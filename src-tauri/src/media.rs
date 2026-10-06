use crate::{
    links::decode,
    state::{display_path, HostState},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::LazyLock,
};
use tauri::{AppHandle, Manager, State};
use url::Url;

const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
pub fn image_type(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "svg" => Some("image/svg+xml"),
        "webp" => Some("image/webp"),
        "ico" => Some("image/x-icon"),
        "bmp" => Some("image/bmp"),
        "avif" => Some("image/avif"),
        _ => None,
    }
}

fn local_image_path(src: &str, document: &Path) -> Option<PathBuf> {
    if let Ok(url) = Url::parse(src) {
        return match url.scheme() {
            "file" => url.to_file_path().ok(),
            "media" if url.host_str() == Some("local") => path_from_uri(url.path()).ok(),
            _ => {
                #[cfg(windows)]
                if src.as_bytes().get(1) == Some(&b':') {
                    return Some(PathBuf::from(decode(src).ok()?));
                }
                None
            }
        };
    }
    Some(document.parent()?.join(decode(src).ok()?))
}

pub fn grant_document(state: &HostState, document: &Path, content: &str) {
    static MARKDOWN_IMAGES: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"!\[[^\]]*\]\(\s*(?:<([^>]+)>|([^\s)]+))").unwrap());
    static HTML_IMAGES: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r#"(?is)<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']"#).unwrap());
    if let Ok(mut scope) = state.media.lock() {
        if let Some(parent) = document.parent().and_then(|p| fs::canonicalize(p).ok()) {
            scope.directories.insert(parent);
        }
        for captures in MARKDOWN_IMAGES
            .captures_iter(content)
            .chain(HTML_IMAGES.captures_iter(content))
        {
            if let Some(src) = captures.get(1).or_else(|| captures.get(2)) {
                if let Some(path) =
                    local_image_path(src.as_str(), document).and_then(|p| fs::canonicalize(p).ok())
                {
                    if image_type(&path).is_some() {
                        scope.files.insert(path);
                    }
                }
            }
        }
    }
}

pub fn path_from_uri(uri_path: &str) -> Result<PathBuf, String> {
    let mut path = decode(uri_path)?;
    if path.starts_with("/local/") {
        path = path[6..].to_string();
    }
    #[cfg(windows)]
    if path.as_bytes().first() == Some(&b'/') && path.as_bytes().get(2) == Some(&b':') {
        path.remove(0);
    }
    Ok(PathBuf::from(path))
}

pub fn response(app: &AppHandle, uri_path: &str) -> tauri::http::Response<Vec<u8>> {
    let result = (|| -> Result<(Vec<u8>, &'static str), String> {
        let path = fs::canonicalize(path_from_uri(uri_path)?).map_err(|e| e.to_string())?;
        let mime = image_type(&path).ok_or("Only image resources are served.")?;
        let state = app.state::<HostState>();
        let scope = state.media.lock().map_err(|e| e.to_string())?;
        if !scope.files.contains(&path)
            && !scope.directories.iter().any(|dir| path.starts_with(dir))
        {
            return Err("This image is outside the opened document scope.".into());
        }
        drop(scope);
        if fs::metadata(&path).map_err(|e| e.to_string())?.len() > MAX_IMAGE_BYTES {
            return Err("Image is too large.".into());
        }
        Ok((fs::read(&path).map_err(|e| e.to_string())?, mime))
    })();
    match result {
        Ok((bytes, mime)) => tauri::http::Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("Access-Control-Allow-Origin", "*")
            .header(
                "Content-Security-Policy",
                "default-src 'none'; style-src 'unsafe-inline'",
            )
            .header("X-Content-Type-Options", "nosniff")
            .body(bytes)
            .unwrap(),
        Err(_) => tauri::http::Response::builder()
            .status(404)
            .header("Access-Control-Allow-Origin", "*")
            .body(Vec::new())
            .unwrap(),
    }
}

fn write_image(
    state: &HostState,
    document_path: &str,
    filename: &str,
    data: &[u8],
) -> Result<String, String> {
    let document = Path::new(document_path);
    let directory = document
        .parent()
        .ok_or("Save the document before importing images.")?
        .join("images");
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    let filename = Path::new(filename)
        .file_name()
        .ok_or("Invalid image name.")?;
    let stem = Path::new(filename)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    let extension = Path::new(filename)
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    for suffix in 0..10000 {
        let name = if suffix == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}_{suffix}.{extension}")
        };
        let target = directory.join(name);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&target)
        {
            Ok(mut file) => {
                file.write_all(data)
                    .and_then(|_| file.sync_all())
                    .map_err(|e| e.to_string())?;
                let target = fs::canonicalize(target).map_err(|e| e.to_string())?;
                state
                    .media
                    .lock()
                    .map_err(|e| e.to_string())?
                    .files
                    .insert(target.clone());
                let url = Url::from_file_path(Path::new(&display_path(&target)))
                    .map_err(|_| "Invalid image path.")?;
                return Ok(format!("media://local{}", url.path()));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Unable to choose an image file name.".into())
}

#[tauri::command]
pub async fn copy_image_to_doc(
    state: State<'_, HostState>,
    source_path: String,
    document_path: Option<String>,
) -> Result<String, String> {
    let source = fs::canonicalize(&source_path).map_err(|e| e.to_string())?;
    let mime = image_type(&source).ok_or("Unsupported image format.")?;
    if fs::metadata(&source).map_err(|e| e.to_string())?.len() > MAX_IMAGE_BYTES {
        return Err("Image is too large.".into());
    }
    let data = fs::read(&source).map_err(|e| e.to_string())?;
    if let Some(document) = document_path {
        write_image(
            &state,
            &document,
            &source.file_name().unwrap_or_default().to_string_lossy(),
            &data,
        )
    } else {
        Ok(format!("data:{mime};base64,{}", STANDARD.encode(data)))
    }
}

#[tauri::command]
pub async fn paste_image(
    state: State<'_, HostState>,
    buffer: Vec<u8>,
    mime_type: String,
    document_path: Option<String>,
) -> Result<String, String> {
    let extension = match mime_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        "image/avif" => "avif",
        _ => return Err("Unsupported image format.".into()),
    };
    if buffer.len() as u64 > MAX_IMAGE_BYTES {
        return Err("Image is too large.".into());
    }
    if let Some(document) = document_path {
        write_image(
            &state,
            &document,
            &format!(
                "pasted_{}.{extension}",
                chrono::Utc::now().timestamp_millis()
            ),
            &buffer,
        )
    } else {
        Ok(format!(
            "data:{mime_type};base64,{}",
            STANDARD.encode(buffer)
        ))
    }
}
