import { addMinutes, toIso } from "./time";
import type { AppSnapshot, ISODateTime, PendingAction, StageInstance } from "./types";

export interface ReminderPayload {
  key: string;
  action: Extract<PendingAction, "confirmStageStart" | "confirmStageEnd">;
  stageId: string;
  stageName: string;
  workdayId?: string;
  title: string;
  body: string;
}

export interface ReminderEvaluation {
  snapshot: AppSnapshot;
  payload?: ReminderPayload;
  shouldShowWindow: boolean;
  shouldNotify: boolean;
  shouldPlaySound: boolean;
  changed: boolean;
}

export function evaluateReminder(snapshot: AppSnapshot, now: Date): ReminderEvaluation {
  const payload = buildReminderPayload(snapshot);
  if (!payload) {
    const cleared = clearReminderState(snapshot);
    return {
      snapshot: cleared,
      shouldShowWindow: false,
      shouldNotify: false,
      shouldPlaySound: false,
      changed: cleared !== snapshot
    };
  }

  const isNewReminder = snapshot.activeReminderKey !== payload.key;
  const isDueAfterSnooze =
    !snapshot.reminderWindowVisible &&
    (!snapshot.nextReminderAt || now.getTime() >= new Date(snapshot.nextReminderAt).getTime());
  const shouldTrigger = isNewReminder || isDueAfterSnooze;

  if (!shouldTrigger) {
    return {
      snapshot,
      payload,
      shouldShowWindow: false,
      shouldNotify: false,
      shouldPlaySound: false,
      changed: false
    };
  }

  const shouldPlaySound =
    snapshot.config.soundMode === "everyReminder" ||
    (snapshot.config.soundMode === "firstOnly" && snapshot.lastSoundReminderKey !== payload.key);
  const intervalMinutes = Math.max(1, snapshot.config.reminderIntervalMinutes || 1);
  const nextReminderAt = toIso(addMinutes(now, intervalMinutes));
  const lastReminderAt = toIso(now);

  return {
    snapshot: {
      ...snapshot,
      activeReminderKey: payload.key,
      lastReminderAt,
      nextReminderAt,
      reminderWindowVisible: true,
      lastSoundReminderKey: shouldPlaySound ? payload.key : snapshot.lastSoundReminderKey
    },
    payload,
    shouldShowWindow: true,
    shouldNotify: snapshot.notificationStatus !== "denied" && snapshot.notificationStatus !== "unavailable",
    shouldPlaySound,
    changed: true
  };
}

export function snoozeReminder(snapshot: AppSnapshot, now: Date): AppSnapshot {
  const intervalMinutes = Math.max(1, snapshot.config.reminderIntervalMinutes || 1);
  return {
    ...snapshot,
    reminderWindowVisible: false,
    nextReminderAt: toIso(addMinutes(now, intervalMinutes))
  };
}

function buildReminderPayload(snapshot: AppSnapshot): ReminderPayload | undefined {
  const action = snapshot.workdayState.pendingAction;
  if (action !== "confirmStageStart" && action !== "confirmStageEnd") return undefined;
  if (snapshot.workdayState.status !== "waitingStageStart" && snapshot.workdayState.status !== "waitingStageEnd") return undefined;

  const stage = currentStage(snapshot);
  if (!stage) return undefined;

  const isStart = action === "confirmStageStart";
  return {
    key: `${snapshot.workdayState.workdayId ?? "workday"}:${stage.id}:${action}`,
    action,
    stageId: stage.id,
    stageName: stage.name,
    workdayId: snapshot.workdayState.workdayId,
    title: "时间管理提醒",
    body: isStart ? `请确认开始：${stage.name}` : `请确认结束：${stage.name}`
  };
}

function currentStage(snapshot: AppSnapshot): StageInstance | undefined {
  return snapshot.stages.find((stage) => stage.id === snapshot.workdayState.currentStageId);
}

function clearReminderState(snapshot: AppSnapshot): AppSnapshot {
  if (
    !snapshot.reminderWindowVisible &&
    !snapshot.activeReminderKey &&
    !snapshot.lastReminderAt &&
    !snapshot.nextReminderAt &&
    !snapshot.lastSoundReminderKey
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    reminderWindowVisible: false,
    activeReminderKey: undefined,
    lastReminderAt: undefined as ISODateTime | undefined,
    nextReminderAt: undefined as ISODateTime | undefined,
    lastSoundReminderKey: undefined
  };
}
