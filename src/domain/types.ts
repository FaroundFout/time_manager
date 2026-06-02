export type TimeOfDay = `${string}:${string}`;
export type ISODateTime = string;

export type SoundMode = "everyReminder" | "firstOnly" | "silent";
export type NotificationStatus = "unknown" | "granted" | "denied" | "unavailable";

export interface AppConfig {
  scheduleFilePath?: string;
  reminderIntervalMinutes: number;
  soundMode: SoundMode;
  autostart: boolean;
  mainWindowAlwaysOnTop: boolean;
  latestTemplateId?: string;
  activeWorkdayId?: string;
}

export interface TemplateStage {
  index: number;
  name: string;
  note?: string;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  crossesMidnight: boolean;
  durationMinutes: number;
  sourceLine: number;
  startOffsetMinutes: number;
  endOffsetMinutes: number;
}

export interface ParsedTemplate {
  templateId: string;
  scheduleStart: TimeOfDay;
  stages: TemplateStage[];
  sourcePath?: string;
  rawText: string;
  appliedAt?: ISODateTime;
}

export type WorkdayStatus =
  | "uninitialized"
  | "waitingWorkdayStart"
  | "idleGap"
  | "waitingStageStart"
  | "stageRunning"
  | "waitingStageEnd"
  | "incidentRunning"
  | "waitingNextWorkday"
  | "dataError";

export type PendingAction =
  | "confirmStageStart"
  | "confirmStageEnd"
  | "endIncident"
  | "none";

export interface WorkdayState {
  status: WorkdayStatus;
  workdayId?: string;
  templateId?: string;
  currentStageId?: string;
  currentIncidentId?: string;
  pendingAction?: PendingAction;
  workdayStart?: ISODateTime;
  workdayEnd?: ISODateTime;
  message?: string;
  previousStatus?: WorkdayStatus;
}

export type StageStatus =
  | "notStarted"
  | "waitingStart"
  | "running"
  | "waitingEnd"
  | "completed"
  | "terminated"
  | "abandoned";

export interface StageInstance {
  id: string;
  workdayId: string;
  templateStageIndex: number;
  name: string;
  note?: string;
  originalStart: ISODateTime;
  originalEnd: ISODateTime;
  currentStart: ISODateTime;
  currentEnd: ISODateTime;
  actualStart?: ISODateTime;
  actualEnd?: ISODateTime;
  status: StageStatus;
  endedEarly: boolean;
  terminated: boolean;
  terminationReason?: string;
}

export type TimelineSegmentType =
  | "stage"
  | "autoGap"
  | "earlyEndGap"
  | "incident"
  | "manualReset"
  | "applySchedule";

export interface TimelineSegment {
  id: string;
  workdayId: string;
  type: TimelineSegmentType;
  name: string;
  start: ISODateTime;
  end?: ISODateTime;
  relatedStageId?: string;
  note?: string;
}

export type EventType =
  | "templateEnabled"
  | "scheduleApplied"
  | "workdayCreated"
  | "stageStartReached"
  | "stageStartConfirmed"
  | "stageEndReached"
  | "stageContinued"
  | "stageEndConfirmed"
  | "stageEndedEarly"
  | "enterNextStageImmediately"
  | "incidentStarted"
  | "incidentEnded"
  | "workdayReset"
  | "exitConfirmed"
  | "startupRecovered";

export interface EventRecord<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  workdayId?: string;
  stageId?: string;
  type: EventType;
  occurredAt: ISODateTime;
  payload: TPayload;
}

export interface IncidentRecord {
  id: string;
  workdayId: string;
  startedAt: ISODateTime;
  endedAt?: ISODateTime;
  name: string;
  note?: string;
  previousStatus: WorkdayStatus;
  affectedStageId?: string;
}

export interface AppSnapshot {
  config: AppConfig;
  template?: ParsedTemplate;
  workdayState: WorkdayState;
  stages: StageInstance[];
  timeline: TimelineSegment[];
  incidents: IncidentRecord[];
  events: EventRecord[];
  lastReminderAt?: ISODateTime;
  nextReminderAt?: ISODateTime;
  reminderWindowVisible?: boolean;
  activeReminderKey?: string;
  lastSoundReminderKey?: string;
  notificationStatus?: NotificationStatus;
}

export interface WorkdaySummary {
  workdayId: string;
  start: ISODateTime;
  end: ISODateTime;
  status: WorkdayStatus;
}

export interface StoragePort {
  loadSnapshot(): Promise<AppSnapshot | undefined>;
  saveSnapshot(snapshot: AppSnapshot): Promise<void>;
  appendEvent(event: EventRecord): Promise<void>;
  listEvents(workdayId?: string): Promise<EventRecord[]>;
  saveTemplateSnapshot(template: ParsedTemplate): Promise<void>;
  listWorkdays(): Promise<WorkdaySummary[]>;
}
