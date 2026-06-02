import { invoke } from "@tauri-apps/api/core";
import { LocalStoragePort } from "../domain/storage";
import type { AppSnapshot, EventRecord, ParsedTemplate, StoragePort, WorkdaySummary } from "../domain/types";

export class SqliteStoragePort implements StoragePort {
  private readonly legacyStorage = new LocalStoragePort();

  async loadSnapshot(): Promise<AppSnapshot | undefined> {
    const snapshot = await invoke<AppSnapshot | null>("load_snapshot");
    if (snapshot) return snapshot;

    const legacySnapshot = await this.legacyStorage.loadSnapshot();
    if (legacySnapshot) {
      await invoke<boolean>("migrate_local_storage_snapshot", { snapshot: legacySnapshot });
      return legacySnapshot;
    }

    return undefined;
  }

  async saveSnapshot(snapshot: AppSnapshot): Promise<void> {
    await invoke("save_snapshot", { snapshot });
  }

  async appendEvent(event: EventRecord): Promise<void> {
    await invoke("append_event", { event });
  }

  async listEvents(workdayId?: string): Promise<EventRecord[]> {
    return invoke<EventRecord[]>("list_events", { workdayId: workdayId ?? null });
  }

  async saveTemplateSnapshot(template: ParsedTemplate): Promise<void> {
    await invoke("save_template_snapshot", { template });
  }

  async listWorkdays(): Promise<WorkdaySummary[]> {
    return invoke<WorkdaySummary[]>("list_workdays");
  }

  async loadWorkdaySnapshot(workdayId: string): Promise<AppSnapshot | undefined> {
    const snapshot = await invoke<AppSnapshot | null>("load_workday_snapshot", { workdayId });
    return snapshot ?? undefined;
  }

  async clearPersistedData(): Promise<void> {
    await invoke("clear_persisted_data");
  }
}
