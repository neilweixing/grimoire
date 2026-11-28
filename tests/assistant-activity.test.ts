import { describe, expect, it } from "vitest";
import { splitAssistantActivity } from "../apps/grimoire-web/src/assistant-activity";

type Part = Parameters<typeof splitAssistantActivity>[0][number];
const text = (text: string, parentId?: string): Part => ({
  type: "text",
  text,
  parentId,
  status: { type: "complete" },
});
const reasoning = (text = "Reasoning"): Part => ({
  type: "reasoning",
  text,
  status: { type: "complete" },
});
const tool = (id: string, parentId = id, extra: object = {}): Part => ({
  type: "tool-call",
  toolCallId: id,
  toolName: "read",
  args: {},
  argsText: "{}",
  parentId,
  result: "ok",
  status: { type: "complete" },
  ...extra,
});
const running = { type: "running" } as const;

describe("assistant activity presentation", () => {
  it("collects interleaved tools, reasoning and progress into one trace while preserving the final answer", () => {
    const parts = [
      text("I'll inspect the project", "step-1"),
      reasoning(),
      tool("one", "step-1"),
      text("Checking another file", "step-2"),
      tool("two", "step-2"),
      reasoning("Summarizing"),
      text("The final answer", "step-3"),
    ];
    const view = splitAssistantActivity(parts);
    expect(view.activity).toEqual([0, 1, 2, 3, 4, 5]);
    expect(view.answer).toEqual([6]);
    expect(view.toolCount).toBe(2);
    expect(view.hasAnswer).toBe(true);
  });

  it("retains all text in a tool-calling step inside activity, including trailing text", () => {
    const view = splitAssistantActivity([
      tool("one", "step-1"),
      text("Tool commentary", "step-1"),
      text("Answer", "step-2"),
    ]);
    expect(view.activity).toEqual([0, 1]);
    expect(view.answer).toEqual([2]);
  });

  it("falls back to order when imported messages have no step identities", () => {
    const view = splitAssistantActivity([
      text("Progress"),
      tool("one"),
      text("Answer"),
    ]);
    expect(view.activity).toEqual([0, 1]);
    expect(view.answer).toEqual([2]);
  });

  it("deduplicates the same call identity but keeps distinct calls to the same tool", () => {
    const view = splitAssistantActivity([
      tool("one", "step", { result: undefined, status: { type: "running" } }),
      tool("one", "step"),
      tool("two", "step"),
    ]);
    expect(view.toolCount).toBe(2);
    expect(view.activity).toEqual([1, 2]);
    expect(view.phase).toBe("settled");
  });

  it("does not hide ordinary answers when there are no tools", () => {
    const view = splitAssistantActivity([text("One"), text("Two")]);
    expect(view.activity).toEqual([]);
    expect(view.answer).toEqual([0, 1]);
  });

  it("keeps reasoning separate from answer text with no fake tool count", () => {
    const view = splitAssistantActivity([reasoning(), text("Answer")]);
    expect(view.activity).toEqual([0]);
    expect(view.answer).toEqual([1]);
    expect(view.toolCount).toBe(0);
  });

  it("tracks thinking, tool work, answer streaming and completion", () => {
    expect(splitAssistantActivity([reasoning()], running).phase).toBe(
      "thinking",
    );
    expect(
      splitAssistantActivity(
        [
          tool("one", "step", {
            result: undefined,
            status: { type: "running" },
          }),
        ],
        running,
      ).phase,
    ).toBe("tools");
    expect(
      splitAssistantActivity(
        [tool("one"), text("Streamed answer", "final")],
        running,
      ).phase,
    ).toBe("answering");
    expect(splitAssistantActivity([tool("one"), text("Answer")]).phase).toBe(
      "settled",
    );
  });

  it("keeps approval waiting visible even when another parallel tool is running", () => {
    const view = splitAssistantActivity(
      [
        tool("one", "step", {
          result: undefined,
          status: { type: "requires-action", reason: "interrupt" },
        }),
        tool("two", "step", { result: undefined, status: { type: "running" } }),
      ],
      running,
    );
    expect(view.phase).toBe("waiting");
  });

  it("preserves error and cancellation state even when the trace is collapsed", () => {
    expect(
      splitAssistantActivity([tool("one", "step", { isError: true })])
        .hasErrors,
    ).toBe(true);
    expect(
      splitAssistantActivity([tool("one")], {
        type: "incomplete",
        reason: "cancelled",
      }).hasErrors,
    ).toBe(true);
  });

  it("preserves images, sources and data parts outside execution details", () => {
    const parts = [
      tool("one"),
      {
        type: "image",
        image: "https://example.com/image.png",
        status: { type: "complete" },
      },
      { type: "data", name: "fixture", data: {}, status: { type: "complete" } },
    ] as Part[];
    expect(splitAssistantActivity(parts).answer).toEqual([1, 2]);
  });
});
