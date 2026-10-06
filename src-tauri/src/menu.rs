use crate::{files, state::HostState};
use tauri::{
    menu::{MenuBuilder, MenuItem, SubmenuBuilder},
    AppHandle, Emitter, Manager,
};

pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let new = MenuItem::with_id(app, "new", "New", true, Some("CmdOrCtrl+N"))?;
    let open = MenuItem::with_id(app, "open", "Open…", true, Some("CmdOrCtrl+O"))?;
    let save = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as = MenuItem::with_id(app, "save-as", "Save As…", true, Some("CmdOrCtrl+Shift+S"))?;
    let close = MenuItem::with_id(app, "close", "Close Window", true, Some("Alt+F4"))?;
    let mut recent = SubmenuBuilder::new(app, "Open Recent");
    if let Ok(store) = app.state::<HostState>().persisted.lock() {
        for entry in store.recent_files.iter().take(10) {
            recent = recent.item(&MenuItem::with_id(
                app,
                format!("recent:{}", entry.path),
                &entry.name,
                true,
                None::<&str>,
            )?);
        }
    }
    let recent = recent.build()?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&new)
        .item(&open)
        .item(&recent)
        .separator()
        .item(&save)
        .item(&save_as)
        .separator()
        .item(&close)
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .cut()
        .copy()
        .paste()
        .separator()
        .select_all()
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItem::with_id(
            app,
            "repository",
            "View on GitHub",
            true,
            None::<&str>,
        )?)
        .build()?;
    let menu = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    let menu = {
        let application = SubmenuBuilder::new(app, "Lumina")
            .about(None)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .item(&MenuItem::with_id(
                app,
                "close",
                "Quit Lumina",
                true,
                Some("Cmd+Q"),
            )?)
            .build()?;
        menu.item(&application)
    };
    app.set_menu(menu.item(&file).item(&edit).item(&help).build()?)?;
    Ok(())
}

pub fn handle(app: &AppHandle, id: &str) {
    match id {
        "new" => {
            let _ = app.emit_to("main", "lumina:open-file", Option::<String>::None);
        }
        "open" => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                match files::open_file(app.clone(), app.state::<HostState>()).await {
                    Ok(Some(result)) => {
                        let _ = app.emit_to("main", "lumina:open-file", result["path"].as_str());
                    }
                    Ok(None) => {}
                    Err(error) => {
                        let _ = app.emit_to("main", "lumina:error", error);
                    }
                }
            });
        }
        "save" => {
            let _ = app.emit_to("main", "lumina:menu-save", ());
        }
        "save-as" => {
            let _ = app.emit_to("main", "lumina:menu-save-as", ());
        }
        "close" => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.close();
            }
        }
        "repository" => {
            let _ = crate::links::open_external(
                app.clone(),
                "https://github.com/zaxioon/lumina-tauri".into(),
            );
        }
        _ => {
            if let Some(path) = id.strip_prefix("recent:") {
                let _ = app.emit_to("main", "lumina:open-file", path);
            }
        }
    }
}
