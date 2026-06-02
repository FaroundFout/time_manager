import { describe, expect, it } from "vitest";
import { parseScheduleMarkdown } from "./scheduleParser";
import { buildWorkdayFromTemplate } from "./timeEngine";
import { reduceSnapshot } from "./stateMachine";
import { createDefaultConfig } from "./storage";
import type { AppSnapshot } from "./types";

function makeSnapshot(now: Date): AppSnapshot {
  const template = parseScheduleMarkdown(`日程起点: 08:00
- 10:00-11:30 学习
- 11:30-13:00 吃饭
- 13:00-14:30 学习`);
  const built = buildWorkdayFromTemplate(template, now);
  return {
    config: createDefaultConfig(),
    template,
    workdayState: built.state,
    stages: built.stages,
    timeline: built.timeline,
    incidents: [],
    events: []
  };
}

describe("reduceSnapshot", () => {
  it("确认开始延迟后保持阶段时长并顺延后续阶段", () => {
    let snapshot = makeSnapshot(new Date("2026-06-02T02:00:00.000Z"));
    snapshot = reduceSnapshot(snapshot, { type: "confirmStageStart", now: new Date("2026-06-02T02:17:00.000Z") });

    expect(snapshot.workdayState.status).toBe("stageRunning");
    expect(snapshot.stages[0].actualStart).toBe("2026-06-02T02:17:00.000Z");
    expect(snapshot.stages[0].currentEnd).toBe("2026-06-02T03:47:00.000Z");
    expect(snapshot.stages[1].currentStart).toBe("2026-06-02T03:47:00.000Z");
  });

  it("结束延迟会额外顺延后续阶段", () => {
    let snapshot = makeSnapshot(new Date("2026-06-02T02:00:00.000Z"));
    snapshot = reduceSnapshot(snapshot, { type: "confirmStageStart", now: new Date("2026-06-02T02:17:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "tick", now: new Date("2026-06-02T03:47:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "confirmStageEnd", now: new Date("2026-06-02T04:05:00.000Z") });

    expect(snapshot.stages[0].actualEnd).toBe("2026-06-02T04:05:00.000Z");
    expect(snapshot.stages[1].currentStart).toBe("2026-06-02T04:05:00.000Z");
  });

  it("提前结束默认不提前后续阶段并形成空档", () => {
    let snapshot = makeSnapshot(new Date("2026-06-02T02:00:00.000Z"));
    snapshot = reduceSnapshot(snapshot, { type: "confirmStageStart", now: new Date("2026-06-02T02:00:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "endStageEarly", now: new Date("2026-06-02T03:00:00.000Z") });

    expect(snapshot.stages[0].currentEnd).toBe("2026-06-02T03:00:00.000Z");
    expect(snapshot.stages[1].currentStart).toBe("2026-06-02T03:30:00.000Z");
    expect(snapshot.timeline.some((segment) => segment.type === "autoGap")).toBe(true);
  });

  it("突发事件发生在阶段中会暂停并顺延当前阶段", () => {
    let snapshot = makeSnapshot(new Date("2026-06-02T02:00:00.000Z"));
    snapshot = reduceSnapshot(snapshot, { type: "confirmStageStart", now: new Date("2026-06-02T02:00:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "startIncident", now: new Date("2026-06-02T02:40:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "endIncident", now: new Date("2026-06-02T03:10:00.000Z") });

    expect(snapshot.workdayState.status).toBe("stageRunning");
    expect(snapshot.stages[0].currentEnd).toBe("2026-06-02T04:00:00.000Z");
  });

  it("突发事件发生在等待确认中不计入等待延迟", () => {
    let snapshot = makeSnapshot(new Date("2026-06-02T02:00:00.000Z"));
    snapshot = reduceSnapshot(snapshot, { type: "startIncident", now: new Date("2026-06-02T02:05:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "endIncident", now: new Date("2026-06-02T02:35:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "confirmStageStart", now: new Date("2026-06-02T02:40:00.000Z") });

    expect(snapshot.stages[0].currentEnd).toBe("2026-06-02T04:10:00.000Z");
    expect(snapshot.stages[1].currentStart).toBe("2026-06-02T04:10:00.000Z");
  });

  it("进行中恢复超过当前计划结束时回到等待结束确认", () => {
    let snapshot = makeSnapshot(new Date("2026-06-02T02:00:00.000Z"));
    snapshot = reduceSnapshot(snapshot, { type: "confirmStageStart", now: new Date("2026-06-02T02:00:00.000Z") });
    snapshot = reduceSnapshot(snapshot, { type: "tick", now: new Date("2026-06-02T04:00:00.000Z") });

    expect(snapshot.workdayState.status).toBe("waitingStageEnd");
  });
});
