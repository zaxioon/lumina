use crate::{
    media,
    state::{
        canonical_for_save, display_path, document_type, error_value, same_path, HostState,
        RecentFile,
    },
};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{
    DialogExt, FilePath, MessageDialogButtons, MessageDialogKind, MessageDialogResult,
};
use tauri_plugin_opener::OpenerExt;

fn filesystem_path(file: FilePath) -> Result<PathBuf, String> {
    file.into_path().map_err(|_| "This platform URI needs a document-provider adapter; desktop filesystem paths are supported.".to_string())
}
pub fn read_document(state: &HostState, path: &Path) -> Result<Value, String> {
    if !document_type(path) {
        return Err("Choose a Markdown or text document.".into());
    }
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let raw = fs::read_to_string(&canonical).map_err(|e| e.to_string())?;
    let content = raw.strip_prefix('\u{feff}').unwrap_or(&raw);
    media::grant_document(state, &canonical, content);
    Ok(json!({"path":display_path(&canonical),"content":content}))
}
fn default_documents(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .unwrap_or_else(|_| app.path().app_data_dir().unwrap_or_default())
        .join("Lumina")
}
fn write_document(state: &HostState, path: &Path, content: &str) -> Result<(), String> {
    if !document_type(path) {
        return Err("Choose a Markdown or text filename.".into());
    }
    let path = canonical_for_save(path)?;
    let mut file = fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(content.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    media::grant_document(state, &path, content);
    Ok(())
}

#[tauri::command]
pub async fn open_file(
    app: AppHandle,
    state: State<'_, HostState>,
) -> Result<Option<Value>, String> {
    let cached = state
        .persisted
        .lock()
        .map_err(|e| e.to_string())?
        .last_open_directory
        .clone();
    let directory = if Path::new(&cached).is_dir() {
        PathBuf::from(cached)
    } else {
        default_documents(&app)
    };
    let mut picker = app
        .dialog()
        .file()
        .set_title("Open document")
        .add_filter("Markdown and text", &["md", "markdown", "txt"])
        .add_filter("Markdown", &["md", "markdown"])
        .add_filter("Plain text", &["txt"]);
    if directory.is_dir() {
        picker = picker.set_directory(directory);
    }
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        picker = picker.set_parent(&window);
    }
    let Some(selected) = picker.blocking_pick_file() else {
        return Ok(None);
    };
    let path = filesystem_path(selected)?;
    let result = read_document(&state, &path)?;
    if let Some(parent) = path.parent() {
        state.update(|store| store.last_open_directory = display_path(parent))?;
    }
    Ok(Some(result))
}

#[tauri::command]
pub async fn open_file_path(
    state: State<'_, HostState>,
    path: String,
) -> Result<Option<Value>, String> {
    Ok(read_document(&state, Path::new(&path)).ok())
}
#[tauri::command]
pub async fn save_file(
    state: State<'_, HostState>,
    path: String,
    content: String,
) -> Result<bool, String> {
    Ok(write_document(&state, Path::new(&path), &content).is_ok())
}
#[tauri::command]
pub async fn inspect_file_path(path: String) -> Value {
    let result = (|| -> Result<Value, String> {
        let path = canonical_for_save(Path::new(&path))?;
        let display = display_path(&path);
        let identity = if path.exists() {
            format!(
                "{:?}",
                file_id::get_file_id(&path).map_err(|e| e.to_string())?
            )
        } else {
            #[cfg(windows)]
            let key = display.to_ascii_lowercase();
            #[cfg(not(windows))]
            let key = display.clone();
            format!("path:{key}")
        };
        Ok(json!({"path":display,"identity":identity}))
    })();
    result.unwrap_or_else(error_value)
}

async fn choose_path(
    app: &AppHandle,
    current_path: Option<String>,
    title: &str,
    extensions: &[&str],
) -> Result<Option<PathBuf>, String> {
    let mut picker = app
        .dialog()
        .file()
        .set_title(title)
        .add_filter("Document", extensions);
    if let Some(path) = current_path {
        let path = Path::new(&path);
        if let Some(parent) = path.parent().filter(|parent| parent.is_dir()) {
            picker = picker.set_directory(parent);
        }
        if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
            picker = picker.set_file_name(name);
        }
    } else {
        picker = picker.set_file_name("untitled.md");
    }
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        picker = picker.set_parent(&window);
    }
    picker.blocking_save_file().map(filesystem_path).transpose()
}
#[tauri::command]
pub async fn choose_save_path(app: AppHandle, current_path: Option<String>) -> Value {
    match choose_path(
        &app,
        current_path,
        "Save document",
        &["md", "markdown", "txt"],
    )
    .await
    {
        Ok(Some(path)) => json!({"path":display_path(&path)}),
        Ok(None) => Value::Null,
        Err(error) => error_value(error),
    }
}
#[tauri::command]
pub async fn save_file_as(
    app: AppHandle,
    state: State<'_, HostState>,
    content: String,
    current_path: Option<String>,
) -> Result<Option<Value>, String> {
    let Some(path) = choose_path(
        &app,
        current_path,
        "Save document",
        &["md", "markdown", "txt"],
    )
    .await?
    else {
        return Ok(None);
    };
    write_document(&state, &path, &content)?;
    Ok(Some(json!({"path":display_path(&path)})))
}

