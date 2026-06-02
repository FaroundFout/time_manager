import { invoke, isTauri } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { isPermissionGranted, onAction, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { AppSnapshot, NotificationStatus } from "../domain/types";
import type { ReminderPayload } from "../domain/reminderEngine";

const REQUEST_EXIT_EVENT = "time-manager://request-exit-confirmation";
const SNAPSHOT_UPDATED_EVENT = "time-manager://snapshot-updated";
const REMINDER_ACTION_EVENT = "time-manager://reminder-action";

export type ReminderAction =
  | "confirmStageStart"
  | "confirmStageEnd"
  | "continueCurrentStage"
  | "startIncident"
  | "snoozeReminder";

export interface PickedMarkdownFile {
  path: string;
  text: string;
}

export function isDesktopRuntime(): boolean {
  return isTauri();
}

export async function pickMarkdownFile(): Promise<PickedMarkdownFile | undefined> {
  if (!isDesktopRuntime()) return undefined;

  const selected = await openDialog({
    title: "选择作息 Markdown 文件",
    multiple: false,
    directory: false,
    filters: [
      {
        name: "Markdown",
        extensions: ["md", "markdown"]
      },
      {
        name: "Text",
        extensions: ["txt"]
      }
    ]
  });

  if (!selected || Array.isArray(selected)) return undefined;

  return {
    path: selected,
    text: await readTextFile(selected)
  };
}

export async function requestExitApp(): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke("exit_app");
  }
}

export async function showMainWindow(): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke("show_main_window");
  }
}

export async function showReminderWindow(_payload: ReminderPayload): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke("show_reminder_window");
  }
}

export async function hideReminderWindow(): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke("hide_reminder_window");
  }
}

export async function playReminderSound(): Promise<void> {
  if (isDesktopRuntime()) {
    await invoke("play_reminder_sound");
  }
}

export async function getNotificationAvailability(): Promise<NotificationStatus> {
  if (!isDesktopRuntime()) return "unavailable";

  try {
    if (await isPermissionGranted()) return "granted";
    const permission = await requestPermission();
    return permission === "granted" ? "granted" : "denied";
  } catch {
    return "unavailable";
  }
}

export async function sendSystemReminder(payload: ReminderPayload): Promise<void> {
  if (!isDesktopRuntime()) return;
  if ((await getNotificationAvailability()) !== "granted") return;

  sendNotification({
    id: notificationIdFromKey(payload.key),
    title: payload.title,
    body: payload.body,
    autoCancel: true,
    extra: { reminderKey: payload.key }
  });
}

export async function sendSnapshotUpdated(snapshot: AppSnapshot): Promise<void> {
  if (isDesktopRuntime()) {
    await emit(SNAPSHOT_UPDATED_EVENT, snapshot);
  }
}

export async function onSnapshotUpdated(handler: (snapshot: AppSnapshot) => void): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) return () => undefined;
  return listen<AppSnapshot>(SNAPSHOT_UPDATED_EVENT, (event) => handler(event.payload));
}

export async function sendReminderAction(action: ReminderAction): Promise<void> {
  if (isDesktopRuntime()) {
    await emit(REMINDER_ACTION_EVENT, action);
  }
}

export async function onReminderAction(handler: (action: ReminderAction) => void): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) return () => undefined;
  return listen<ReminderAction>(REMINDER_ACTION_EVENT, (event) => handler(event.payload));
}

export async function onNotificationInteraction(handler: () => void): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) return () => undefined;
  const listener = await onAction(() => handler());
  return () => {
    listener.unregister();
  };
}

export async function onExitRequested(handler: () => void): Promise<UnlistenFn> {
  if (!isDesktopRuntime()) return () => undefined;
  return listen(REQUEST_EXIT_EVENT, handler);
}

function notificationIdFromKey(key: string): number {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) || 1;
}
