use crate::state::{display_path, document_type, error_value};
use percent_encoding::percent_decode_str;
use serde_json::{json, Value};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use url::Url;

pub fn attachment_allowed(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some(
            "pdf"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "bmp"
                | "avif"
                | "mp3"
                | "wav"
                | "ogg"
                | "mp4"
                | "webm"
        )
    )
}
pub fn decode(value: &str) -> Result<String, String> {
    let bytes = value.as_bytes();
    for (i, byte) in bytes.iter().enumerate() {
        if *byte == b'%'
            && (i + 2 >= bytes.len()
                || !bytes[i + 1].is_ascii_hexdigit()
                || !bytes[i + 2].is_ascii_hexdigit())
        {
            return Err("Invalid URL encoding.".into());
        }
    }
    percent_decode_str(value)
        .decode_utf8()
        .map(|v| v.into_owned())
        .map_err(|_| "Invalid URL encoding.".into())
}
fn normalized(path: &Path) -> PathBuf {
    let mut output = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                output.pop();
            }
            other => output.push(other.as_os_str()),
        }
    }
    output
}
pub fn validate_local_path(path: &str) -> Result<(), String> {
    if path.chars().any(|c| c.is_control()) {
        return Err("Invalid file path.".into());
    }
    if path.starts_with("//") || path.starts_with(r"\\") {
        return Err("Network and device paths are not supported.".into());
    }
    #[cfg(windows)]
    {
        let rest = if path.as_bytes().get(1) == Some(&b':') {
            &path[2..]
        } else {
            path
        };
        if rest.contains(':') {
            return Err("Invalid Windows file path.".into());
        }
    }
    Ok(())
}

pub fn resolve_value(href: &str, document_path: Option<&str>) -> Result<Value, String> {
    let href = href.trim();
    if href.is_empty() || href.chars().any(|c| c.is_control()) {
        return Err("Invalid link address.".into());
    }
    if let Ok(url) = Url::parse(href) {
        if matches!(url.scheme(), "http" | "https" | "mailto") {
            return Ok(json!({"kind":"external","url":url.as_str()}));
        }
    }
    let (destination, fragment) = href.split_once('#').unwrap_or((href, ""));
    let anchor = decode(fragment)?;
    if href.starts_with('#') {
        return Ok(json!({"kind":"anchor","anchor":anchor}));
    }
    let raw = if destination.to_ascii_lowercase().starts_with("file:") {
        let url = Url::parse(destination).map_err(|_| "Invalid file URL.")?;
        if url.query().is_some() {
            return Err("File links cannot contain a query string.".into());
        }
        if url
            .host_str()
            .is_some_and(|host| !host.is_empty() && host != "localhost")
        {
            return Err("Network paths are not supported.".into());
        }
        // Validate escapes before URL conversion, which otherwise accepts malformed percent escapes.
        decode(url.path())?;
        display_path(&url.to_file_path().map_err(|_| "Invalid local file URL.")?)
    } else {
        let drive = destination.as_bytes().get(1) == Some(&b':')
            && destination
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_alphabetic)
            && destination
                .as_bytes()
                .get(2)
                .is_some_and(|b| *b == b'/' || *b == b'\\');
        if destination.contains(':') && !drive {
            return Err("This link protocol is not supported.".into());
        }
        decode(destination)?
    };
    validate_local_path(&raw)?;
    let raw_path = Path::new(&raw);
    let path = if raw_path.is_absolute() {
        normalized(raw_path)
    } else {
        let base = document_path.ok_or("Save this document before opening a relative link.")?;
        normalized(
            &Path::new(base)
                .parent()
                .ok_or("Invalid document path.")?
                .join(raw_path),
        )
    };
    let kind = if document_type(&path) {
        "document"
    } else if attachment_allowed(&path) {
        "attachment"
    } else {
        return Err("This file type cannot be opened from a document link.".into());
    };
    Ok(json!({"kind":kind,"path":display_path(&path),"anchor":anchor}))
}

#[tauri::command]
pub fn resolve_link(href: String, document_path: Option<String>) -> Value {
    match resolve_value(&href, document_path.as_deref()) {
        Ok(target) => json!({"target":target}),
        Err(error) => error_value(error),
    }
}
#[tauri::command]
pub async fn open_attachment(app: AppHandle, path: String) -> String {
    let attempt = || -> Result<(), String> {
        validate_local_path(&path)?;
        if !Path::new(&path).is_absolute() || !attachment_allowed(Path::new(&path)) {
            return Err("Unsupported attachment.".into());
        }
        let canonical = fs::canonicalize(&path)
            .map_err(|_| "Unable to open attachment. Check that the file exists.")?;
        validate_local_path(&display_path(&canonical))?;
        if !canonical.is_file() || !attachment_allowed(&canonical) {
            return Err("Unsupported attachment.".into());
        }
        app.opener()
            .open_path(display_path(&canonical), None::<&str>)
            .map_err(|e| e.to_string())
    };
    attempt().err().unwrap_or_default()
}
#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let parsed = Url::parse(&url).map_err(|_| "Invalid URL.")?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err("Unsupported external link.".into());
    }
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}
