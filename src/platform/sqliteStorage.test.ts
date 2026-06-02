import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { SqliteStoragePort } from "./sqliteStorage";
import type { AppSnapshot, EventRecord } from "../domain/types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn()
}));

const invokeMock = vi.mocked(invoke);

function makeSnapshot(): AppSnapshot {
  return {
    config: {
      reminderIntervalMinutes: 5,
      soundMode: "everyReminder",
      autostart: false,
      mainWindowAlwaysOnTop: false
    },
    workdayState: {
      status: "waitingStageStart",
      workdayId: "workday_1",
      workdayStart: "2026-06-02T00:00:00.000Z",
      workdayEnd: "2026-06-02T12:00:00.000Z"
    },
    stages: [],
    timeline: [],
    incidents: [],
    events: []
  };
}

describe("SqliteStoragePort", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("loads the snapshot from the sqlite command", async () => {
    const snapshot = makeSnapshot();
    invokeMock.mockResolvedValueOnce(snapshot);

    await expect(new SqliteStoragePort().loadSnapshot()).resolves.toEqual(snapshot);
    expect(invokeMock).toHaveBeenCalledWith("load_snapshot");
  });

  it("saves snapshots through the sqlite command", async () => {
    const snapshot = makeSnapshot();
    invokeMock.mockResolvedValueOnce(undefined);

    await new SqliteStoragePort().saveSnapshot(snapshot);
    expect(invokeMock).toHaveBeenCalledWith("save_snapshot", { snapshot });
  });

  it("appends and filters events through sqlite commands", async () => {
    const event: EventRecord = {
      id: "event_1",
      type: "stageStartConfirmed",
      occurredAt: "2026-06-02T01:00:00.000Z",
      workdayId: "workday_1",
      payload: {}
    };
    invokeMock.mockResolvedValueOnce(undefined).mockResolvedValueOnce([event]);

    const storage = new SqliteStoragePort();
    await storage.appendEvent(event);
    const events = await storage.listEvents("workday_1");

    expect(events).toEqual([event]);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "append_event", { event });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "list_events", { workdayId: "workday_1" });
  });

  it("clears persisted data through the sqlite command", async () => {
    invokeMock.mockResolvedValueOnce(undefined);

    await new SqliteStoragePort().clearPersistedData();
    expect(invokeMock).toHaveBeenCalledWith("clear_persisted_data");
  });
});
