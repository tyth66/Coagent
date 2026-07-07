use std::path::PathBuf;

use async_trait::async_trait;

use super::agent_profile::AgentProfile;
use super::backend_trait::{AgentBackend, BackendCapabilities, BackendError, BackendRequest, BackendResponse};
use super::reasonix::{ReasonixError, ReasonixRunner};

/// An ACP backend driven by an AgentProfile.
pub struct AcpBackend {
    profile: AgentProfile,
    runner: ReasonixRunner,
}

impl AcpBackend {
    pub fn new(profile: AgentProfile) -> Self {
        let model = profile
            .args
            .iter()
            .position(|a| a == "--model")
            .and_then(|i| profile.args.get(i + 1))
            .cloned()
            .unwrap_or_else(|| "deepseek-v4-flash".into());
        Self {
            runner: ReasonixRunner::new(&model, profile.cwd.clone()),
            profile,
        }
    }

    /// Legacy constructor for backward compatibility.
    pub fn with_model(_id: impl Into<String>, model: impl Into<String>, cwd: PathBuf) -> Self {
        Self::new(AgentProfile::reasonix(cwd, &model.into()))
    }
}

#[async_trait]
impl AgentBackend for AcpBackend {
        async fn invoke(&self, request: BackendRequest) -> Result<BackendResponse, BackendError> {
        // Build prompt from context.
        let diff_path = request.context.get("diff_path").and_then(|v| v.as_str()).unwrap_or("");
        let prompt = format!(
            "GOAL: {}
DIFF PATH: {}

Analyze the diff and return your review as JSON.",
            request.goal, diff_path,
        );

        let mut client = super::acp_client::AcpClient::connect(
            &self.profile.command,
            &self.profile.args,
            &self.profile.cwd,
        )
        .await
        .map_err(|e| BackendError::Unavailable(e.to_string()))?;

        let text = client
            .send_prompt(&prompt, self.profile.timeout_ms)
            .await
            .map_err(|e| match e {
                super::acp_client::AcpClientError::Spawn(msg) | super::acp_client::AcpClientError::Io(msg) => {
                    BackendError::Unavailable(msg)
                }
                super::acp_client::AcpClientError::Protocol(msg) => BackendError::Protocol(msg),
                super::acp_client::AcpClientError::Timeout(_msg) => BackendError::Timeout,
            })?;

        let payload: serde_json::Value = serde_json::from_str(&text)
            .or_else(|_| {
                text.find('{')
                    .and_then(|start| {
                        let slice = &text[start..];
                        slice.rfind('}').map(|end| &slice[..=end])
                    })
                    .and_then(|json_str| serde_json::from_str(json_str).ok())
                    .ok_or_else(|| BackendError::Protocol("unparseable response".into()))
            })
            .map_err(|e: BackendError| e)?;

        Ok(BackendResponse {
            output_schema: request.output_schema.clone(),
            payload,
        })
    }

    fn backend_id(&self) -> &str {
        &self.profile.backend_id
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            tags: self.profile.capabilities.clone(),
            max_tokens: None,
            supports_streaming: true,
        }
    }
}

/// A mock backend that returns a pass review instantly.
pub struct MockBackend {
    id: String,
}

impl MockBackend {
    pub fn new(id: impl Into<String>) -> Self {
        Self { id: id.into() }
    }
}

#[async_trait]
impl AgentBackend for MockBackend {
    async fn invoke(&self, _request: BackendRequest) -> Result<BackendResponse, BackendError> {
        let review = super::mock::PureReviewResult::mock_pass();
        let payload = serde_json::to_value(&review)
            .map_err(|e| BackendError::Protocol(format!("serialization: {e}")))?;
        Ok(BackendResponse {
            output_schema: "review_result_v1".into(),
            payload,
        })
    }

    fn backend_id(&self) -> &str {
        &self.id
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            tags: vec!["mock".into()],
            max_tokens: None,
            supports_streaming: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_backend_invoke_returns_pass() {
        let backend = MockBackend::new("mock");
        let rt = tokio::runtime::Runtime::new().unwrap();
        let result = rt.block_on(backend.invoke(BackendRequest {
            goal: "test".into(),
            operation: "review_diff".into(),
            output_schema: "review_result_v1".into(),
            read_paths: vec![],
            context: serde_json::json!({}),
        }));
        assert!(result.is_ok());
        let response = result.unwrap();
        assert_eq!(response.payload["verdict"], "pass");
    }

    #[test]
    fn acp_backend_registers_with_id() {
        let profile = AgentProfile::reasonix(PathBuf::from("."), "deepseek-v4-flash");
        let backend = AcpBackend::new(profile);
        assert_eq!(backend.backend_id(), "reasonix");
        assert!(backend.capabilities().tags.contains(&"code.review.diff".to_string()));
    }
}
