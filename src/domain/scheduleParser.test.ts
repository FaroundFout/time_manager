import { describe, expect, it } from "vitest";
import { parseScheduleMarkdown, ScheduleParseError } from "./scheduleParser";

describe("parseScheduleMarkdown", () => {
  it("解析显式日程起点、中文冒号、备注和重复阶段名称", () => {
    const template = parseScheduleMarkdown(`日程起点：08:00

- 08：00 - 08:30 学习 # 备注：语文
- 08:30-09:00 学习
`);

    expect(template.scheduleStart).toBe("08:00");
    expect(template.stages).toHaveLength(2);
    expect(template.stages[0]).toMatchObject({
      index: 1,
      name: "学习",
      note: "备注：语文",
      startTime: "08:00",
      endTime: "08:30",
      durationMinutes: 30
    });
  });

  it("没有显式日程起点时使用第一段开始时间", () => {
    const template = parseScheduleMarkdown(`- 10:00-11:30 学习
- 11:30-13:00 吃饭`);

    expect(template.scheduleStart).toBe("10:00");
    expect(template.stages[1].startOffsetMinutes).toBe(90);
  });

  it("允许跨午夜阶段并归入同一个作息日", () => {
    const template = parseScheduleMarkdown(`日程起点: 08:00

- 23:30-00:30 学习`);

    expect(template.stages[0].crossesMidnight).toBe(true);
    expect(template.stages[0].durationMinutes).toBe(60);
    expect(template.stages[0].startOffsetMinutes).toBe(15 * 60 + 30);
  });

  it("拒绝重叠或顺序不合理的阶段", () => {
    expect(() =>
      parseScheduleMarkdown(`日程起点: 08:00
- 08:00-10:00 学习
- 09:30-11:00 会议`)
    ).toThrow(ScheduleParseError);
  });

  it("拒绝缺少名称或时间格式错误", () => {
    expect(() => parseScheduleMarkdown("- 08:00-09:00 ")).toThrow(ScheduleParseError);
    expect(() => parseScheduleMarkdown("- 08:00 学习")).toThrow(ScheduleParseError);
  });
});
