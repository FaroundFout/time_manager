import { addMinutes, makeId, minutesBetweenIso, toIso } from "./time";
import { deriveTimeline, markCurrentStage } from "./timeEngine";
import { snoozeReminder } from "./reminderEngine";
import type {
  AppSnapshot,
  EventRecord,
  IncidentRecord,
  StageInstance,
  TimelineSegment,
  WorkdayState,
  WorkdayStatus
} from "./types";
import { createEvent } from "./eventLog";

export type StateAction =
  | { type: "tick"; now: Date }
  | { type: "confirmStageStart"; now: Date }
  | { type: "confirmStageEnd"; now: Date }
  | { type: "continueCurrentStage"; now: Date }
  | { type: "endStageEarly"; now: Date }
  | { type: "enterNextStageImmediately"; now: Date }
  | { type: "startIncident"; now: Date }
  | { type: "endIncident"; now: Date; note?: string }
  | { type: "resetWorkday"; now: Date }
  | { type: "snoozeReminder"; now: Date };

export function reduceSnapshot(snapshot: AppSnapshot, action: StateAction): AppSnapshot {
  switch (action.type) {
    case "tick":
      return tick(snapshot, action.now);
    case "confirmStageStart":
      return confirmStageStart(snapshot, action.now);
    case "confirmStageEnd":
      return confirmStageEnd(snapshot, action.now);
    case "continueCurrentStage":
      return continueCurrentStage(snapshot, action.now);
    case "endStageEarly":
      return endStageEarly(snapshot, action.now);
    case "enterNextStageImmediately":
      return enterNextStageImmediately(snapshot, action.now);
    case "startIncident":
      return startIncident(snapshot, action.now);
    case "endIncident":
      return endIncident(snapshot, action.now, action.note);
    case "resetWorkday":
      return resetWorkday(snapshot, action.now);
    case "snoozeReminder":
      return snoozeReminder(snapshot, action.now);
    default:
      return snapshot;
  }
}

function tick(snapshot: AppSnapshot, now: Date): AppSnapshot {
  const nowMs = now.getTime();
  const state = snapshot.workdayState;
  if (state.status === "stageRunning") {
    const stage = currentStage(snapshot);
    if (stage && nowMs >= new Date(stage.currentEnd).getTime()) {
      return withStateAndEvent(
        snapshot,
        {
          ...state,
          status: "waitingStageEnd",
          pendingAction: "confirmStageEnd",
          message: `等待确认结束：${stage.name}`
        },
        createEvent("stageEndReached", { stageName: stage.name }, { workdayId: state.workdayId, stageId: stage.id, occurredAt: now }),
        updateStage(snapshot.stages, stage.id, { status: "waitingEnd" })
      );
    }
  }

  if (state.status === "idleGap") {
    const next = currentStage(snapshot);
    if (next && nowMs >= new Date(next.currentStart).getTime()) {
      return withStateAndEvent(
        snapshot,
        {
          ...state,
          status: "waitingStageStart",
          pendingAction: "confirmStageStart",
          message: `等待确认开始：${next.name}`
        },
        createEvent("stageStartReached", { stageName: next.name }, { workdayId: state.workdayId, stageId: next.id, occurredAt: now }),
        updateStage(snapshot.stages, next.id, { status: "waitingStart" })
      );
    }
  }

  if (state.status === "waitingWorkdayStart") {
    const first = snapshot.stages[0];
    if (first && nowMs >= new Date(first.currentStart).getTime()) {
      return withStateAndEvent(
        snapshot,
        {
          ...state,
          status: "waitingStageStart",
          currentStageId: first.id,
          pendingAction: "confirmStageStart",
          message: `等待确认开始：${first.name}`
        },
        createEvent("stageStartReached", { stageName: first.name }, { workdayId: state.workdayId, stageId: first.id, occurredAt: now }),
        updateStage(snapshot.stages, first.id, { status: "waitingStart" })
      );
    }
  }

  return snapshot;
}

