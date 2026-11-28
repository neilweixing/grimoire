import { expect, it } from "vitest";
import {
  userCopyText,
  assistantCopyText,
  splitSkillInvocation,
} from "../apps/grimoire-web/src/message-copy";
import { attachmentReference } from "../packages/grimoire-core/src/index";
const file = attachmentReference({
  id: "77c054a9-3439-4632-9e37-d40df52028df",
  name: "fixture.txt",
  path: "/private/attachments/fixture.txt",
  contentType: "text/plain",
  size: 4,
});
const block = `<skill name="fixture" location="/private/skills/fixture/SKILL.md">\nHidden instructions\n</skill>`;
it("copies plain user Markdown and whitespace unchanged", () => {
  const source = "  **原始内容**\n\n\`code\`  ";
  expect(userCopyText(source)).toBe(source);
});
it("reconstructs a native Skill command without copying injected instructions or paths", () => {
  expect(userCopyText(`${block}\n\nExplain **this query**`)).toBe(
    "/skill:fixture Explain **this query**",
  );
  expect(userCopyText(block)).toBe("/skill:fixture");
});
it("removes attachment metadata from ordinary and Skill inputs and has no copy text for file-only messages", () => {
  expect(userCopyText(`Task\n\n${file}`)).toBe("Task");
  expect(userCopyText(`${block}\n\nTask\n\n${file}`)).toBe(
    "/skill:fixture Task",
  );
  expect(userCopyText(file)).toBe("");
});
it("copies only final answer Markdown after tools, excluding progress and reasoning", () => {
  const parts = [
    {
      type: "text",
      text: "Hidden progress",
      parentId: "step",
      status: { type: "complete" },
    },
    {
      type: "tool-call",
      toolName: "read",
      toolCallId: "call",
      args: {},
      argsText: "{}",
      result: "Private output",
      parentId: "step",
      status: { type: "complete" },
    },
    {
      type: "text",
      text: "Trailing tool commentary",
      parentId: "step",
      status: { type: "complete" },
    },
    {
      type: "reasoning",
      text: "Hidden reasoning",
      status: { type: "complete" },
    },
    {
      type: "text",
      text: "**Final answer**",
      parentId: "answer",
      status: { type: "complete" },
    },
    {
      type: "text",
      text: "\`code\`",
      parentId: "answer",
      status: { type: "complete" },
    },
  ];
  expect(assistantCopyText(parts as never)).toBe(
    "**Final answer**\n\n\`code\`",
  );
});
it("copies all ordinary answer text and returns empty for tool-only or non-text output", () => {
  expect(
    assistantCopyText([
      { type: "text", text: "One", status: { type: "complete" } },
      { type: "text", text: "Two", status: { type: "complete" } },
    ] as never),
  ).toBe("One\n\nTwo");
  expect(
    assistantCopyText([
      {
        type: "tool-call",
        toolName: "read",
        toolCallId: "call",
        args: {},
        argsText: "{}",
        status: { type: "complete" },
      },
    ] as never),
  ).toBe("");
});

it("keeps XML closing tags in a legacy Skill query", () => {
  const query =
    "Explain this XML example:\n<skill>\nUser example\n</skill>\n\nKeep the example";
  expect(userCopyText(`${block}\n\n${query}`)).toBe(`/skill:fixture ${query}`);
});
it.each([
  "Explain this XML:\n<skill>\nUser example\n</skill>\n\nKeep the example",
  "  Keep original spacing\n\n<skill>Example</skill>  ",
])(
  "copies the saved original Skill input instead of inferring XML boundaries",
  (query) => {
    const source = `/skill:fixture  ${query}`;
    const injected = `<skill name="fixture" location="/private/SKILL.md">\nInstructions with a closing tag example:\n</skill>\n\nMore injected instructions\n</skill>`;
    expect(userCopyText(`${injected}\n\n${query.trim()}`, source)).toBe(source);
    expect(
      userCopyText(
        `${injected}\n\n${query.trim()}\n\n${file}`,
        `${source}\n\n${file}`,
      ),
    ).toBe(source);
  },
);

it("uses the original query suffix to separate Skill instructions containing closing tags", () => {
  const instructions = "An XML example:\n</skill>\n\nMore hidden instructions";
  const query =
    "Explain another XML example:\n<skill>\nUser XML\n</skill>\n\nKeep this";
  const source = `<skill name="fixture" location="/fixture/SKILL.md">\n${instructions}\n</skill>\n\n${query}`;
  expect(splitSkillInvocation(source, `/skill:fixture   ${query}  `)).toEqual({
    name: "fixture",
    instructions,
    query,
  });
});
