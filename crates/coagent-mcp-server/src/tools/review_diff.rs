use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::backends::mock::PureReviewResult;

// ── MCP Input schema ──

#[derive(Debug, Clone, Deserialize, JsonSchema)]
#[schemars(rename = "review_diff_input_v1")]
pub struct ReviewDiffInput {
    pub schema_version: String,
    pub task_id: Option<String>,
    pub request_id: Option<String>,
    pub mode: Option<String>,
    pub goal: String,
    pub repo: RepoInfo,
    pub artifacts: Artifacts,
    #[serde(default)]
    pub focus: Vec<String>,
    #[serde(default)]
    pub constraints: Vec<String>,
    pub budget: Option<Budget>,
    pub permission_level: String,
    pub output_schema: String,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct RepoInfo {
    pub root: String,
    pub base_branch: Option<String>,
    pub working_branch: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct Artifacts {
    pub diff_path: String,
    pub context_path: Option<String>,
    pub test_log_path: Option<String>,
    pub build_log_path: Option<String>,
}

#[derive(Debug, Clone, Deserialize, JsonSchema)]
pub struct Budget {
    pub max_minutes: Option<i64>,
    pub max_output_chars: Option<i64>,
    pub max_steps: Option<i64>,
}

// ── Validation ──

#[derive(Debug)]
pub struct ValidationError {
    pub path: String,
    pub message: String,
}

impl ReviewDiffInput {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if self.schema_version != "review_diff_input_v1" {
            return Err(ValidationError {
                path: "/schema_version".into(),
                message: "schema_version must be review_diff_input_v1".into(),
            });
        }
        if self.goal.is_empty() {
            return Err(ValidationError {
                path: "/goal".into(),
                message: "goal is required".into(),
            });
        }
        if self.repo.root.is_empty() {
            return Err(ValidationError {
                path: "/repo/root".into(),
                message: "repo.root is required".into(),
            });
        }
        if self.artifacts.diff_path.is_empty() {
            return Err(ValidationError {
                path: "/artifacts/diff_path".into(),
                message: "artifacts.diff_path is required".into(),
            });
        }
        if self.permission_level != "L1_DIFF_REVIEW" {
            return Err(ValidationError {
                path: "/permission_level".into(),
                message: "permission_level must be L1_DIFF_REVIEW".into(),
            });
        }
        if self.output_schema != "review_result_v1" {
            return Err(ValidationError {
                path: "/output_schema".into(),
                message: "output_schema must be review_result_v1".into(),
            });
        }
        Ok(())
    }
}

// ── Output validation ──

impl PureReviewResult {
    pub fn validate(&self) -> Result<(), ValidationError> {
        if !matches!(
            self.verdict.as_str(),
            "pass" | "needs_fix" | "risky" | "unknown" | "not_applicable"
        ) {
            return Err(ValidationError {
                path: "/verdict".into(),
                message: "verdict must be a valid review verdict".into(),
            });
        }
        if self.summary.is_empty() {
            return Err(ValidationError {
                path: "/summary".into(),
                message: "summary must be a non-empty string".into(),
            });
        }
        if !(0.0..=1.0).contains(&self.confidence) {
            return Err(ValidationError {
                path: "/confidence".into(),
                message: "confidence must be between 0 and 1".into(),
            });
        }
        Ok(())
    }
}

// ── Coagent wrapper (metadata attached by server, not by backend) ──

#[derive(Debug, Serialize)]
pub struct CoagentReviewWrapper {
    pub review: PureReviewResult,
    pub metadata: ReviewMetadata,
}

#[derive(Debug, Serialize)]
pub struct ReviewMetadata {
    pub schema_version: String,
    pub task_id: String,
    pub request_id: String,
    pub status: String,
    pub operation: String,
    pub runtime_decision: String,
}