function confirmStageStart(snapshot: AppSnapshot, now: Date): AppSnapshot {
  if (snapshot.workdayState.status !== "waitingStageStart") return snapshot;
  const stage = currentStage(snapshot);
  if (!stage) return snapshot;
  const duration = minutesBetweenIso(stage.originalStart, stage.originalEnd);
  const currentStart = toIso(now);
  const currentEnd = toIso(addMinutes(now, duration));
  const delta = minutesBetweenIso(stage.currentStart, currentStart);
  const shifted = shiftFutureStages(snapshot.stages, stage.id, delta);
  const stages = updateStage(shifted, stage.id, {
    actualStart: currentStart,
    currentStart,
    currentEnd,
    status: "running"
  });
  const state: WorkdayState = {
    ...snapshot.workdayState,
    status: "stageRunning",
    pendingAction: "none",
    message: `${stage.name} 进行中`
  };
  return withStateAndEvent(
    snapshot,
    state,
    createEvent("stageStartConfirmed", { stageName: stage.name }, { workdayId: stage.workdayId, stageId: stage.id, occurredAt: now }),
    stages
  );
}

function confirmStageEnd(snapshot: AppSnapshot, now: Date): AppSnapshot {
  if (snapshot.workdayState.status !== "waitingStageEnd" && snapshot.workdayState.status !== "stageRunning") return snapshot;
  const stage = currentStage(snapshot);
  if (!stage) return snapshot;
  const actualEnd = toIso(now);
  const extension = Math.max(0, minutesBetweenIso(stage.currentEnd, actualEnd));
  let stages = shiftFutureStages(snapshot.stages, stage.id, extension);
  stages = updateStage(stages, stage.id, {
    actualEnd,
    currentEnd: actualEnd,
    status: "completed"
  });

  const next = nextStage(stages, stage.id);
  const state = nextStateAfterStageEnd(snapshot.workdayState, next, now);
  return withStateAndEvent(
    snapshot,
    state,
    createEvent("stageEndConfirmed", { stageName: stage.name }, { workdayId: stage.workdayId, stageId: stage.id, occurredAt: now }),
    stages
  );
}

function continueCurrentStage(snapshot: AppSnapshot, now: Date): AppSnapshot {
  if (snapshot.workdayState.status !== "waitingStageEnd") return snapshot;
  const stage = currentStage(snapshot);
  if (!stage) return snapshot;
  const extraMinutes = Math.max(1, snapshot.config.reminderIntervalMinutes || 1);
  const currentEnd = toIso(addMinutes(now, extraMinutes));
  const stages = updateStage(snapshot.stages, stage.id, {
    currentEnd,
    status: "running"
  });
  const state: WorkdayState = {
    ...snapshot.workdayState,
    status: "stageRunning",
    pendingAction: "none",
    message: `${stage.name} 继续进行中`
  };
  return withStateAndEvent(
    snapshot,
    state,
    createEvent("stageContinued", { stageName: stage.name, extraMinutes }, { workdayId: stage.workdayId, stageId: stage.id, occurredAt: now }),
    stages
  );
}

function endStageEarly(snapshot: AppSnapshot, now: Date): AppSnapshot {
  if (snapshot.workdayState.status !== "stageRunning") return snapshot;
  const stage = currentStage(snapshot);
  if (!stage) return snapshot;
  const actualEnd = toIso(now);
  const stages = updateStage(snapshot.stages, stage.id, {
    actualEnd,
    currentEnd: actualEnd,
    status: "completed",
    endedEarly: true
  });
  const next = nextStage(stages, stage.id);
  const state = nextStateAfterStageEnd(snapshot.workdayState, next, now);
  return withStateAndEvent(
    snapshot,
    state,
    createEvent("stageEndedEarly", { stageName: stage.name }, { workdayId: stage.workdayId, stageId: stage.id, occurredAt: now }),
    stages
  );
}

