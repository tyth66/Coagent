use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::mock::PureReviewResult;

// ── Persistent ACP Session ──

/// A long-lived Reasonix ACP process with an established session.
/// Created once at server startup, reused for every review_diff call.
struct AcpSession {
    child: Child,
    stdin: tokio::process::ChildStdin,
    reader: BufReader<tokio::process::ChildStdout>,
    session_id: String,
    next_request_id: u64,
}

impl AcpSession {
    async fn connect(model: &str, cwd: &PathBuf) -> Result<Self, ReasonixError> {
        let reasonix_cmd =
            std::env::var("COAGENT_REASONIX_PATH").unwrap_or_else(|_| "reasonix".into());

        let mut child = Command::new(&reasonix_cmd)
            .arg("acp")
            .arg("--model")
            .arg(model)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| ReasonixError::Spawn(e.to_string()))?;

        let mut stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");
        let mut reader = BufReader::new(stdout);

        // ACP initialize
        send_frame(&mut stdin, 1, "initialize", &serde_json::json!({
            "protocolVersion": 1,
            "clientInfo": { "name": "coagent", "version": "0.1.0" }
        })).await?;
        read_response_line(&mut reader).await?; // ignore init response

        // ACP session/new
        send_frame(&mut stdin, 2, "session/new", &serde_json::json!({
            "cwd": cwd.to_string_lossy()
        })).await?;

        let session_resp = read_response_line(&mut reader).await?;
        let session: serde_json::Value = serde_json::from_str(&session_resp)
            .map_err(|e| ReasonixError::Protocol(format!("session/new: {e}")))?;
        let session_id = session["result"]["sessionId"]
            .as_str()
            .ok_or_else(|| ReasonixError::Protocol("missing sessionId".into()))?
            .to_string();

        Ok(Self {
            child,
            stdin,
            reader,
            session_id,
            next_request_id: 3,
        })
    }

    /// Send a session/prompt and collect the response.
    async fn send_prompt(&mut self, goal: &str, diff_path: &str) -> Result<PureReviewResult, ReasonixError> {
        let id = self.next_request_id;
        self.next_request_id += 2; // leave room for potential other messages

        let prompt = build_review_prompt(goal, diff_path);
        send_frame(&mut self.stdin, id, "session/prompt", &serde_json::json!({
            "sessionId": self.session_id,
            "prompt": [{ "type": "text", "text": prompt }]
        })).await?;

        // Collect agent_message_chunk notifications until the final response
        let mut collected_text = String::new();
        loop {
            let line = read_response_line(&mut self.reader).await?;
            if line.is_empty() {
                continue;
            }
            let msg: serde_json::Value = serde_json::from_str(&line)
                .map_err(|e| ReasonixError::Protocol(format!("invalid frame: {e}")))?;

            // Check for session/prompt response (our id)
            if msg.get("id").and_then(|v| v.as_i64()) == Some(id as i64) {
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

            // Collect agent_message_chunk notifications
            if msg.get("method").and_then(|v| v.as_str()) == Some("session/update") {
                if let Some(update) = msg.get("params").and_then(|p| p.get("update")) {
                    if update.get("sessionUpdate").and_then(|v| v.as_str()) == Some("agent_message_chunk") {
                        if let Some(text) = update.get("content").and_then(|c| c.get("text")).and_then(|v| v.as_str()) {
                            collected_text.push_str(text);
                        }
                    }
                }
            }
        }

        // Parse review from collected text
        let review: PureReviewResult = serde_json::from_str(&collected_text)
            .or_else(|_| extract_json(&collected_text))
            .map_err(|e| ReasonixError::Protocol(format!("parse review: {e}")))?;

        Ok(review)
    }


    async fn shutdown(&mut self) {
        let _ = self.child.kill().await;
    }
}

// ── Reasonix Runner (wraps AcpSession) ──

/// Reasonix backend using a persistent ACP session.
/// Lazy-initialized: connects on first use, reused thereafter.
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
}

// ── Session Pool (global, lazy-init) ──

use std::sync::Arc;
use std::sync::OnceLock;
use tokio::sync::Mutex as TokioMutex;

type SessionPool = Arc<TokioMutex<Option<AcpSession>>>;

static SESSION_POOL: OnceLock<SessionPool> = OnceLock::new();

fn get_pool() -> &'static SessionPool {
    SESSION_POOL.get_or_init(|| Arc::new(TokioMutex::new(None)))
}

impl ReasonixRunner {
    pub async fn run(
        &self,
        goal: &str,
        diff_path: &str,
    ) -> Result<PureReviewResult, ReasonixError> {
        let pool = get_pool();
        let mut guard = pool.lock().await;

        // Lazy-init: connect on first call
        if guard.is_none() {
            let session = AcpSession::connect(&self.model, &self.cwd).await?;
            *guard = Some(session);
        }

        let session = guard.as_mut().unwrap();
        session.send_prompt(goal, diff_path).await
    }
}

// ── Helpers ──

async fn send_frame(
    stdin: &mut tokio::process::ChildStdin,
    id: u64,
    method: &str,
    params: &serde_json::Value,
) -> Result<(), ReasonixError> {
    let frame = serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": method,
        "params": params
    });
    stdin
        .write_all(format!("{}\n", frame).as_bytes())
        .await
        .map_err(|e| ReasonixError::Io(e.to_string()))?;
    stdin.flush().await.map_err(|e| ReasonixError::Io(e.to_string()))
}

async fn read_response_line(
    reader: &mut BufReader<tokio::process::ChildStdout>,
) -> Result<String, ReasonixError> {
    let mut line = String::new();
    reader
        .read_line(&mut line)
        .await
        .map_err(|e| ReasonixError::Io(e.to_string()))?;
    Ok(line)
}

// ── Error ──

#[derive(Debug, thiserror::Error)]
pub enum ReasonixError {
    #[error("spawn: {0}")]
    Spawn(String),
    #[error("I/O: {0}")]
    Io(String),
    #[error("protocol: {0}")]
    Protocol(String),
}

// ── Prompt builder ──

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

// ── JSON extraction ──

fn extract_json(text: &str) -> Result<PureReviewResult, serde_json::Error> {
    if let Some(start) = text.find('{') {
        let slice = &text[start..];
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
