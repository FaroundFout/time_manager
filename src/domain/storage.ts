import type { AppSnapshot, EventRecord, ParsedTemplate, StoragePort, WorkdaySummary } from "./types";

const SNAPSHOT_KEY = "time-manager:snapshot:v1";

export class LocalStoragePort implements StoragePort {
  async loadSnapshot(): Promise<AppSnapshot | undefined> {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as AppSnapshot;
  }

  async saveSnapshot(snapshot: AppSnapshot): Promise<void> {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  }

  async appendEvent(event: EventRecord): Promise<void> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot) return;
    await this.saveSnapshot({ ...snapshot, events: [...snapshot.events, event] });
  }

  async listEvents(workdayId?: string): Promise<EventRecord[]> {
    const snapshot = await this.loadSnapshot();
    const events = snapshot?.events ?? [];
    return workdayId ? events.filter((event) => event.workdayId === workdayId) : events;
  }

  async saveTemplateSnapshot(template: ParsedTemplate): Promise<void> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot) return;
    await this.saveSnapshot({ ...snapshot, template });
  }

  async listWorkdays(): Promise<WorkdaySummary[]> {
    const snapshot = await this.loadSnapshot();
    if (!snapshot?.workdayState.workdayId || !snapshot.workdayState.workdayStart || !snapshot.workdayState.workdayEnd) {
      return [];
    }
    return [
      {
        workdayId: snapshot.workdayState.workdayId,
        start: snapshot.workdayState.workdayStart,
        end: snapshot.workdayState.workdayEnd,
        status: snapshot.workdayState.status
      }
    ];
  }

  async loadWorkdaySnapshot(workdayId: string): Promise<AppSnapshot | undefined> {
    const snapshot = await this.loadSnapshot();
    return snapshot?.workdayState.workdayId === workdayId ? snapshot : undefined;
  }

  async clearPersistedData(): Promise<void> {
    window.localStorage.removeItem(SNAPSHOT_KEY);
  }
}

export function createDefaultConfig() {
  return {
    reminderIntervalMinutes: 5,
    soundMode: "everyReminder" as const,
    autostart: false,
    mainWindowAlwaysOnTop: false
  };
}
