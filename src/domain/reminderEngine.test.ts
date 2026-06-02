import { describe, expect, it } from "vitest";
import { evaluateReminder, snoozeReminder } from "./reminderEngine";
import { parseScheduleMarkdown } from "./scheduleParser";
import { createDefaultConfig } from "./storage";
import { reduceSnapshot } from "./stateMachine";
import { buildWorkdayFromTemplate } from "./timeEngine";
import type { AppSnapshot } from "./types";

function makeWaitingStartSnapshot(): AppSnapshot {
  const template = parseScheduleMarkdown(`日程起点: 08:00
- 10:00-11:00 学习
- 11:00-12:00 休息`);
  const built = buildWorkdayFromTemplate(template, new Date("2026-06-02T02:00:00.000Z"));
  return {
    config: createDefaultConfig(),
    template,
    workdayState: built.state,
    stages: built.stages,
    timeline: built.timeline,
    incidents: [],
    events: [],
    notificationStatus: "granted"
  };
}

describe("evaluateReminder", () => {
  it("待确认开始时触发提醒并写入下一次提醒时间", () => {
    const snapshot = makeWaitingStartSnapshot();
    const evaluated = evaluateReminder(snapshot, new Date("2026-06-02T02:00:00.000Z"));

    expect(evaluated.shouldShowWindow).toBe(true);
    expect(evaluated.shouldNotify).toBe(true);
    expect(evaluated.shouldPlaySound).toBe(true);
    expect(evaluated.snapshot.reminderWindowVisible).toBe(true);
    expect(evaluated.snapshot.nextReminderAt).toBe("2026-06-02T02:05:00.000Z");
  });

  it("提醒窗口仍显示时不会重复触发", () => {
    const first = evaluateReminder(makeWaitingStartSnapshot(), new Date("2026-06-02T02:00:00.000Z")).snapshot;
    const second = evaluateReminder(first, new Date("2026-06-02T02:01:00.000Z"));

    expect(second.shouldShowWindow).toBe(false);
    expect(second.changed).toBe(false);
  });

  it("稍后提醒不改变作息状态，并在下一周期再次触发", () => {
    const first = evaluateReminder(makeWaitingStartSnapshot(), new Date("2026-06-02T02:00:00.000Z")).snapshot;
    const snoozed = snoozeReminder(first, new Date("2026-06-02T02:01:00.000Z"));
    const beforeDue = evaluateReminder(snoozed, new Date("2026-06-02T02:05:00.000Z"));
    const due = evaluateReminder(snoozed, new Date("2026-06-02T02:06:00.000Z"));

    expect(snoozed.workdayState.status).toBe("waitingStageStart");
    expect(beforeDue.shouldShowWindow).toBe(false);
    expect(due.shouldShowWindow).toBe(true);
  });

  it("firstOnly 模式同一待处理动作只首次响铃", () => {
    const snapshot = {
      ...makeWaitingStartSnapshot(),
      config: { ...createDefaultConfig(), soundMode: "firstOnly" as const, reminderIntervalMinutes: 1 }
    };
    const first = evaluateReminder(snapshot, new Date("2026-06-02T02:00:00.000Z")).snapshot;
    const snoozed = snoozeReminder(first, new Date("2026-06-02T02:00:10.000Z"));
    const second = evaluateReminder(snoozed, new Date("2026-06-02T02:01:10.000Z"));

    expect(second.shouldShowWindow).toBe(true);
    expect(second.shouldPlaySound).toBe(false);
  });

  it("待确认动作结束后清理过期提醒状态", () => {
    const reminded = evaluateReminder(makeWaitingStartSnapshot(), new Date("2026-06-02T02:00:00.000Z")).snapshot;
    const running = reduceSnapshot(reminded, { type: "confirmStageStart", now: new Date("2026-06-02T02:02:00.000Z") });
    const evaluated = evaluateReminder(running, new Date("2026-06-02T02:02:00.000Z"));

    expect(evaluated.snapshot.workdayState.status).toBe("stageRunning");
    expect(evaluated.snapshot.reminderWindowVisible).toBe(false);
    expect(evaluated.snapshot.activeReminderKey).toBeUndefined();
  });
});
