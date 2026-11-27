import { CircleGauge, Database, Gauge } from "lucide-react";
import { summarizeConversation } from "@grimoire/core";
import { useI18n } from "./i18n";

export type ConversationMetrics = ReturnType<typeof summarizeConversation>;
const tokens = (value: number) =>
  value >= 1_000_000
    ? `${(value / 1_000_000).toFixed(1)}M`
    : value >= 1_000
      ? `${(value / 1_000).toFixed(1)}k`
      : `${Math.round(value)}`;

export function MetricsBar({ metrics }: { metrics: ConversationMetrics }) {
  const { t, locale } = useI18n();
  const number = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    maximumFractionDigits: 1,
  });
  const steps = metrics.stepsComplete
    ? `${metrics.steps}`
    : metrics.steps
      ? `≥${metrics.steps}`
      : "—";
  const total =
    metrics.totalTokens === null
      ? "—"
      : `${metrics.usageComplete ? "" : "≥"}${tokens(metrics.totalTokens)}`;
  const contextTitle =
    metrics.contextWindow !== null
      ? `${t("metricsContextHint")} ${metrics.contextInputTokens === null ? "—" : number.format(metrics.contextInputTokens)} / ${number.format(metrics.contextWindow)} tok`
      : `${t("lastInput")}: ${metrics.contextInputTokens === null ? "—" : number.format(metrics.contextInputTokens)} tok. ${t("contextUnknown")}`;
  return (
    <div className="composer-metrics" aria-label={t("runMetrics")}>
      <span className="metric-group">
        <Gauge size={13} aria-hidden="true" />
        <span title={t("metricsStepsHint")}>
          {metrics.rounds} {t("rounds")} {steps} {t("steps")}
        </span>
        <span className="metric-separator">·</span>
        <span title={t("metricsSpeedHint")}>
          {metrics.tokensPerSecond === null
            ? "—"
            : number.format(metrics.tokensPerSecond)}{" "}
          tok/s
        </span>
      </span>
      <span className="metric-group">
        <Database size={12} aria-hidden="true" />
        <span title={t("metricsTokensHint")}>{total} tok</span>
        <span className="metric-separator">·</span>
        <span title={t("metricsCacheHint")}>
          {t("cacheHit")}{" "}
          {metrics.cacheHitRate === null
            ? "—"
            : `${number.format(metrics.cacheHitRate * 100)}%`}
        </span>
      </span>
      <span
        className="metric-group"
        title={`${metrics.model ? `${metrics.model} · ` : ""}${contextTitle}`}
      >
        <CircleGauge size={13} aria-hidden="true" />
        <span>
          {t("context")}{" "}
          {metrics.contextUsedPercent === null
            ? "—"
            : `${number.format(metrics.contextUsedPercent)}%`}
        </span>
      </span>
    </div>
  );
}
