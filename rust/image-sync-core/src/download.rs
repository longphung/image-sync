use crate::error::CoreError;

/// Download `url` to `dest_path`, skipping (returning `Ok(false)`) if a file
/// already exists there, and creating parent directories as needed.
pub fn download_image(url: &str, dest_path: &str) -> Result<bool, CoreError> {
    let dest = std::path::Path::new(dest_path);
    if dest.exists() {
        return Ok(false);
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let mut resp = ureq::get(url)
        .call()
        .map_err(|e| CoreError::Http(format!("GET {url}: {e}")))?;
    let mut file = std::fs::File::create(dest)?;
    std::io::copy(&mut resp.body_mut().as_reader(), &mut file)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn skips_existing_destination_without_network() {
        let existing = tempfile::NamedTempFile::new().unwrap();
        let dest_path = existing.path().to_str().unwrap();
        // Port 1 on localhost is never listening; if the skip check didn't
        // happen before any network attempt, this would error instead of
        // returning Ok(false).
        let result = download_image("http://127.0.0.1:1/unreachable", dest_path);
        assert!(!result.unwrap());
    }

    #[test]
    fn creates_parent_directories_before_download() {
        let dir = tempfile::tempdir().unwrap();
        let dest = dir.path().join("nested").join("sub").join("photo.jpg");
        let dest_path = dest.to_str().unwrap();
        // The network call will fail (nothing listening on port 1), but the
        // parent directories should already have been created by then.
        let _ = download_image("http://127.0.0.1:1/unreachable", dest_path);
        assert!(dest.parent().unwrap().exists());
    }
}
