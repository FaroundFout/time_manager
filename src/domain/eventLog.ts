import { makeId, toIso } from "./time";
import type { EventRecord, EventType } from "./types";

export function createEvent<TPayload extends Record<string, unknown>>(
  type: EventType,
  payload: TPayload,
  options: { workdayId?: string; stageId?: string; occurredAt?: Date } = {}
): EventRecord<TPayload> {
  return {
    id: makeId("event"),
    workdayId: options.workdayId,
    stageId: options.stageId,
    type,
    occurredAt: toIso(options.occurredAt ?? new Date()),
    payload
  };
}

export function eventsForWorkday(events: EventRecord[], workdayId?: string): EventRecord[] {
  if (!workdayId) return events;
  return events.filter((event) => event.workdayId === workdayId);
}