function enterNextStageImmediately(snapshot: AppSnapshot, now: Date): AppSnapshot {
  const next = currentStage(snapshot);
  if (!next || (snapshot.workdayState.status !== "idleGap" && snapshot.workdayState.status !== "waitingStageStart")) return snapshot;
  const duration = minutesBetweenIso(next.originalStart, next.originalEnd);
  const currentStart = toIso(now);
  const currentEnd = toIso(addMinutes(now, duration));
  const delta = minutesBetweenIso(next.currentStart, currentStart);
  const shifted = shiftFutureStages(snapshot.stages, next.id, delta);
  const stages = updateStage(shifted, next.id, {
    actualStart: currentStart,
    currentStart,
    currentEnd,
    status: "running"
  });
  const state: WorkdayState = {
    ...snapshot.workdayState,
    status: "stageRunning",
    currentStageId: next.id,
    pendingAction: "none",
    message: `${next.name} 进行中`
  };
  return withStateAndEvent(
    snapshot,
    state,
    createEvent("enterNextStageImmediately", { stageName: next.name }, { workdayId: next.workdayId, stageId: next.id, occurredAt: now }),
    stages
  );
}

function startIncident(snapshot: AppSnapshot, now: Date): AppSnapshot {
  if (snapshot.workdayState.status === "incidentRunning") return snapshot;
  const current = currentStage(snapshot);
  const incident: IncidentRecord = {
    id: makeId("incident"),
    workdayId: snapshot.workdayState.workdayId ?? "unknown",
    startedAt: toIso(now),
    name: "突发事件",
    previousStatus: snapshot.workdayState.status,
    affectedStageId: current?.id
  };
  const state: WorkdayState = {
    ...snapshot.workdayState,
    status: "incidentRunning",
    currentIncidentId: incident.id,
    pendingAction: "endIncident",
    previousStatus: snapshot.workdayState.status,
    message: "突发事件进行中"
  };
  return withStateAndEvent(
    { ...snapshot, incidents: [...snapshot.incidents, incident] },
    state,
    createEvent("incidentStarted", { previousStatus: incident.previousStatus }, { workdayId: incident.workdayId, stageId: current?.id, occurredAt: now }),
    snapshot.stages
  );
}

function endIncident(snapshot: AppSnapshot, now: Date, note?: string): AppSnapshot {
  if (snapshot.workdayState.status !== "incidentRunning") return snapshot;
  const incident = snapshot.incidents.find((item) => item.id === snapshot.workdayState.currentIncidentId);
  if (!incident) return snapshot;
  const endedAt = toIso(now);
  const incidentMinutes = minutesBetweenIso(incident.startedAt, endedAt);
  let stages = snapshot.stages;
  let status: WorkdayStatus = incident.previousStatus;
  let currentStageId = snapshot.workdayState.currentStageId;
  const affected = incident.affectedStageId ? stages.find((stage) => stage.id === incident.affectedStageId) : undefined;

  if (affected && ["stageRunning", "waitingStageStart", "waitingStageEnd"].includes(incident.previousStatus)) {
    stages = shiftStagesFrom(stages, affected.id, incidentMinutes);
  }

  if (incident.previousStatus === "idleGap") {
    const next = currentStage(snapshot);
    if (next && new Date(endedAt).getTime() >= new Date(next.currentStart).getTime()) {
      stages = shiftStagesFrom(stages, next.id, minutesBetweenIso(next.currentStart, endedAt));
      status = "waitingStageStart";
      currentStageId = next.id;
      stages = updateStage(stages, next.id, { status: "waitingStart" });
    }
  }

  const incidents = snapshot.incidents.map((item) =>
    item.id === incident.id ? { ...item, endedAt, note, name: note?.trim() || "突发事件" } : item
  );
  const state: WorkdayState = {
    ...snapshot.workdayState,
    status,
    currentIncidentId: undefined,
    currentStageId,
    pendingAction: status === "waitingStageStart" ? "confirmStageStart" : status === "waitingStageEnd" ? "confirmStageEnd" : "none",
    message: status === "waitingStageStart" ? "突发事件结束，等待确认开始" : "突发事件结束，已恢复日程"
  };
  return withStateAndEvent(
    { ...snapshot, incidents },
    state,
    createEvent("incidentEnded", { note: note ?? "" }, { workdayId: incident.workdayId, stageId: incident.affectedStageId, occurredAt: now }),
    stages
  );
}

