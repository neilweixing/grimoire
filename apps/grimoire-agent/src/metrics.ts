import type { AgentEvent } from "@earendil-works/pi-agent-core";
import type { RunMetrics } from "@grimoire/core";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export class RunMetricsCollector {
  private readonly startedAt: number;
  private modelStartedAt = 0;
  private modelCalls = 0;
  private toolCalls = 0;
  private completedCalls = 0;
  private reportedCalls = 0;
  private cachedCalls = 0;
  private inputReported = false;
  private outputReported = false;
  private cacheReported = false;
  private totalTokens = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private cacheReadTokens = 0;
  private cacheWriteTokens = 0;
  private modelDurationMs = 0;
  private contextInputTokens: number | null = null;

  constructor(
    private readonly model: string,
    private readonly providerId: string,
    private readonly contextWindow: number | null,
    private readonly now = () => performance.now(),
  ) {
    this.startedAt = now();
  }

  observeProviderEvent(event: unknown): void {
    const data = record(event);
    const usage =
      record(data?.usage) ??
      record(record(data?.response)?.usage) ??
      record(record(data?.message)?.usage);
    if (!usage) return;
    this.inputReported ||=
      count(usage.input_tokens) || count(usage.prompt_tokens);
    this.outputReported ||=
      count(usage.output_tokens) || count(usage.completion_tokens);
    this.cacheReported ||=
      count(usage.cache_read_input_tokens) ||
      count(usage.cache_creation_input_tokens) ||
      count(usage.prompt_cache_hit_tokens) ||
      count(usage.cached_tokens) ||
      count(record(usage.input_tokens_details)?.cached_tokens) ||
      count(record(usage.prompt_tokens_details)?.cached_tokens);
  }

  observe(event: AgentEvent): boolean {
    if (event.type === "turn_start") {
      this.modelCalls++;
      this.inputReported = this.outputReported = this.cacheReported = false;
      return true;
    }
    if (event.type === "message_start" && event.message.role === "assistant")
      this.modelStartedAt = this.now();
    if (event.type === "tool_execution_start") {
      this.toolCalls++;
      return true;
    }
    if (event.type !== "message_end" || event.message.role !== "assistant")
      return false;
    this.completedCalls++;
    this.modelDurationMs += Math.max(
      0,
      event.message.durationMs ?? this.now() - this.modelStartedAt,
    );
    const usage = event.message.usage;
    // Pi normalizes missing usage/cache fields to zero. Only explicit provider fields establish availability.
    this.contextInputTokens = this.inputReported
      ? usage.input + usage.cacheRead + usage.cacheWrite
      : null;
    if (this.inputReported && this.outputReported) {
      this.reportedCalls++;
      this.inputTokens += usage.input;
      this.outputTokens += usage.output;
      this.cacheReadTokens += usage.cacheRead;
      this.cacheWriteTokens += usage.cacheWrite;
      this.totalTokens +=
        usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
      if (this.cacheReported) this.cachedCalls++;
    }
    return true;
  }

  snapshot(): RunMetrics {
    return {
      model: this.model,
      providerId: this.providerId,
      modelCalls: this.modelCalls,
      toolCalls: this.toolCalls,
      totalTokens: this.reportedCalls ? this.totalTokens : null,
      inputTokens: this.reportedCalls ? this.inputTokens : null,
      outputTokens: this.reportedCalls ? this.outputTokens : null,
      cacheReadTokens: this.reportedCalls ? this.cacheReadTokens : null,
      cacheWriteTokens: this.reportedCalls ? this.cacheWriteTokens : null,
      usageComplete:
        this.completedCalls > 0 &&
        this.reportedCalls === this.modelCalls &&
        this.completedCalls === this.modelCalls,
      cacheComplete:
        this.completedCalls > 0 && this.cachedCalls === this.modelCalls,
      modelDurationMs: this.completedCalls ? this.modelDurationMs : null,
      durationMs: Math.max(0, this.now() - this.startedAt),
      contextWindow: this.contextWindow,
      contextInputTokens: this.contextInputTokens,
    };
  }
}