#[tauri::command]
pub async fn confirm_document_close(app: AppHandle, name: String) -> String {
    let mut dialog = app
        .dialog()
        .message(format!("Save changes to {name}?"))
        .title("Lumina")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNoCancelCustom(
            "Save".into(),
            "Don't Save".into(),
            "Cancel".into(),
        ));
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        dialog = dialog.parent(&window);
    }
    match dialog.blocking_show_with_result() {
        MessageDialogResult::Yes => "save",
        MessageDialogResult::No => "discard",
        MessageDialogResult::Custom(label) if label == "Save" => "save",
        MessageDialogResult::Custom(label) if label == "Don't Save" => "discard",
        _ => "cancel",
    }
    .into()
}

#[tauri::command]
pub async fn list_directory(document_path: String) -> Value {
    let path = Path::new(&document_path)
        .parent()
        .unwrap_or_else(|| Path::new(""));
    let result = (|| -> Result<Vec<Value>, String> {
        let entries = fs::read_dir(path).map_err(|e| e.to_string())?;
        let mut files = Vec::new();
        for entry in entries.flatten() {
            let candidate = entry.path();
            if entry.file_type().is_ok_and(|kind| kind.is_file()) && document_type(&candidate) {
                files.push(json!({"path":display_path(&candidate),"name":entry.file_name().to_string_lossy()}));
            }
        }
        files.sort_by(|a, b| {
            natural_compare(
                a["name"].as_str().unwrap_or(""),
                b["name"].as_str().unwrap_or(""),
            )
        });
        Ok(files)
    })();
    match result {
        Ok(files) => json!({"path":display_path(path),"files":files}),
        Err(_) => {
            json!({"path":display_path(path),"files":[],"error":"This folder is unavailable. Check its location and permissions."})
        }
    }
}
fn natural_compare(left: &str, right: &str) -> std::cmp::Ordering {
    let a = left.to_lowercase();
    let b = right.to_lowercase();
    let mut a = a.chars().peekable();
    let mut b = b.chars().peekable();
    loop {
        match (a.peek(), b.peek()) {
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut x = String::new();
                let mut y = String::new();
                while a.peek().is_some_and(char::is_ascii_digit) {
                    x.push(a.next().unwrap());
                }
                while b.peek().is_some_and(char::is_ascii_digit) {
                    y.push(b.next().unwrap());
                }
                let x = x.trim_start_matches('0');
                let y = y.trim_start_matches('0');
                let order = x.len().cmp(&y.len()).then_with(|| x.cmp(y));
                if !order.is_eq() {
                    return order;
                }
            }
            (Some(_), Some(_)) => {
                let order = a.next().cmp(&b.next());
                if !order.is_eq() {
                    return order;
                }
            }
            _ => return a.next().cmp(&b.next()),
        }
    }
}

#[tauri::command]
pub async fn read_initial_file(
    app: AppHandle,
    state: State<'_, HostState>,
) -> Result<Option<Value>, String> {
    #[cfg(desktop)]
    for arg in std::env::args().skip(1) {
        if !arg.starts_with('-') && document_type(Path::new(&arg)) {
            if let Ok(document) = read_document(&state, Path::new(&arg)) {
                state.add_recent(Path::new(document["path"].as_str().unwrap_or(&arg)), None)?;
                return Ok(Some(document));
            }
        }
    }
    let (recents, welcome) = {
        let store = state.persisted.lock().map_err(|e| e.to_string())?;
        (
            store.recent_files.clone(),
            store.settings["welcomeShown"].as_bool().unwrap_or(false),
        )
    };
    for recent in recents {
        if let Ok(document) = read_document(&state, Path::new(&recent.path)) {
            state.add_recent(Path::new(&recent.path), recent.snippet)?;
            return Ok(Some(document));
        }
    }
    if !welcome {
        let directory = default_documents(&app);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let path = directory.join("Welcome to Lumina.md");
        if !path.exists() {
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
            file.write_all(b"# Welcome to Lumina\n\nA clean space for **Markdown** and text.\n\nOpen a document to start reading or editing. Each document keeps its own tab and undo history.\n").map_err(|e| e.to_string())?;
        }
        state.update(|store| store.settings["welcomeShown"] = json!(true))?;
        if let Ok(document) = read_document(&state, &path) {
            state.add_recent(&path, None)?;
            return Ok(Some(document));
        }
    }
    Ok(None)
}

