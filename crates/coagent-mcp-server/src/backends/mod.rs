pub mod mock;
pub mod reasonix;

use std::path::PathBuf;

use crate::config::BackendId;

#[derive(Clone)]
pub enum Backend {
    Mock,
    Reasonix(reasonix::ReasonixRunner),
}

impl Backend {
    pub fn from_config(backend_id: BackendId, reasonix_model: &str) -> Self {
        match backend_id {
            BackendId::Mock => Self::Mock,
            BackendId::Reasonix => Self::Reasonix(reasonix::ReasonixRunner::new(
                reasonix_model,
                PathBuf::from("."),
            )),
        }
    }
}
