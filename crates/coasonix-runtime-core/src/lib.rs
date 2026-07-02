pub mod artifact;
pub mod canonical;
pub mod policy;
pub mod schema;
pub mod state;

#[cfg(test)]
mod tests {
    #[test]
    fn runtime_core_smoke_test_runs() {
        assert_eq!(2 + 2, 4);
    }
}
