use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State, WindowEvent,
};

mod persistence;
use persistence::DbState;

const MAIN_WINDOW_LABEL: &str = "main";
const REMINDER_WINDOW_LABEL: &str = "reminder";
const EVENT_REQUEST_EXIT: &str = "time-manager://request-exit-confirmation";
const EVENT_REMINDER_ACTION: &str = "time-manager://reminder-action";

struct QuitState {
    is_quitting: AtomicBool,
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle, quit_state: State<'_, Arc<QuitState>>) {
    quit_state.is_quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    show_main_window_handle(&app);
}

#[tauri::command]
fn show_reminder_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(REMINDER_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_always_on_top(true);
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn hide_reminder_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(REMINDER_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

#[tauri::command]
fn play_reminder_sound() {
    play_system_prompt_sound();
}

#[tauri::command]
fn load_snapshot(db: State<'_, Arc<DbState>>) -> Result<Option<Value>, String> {
    persistence::load_snapshot_from_db(db.inner().as_ref())
}

#[tauri::command]
fn save_snapshot(db: State<'_, Arc<DbState>>, snapshot: Value) -> Result<(), String> {
    persistence::save_snapshot_to_db(db.inner().as_ref(), snapshot)
}

#[tauri::command]
fn append_event(db: State<'_, Arc<DbState>>, event: Value) -> Result<(), String> {
    persistence::append_event_to_db(db.inner().as_ref(), event)
}

#[tauri::command]
fn list_events(db: State<'_, Arc<DbState>>, workday_id: Option<String>) -> Result<Vec<Value>, String> {
    persistence::list_events_from_db(db.inner().as_ref(), workday_id)
}

#[tauri::command]
fn save_template_snapshot(db: State<'_, Arc<DbState>>, template: Value) -> Result<(), String> {
    persistence::save_template_to_db(db.inner().as_ref(), template)
}

#[tauri::command]
fn list_workdays(db: State<'_, Arc<DbState>>) -> Result<Vec<Value>, String> {
    persistence::list_workdays_from_db(db.inner().as_ref())
}

#[tauri::command]
fn migrate_local_storage_snapshot(db: State<'_, Arc<DbState>>, snapshot: Value) -> Result<bool, String> {
    if persistence::load_snapshot_from_db(db.inner().as_ref())?.is_some() {
        return Ok(false);
    }
    persistence::save_snapshot_to_db(db.inner().as_ref(), snapshot)?;
    Ok(true)
}

#[tauri::command]
fn clear_persisted_data(db: State<'_, Arc<DbState>>) -> Result<(), String> {
    persistence::clear_persisted_data_in_db(db.inner().as_ref())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(QuitState {
            is_quitting: AtomicBool::new(false),
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window_handle(app);
        }))
        .invoke_handler(tauri::generate_handler![
            exit_app,
            show_main_window,
            show_reminder_window,
            hide_reminder_window,
            play_reminder_sound,
            load_snapshot,
            save_snapshot,
            append_event,
            list_events,
            save_template_snapshot,
            list_workdays,
            migrate_local_storage_snapshot,
            clear_persisted_data
        ])
        .setup(|app| {
            let db = persistence::init_database(app).expect("failed to initialize sqlite database");
            app.manage(Arc::new(db));
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let should_quit = window
                    .state::<Arc<QuitState>>()
                    .is_quitting
                    .load(Ordering::SeqCst);

                if !should_quit {
                    api.prevent_close();
                    if window.label() == REMINDER_WINDOW_LABEL {
                        let _ = window.app_handle().emit(EVENT_REMINDER_ACTION, "snoozeReminder");
                    }
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn setup_tray(app: &tauri::App) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
    let exit_item = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &exit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("时间管理程序")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => show_main_window_handle(app),
            "exit" => request_exit_confirmation(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window_handle(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

fn show_main_window_handle(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn request_exit_confirmation(app: &tauri::AppHandle) {
    show_main_window_handle(app);
    let _ = app.emit(EVENT_REQUEST_EXIT, ());
}

#[cfg(target_os = "windows")]
fn play_system_prompt_sound() {
    use windows_sys::Win32::System::Diagnostics::Debug::MessageBeep;
    use windows_sys::Win32::UI::WindowsAndMessaging::MB_ICONEXCLAMATION;

    unsafe {
        let _ = MessageBeep(MB_ICONEXCLAMATION);
    }
}

#[cfg(not(target_os = "windows"))]
fn play_system_prompt_sound() {}
