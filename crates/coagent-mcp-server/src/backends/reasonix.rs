use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

use super::mock::PureReviewResult;

/// Reasonix backend runner using ACP protocol over stdio.
#[derive(Clone)]
pub struct ReasonixRunner {
    model: String,
    cwd: PathBuf,
}

impl ReasonixRunner {
    pub fn new(model: impl Into<String>, cwd: PathBuf) -> Self {
        Self {
            model: model.into(),
            cwd,
        }
    }

    /// Run a review_diff through the Reasonix ACP backend.
    /// Returns the pure review result parsed from the ACP session output.
    pub async fn run(
        &self,
        _goal: &str,
        _diff_path: &str,
    ) -> Result<PureReviewResult, ReasonixError> {
        // Start the ACP process
        let mut child = Command::new("reasonix")
            .arg("acp")
            .arg("--model")
            .arg(&self.model)
            .current_dir(&self.cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ReasonixError::Spawn(e.to_string()))?;

        let mut stdin = child.stdin.take().expect("stdin not available");
        let stdout = child.stdout.take().expect("stdout not available");
        let stderr = child.stderr.take().expect("stderr not available");

        let mut reader = BufReader::new(stdout).lines();

        // ACP initialize handshake
        let init_frame = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": 1,
                "clientInfo": { "name": "coagent", "version": "0.1.0" }
            }
        });
        stdin
            .write_all(format!("{}\n", init_frame).as_bytes())
            .await
            .map_err(|e| ReasonixError::Io(e.to_string()))?;
        stdin.flush().await.map_err(|e| ReasonixError::Io(e.to_string()))?;

        // Read initialize response
        let _init_resp = read_line(&mut reader)
            .await
            .map_err(|e| ReasonixError::Protocol(format!("initialize failed: {e}")))?;

        // ACP session/new
        let session_frame = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/new",
            "params": { "cwd": self.cwd.to_string_lossy() }
        });
        stdin
            .write_all(format!("{}\n", session_frame).as_bytes())
            .await
            .map_err(|e| ReasonixError::Io(e.to_string()))?;
        stdin.flush().await.map_err(|e| ReasonixError::Io(e.to_string()))?;

        let session_resp = read_line(&mut reader)
            .await
            .map_err(|e| ReasonixError::Protocol(format!("session/new failed: {e}")))?;
        let session: serde_json::Value = serde_json::from_str(&session_resp)
            .map_err(|e| ReasonixError::Protocol(format!("invalid session response: {e}")))?;
        let session_id = session["result"]["sessionId"]
            .as_str()
            .ok_or_else(|| ReasonixError::Protocol("missing sessionId".into()))?
            .to_string();

        // Build review prompt and send session/prompt
        let prompt = build_review_prompt(_goal, _diff_path);
        let prompt_frame = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 3,
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": prompt }]
            }
        });
        stdin
            .write_all(format!("{}\n", prompt_frame).as_bytes())
            .await
            .map_err(|e| ReasonixError::Io(e.to_string()))?;
        stdin.flush().await.map_err(|e| ReasonixError::Io(e.to_string()))?;

        // Collect agent_message_chunk notifications and final response
        let mut collected_text = String::new();
        loop {
            let line = read_line(&mut reader)
                .await
                .map_err(|e| ReasonixError::Protocol(format!("read failed: {e}")))?;
            if line.is_empty() {
                continue;
            }
            let msg: serde_json::Value = serde_json::from_str(&line)
                .map_err(|e| ReasonixError::Protocol(format!("invalid frame: {e}")))?;

            // Check for session/prompt response
            if msg.get("id").and_then(|v| v.as_i64()) == Some(3) {
                if let Some(err) = msg.get("error") {
                    return Err(ReasonixError::Protocol(
                        err.get("message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown error")
                            .into(),
                    ));
                }
                break;
            }

            // Check for agent_message_chunk notification
            if msg.get("method").and_then(|v| v.as_str()) == Some("session/update") {
                if let Some(update) = msg.get("params").and_then(|p| p.get("update")) {
                    if update.get("sessionUpdate").and_then(|v| v.as_str()) == Some("agent_message_chunk") {
                        if let Some(text) = update
                            .get("content")
                            .and_then(|c| c.get("text"))
                            .and_then(|v| v.as_str())
                        {
                            collected_text.push_str(text);
                        }
                    }
                }
            }
        }

        // Drain stderr
        let _stderr_output = drain_stderr(stderr).await;

        // Parse JSON from collected text
        let review: PureReviewResult = serde_json::from_str(&collected_text)
            .or_else(|_| {
                // Try to extract JSON from the text (may have markdown wrapping)
                extract_json(&collected_text)
            })
            .map_err(|e| ReasonixError::Protocol(format!("failed to parse review result: {e}")))?;

        Ok(review)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ReasonixError {
    #[error("spawn failed: {0}")]
    Spawn(String),
    #[error("I/O error: {0}")]
    Io(String),
    #[error("protocol error: {0}")]
    Protocol(String),
}

async fn read_line(
    reader: &mut tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
) -> Result<String, String> {
    reader
        .next_line()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "stdout closed".to_string())
}

async fn drain_stderr(stderr: tokio::process::ChildStderr) -> String {
    let reader = BufReader::new(stderr);
    let mut lines = reader.lines();
    let mut output = String::new();
    while let Ok(Some(line)) = lines.next_line().await {
        output.push_str(&line);
        output.push('\n');
    }
    output
}

fn build_review_prompt(goal: &str, diff_path: &str) -> String {
    format!(
        "You are reviewing a code diff.\n\n\
         Review goal: {goal}\n\n\
         Artifacts:\n\
         - diff_path: {diff_path}\n\n\
         Read the diff file, analyze it, then return your review as a single JSON \
         object with this exact schema. Return ONLY the JSON, no other text:\n\
         {{\n  \"verdict\": \"pass\" | \"needs_fix\" | \"risky\" | \"unknown\",\n  \
         \"summary\": \"one-sentence summary\",\n  \
         \"findings\": [],\n  \
         \"tests_to_run\": [],\n  \
         \"risks\": [],\n  \
         \"assumptions\": [],\n  \
         \"confidence\": 0.0-1.0\n}}"
    )
}

/// Extract a JSON object from text that may contain markdown wrapping.
fn extract_json(text: &str) -> Result<PureReviewResult, serde_json::Error> {
    // Try to find the first '{' and matching '}'
    if let Some(start) = text.find('{') {
        let slice = &text[start..];
        // Try parsing progressively shorter slices
        let mut end = slice.len();
        while end > 0 {
            if let Ok(v) = serde_json::from_str(&slice[..end]) {
                return Ok(v);
            }
            end = slice[..end].rfind('}').map(|i| i + 1).unwrap_or(0);
        }
    }
    serde_json::from_str(text)
}