function resetWorkday(snapshot: AppSnapshot, now: Date): AppSnapshot {
  const stages = snapshot.stages.map((stage) => {
    if (["running", "waitingStart", "waitingEnd"].includes(stage.status)) {
      return { ...stage, status: "terminated" as const, terminated: true, terminationReason: "因手动重置而终止" };
    }
    if (stage.status === "notStarted") {
      return { ...stage, status: "abandoned" as const, terminationReason: "因手动重置而放弃" };
    }
    return stage;
  });
  const state: WorkdayState = {
    ...snapshot.workdayState,
    status: "waitingNextWorkday",
    pendingAction: "none",
    message: "当前作息日已手动重置"
  };
  return withStateAndEvent(
    snapshot,
    state,
    createEvent("workdayReset", {}, { workdayId: snapshot.workdayState.workdayId, occurredAt: now }),
    stages
  );
}

function nextStateAfterStageEnd(state: WorkdayState, next: StageInstance | undefined, now: Date): WorkdayState {
  if (!next) {
    return { ...state, status: "waitingNextWorkday", currentStageId: undefined, pendingAction: "none", message: "等待下一个作息日" };
  }
  if (new Date(next.currentStart).getTime() <= now.getTime()) {
    return { ...state, status: "waitingStageStart", currentStageId: next.id, pendingAction: "confirmStageStart", message: `等待确认开始：${next.name}` };
  }
  return { ...state, status: "idleGap", currentStageId: next.id, pendingAction: "none", message: `当前为空档，等待 ${next.name}` };
}

function currentStage(snapshot: AppSnapshot): StageInstance | undefined {
  return snapshot.stages.find((stage) => stage.id === snapshot.workdayState.currentStageId);
}

function nextStage(stages: StageInstance[], currentId: string): StageInstance | undefined {
  const index = stages.findIndex((stage) => stage.id === currentId);
  return index >= 0 ? stages[index + 1] : undefined;
}

function updateStage(stages: StageInstance[], id: string, patch: Partial<StageInstance>): StageInstance[] {
  return stages.map((stage) => (stage.id === id ? { ...stage, ...patch } : stage));
}

function shiftFutureStages(stages: StageInstance[], currentId: string, minutes: number): StageInstance[] {
  const currentIndex = stages.findIndex((stage) => stage.id === currentId);
  if (currentIndex < 0 || minutes === 0) return stages;
  return stages.map((stage, index) => {
    if (index <= currentIndex) return stage;
    return {
      ...stage,
      currentStart: toIso(addMinutes(new Date(stage.currentStart), minutes)),
      currentEnd: toIso(addMinutes(new Date(stage.currentEnd), minutes))
    };
  });
}

function shiftStagesFrom(stages: StageInstance[], firstId: string, minutes: number): StageInstance[] {
  const firstIndex = stages.findIndex((stage) => stage.id === firstId);
  if (firstIndex < 0 || minutes === 0) return stages;
  return stages.map((stage, index) => {
    if (index < firstIndex) return stage;
    return {
      ...stage,
      currentStart: toIso(addMinutes(new Date(stage.currentStart), minutes)),
      currentEnd: toIso(addMinutes(new Date(stage.currentEnd), minutes))
    };
  });
}

function withStateAndEvent(snapshot: AppSnapshot, state: WorkdayState, event: EventRecord, stages: StageInstance[]): AppSnapshot {
  const timelineExtras: TimelineSegment[] = snapshot.incidents
    .filter((incident) => incident.endedAt)
    .map((incident) => ({
      id: `segment_${incident.id}`,
      workdayId: incident.workdayId,
      type: "incident",
      name: incident.name,
      start: incident.startedAt,
      end: incident.endedAt,
      relatedStageId: incident.affectedStageId,
      note: incident.note
    }));
  const markedStages = markCurrentStage(stages, state);
  return {
    ...snapshot,
    workdayState: state,
    stages: markedStages,
    events: [...snapshot.events, event],
    timeline: deriveTimeline(state.workdayId ?? "unknown", markedStages, timelineExtras),
    reminderWindowVisible: state.pendingAction === "confirmStageStart" || state.pendingAction === "confirmStageEnd"
  };
}
