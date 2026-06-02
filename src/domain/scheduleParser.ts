import { formatTimeOfDay, makeId, MINUTES_PER_DAY, parseTimeOfDay } from "./time";
import type { ParsedTemplate, TemplateStage, TimeOfDay } from "./types";

export interface ParseErrorDetail {
  line: number;
  reason: string;
  text: string;
}

export class ScheduleParseError extends Error {
  constructor(public readonly errors: ParseErrorDetail[]) {
    super(errors.map((error) => `第 ${error.line} 行：${error.reason}`).join("\n"));
    this.name = "ScheduleParseError";
  }
}

interface RawStage {
  sourceLine: number;
  start: string;
  end: string;
  body: string;
}

export function parseScheduleMarkdown(rawText: string, sourcePath?: string): ParsedTemplate {
  const lines = rawText.split(/\r?\n/);
  const errors: ParseErrorDetail[] = [];
  const rawStages: RawStage[] = [];
  let explicitScheduleStart: TimeOfDay | undefined;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) return;

    const scheduleStartMatch = /^日程起点\s*[:：]\s*(\d{1,2}[:：]\d{2})\s*$/.exec(trimmed);
    if (scheduleStartMatch) {
      try {
        explicitScheduleStart = formatTimeOfDay(parseTimeOfDay(scheduleStartMatch[1]));
      } catch (error) {
        errors.push({ line: lineNumber, reason: (error as Error).message, text: line });
      }
      return;
    }

    if (/^日程起点\s*[:：]/.test(trimmed)) {
      errors.push({ line: lineNumber, reason: "日程起点格式错误", text: line });
      return;
    }

    const stageMatch = /^(?:[-*]\s*)?(\d{1,2}[:：]\d{2})\s*-\s*(\d{1,2}[:：]\d{2})\s+(.+)$/.exec(trimmed);
    if (stageMatch) {
      rawStages.push({
        sourceLine: lineNumber,
        start: stageMatch[1],
        end: stageMatch[2],
        body: stageMatch[3].trim()
      });
      return;
    }

    if (/^(?:[-*]\s*)?\d{1,2}[:：]\d{2}/.test(trimmed)) {
      errors.push({ line: lineNumber, reason: "阶段时间格式错误或缺少结束时间", text: line });
    }
  });

  if (rawStages.length === 0) {
    errors.push({ line: 1, reason: "没有任何有效阶段", text: rawText.split(/\r?\n/)[0] ?? "" });
  }

  if (errors.length > 0) {
    throw new ScheduleParseError(errors);
  }

  const scheduleStart = explicitScheduleStart ?? formatTimeOfDay(parseTimeOfDay(rawStages[0].start));
  const scheduleStartMinutes = parseTimeOfDay(scheduleStart);
  let previousEndOffset = -1;

  const stages: TemplateStage[] = rawStages.map((rawStage, index) => {
    const startMinutes = parseTimeOfDay(rawStage.start);
    const endMinutes = parseTimeOfDay(rawStage.end);
    const startTime = formatTimeOfDay(startMinutes);
    const endTime = formatTimeOfDay(endMinutes);
    const crossesMidnight = endMinutes <= startMinutes;
    const startOffsetMinutes = (startMinutes - scheduleStartMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    let endOffsetMinutes = (endMinutes - scheduleStartMinutes + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    if (endOffsetMinutes <= startOffsetMinutes) {
      endOffsetMinutes += MINUTES_PER_DAY;
    }

    if (startOffsetMinutes < previousEndOffset) {
      errors.push({
        line: rawStage.sourceLine,
        reason: "阶段顺序不合理或与上一阶段重叠",
        text: lines[rawStage.sourceLine - 1]
      });
    }
    previousEndOffset = endOffsetMinutes;

    const { name, note } = splitNameAndNote(rawStage.body);
    if (!name) {
      errors.push({ line: rawStage.sourceLine, reason: "阶段缺少名称", text: lines[rawStage.sourceLine - 1] });
    }

    return {
      index: index + 1,
      name,
      note,
      startTime: startTime as TimeOfDay,
      endTime: endTime as TimeOfDay,
      crossesMidnight,
      durationMinutes: endOffsetMinutes - startOffsetMinutes,
      sourceLine: rawStage.sourceLine,
      startOffsetMinutes,
      endOffsetMinutes
    };
  });

  if (errors.length > 0) {
    throw new ScheduleParseError(errors);
  }

  return {
    templateId: makeId("template"),
    scheduleStart,
    stages,
    sourcePath,
    rawText
  };
}

function splitNameAndNote(body: string): { name: string; note?: string } {
  const [namePart, ...noteParts] = body.split("#");
  const name = namePart.trim();
  const note = noteParts.join("#").trim();
  return { name, note: note || undefined };
}
