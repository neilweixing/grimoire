import { describe, expect, it } from "vitest";
import {
  matchSkillTrigger,
  SKILL_TRIGGER,
  skillCompletionAdapter,
  skillFormatter,
} from "../apps/grimoire-web/src/skill-completion";

describe("native Skill completion", () => {
  it.each([
    ["/skill", 6, { query: "", offset: 0, endOffset: 6 }],
    ["/skill:", 7, { query: "", offset: 0, endOffset: 7 }],
    ["/skill gri", 10, { query: "gri", offset: 0, endOffset: 10 }],
    ["/skill:grilling Task", 10, { query: "gri", offset: 0, endOffset: 15 }],
    ["/skill:grilling Task", 6, { query: "", offset: 0, endOffset: 15 }],
    ["/skill Task", 6, { query: "", offset: 0, endOffset: 6 }],
  ])(
    "matches a Skill command without consuming following task text: %s",
    (text, cursor, expected) => {
      expect(matchSkillTrigger(text, SKILL_TRIGGER, cursor)).toEqual(expected);
    },
  );
  it.each([
    "/",
    "/skills",
    "/skillful",
    "Task /skill",
    "/path/skill",
    "/skill:grilling Task",
    "/skill\nTask",
  ])("ignores plain text and completed commands: %s", (text) => {
    expect(matchSkillTrigger(text, SKILL_TRIGGER, text.length)).toBeNull();
  });
  it("stays closed when Escape moves the cursor before the trigger", () => {
    expect(matchSkillTrigger("/skill:grilling", SKILL_TRIGGER, 0)).toBeNull();
  });
  it("searches enabled Skill names and descriptions while excluding disabled Skills", () => {
    const adapter = skillCompletionAdapter([
      { name: "grilling", description: "Refine a plan", enabled: true },
      { name: "analysis", description: "分析数据", enabled: true },
      { name: "disabled", description: "Refine a plan", enabled: false },
    ]);
    expect(adapter.search("").map((item) => item.id)).toEqual([
      "grilling",
      "analysis",
    ]);
    expect(adapter.search("GRI").map((item) => item.id)).toEqual(["grilling"]);
    expect(adapter.search("分析").map((item) => item.id)).toEqual(["analysis"]);
  });
  it("serializes only Pi's native command, preserving ordinary text", () => {
    expect(
      skillFormatter.serialize({
        id: "grilling",
        type: "skill",
        label: "grilling",
      }),
    ).toBe("/skill:grilling");
    expect(skillFormatter.parse("/skill:grilling Do the task")).toEqual([
      { kind: "text", text: "/skill:grilling Do the task" },
    ]);
  });
});
