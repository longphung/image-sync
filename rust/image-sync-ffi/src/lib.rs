uniffi::setup_scaffolding!();

mod types;
pub use types::{CameraApi, CameraError, ImageItem};

#[uniffi::export]
pub fn ping() -> String {
    image_sync_core::ping()
}

#[uniffi::export]
pub fn get_camera_api(host: Option<String>) -> Result<CameraApi, CameraError> {
    image_sync_core::get_camera_api(host.as_deref())
        .map(Into::into)
        .map_err(Into::into)
}

#[uniffi::export]
pub fn list_images(api: CameraApi) -> Result<Vec<ImageItem>, CameraError> {
    let core_api: image_sync_core::CameraApi = api.into();
    image_sync_core::list_images(&core_api)
        .map(|items| items.into_iter().map(Into::into).collect())
        .map_err(Into::into)
}

#[uniffi::export]
pub fn download_image(url: String, dest_path: String) -> Result<bool, CameraError> {
    image_sync_core::download_image(&url, &dest_path).map_err(Into::into)
}
