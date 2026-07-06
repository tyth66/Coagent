use std::sync::Arc;

use rmcp::{
    handler::server::wrapper::Parameters,
    tool, tool_router,
    ServiceExt,
    transport::stdio,
};
use schemars::JsonSchema;
use serde::Deserialize;

mod config;

#[derive(Debug, Deserialize, JsonSchema)]
struct PingParams {
    message: Option<String>,
}

#[derive(Clone)]
struct CoagentServer {
    #[allow(dead_code)]
    config: Arc<config::Config>,
}

#[tool_router(server_handler)]
impl CoagentServer {
    #[tool(description = "Placeholder: will be replaced by review_diff")]
    async fn ping(
        &self,
        Parameters(params): Parameters<PingParams>,
    ) -> String {
        format!("pong: {}", params.message.as_deref().unwrap_or("no message"))
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Arc::new(config::Config::from_env()?);
    let server = CoagentServer { config };

    let service = server.serve(stdio()).await?;
    service.waiting().await?;

    Ok(())
}
