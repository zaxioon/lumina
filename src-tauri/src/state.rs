use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{atomic::AtomicBool, Mutex},
};
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    pub last_opened: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    #[serde(default)]
    pub pinned: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Persisted {
    pub last_open_directory: String,
    pub recent_files: Vec<RecentFile>,
    pub settings: Value,
}
impl Default for Persisted {
    fn default() -> Self {
        Self {
            last_open_directory: String::new(),
            recent_files: Vec::new(),
            settings: json!({"theme":"system","sidebarOpen":true}),
        }
    }
}

#[derive(Default)]
pub struct MediaScope {
    pub directories: HashSet<PathBuf>,
    pub files: HashSet<PathBuf>,
}

pub struct HostState {
    pub persisted: Mutex<Persisted>,
    pub store_path: PathBuf,
    pub media: Mutex<MediaScope>,
    pub allow_close: AtomicBool,
    pub close_pending: AtomicBool,
}
impl HostState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let store_path = directory.join("settings.json");
        let persisted = if store_path.exists() {
            let bytes = fs::read(&store_path).map_err(|e| e.to_string())?;
            match serde_json::from_slice(&bytes) {
                Ok(value) => value,
                Err(error) => {
                    let backup = directory.join(format!(
                        "settings.corrupt-{}.json",
                        Utc::now().timestamp_millis()
                    ));
                    fs::copy(&store_path, backup).map_err(|e| e.to_string())?;
                    eprintln!("Preserved unreadable settings: {error}");
                    Persisted::default()
                }
            }
        } else {
            Persisted::default()
        };
        Ok(Self {
            persisted: Mutex::new(persisted),
            store_path,
            media: Mutex::new(MediaScope::default()),
            allow_close: AtomicBool::new(false),
            close_pending: AtomicBool::new(false),
        })
    }

    pub fn update<T>(&self, change: impl FnOnce(&mut Persisted) -> T) -> Result<T, String> {
        let mut state = self.persisted.lock().map_err(|e| e.to_string())?;
        let mut next = state.clone();
        let result = change(&mut next);
        let data = serde_json::to_vec_pretty(&next).map_err(|e| e.to_string())?;
        let tmp = self.store_path.with_extension("json.tmp");
        let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
        file.write_all(&data)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.store_path).map_err(|e| e.to_string())?;
        *state = next;
        Ok(result)
    }

    pub fn add_recent(&self, path: &Path, snippet: Option<String>) -> Result<(), String> {
        let path = display_path(path);
        self.update(|state| {
            let pinned = state
                .recent_files
                .iter()
                .find(|entry| same_path(&entry.path, &path))
                .is_some_and(|entry| entry.pinned);
            state
                .recent_files
                .retain(|entry| !same_path(&entry.path, &path));
            state.recent_files.insert(
                0,
                RecentFile {
                    name: Path::new(&path)
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string(),
                    path,
                    last_opened: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
                    snippet,
                    pinned,
                },
            );
            let mut unpinned = 0;
            state.recent_files.retain(|entry| {
                if entry.pinned {
                    true
                } else {
                    unpinned += 1;
                    unpinned <= 20
                }
            });
        })
    }
}

pub fn display_path(path: &Path) -> String {
    let value = path.to_string_lossy();
    #[cfg(windows)]
    {
        if let Some(unc) = value.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{unc}");
        }
        return value.strip_prefix(r"\\?\").unwrap_or(&value).to_string();
    }
    #[cfg(not(windows))]
    value.to_string()
}

pub fn same_path(left: &str, right: &str) -> bool {
    #[cfg(windows)]
    {
        left.replace('\\', "/")
            .eq_ignore_ascii_case(&right.replace('\\', "/"))
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

pub fn document_type(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|s| s.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("md" | "markdown" | "txt")
    )
}

pub fn canonical_for_save(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
        if !canonical.is_file() {
            return Err("Select a document file.".into());
        }
        Ok(canonical)
    } else {
        let parent = path.parent().ok_or("Missing parent directory.")?;
        let name = path.file_name().ok_or("Missing file name.")?;
        let parent = fs::canonicalize(parent).map_err(|e| e.to_string())?;
        Ok(parent.join(name))
    }
}

pub fn error_value(message: impl ToString) -> Value {
    json!({"error":message.to_string()})
}
