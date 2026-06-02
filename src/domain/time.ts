import type { ISODateTime, TimeOfDay } from "./types";

export const MINUTES_PER_DAY = 24 * 60;

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeTimeText(input: string): string {
  return input.trim().replace("：", ":");
}

export function parseTimeOfDay(input: string): number {
  const normalized = normalizeTimeText(input);
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) {
    throw new Error("时间格式必须是 HH:MM");
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error("时间超出 00:00-23:59 范围");
  }

  return hour * 60 + minute;
}

export function formatTimeOfDay(minutes: number): TimeOfDay {
  const wrapped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(wrapped / 60);
  const minute = wrapped % 60;
  return `${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function minutesBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / 60_000);
}

export function minutesBetweenIso(start: ISODateTime, end: ISODateTime): number {
  return minutesBetween(new Date(start), new Date(end));
}

export function toIso(date: Date): ISODateTime {
  return date.toISOString();
}

export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

export function dateAtLocalTime(day: Date, time: TimeOfDay): Date {
  return addMinutes(startOfLocalDay(day), parseTimeOfDay(time));
}

export function formatClock(dateOrIso?: Date | ISODateTime): string {
  if (!dateOrIso) return "未记录";
  const date = typeof dateOrIso === "string" ? new Date(dateOrIso) : dateOrIso;
  return `${date.getHours().toString().padStart(2, "0")}:${date
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")}`;
}

export function compareIso(left?: ISODateTime, right?: ISODateTime): number {
  if (!left || !right) return 0;
  return new Date(left).getTime() - new Date(right).getTime();
}
