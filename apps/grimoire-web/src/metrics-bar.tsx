import { CircleGauge, Database, Gauge } from "lucide-react";
import { summarizeConversation } from "@grimoire/core";
import { useI18n } from "./i18n";
import { Tooltip } from "./tooltip";

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
  const stepLabel = `${metrics.rounds} ${t("rounds")} ${steps} ${t("steps")}`;
  const speedLabel = `${metrics.tokensPerSecond === null ? "—" : number.format(metrics.tokensPerSecond)} tok/s`;
  const tokenLabel = `${total} tok`;
  const cacheLabel = `${t("cacheHit")} ${metrics.cacheHitRate === null ? "—" : `${number.format(metrics.cacheHitRate * 100)}%`}`;
  const contextLabel = `${t("context")} ${metrics.contextUsedPercent === null ? "—" : `${number.format(metrics.contextUsedPercent)}%`}`;
  return (
    <div className="composer-metrics" aria-label={t("runMetrics")}>
      <Tooltip content={`${stepLabel} · ${speedLabel}`}>
        <span
          className="metric-group"
          tabIndex={0}
          role="group"
          aria-label={`${stepLabel} · ${speedLabel}`}
        >
          <Gauge size={14} aria-hidden="true" />
          <span className="metric-details">
            {stepLabel}
            <span className="metric-separator"> · </span>
            {speedLabel}
          </span>
        </span>
      </Tooltip>
      <Tooltip content={`${tokenLabel} · ${cacheLabel}`}>
        <span
          className="metric-group"
          tabIndex={0}
          role="group"
          aria-label={`${tokenLabel} · ${cacheLabel}`}
        >
          <Database size={14} aria-hidden="true" />
          <span className="metric-details">
            {tokenLabel}
            <span className="metric-separator"> · </span>
            {cacheLabel}
          </span>
        </span>
      </Tooltip>
      <Tooltip content={contextLabel}>
        <span
          className="metric-group"
          tabIndex={0}
          role="group"
          aria-label={contextLabel}
        >
          <CircleGauge size={14} aria-hidden="true" />
          <span className="metric-details">{contextLabel}</span>
        </span>
      </Tooltip>
    </div>
  );
}
