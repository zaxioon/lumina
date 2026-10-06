mod files;
mod links;
mod media;
#[cfg(desktop)]
mod menu;
mod state;
#[cfg(test)]
mod tests;

use state::HostState;
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, State};

#[tauri::command]
fn complete_window_close(
    app: tauri::AppHandle,
    state: State<'_, HostState>,
    allowed: bool,
) -> Result<(), String> {
    if !state.close_pending.swap(false, Ordering::SeqCst) {
        return Ok(());
    }
    if allowed {
        state.allow_close.store(true, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window("main") {
            window.close().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn request_close(app: &tauri::AppHandle) {
    let state = app.state::<HostState>();
    if !state.close_pending.swap(true, Ordering::SeqCst) {
        if let Err(error) = app.emit_to("main", "lumina:request-close", ()) {
            state.close_pending.store(false, Ordering::SeqCst);
            eprintln!("Unable to request document close: {error}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .register_asynchronous_uri_scheme_protocol("media", |context, request, responder| {
            let app = context.app_handle().clone();
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media::response(&app,&path));
            });
        })
        .setup(|app| {
            app.manage(HostState::load(app.handle()).map_err(std::io::Error::other)?);
            #[cfg(desktop)]
            menu::install(app.handle())?;
            #[cfg(target_os="macos")]
            if let Some(window) = app.get_webview_window("main") {
                window.set_title_bar_style(tauri::TitleBarStyle::Overlay)?;
            }
            if let Some(window) = app.get_webview_window("main") {
                let settings = app.state::<HostState>().persisted.lock().map_err(|e| std::io::Error::other(e.to_string()))?.settings.clone();
                let theme = match settings["theme"].as_str() { Some("dark") => Some(tauri::Theme::Dark), Some("light") => Some(tauri::Theme::Light), _ => None };
                let _ = window.set_theme(theme);
                if let (Some(width),Some(height)) = (settings["windowBounds"]["width"].as_u64(),settings["windowBounds"]["height"].as_u64()) {
                    let _ = window.set_size(tauri::LogicalSize::new(width.clamp(600,7680) as f64,height.clamp(400,4320) as f64));
                }
            }
            Ok(())
        })
        .on_window_event(|window,event| {
            if window.label() != "main" { return; }
            let state = window.state::<HostState>();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    if !state.allow_close.load(Ordering::SeqCst) {
                        api.prevent_close();
                        request_close(window.app_handle());
                    } else if let Ok(size) = window.inner_size() {
                        let scale = window.scale_factor().unwrap_or(1.0);
                        let logical = size.to_logical::<f64>(scale);
                        let _ = state.update(|store| {
                            store.settings["windowBounds"] = serde_json::json!({"width":logical.width.round() as u64,"height":logical.height.round() as u64});
                        });
                    }
                }
                tauri::WindowEvent::ThemeChanged(theme) => {
                    let _ = window.emit("lumina:theme-change",if *theme == tauri::Theme::Dark { "dark" } else { "light" });
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            files::open_file,files::open_file_path,files::save_file,files::save_file_as,
            files::inspect_file_path,files::choose_save_path,files::confirm_document_close,
            files::list_directory,files::read_initial_file,files::get_recent_files,
            files::add_recent_file,files::remove_recent_file,files::pin_recent_file,
            files::reveal_file,files::rename_file,files::get_settings,files::set_settings,
            files::export_html,files::export_binary,
            links::resolve_link,links::open_attachment,links::open_external,
            media::copy_image_to_doc,media::paste_image,complete_window_close,
        ]);
    #[cfg(desktop)]
    let builder = builder.on_menu_event(|app, event| menu::handle(app, event.id().as_ref()));
    builder
        .build(tauri::generate_context!())
        .expect("failed to initialize Lumina")
        .run(|app, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !app.state::<HostState>().allow_close.load(Ordering::SeqCst)
                    && app.get_webview_window("main").is_some()
                {
                    api.prevent_exit();
                    request_close(app);
                }
            }
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            tauri::RunEvent::Opened { urls } => {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if state::document_type(&path) {
                            let _ =
                                app.emit_to("main", "lumina:open-file", state::display_path(&path));
                        }
                    }
                }
            }
            _ => {}
        });
}
