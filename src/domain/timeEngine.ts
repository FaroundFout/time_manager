import { addMinutes, dateAtLocalTime, makeId, parseTimeOfDay, toIso } from "./time";
import type { ParsedTemplate, StageInstance, TimelineSegment, WorkdayState } from "./types";

export interface WorkdayBuildResult {
  state: WorkdayState;
  stages: StageInstance[];
  timeline: TimelineSegment[];
}

export function resolveWorkdayStart(now: Date, scheduleStart: string): Date {
  const todayStart = dateAtLocalTime(now, scheduleStart as `${string}:${string}`);
  return now.getTime() < todayStart.getTime() ? addMinutes(todayStart, -24 * 60) : todayStart;
}

export function buildWorkdayFromTemplate(template: ParsedTemplate, now = new Date()): WorkdayBuildResult {
  const workdayStartDate = resolveWorkdayStart(now, template.scheduleStart);
  const workdayId = `workday_${workdayStartDate.toISOString().slice(0, 10)}_${parseTimeOfDay(template.scheduleStart)}`;
  const workdayEndDate = addMinutes(workdayStartDate, 24 * 60);

  const stages = template.stages.map<StageInstance>((stage) => {
    const originalStart = addMinutes(workdayStartDate, stage.startOffsetMinutes);
    const originalEnd = addMinutes(workdayStartDate, stage.endOffsetMinutes);
    return {
      id: `${workdayId}_stage_${stage.index}`,
      workdayId,
      templateStageIndex: stage.index,
      name: stage.name,
      note: stage.note,
      originalStart: toIso(originalStart),
      originalEnd: toIso(originalEnd),
      currentStart: toIso(originalStart),
      currentEnd: toIso(originalEnd),
      status: "notStarted",
      endedEarly: false,
      terminated: false
    };
  });

  const state = locateInitialState(workdayId, template.templateId, workdayStartDate, workdayEndDate, stages, now);
  const timeline = deriveTimeline(workdayId, stages, []);
  return { state, stages: markCurrentStage(stages, state), timeline };
}

export function locateInitialState(
  workdayId: string,
  templateId: string,
  workdayStart: Date,
  workdayEnd: Date,
  stages: StageInstance[],
  now: Date
): WorkdayState {
  if (now.getTime() < workdayStart.getTime()) {
    return {
      status: "waitingWorkdayStart",
      workdayId,
      templateId,
      pendingAction: "none",
      workdayStart: toIso(workdayStart),
      workdayEnd: toIso(workdayEnd),
      message: "等待今日作息开始"
    };
  }

  const currentStage = stages.find(
    (stage) => new Date(stage.currentStart).getTime() <= now.getTime() && now.getTime() < new Date(stage.currentEnd).getTime()
  );
  if (currentStage) {
    return {
      status: "waitingStageStart",
      workdayId,
      templateId,
      currentStageId: currentStage.id,
      pendingAction: "confirmStageStart",
      workdayStart: toIso(workdayStart),
      workdayEnd: toIso(workdayEnd),
      message: `等待确认开始：${currentStage.name}`
    };
  }

  const nextStage = stages.find((stage) => now.getTime() < new Date(stage.currentStart).getTime());
  if (nextStage) {
    return {
      status: "idleGap",
      workdayId,
      templateId,
      currentStageId: nextStage.id,
      pendingAction: "none",
      workdayStart: toIso(workdayStart),
      workdayEnd: toIso(workdayEnd),
      message: `当前为空档，等待 ${nextStage.name}`
    };
  }

  return {
    status: "waitingNextWorkday",
    workdayId,
    templateId,
    pendingAction: "none",
    workdayStart: toIso(workdayStart),
    workdayEnd: toIso(workdayEnd),
    message: "今日作息已过，等待下一个作息日"
  };
}

export function markCurrentStage(stages: StageInstance[], state: WorkdayState): StageInstance[] {
  return stages.map((stage) => {
    if (stage.id !== state.currentStageId) return stage;
    if (state.status === "waitingStageStart") return { ...stage, status: "waitingStart" };
    if (state.status === "stageRunning") return { ...stage, status: "running" };
    if (state.status === "waitingStageEnd") return { ...stage, status: "waitingEnd" };
    return stage;
  });
}

export function deriveTimeline(
  workdayId: string,
  stages: StageInstance[],
  extraSegments: TimelineSegment[]
): TimelineSegment[] {
  const stageSegments = stages.map<TimelineSegment>((stage) => ({
    id: `segment_${stage.id}`,
    workdayId,
    type: "stage",
    name: stage.name,
    start: stage.actualStart ?? stage.currentStart,
    end: stage.actualEnd ?? stage.currentEnd,
    relatedStageId: stage.id,
    note: stage.note
  }));

  const baseSegments = [...stageSegments, ...extraSegments].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime()
  );
  const segmentsWithGaps: TimelineSegment[] = [];

  for (let index = 0; index < baseSegments.length; index += 1) {
    const current = baseSegments[index];
    const previous = segmentsWithGaps[segmentsWithGaps.length - 1];
    if (previous?.end && new Date(previous.end).getTime() < new Date(current.start).getTime()) {
      segmentsWithGaps.push({
        id: makeId("gap"),
        workdayId,
        type: "autoGap",
        name: "自动空档",
        start: previous.end,
        end: current.start
      });
    }
    segmentsWithGaps.push(current);
  }

  return segmentsWithGaps;
}
