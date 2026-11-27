import type { ChatMessage } from "./index.js";

export function summarizeConversation(messages: ChatMessage[]) {
  const assistants = messages.filter((message) => message.role === "assistant");
  const runs = assistants.flatMap((message) =>
    message.metrics ? [message.metrics] : [],
  );
  const last = runs.at(-1);
  const usageComplete =
    assistants.length > 0 &&
    runs.length === assistants.length &&
    runs.every((run) => run.usageComplete);
  const knownRuns = runs.filter((run) => run.totalTokens !== null);
  const inputTokens = knownRuns.reduce(
    (sum, run) =>
      sum +
      (run.inputTokens ?? 0) +
      (run.cacheReadTokens ?? 0) +
      (run.cacheWriteTokens ?? 0),
    0,
  );
  const cacheRead = knownRuns.reduce(
    (sum, run) => sum + (run.cacheReadTokens ?? 0),
    0,
  );
  return {
    rounds: messages.filter((message) => message.role === "user").length,
    steps: runs.reduce((sum, run) => sum + run.modelCalls + run.toolCalls, 0),
    stepsComplete: runs.length === assistants.length,
    totalTokens: knownRuns.length
      ? knownRuns.reduce((sum, run) => sum + run.totalTokens!, 0)
      : null,
    usageComplete,
    cacheHitRate:
      usageComplete && runs.every((run) => run.cacheComplete) && inputTokens > 0
        ? cacheRead / inputTokens
        : null,
    tokensPerSecond:
      last?.usageComplete &&
      last.outputTokens !== null &&
      last.modelDurationMs &&
      last.modelDurationMs > 0
        ? last.outputTokens / (last.modelDurationMs / 1000)
        : null,
    contextInputTokens: last?.contextInputTokens ?? null,
    contextWindow: last?.contextWindow ?? null,
    contextUsedPercent:
      last?.contextInputTokens != null && last.contextWindow
        ? (last.contextInputTokens / last.contextWindow) * 100
        : null,
    model: last?.model ?? null,
  };
}
