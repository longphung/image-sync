#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error("HTTP request failed: {0}")]
    Http(String),
    #[error("failed to parse XML: {0}")]
    XmlParse(String),
    #[error("unrecognized camera device description at {0} (neither Scalar nor DLNA)")]
    UnrecognizedDevice(String),
    #[error("SOAP Browse error: {0}")]
    Soap(String),
    #[error("Scalar JSON-RPC error: {0}")]
    JsonRpc(String),
    #[error("I/O error: {0}")]
    Io(String),
}

impl From<std::io::Error> for CoreError {
    fn from(e: std::io::Error) -> Self {
        CoreError::Io(e.to_string())
    }
}

impl From<ureq::Error> for CoreError {
    fn from(e: ureq::Error) -> Self {
        CoreError::Http(e.to_string())
    }
}

impl From<quick_xml::Error> for CoreError {
    fn from(e: quick_xml::Error) -> Self {
        CoreError::XmlParse(e.to_string())
    }
}
