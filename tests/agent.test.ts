import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readAgentStream,
  type AgentStreamEvent,
  type ChatMessage,
} from "../packages/grimoire-core/src/index";
import { createApp } from "../apps/grimoire-agent/src/app";
import {
  createGrimoireAgent,
  toPiMessages,
} from "../apps/grimoire-agent/src/agent";
import { demoModel } from "../apps/grimoire-agent/src/demo";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-agent-test-"));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});
const user = (text: string): ChatMessage => ({
  id: crypto.randomUUID(),
  role: "user",
  status: "complete",
  content: [{ type: "text", text }],
});

describe("Pi agent integration", () => {
  it("executes the real tool loop and streams an English result over SSE", async () => {
    const app = createApp(new SettingsStore(join(directory, "providers.json")));
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "en" },
      body: JSON.stringify({ messages: [user("Inspect orders")] }),
    });
    expect(response.status).toBe(200);
    const events: AgentStreamEvent[] = [];
    for await (const event of readAgentStream(response.body!))
      events.push(event);
    const start = events.find((event) => event.type === "tool-start");
    expect(start).toMatchObject({
      toolName: "inspect_dataset",
      args: { dataset: "orders" },
    });
    expect(events.find((event) => event.type === "tool-result")).toMatchObject({
      isError: false,
      result: { dataset: "orders", source: "demo" },
    });
    expect(
      events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.delta)
        .join(""),
    ).toContain("1,657");
    expect(events.some((event) => event.type === "error")).toBe(false);
    expect(events.at(-1)?.type).toBe("done");
    const metrics = events
      .filter((event) => event.type === "metrics")
      .at(-1)?.metrics;
    expect(metrics).toMatchObject({
      modelCalls: 2,
      toolCalls: 1,
      totalTokens: null,
      usageComplete: false,
      contextWindow: null,
    });
  });

  it("stops Pi generation when aborted", async () => {
    const agent = createGrimoireAgent();
    let deltas = 0;
    agent.subscribe((event) => {
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent.type === "text_delta"
      ) {
        if (++deltas === 2) agent.abort();
      }
    });
    await agent.prompt("orders");
    expect(deltas).toBe(2);
    expect(agent.state.messages.at(-1)).toMatchObject({
      role: "assistant",
      stopReason: "aborted",
    });
  });

  it("reconstructs tool calls and interrupted results for subsequent turns", () => {
    const messages: ChatMessage[] = [
      user("orders"),
      {
        id: "answer",
        role: "assistant",
        status: "cancelled",
        content: [
          { type: "text", text: "Checking" },
          {
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "inspect_dataset",
            args: { dataset: "orders" },
          },
        ],
      },
    ];
    const transcript = toPiMessages(messages, demoModel);
    expect(transcript.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
    ]);
    expect(transcript[2]).toMatchObject({
      toolCallId: "call-1",
      isError: true,
    });
  });

  it("validates requests before starting an agent", async () => {
    const app = createApp(new SettingsStore(join(directory, "providers.json")));
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects a known unsupported thinking level before contacting a model", async () => {
    const settings = new SettingsStore(join(directory, "providers.json"));
    settings.save(
      {
        name: "Non-reasoning model",
        kind: "openai",
        model: "gpt-4.1-mini",
        apiKey: "fixture-key",
      },
      "non-reasoning",
    );
    settings.activate("non-reasoning");
    const app = createApp(settings);
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept-Language": "en" },
      body: JSON.stringify({
        messages: [user("Hello")],
        thinkingLevel: "high",
      }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(
      "does not support the selected thinking level",
    );
  });

  it("rejects invalid thinking values at the API boundary", async () => {
    const app = createApp(new SettingsStore(join(directory, "providers.json")));
    const response = await app.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [user("Hello")],
        thinkingLevel: "invalid",
      }),
    });
    expect(response.status).toBe(400);
  });
});
