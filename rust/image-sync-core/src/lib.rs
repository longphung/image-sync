pub fn ping() -> String {
    "pong from image-sync-core".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_returns_expected_string() {
        assert_eq!(ping(), "pong from image-sync-core");
    }
}
