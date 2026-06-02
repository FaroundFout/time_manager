import { describe, expect, it } from "vitest";
import { parseScheduleMarkdown } from "./scheduleParser";
import { buildWorkdayFromTemplate } from "./timeEngine";

describe("buildWorkdayFromTemplate", () => {
  it("当前时间落在正式阶段内时等待开始确认", () => {
    const template = parseScheduleMarkdown(`日程起点: 08:00
- 10:00-11:30 学习
- 11:30-13:00 吃饭`);
    const result = buildWorkdayFromTemplate(template, new Date("2026-06-02T02:30:00.000Z"));

    expect(result.state.status).toBe("waitingStageStart");
    expect(result.stages.find((stage) => stage.id === result.state.currentStageId)?.name).toBe("学习");
  });

  it("当前时间落在自动空档内时进入空档状态", () => {
    const template = parseScheduleMarkdown(`日程起点: 08:00
- 08:00-09:00 起床
- 10:00-11:00 学习`);
    const result = buildWorkdayFromTemplate(template, new Date("2026-06-02T01:30:00.000Z"));

    expect(result.state.status).toBe("idleGap");
    expect(result.stages.find((stage) => stage.id === result.state.currentStageId)?.name).toBe("学习");
  });

  it("跨午夜阶段生成次日结束时间", () => {
    const template = parseScheduleMarkdown(`日程起点: 08:00
- 23:30-00:30 学习`);
    const result = buildWorkdayFromTemplate(template, new Date("2026-06-02T15:40:00.000Z"));
    const stage = result.stages[0];

    expect(new Date(stage.originalEnd).getTime()).toBeGreaterThan(new Date(stage.originalStart).getTime());
  });
});
