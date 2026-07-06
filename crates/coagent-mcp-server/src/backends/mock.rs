use serde::{Deserialize, Serialize};

/// Pure review result returned by backends (no system envelope fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PureReviewResult {
    pub verdict: String,
    pub summary: String,
    pub findings: Vec<serde_json::Value>,
    pub tests_to_run: Vec<String>,
    pub risks: Vec<String>,
    pub assumptions: Vec<String>,
    pub confidence: f64,
}

impl PureReviewResult {
    pub fn mock_pass() -> Self {
        Self {
            verdict: "pass".into(),
            summary: "Mock runner completed review.".into(),
            findings: vec![],
            tests_to_run: vec![],
            risks: vec![],
            assumptions: vec![],
            confidence: 0.9,
        }
    }
}
