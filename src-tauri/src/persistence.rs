use std::{fs, sync::Mutex};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};
use tauri::{Manager, Runtime};

const SCHEMA_VERSION: &str = "1";

pub struct DbState {
    connection: Mutex<Connection>,
}

impl DbState {
    pub fn new(connection: Connection) -> Self {
        Self {
            connection: Mutex::new(connection),
        }
    }
}

pub fn init_database<R: Runtime>(app: &tauri::App<R>) -> Result<DbState, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    fs::create_dir_all(&data_dir).map_err(|error| format!("无法创建应用数据目录：{error}"))?;

    let db_path = data_dir.join("time-manager.db");
    let connection = Connection::open(db_path).map_err(|error| format!("无法打开 SQLite 数据库：{error}"))?;
    initialize_schema(&connection)?;
    Ok(DbState::new(connection))
}

pub fn load_snapshot_from_db(state: &DbState) -> Result<Option<Value>, String> {
    let connection = lock_connection(state)?;
    let raw = connection
        .query_row("SELECT json FROM snapshots WHERE id = 'current'", [], |row| row.get::<_, String>(0))
        .optional()
        .map_err(|error| format!("读取快照失败：{error}"))?;

    raw.map(|text| serde_json::from_str(&text).map_err(|error| format!("快照 JSON 损坏：{error}")))
        .transpose()
}

pub fn save_snapshot_to_db(state: &DbState, snapshot: Value) -> Result<(), String> {
    let mut connection = lock_connection(state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启保存事务失败：{error}"))?;

    let snapshot_json = serde_json::to_string(&snapshot).map_err(|error| format!("序列化快照失败：{error}"))?;
    transaction
        .execute(
            "INSERT INTO snapshots (id, json, updated_at)
             VALUES ('current', ?1, datetime('now'))
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
            params![snapshot_json],
        )
        .map_err(|error| format!("保存快照失败：{error}"))?;

    upsert_workday_summary(&transaction, &snapshot)?;
    if let Some(template) = snapshot.get("template") {
        upsert_template(&transaction, template)?;
    }
    if let Some(events) = snapshot.get("events").and_then(Value::as_array) {
        for event in events {
            insert_event(&transaction, event)?;
        }
    }

    transaction
        .commit()
        .map_err(|error| format!("提交保存事务失败：{error}"))
}

pub fn append_event_to_db(state: &DbState, event: Value) -> Result<(), String> {
    let connection = lock_connection(state)?;
    insert_event(&*connection, &event)
}

pub fn list_events_from_db(state: &DbState, workday_id: Option<String>) -> Result<Vec<Value>, String> {
    let connection = lock_connection(state)?;
    let mut events = Vec::new();

    if let Some(workday_id) = workday_id {
        let mut statement = connection
            .prepare("SELECT json FROM events WHERE workday_id = ?1 ORDER BY occurred_at ASC, id ASC")
            .map_err(|error| format!("准备事件查询失败：{error}"))?;
        let rows = statement
            .query_map(params![workday_id], |row| row.get::<_, String>(0))
            .map_err(|error| format!("查询事件失败：{error}"))?;
        for row in rows {
            let raw = row.map_err(|error| format!("读取事件失败：{error}"))?;
            events.push(parse_row_json(raw)?);
        }
    } else {
        let mut statement = connection
            .prepare("SELECT json FROM events ORDER BY occurred_at ASC, id ASC")
            .map_err(|error| format!("准备事件查询失败：{error}"))?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| format!("查询事件失败：{error}"))?;
        for row in rows {
            let raw = row.map_err(|error| format!("读取事件失败：{error}"))?;
            events.push(parse_row_json(raw)?);
        }
    }

    Ok(events)
}

pub fn save_template_to_db(state: &DbState, template: Value) -> Result<(), String> {
    let connection = lock_connection(state)?;
    upsert_template(&*connection, &template)
}

pub fn list_workdays_from_db(state: &DbState) -> Result<Vec<Value>, String> {
    let connection = lock_connection(state)?;
    let mut statement = connection
        .prepare("SELECT workday_id, start, end, status FROM workdays ORDER BY start DESC")
        .map_err(|error| format!("准备作息日查询失败：{error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(json!({
                "workdayId": row.get::<_, String>(0)?,
                "start": row.get::<_, String>(1)?,
                "end": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?
            }))
        })
        .map_err(|error| format!("查询作息日失败：{error}"))?;

    let mut workdays = Vec::new();
    for row in rows {
        workdays.push(row.map_err(|error| format!("读取作息日失败：{error}"))?);
    }
    Ok(workdays)
}

