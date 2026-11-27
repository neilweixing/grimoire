import { describe, expect, it } from "vitest";
import {
  summarizeConversation,
  chatMessageSchema,
  type ChatMessage,
} from "../packages/grimoire-core/src/index";
import { RunMetricsCollector } from "../apps/grimoire-agent/src/metrics";
import { assistantMessage, demoModel } from "../apps/grimoire-agent/src/demo";
import { modelContextWindow } from "../apps/grimoire-agent/src/agent";

function recordCall(
  collector: RunMetricsCollector,
  rawUsage?: Record<string, unknown>,
) {
  collector.observe({ type: "turn_start" });
  const message = assistantMessage(demoModel);
  collector.observe({ type: "message_start", message });
  if (rawUsage)
    collector.observeProviderEvent({ response: { usage: rawUsage } });
  message.usage = {
    ...message.usage,
    input: 40,
    output: 20,
    cacheRead: 60,
    totalTokens: 120,
  };
  message.durationMs = 200;
  collector.observe({ type: "message_end", message });
}

const usage = {
  input_tokens: 100,
  output_tokens: 20,
  input_tokens_details: { cached_tokens: 60 },
};
const messageWithMetrics = (
  metrics: ReturnType<RunMetricsCollector["snapshot"]>,
): ChatMessage => ({
  id: "assistant",
  role: "assistant",
  status: "complete",
  content: [],
  metrics,
});

describe("provider-backed run metrics", () => {
  it("counts calls and tools and calculates cache and context denominators", () => {
    const collector = new RunMetricsCollector(
      "model",
      "provider",
      1000,
      () => 500,
    );
    recordCall(collector, usage);
    collector.observe({
      type: "tool_execution_start",
      toolCallId: "tool",
      toolName: "inspect_dataset",
      args: {},
    });
    const metrics = collector.snapshot();
    expect(metrics).toMatchObject({
      modelCalls: 1,
      toolCalls: 1,
      totalTokens: 120,
      contextInputTokens: 100,
      usageComplete: true,
      cacheComplete: true,
    });
    const stats = summarizeConversation([
      {
        id: "user",
        role: "user",
        status: "complete",
        content: [{ type: "text", text: "Hello" }],
      },
      messageWithMetrics(metrics),
    ]);
    expect(stats).toMatchObject({
      rounds: 1,
      steps: 2,
      tokensPerSecond: 100,
      cacheHitRate: 0.6,
      contextUsedPercent: 10,
    });
  });

  it("does not confuse Pi's zero defaults with reported provider usage", () => {
    const collector = new RunMetricsCollector("model", "provider", null);
    recordCall(collector);
    expect(collector.snapshot()).toMatchObject({
      totalTokens: null,
      usageComplete: false,
      cacheComplete: false,
      contextWindow: null,
      contextInputTokens: null,
    });
    expect(
      summarizeConversation([messageWithMetrics(collector.snapshot())]),
    ).toMatchObject({
      totalTokens: null,
      tokensPerSecond: null,
      cacheHitRate: null,
      contextUsedPercent: null,
    });
  });

  it("does not invent a zero cache-hit rate when cache fields are absent", () => {
    const collector = new RunMetricsCollector("model", "provider", null);
    recordCall(collector, { input_tokens: 100, output_tokens: 20 });
    const stats = summarizeConversation([
      messageWithMetrics(collector.snapshot()),
    ]);
    expect(stats.totalTokens).toBe(120);
    expect(stats.cacheHitRate).toBeNull();
    expect(stats.contextUsedPercent).toBeNull();
  });

  it("marks partial usage and hides misleading throughput after an unreported call", () => {
    const collector = new RunMetricsCollector("model", "provider", 1000);
    recordCall(collector, usage);
    recordCall(collector);
    const stats = summarizeConversation([
      messageWithMetrics(collector.snapshot()),
    ]);
    expect(stats).toMatchObject({
      totalTokens: 120,
      usageComplete: false,
      tokensPerSecond: null,
      cacheHitRate: null,
    });
  });

  it("recognizes explicit cache zero and preserves metrics through stored-message validation", () => {
    const collector = new RunMetricsCollector("model", "provider", 1000);
    collector.observe({ type: "turn_start" });
    collector.observeProviderEvent({
      usage: {
        prompt_tokens: 40,
        completion_tokens: 20,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });
    const message = assistantMessage(demoModel);
    message.usage = {
      ...message.usage,
      input: 40,
      output: 20,
      totalTokens: 60,
    };
    message.durationMs = 200;
    collector.observe({ type: "message_end", message });
    const stored = chatMessageSchema.parse(
      messageWithMetrics(collector.snapshot()),
    );
    expect(summarizeConversation([stored]).cacheHitRate).toBe(0);
  });

  it("handles empty and pre-metrics conversation histories", () => {
    expect(summarizeConversation([])).toMatchObject({
      rounds: 0,
      steps: 0,
      totalTokens: null,
      tokensPerSecond: null,
    });
    expect(
      summarizeConversation([
        { id: "old", role: "assistant", status: "complete", content: [] },
      ]),
    ).toMatchObject({
      stepsComplete: false,
      usageComplete: false,
      totalTokens: null,
    });
  });

  it("uses only a configured or catalog context window, never the fallback model's value", () => {
    const provider = {
      id: "custom",
      name: "Custom",
      kind: "openai-compatible" as const,
      model: "custom-model",
    };
    expect(modelContextWindow(provider)).toBeNull();
    expect(modelContextWindow({ ...provider, contextWindow: 64000 })).toBe(
      64000,
    );
    expect(
      modelContextWindow({ ...provider, model: "gpt-4.1-mini" }),
    ).toBeGreaterThan(0);
    expect(modelContextWindow()).toBeNull();
  });
});
