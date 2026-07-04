uniffi::setup_scaffolding!();

#[uniffi::export]
pub fn ping() -> String {
    image_sync_core::ping()
}
