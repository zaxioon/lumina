use crate::{
    files, links, media,
    state::{canonical_for_save, HostState, MediaScope, Persisted},
};
use serde_json::json;
use std::{
    fs,
    path::Path,
    sync::{atomic::AtomicBool, Mutex},
};

fn test_state() -> (HostState, std::path::PathBuf) {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("behavior-tests")
        .join(format!(
            "{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
    fs::create_dir_all(&path).unwrap();
    (
        HostState {
            persisted: Mutex::new(Persisted::default()),
            store_path: path.join("settings.json"),
            media: Mutex::new(MediaScope::default()),
            allow_close: AtomicBool::new(false),
            close_pending: AtomicBool::new(false),
        },
        path,
    )
}

#[test]
fn document_io_preserves_bom_identity_and_grants_images() {
    let (state, root) = test_state();
    let file = root.join("中文 笔记.md");
    fs::write(&file, "\u{feff}# 标题\n\n![图](image.png)").unwrap();
    fs::write(root.join("image.png"), [137, 80, 78, 71]).unwrap();
    let document = files::read_document(&state, &file).unwrap();
    assert_eq!(document["content"], "# 标题\n\n![图](image.png)");
    let alias = root.join("alias.md");
    fs::hard_link(&file, &alias).unwrap();
    let first = tauri::async_runtime::block_on(files::inspect_file_path(
        file.to_string_lossy().into_owned(),
    ));
    let second = tauri::async_runtime::block_on(files::inspect_file_path(
        alias.to_string_lossy().into_owned(),
    ));
    assert_eq!(first["identity"], second["identity"]);
    assert!(first["identity"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
    assert_eq!(
        canonical_for_save(&root.join("new.md")).unwrap(),
        fs::canonicalize(&root).unwrap().join("new.md")
    );
    assert!(state
        .media
        .lock()
        .unwrap()
        .files
        .contains(&fs::canonicalize(root.join("image.png")).unwrap()));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn link_routing_decodes_paths_and_keeps_executable_links_closed() {
    assert_eq!(
        links::resolve_value("#%E6%A0%87%E9%A2%98", None).unwrap(),
        json!({"kind":"anchor","anchor":"标题"})
    );
    assert_eq!(
        links::resolve_value("HTTPS://example.com", None).unwrap()["kind"],
        "external"
    );
    let base = Some(if cfg!(windows) {
        "C:/docs/main.md"
    } else {
        "/docs/main.md"
    });
    assert!(links::resolve_value("javascript:alert(1)", base).is_err());
    assert!(links::resolve_value("file://server/share.md", base).is_err());
    assert!(links::resolve_value("./app.exe", base).is_err());
    assert!(links::resolve_value("./bad%00.md", base).is_err());
    assert!(links::resolve_value("./bad%ZZ.md", base).is_err());
    #[cfg(windows)]
    {
        let link = links::resolve_value("./中文%20笔记.md#标题", Some("C:/docs/main.md")).unwrap();
        assert_eq!(link["path"], r"C:\docs\中文 笔记.md");
        assert_eq!(link["anchor"], "标题");
        let file = links::resolve_value("file:///D:/a%23b.md", None).unwrap();
        assert_eq!(file["path"], r"D:\a#b.md");
        assert_eq!(
            media::path_from_uri("/C%3A/docs/image%20a.png").unwrap(),
            Path::new("C:/docs/image a.png")
        );
    }
    assert!(!links::attachment_allowed(Path::new("run.exe")));
    assert!(media::image_type(Path::new("IMAGE.PNG")).is_some());
    assert!(media::image_type(Path::new("secret.json")).is_none());
}

#[test]
fn settings_and_recent_files_persist_without_losing_pins() {
    let (state, root) = test_state();
    state
        .update(|store| {
            store.settings["theme"] = json!("dark");
            store.last_open_directory = root.to_string_lossy().into_owned();
        })
        .unwrap();
    for index in 0..25 {
        let path = root.join(format!("note{index}.md"));
        state.add_recent(&path, None).unwrap();
        if index == 0 {
            state
                .update(|store| store.recent_files[0].pinned = true)
                .unwrap();
        }
    }
    let saved: Persisted = serde_json::from_slice(&fs::read(&state.store_path).unwrap()).unwrap();
    assert_eq!(saved.settings["theme"], "dark");
    assert_eq!(saved.recent_files.len(), 21);
    assert!(saved
        .recent_files
        .iter()
        .any(|entry| entry.pinned && entry.name == "note0.md"));
    assert!(saved.last_open_directory.contains("behavior-tests"));
    fs::remove_dir_all(root).unwrap();
}