#[tauri::command]
pub fn get_recent_files(state: State<'_, HostState>) -> Result<Vec<RecentFile>, String> {
    Ok(state
        .persisted
        .lock()
        .map_err(|e| e.to_string())?
        .recent_files
        .clone())
}
#[tauri::command]
pub fn add_recent_file(
    state: State<'_, HostState>,
    path: String,
    snippet: Option<String>,
) -> Result<(), String> {
    state.add_recent(Path::new(&path), snippet)
}
#[tauri::command]
pub fn remove_recent_file(state: State<'_, HostState>, path: String) -> Result<(), String> {
    state.update(|store| {
        store
            .recent_files
            .retain(|entry| !same_path(&entry.path, &path))
    })
}
#[tauri::command]
pub fn pin_recent_file(
    state: State<'_, HostState>,
    path: String,
) -> Result<Vec<RecentFile>, String> {
    state.update(|store| {
        for entry in &mut store.recent_files {
            if same_path(&entry.path, &path) {
                entry.pinned = !entry.pinned;
            }
        }
        store.recent_files.clone()
    })
}
#[tauri::command]
pub fn reveal_file(app: AppHandle, path: String) -> Result<(), String> {
    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn rename_file(
    state: State<'_, HostState>,
    old_path: String,
    new_name: String,
) -> Result<Option<Value>, String> {
    Ok((|| -> Option<Value> {
        if new_name.is_empty()
            || new_name == "."
            || new_name == ".."
            || new_name.contains(['/', '\\', ':'])
            || new_name.chars().any(|c| c.is_control())
        {
            return None;
        }
        let old = Path::new(&old_path);
        let new = old.parent()?.join(&new_name);
        if !document_type(&new) || new.exists() {
            return None;
        }
        fs::rename(old, &new).ok()?;
        let new_path = display_path(&new);
        if let Err(error) = state.update(|store| {
            for entry in &mut store.recent_files {
                if same_path(&entry.path, &old_path) {
                    entry.path = new_path.clone();
                    entry.name = new_name.clone();
                }
            }
        }) {
            eprintln!("Unable to update recents after rename: {error}");
        }
        Some(json!({"newPath":new_path}))
    })())
}
#[tauri::command]
pub fn get_settings(state: State<'_, HostState>) -> Result<Value, String> {
    Ok(state
        .persisted
        .lock()
        .map_err(|e| e.to_string())?
        .settings
        .clone())
}
#[tauri::command]
pub fn set_settings(state: State<'_, HostState>, partial: Value) -> Result<(), String> {
    let fields = partial.as_object().ok_or("Expected settings object.")?;
    if fields
        .get("theme")
        .is_some_and(|v| !matches!(v.as_str(), Some("light" | "dark" | "system")))
    {
        return Err("Invalid theme.".into());
    }
    state.update(|store| {
        for (key, value) in fields {
            if matches!(
                key.as_str(),
                "theme" | "sidebarOpen" | "welcomeShown" | "windowBounds"
            ) {
                store.settings[key] = value.clone();
            }
        }
    })
}
#[tauri::command]
pub async fn export_html(
    app: AppHandle,
    default_path: String,
    content: String,
) -> Result<Option<Value>, String> {
    export_data(&app, default_path, content.into_bytes(), "html").await
}
#[tauri::command]
pub async fn export_binary(
    app: AppHandle,
    default_path: String,
    buffer: Vec<u8>,
    format: String,
) -> Result<Option<Value>, String> {
    if !matches!(format.as_str(), "pdf" | "docx") {
        return Err("Unsupported export format.".into());
    }
    export_data(&app, default_path, buffer, &format).await
}
async fn export_data(
    app: &AppHandle,
    default_path: String,
    data: Vec<u8>,
    extension: &str,
) -> Result<Option<Value>, String> {
    let Some(path) = choose_path(app, Some(default_path), "Export document", &[extension]).await?
    else {
        return Ok(None);
    };
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(Some(json!({"path":display_path(&path)})))
}
