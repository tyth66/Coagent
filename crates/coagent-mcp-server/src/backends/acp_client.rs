use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};

/// Error type for ACP client operations.
#[derive(Debug, thiserror::Error)]
pub enum AcpClientError {
    #[error("spawn: {0}")]
    Spawn(String),
    #[error("I/O: {0}")]
    Io(String),
    #[error("protocol: {0}")]
    Protocol(String),
    #[error("timeout: {0}")]
    Timeout(String),
}

/// A long-lived ACP session connected to a backend process.
/// Generic: not tied to Reasonix — any ACP-compatible agent can use this.
pub struct AcpClient {
    child: Child,
    stdin: tokio::process::ChildStdin,
    reader: BufReader<tokio::process::ChildStdout>,
    session_id: String,
    next_request_id: u64,
}

impl Drop for AcpClient {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

impl AcpClient {
    /// Connect to an ACP agent by spawning its command.
    pub async fn connect(command: &str, args: &[String], cwd: &PathBuf) -> Result<Self, AcpClientError> {
        let mut child = Command::new(command)
            .args(args)
            .current_dir(cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| AcpClientError::Spawn(e.to_string()))?;

        let mut stdin = child.stdin.take().expect("stdin");
        let stdout = child.stdout.take().expect("stdout");
        let mut reader = BufReader::new(stdout);

        // ACP initialize
        send_frame(
            &mut stdin,
            1,
            "initialize",
            &serde_json::json!({
                "protocolVersion": 1,
                "clientInfo": { "name": "coagent", "version": "0.2.0" }
            }),
        )
        .await?;
        let init_resp = read_line(&mut reader).await?;
        parse_response_frame(&init_resp, 1, "initialize")?;

        // ACP session/new
        send_frame(
            &mut stdin,
            2,
            "session/new",
            &serde_json::json!({ "cwd": cwd.to_string_lossy() }),
        )
        .await?;
        let session_resp = read_line(&mut reader).await?;
        let session = parse_response_frame(&session_resp, 2, "session/new")?;
        let session_id = session["result"]["sessionId"]
            .as_str()
            .ok_or_else(|| AcpClientError::Protocol("missing sessionId".into()))?
            .to_string();

        Ok(Self {
            child,
            stdin,
            reader,
            session_id,
            next_request_id: 3,
        })
    }

    /// Send a prompt and collect the text response.
    pub async fn send_prompt(
        &mut self,
        prompt: &str,
        timeout_ms: u64,
    ) -> Result<String, AcpClientError> {
        let deadline = tokio::time::Instant::now()
            + std::time::Duration::from_millis(timeout_ms);
        let id = self.next_request_id;
        self.next_request_id += 2;

        send_frame(
            &mut self.stdin,
            id,
            "session/prompt",
            &serde_json::json!({
                "sessionId": self.session_id,
                "prompt": [{ "type": "text", "text": prompt }]
            }),
        )
        .await?;

        let mut collected_text = String::new();
        loop {
            let line = tokio::time::timeout_at(deadline, read_line(&mut self.reader))
                .await
                .map_err(|_| AcpClientError::Timeout("ACP prompt timed out".into()))??;
            if line.is_empty() {
                continue;
            }
            let msg: serde_json::Value = serde_json::from_str(&line)
                .map_err(|e| AcpClientError::Protocol(format!("invalid frame: {e}")))?;

            if msg.get("id").and_then(|v| v.as_i64()) == Some(id as i64) {
                if let Some(err) = msg.get("error") {
                    return Err(AcpClientError::Protocol(
                        err.get("message")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown error")
                            .into(),
                    ));
                }
                break;
            }

            if msg.get("method").and_then(|v| v.as_str()) == Some("session/update")
                && let Some(update) = msg.get("params").and_then(|p| p.get("update"))
                && update.get("sessionUpdate").and_then(|v| v.as_str())
                    == Some("agent_message_chunk")
                && let Some(text) = update
                    .get("content")
                    .and_then(|c| c.get("text"))
                    .and_then(|v| v.as_str())
            {
                collected_text.push_str(text);
            }
        }

        Ok(collected_text)
    }
}

// ── Protocol helpers ──

async fn send_frame(
    stdin: &mut tokio::process::ChildStdin,
    id: u64,
    method: &str,
    params: &serde_json::Value,
) -> Result<(), AcpClientError> {
    let frame = serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
    stdin
        .write_all(format!("{}\n", frame).as_bytes())
        .await
        .map_err(|e| AcpClientError::Io(e.to_string()))?;
    stdin.flush().await.map_err(|e| AcpClientError::Io(e.to_string()))
}

async fn read_line(
    reader: &mut BufReader<tokio::process::ChildStdout>,
) -> Result<String, AcpClientError> {
    let mut line = String::new();
    let bytes_read = reader.read_line(&mut line).await
        .map_err(|e| AcpClientError::Io(e.to_string()))?;
    if bytes_read == 0 {
        return Err(AcpClientError::Protocol("ACP process closed stdout".into()));
    }
    Ok(line)
}

fn parse_response_frame(
    line: &str,
    expected_id: u64,
    context: &str,
) -> Result<serde_json::Value, AcpClientError> {
    let frame: serde_json::Value = serde_json::from_str(line)
        .map_err(|e| AcpClientError::Protocol(format!("{context}: invalid frame: {e}")))?;
    if frame.get("id").and_then(|v| v.as_u64()) != Some(expected_id) {
        return Err(AcpClientError::Protocol(format!("{context}: unexpected response id")));
    }
    if let Some(error) = frame.get("error") {
        return Err(AcpClientError::Protocol(format!(
            "{context}: {}",
            error.get("message").and_then(|v| v.as_str()).unwrap_or("unknown error")
        )));
    }
    Ok(frame)
}
