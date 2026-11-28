import {
  thinkingLevelSchema,
  type ModelProbeResult,
  type ThinkingLevel,
} from "@grimoire/core";
import {
  normalizeContext,
  getSupportedThinkingLevels,
  type AssistantMessage,
} from "@earendil-works/pi-ai";
import { providerRuntime } from "./agent.js";
import { knownModel } from "./provider-catalog.js";
import type { StoredProvider } from "./settings.js";

// Inspect only effort fields, never return prompts, headers, or raw provider errors.
function effortParameter(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return;
  const data = payload as {
    reasoning_effort?: unknown;
    reasoning?: { effort?: unknown };
    output_config?: { effort?: unknown };
    generationConfig?: { thinkingConfig?: { thinkingLevel?: unknown } };
  };
  const effort =
    data.reasoning_effort ??
    data.reasoning?.effort ??
    data.output_config?.effort ??
    data.generationConfig?.thinkingConfig?.thinkingLevel;
  return typeof effort === "string" ? effort.slice(0, 80) : undefined;
}

export async function probeModel(
  provider: StoredProvider,
  signal?: AbortSignal,
): Promise<ModelProbeResult> {
  const known = knownModel(provider);
  const levels = known
    ? getSupportedThinkingLevels(known)
    : thinkingLevelSchema.options;
  const result: ModelProbeResult = { model: provider.model, results: [] };
  const deadline = AbortSignal.timeout(60_000);
  let stop = false;
  for (const level of levels) {
    signal?.throwIfAborted();
    if (stop || deadline.aborted) {
      result.results.push({
        level,
        status: "inconclusive",
        reason: "notRun",
        outputTokens: null,
        reasoningTokens: null,
        durationMs: 0,
      });
      continue;
    }
    const started = performance.now();
    const timeout = AbortSignal.timeout(15_000);
    const requestSignal = AbortSignal.any([
      ...(signal ? [signal] : []),
      deadline,
      timeout,
    ]);
    let parameter: string | undefined;
    let httpStatus: number | undefined;
    let message: AssistantMessage | undefined;
    let errorText = "";
    try {
      const { model, streamFn } = providerRuntime(
        {
          ...provider,
          modelOverrides: {
            ...provider.modelOverrides,
            [provider.model]: {
              ...provider.modelOverrides?.[provider.model],
              thinkingLevels: levels as ThinkingLevel[],
            },
          },
        },
        "en",
        level,
      );
      const stream = await streamFn(
        { ...model, maxTokens: Math.min(model.maxTokens, 2048) },
        normalizeContext({
          messages: [
            {
              role: "user",
              content: "What is 17 + 28? Reply with the number only.",
              timestamp: Date.now(),
            },
          ],
        }),
        {
          signal: requestSignal,
          reasoning: level === "off" ? undefined : level,
          maxTokens: 1024,
          thinkingBudgets: {
            minimal: 1024,
            low: 1024,
            medium: 1024,
            high: 1024,
          },
          timeoutMs: 15_000,
          maxRetries: 0,
          transport: "sse",
          disableContinuation: true,
          onPayload: (payload) => {
            parameter = effortParameter(payload);
          },
          onResponse: (response) => {
            httpStatus = response.status;
          },
        },
      );
      message = await stream.result();
      errorText = message.errorMessage ?? "";
    } catch (error) {
      errorText = error instanceof Error ? error.message : "";
    }
    signal?.throwIfAborted();
    httpStatus ??= Number(errorText.match(/\b([45]\d{2})\b/)?.[1]) || undefined;
    const failed =
      !message ||
      message.stopReason === "error" ||
      message.stopReason === "aborted" ||
      Boolean(httpStatus && httpStatus >= 400);
    let reason: ModelProbeResult["results"][number]["reason"] = "accepted";
    if (timeout.aborted || deadline.aborted) reason = "timeout";
    else if (httpStatus === 401 || httpStatus === 403) {
      reason = "authentication";
      stop = true;
    } else if (httpStatus === 429) {
      reason = "rateLimited";
      stop = true;
    } else if (failed)
      reason =
        Boolean(parameter) &&
        (httpStatus === 400 || httpStatus === 422) &&
        /reasoning|thinking|effort/i.test(errorText)
          ? "invalidParameter"
          : "requestFailed";
    else if (level !== "off" && !parameter) reason = "noEffortParameter";
    result.results.push({
      level,
      status:
        reason === "accepted"
          ? "accepted"
          : reason === "invalidParameter"
            ? "rejected"
            : "inconclusive",
      reason,
      ...(parameter ? { parameter } : {}),
      ...(httpStatus ? { httpStatus } : {}),
      outputTokens: message?.usage.output || null,
      reasoningTokens: message?.usage.reasoning ?? null,
      durationMs: Math.round(performance.now() - started),
    });
  }
  return result;
}
