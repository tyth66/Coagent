use schemars::JsonSchema;
use serde::{Deserialize, Serialize};


// -- MCP Input schema for rescue --

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[schemars(rename = "rescue_input_v1")]
pub struct RescueInput {
    pub schema_version: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub request_id: Option<String>,
    pub goal: String,
    pub repo_root: String,
    #[serde(default)]
    pub focus: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    pub permission_level: String,
    pub output_schema: String,
}

// Rescue reuses PureReviewResult for backend output and CoagentReviewWrapper for the response.
// This keeps the pipeline closures identical to review_diff.

impl RescueInput {
    #[allow(dead_code)]
    /// Create a rescue input from a natural-language goal.
    pub fn new(goal: impl Into<String>, repo_root: impl Into<String>) -> Self {
        Self {
            schema_version: "rescue_input_v1".into(),
            task_id: None,
            request_id: None,
            goal: goal.into(),
            repo_root: repo_root.into(),
            focus: vec![],
            constraints: vec![],
            permission_level: "L1_DIFF_REVIEW".into(),
            output_schema: "review_result_v1".into(),
        }
    }
}