pub fn clear_persisted_data_in_db(state: &DbState) -> Result<(), String> {
    let mut connection = lock_connection(state)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开启清空事务失败：{error}"))?;
    transaction
        .execute_batch(
            "DELETE FROM snapshots;
             DELETE FROM events;
             DELETE FROM templates;
             DELETE FROM workdays;",
        )
        .map_err(|error| format!("清空数据库失败：{error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("提交清空事务失败：{error}"))
}

fn initialize_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS app_meta (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS snapshots (
               id TEXT PRIMARY KEY CHECK (id = 'current'),
               json TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS events (
               id TEXT PRIMARY KEY,
               workday_id TEXT,
               stage_id TEXT,
               type TEXT NOT NULL,
               occurred_at TEXT NOT NULL,
               json TEXT NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_events_workday ON events(workday_id, occurred_at);
             CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
             CREATE TABLE IF NOT EXISTS templates (
               template_id TEXT PRIMARY KEY,
               source_path TEXT,
               applied_at TEXT,
               json TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS workdays (
               workday_id TEXT PRIMARY KEY,
               start TEXT NOT NULL,
               end TEXT NOT NULL,
               status TEXT NOT NULL,
               updated_at TEXT NOT NULL
             );",
        )
        .map_err(|error| format!("初始化数据库结构失败：{error}"))?;

    connection
        .execute(
            "INSERT INTO app_meta (key, value)
             VALUES ('schema_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![SCHEMA_VERSION],
        )
        .map_err(|error| format!("写入数据库版本失败：{error}"))?;

    Ok(())
}

fn insert_event(connection: &impl ExecuteSql, event: &Value) -> Result<(), String> {
    let id = required_string(event, "id")?;
    let event_type = required_string(event, "type")?;
    let occurred_at = required_string(event, "occurredAt")?;
    let workday_id = optional_string(event, "workdayId");
    let stage_id = optional_string(event, "stageId");
    let json = serde_json::to_string(event).map_err(|error| format!("序列化事件失败：{error}"))?;

    connection.execute_sql(
        "INSERT OR IGNORE INTO events (id, workday_id, stage_id, type, occurred_at, json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, workday_id, stage_id, event_type, occurred_at, json],
    )
}

fn upsert_template(connection: &impl ExecuteSql, template: &Value) -> Result<(), String> {
    let template_id = required_string(template, "templateId")?;
    let source_path = optional_string(template, "sourcePath");
    let applied_at = optional_string(template, "appliedAt");
    let json = serde_json::to_string(template).map_err(|error| format!("序列化模板失败：{error}"))?;

    connection.execute_sql(
        "INSERT INTO templates (template_id, source_path, applied_at, json)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(template_id) DO UPDATE SET
           source_path = excluded.source_path,
           applied_at = excluded.applied_at,
           json = excluded.json",
        params![template_id, source_path, applied_at, json],
    )
}

fn upsert_workday_summary(transaction: &Transaction<'_>, snapshot: &Value) -> Result<(), String> {
    let Some(state) = snapshot.get("workdayState") else {
        return Ok(());
    };
    let Some(workday_id) = optional_string(state, "workdayId") else {
        return Ok(());
    };
    let Some(start) = optional_string(state, "workdayStart") else {
        return Ok(());
    };
    let Some(end) = optional_string(state, "workdayEnd") else {
        return Ok(());
    };
    let Some(status) = optional_string(state, "status") else {
        return Ok(());
    };

    transaction
        .execute(
            "INSERT INTO workdays (workday_id, start, end, status, updated_at)
             VALUES (?1, ?2, ?3, ?4, datetime('now'))
             ON CONFLICT(workday_id) DO UPDATE SET
               start = excluded.start,
               end = excluded.end,
               status = excluded.status,
               updated_at = excluded.updated_at",
            params![workday_id, start, end, status],
        )
        .map(|_| ())
        .map_err(|error| format!("保存作息日摘要失败：{error}"))
}

trait ExecuteSql {
    fn execute_sql<P: rusqlite::Params>(&self, sql: &str, params: P) -> Result<(), String>;
}

impl ExecuteSql for Connection {
    fn execute_sql<P: rusqlite::Params>(&self, sql: &str, params: P) -> Result<(), String> {
        self.execute(sql, params)
            .map(|_| ())
            .map_err(|error| format!("执行 SQL 失败：{error}"))
    }
}

impl ExecuteSql for Transaction<'_> {
    fn execute_sql<P: rusqlite::Params>(&self, sql: &str, params: P) -> Result<(), String> {
        self.execute(sql, params)
            .map(|_| ())
            .map_err(|error| format!("执行 SQL 失败：{error}"))
    }
}

fn lock_connection(state: &DbState) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
    state
        .connection
        .lock()
        .map_err(|_| "数据库连接锁已损坏".to_string())
}

fn parse_row_json(raw: String) -> Result<Value, String> {
    serde_json::from_str(&raw).map_err(|error| format!("数据库 JSON 损坏：{error}"))
}

fn required_string(value: &Value, key: &str) -> Result<String, String> {
    optional_string(value, key).ok_or_else(|| format!("缺少字段：{key}"))
}

fn optional_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_state() -> DbState {
        let connection = Connection::open_in_memory().expect("open in-memory database");
        initialize_schema(&connection).expect("initialize schema");
        DbState::new(connection)
    }

    fn snapshot_json() -> Value {
        json!({
            "config": {
                "reminderIntervalMinutes": 5,
                "soundMode": "everyReminder",
                "autostart": false,
                "mainWindowAlwaysOnTop": false
            },
            "workdayState": {
                "status": "waitingStageStart",
                "workdayId": "workday_1",
                "workdayStart": "2026-06-02T00:00:00.000Z",
                "workdayEnd": "2026-06-02T12:00:00.000Z"
            },
            "stages": [],
            "timeline": [],
            "incidents": [],
            "events": [
                {
                    "id": "event_1",
                    "type": "templateEnabled",
                    "occurredAt": "2026-06-02T00:00:00.000Z",
                    "workdayId": "workday_1",
                    "payload": { "templateId": "template_1" }
                }
            ],
            "template": {
                "templateId": "template_1",
                "scheduleStart": "08:00",
                "stages": [],
                "rawText": "日程起点: 08:00",
                "sourcePath": "C:\\Users\\WANG\\Desktop\\schedule.md",
                "appliedAt": "2026-06-02T00:00:00.000Z"
            }
        })
    }

    #[test]
    fn initializes_schema_version() {
        let state = test_state();
        let connection = lock_connection(&state).expect("lock connection");
        let version: String = connection
            .query_row("SELECT value FROM app_meta WHERE key = 'schema_version'", [], |row| row.get(0))
            .expect("read schema version");

        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn saves_and_loads_snapshot_with_indexes() {
        let state = test_state();
        save_snapshot_to_db(&state, snapshot_json()).expect("save snapshot");
        let loaded = load_snapshot_from_db(&state).expect("load snapshot").expect("snapshot exists");
        let workdays = list_workdays_from_db(&state).expect("list workdays");
        let events = list_events_from_db(&state, Some("workday_1".to_string())).expect("list events");

        assert_eq!(loaded["workdayState"]["workdayId"], "workday_1");
        assert_eq!(workdays.len(), 1);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0]["id"], "event_1");
    }

    #[test]
    fn ignores_duplicate_events() {
        let state = test_state();
        let event = json!({
            "id": "event_1",
            "type": "stageStartConfirmed",
            "occurredAt": "2026-06-02T01:00:00.000Z",
            "workdayId": "workday_1",
            "payload": {}
        });

        append_event_to_db(&state, event.clone()).expect("append event");
        append_event_to_db(&state, event).expect("append duplicate event");

        assert_eq!(list_events_from_db(&state, None).expect("list events").len(), 1);
    }

    #[test]
    fn upserts_template_snapshots() {
        let state = test_state();
        save_template_to_db(
            &state,
            json!({
                "templateId": "template_1",
                "scheduleStart": "08:00",
                "stages": [],
                "rawText": "old"
            }),
        )
        .expect("save first template");
        save_template_to_db(
            &state,
            json!({
                "templateId": "template_1",
                "scheduleStart": "08:00",
                "stages": [],
                "rawText": "new"
            }),
        )
        .expect("save second template");

        let connection = lock_connection(&state).expect("lock connection");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM templates WHERE template_id = 'template_1'", [], |row| row.get(0))
            .expect("count templates");
        let raw: String = connection
            .query_row("SELECT json FROM templates WHERE template_id = 'template_1'", [], |row| row.get(0))
            .expect("read template");
        let template: Value = serde_json::from_str(&raw).expect("parse template json");

        assert_eq!(count, 1);
        assert_eq!(template["rawText"], "new");
    }

    #[test]
    fn clears_persisted_data() {
        let state = test_state();
        save_snapshot_to_db(&state, snapshot_json()).expect("save snapshot");
        clear_persisted_data_in_db(&state).expect("clear data");

        assert!(load_snapshot_from_db(&state).expect("load snapshot").is_none());
        assert!(list_events_from_db(&state, None).expect("list events").is_empty());
        assert!(list_workdays_from_db(&state).expect("list workdays").is_empty());
    }
}
