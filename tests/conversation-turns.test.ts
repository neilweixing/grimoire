import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "@assistant-ui/react";
import { conversationTurns } from "../apps/grimoire-web/src/conversation-turns";
const message = (
  id: string,
  role: "user" | "assistant",
  content: object[],
): ThreadMessage =>
  ({
    id,
    role,
    content,
    createdAt: new Date(0),
    metadata: { custom: {} },
    status: { type: "complete", reason: "stop" },
  }) as ThreadMessage;
const text = (text: string, parentId?: string) => ({
  type: "text",
  text,
  parentId,
});

describe("conversation navigation turns", () => {
  it("groups each user input with its final answer without leaking tool traces", () => {
    const turns = conversationTurns([
      message("one", "user", [text("Inspect the code")]),
      message("answer-one", "assistant", [
        text("Checking files", "step"),
        { type: "reasoning", text: "Private reasoning" },
        {
          type: "tool-call",
          toolCallId: "call",
          toolName: "read",
          args: { secret: "not previewed" },
          parentId: "step",
        },
        text("The result", "final"),
      ]),
      message("two", "user", [text("Follow up")]),
      message("answer-two", "assistant", [text("Second result")]),
    ]);
    expect(turns).toEqual([
      { id: "one", query: "Inspect the code", answer: "The result" },
      { id: "two", query: "Follow up", answer: "Second result" },
    ]);
  });
  it("does not preview intermediate tool commentary as a final answer", () => {
    expect(
      conversationTurns([
        message("one", "user", [text("Task")]),
        message("answer", "assistant", [
          {
            type: "tool-call",
            toolCallId: "call",
            toolName: "read",
            parentId: "step",
          },
          text("Still checking", "step"),
        ]),
      ])[0]?.answer,
    ).toBe("");
  });
  it("keeps repeated queries separate by identity and tolerates image-only inputs", () => {
    expect(
      conversationTurns([
        message("one", "user", [text("Continue")]),
        message("two", "user", [text("Continue")]),
        message("three", "user", [
          { type: "image", image: "data:image/png;base64,fixture" },
        ]),
      ]).map((turn) => ({ id: turn.id, query: turn.query })),
    ).toEqual([
      { id: "one", query: "Continue" },
      { id: "two", query: "Continue" },
      { id: "three", query: "" },
    ]);
  });
  it("leaves literal text intact and ignores messages before the first user input", () => {
    expect(
      conversationTurns([
        message("orphan", "assistant", [text("No turn")]),
        message("user", "user", [text("<script>literal</script>")]),
      ]),
    ).toEqual([{ id: "user", query: "<script>literal</script>", answer: "" }]);
  });
});
