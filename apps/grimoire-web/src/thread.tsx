import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  groupPartByType,
  useAuiState,
  type ToolCallMessagePartProps,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowDown,
  ArrowUp,
  CheckCheck,
  ChevronRight,
  Copy,
  LoaderCircle,
  MessageSquarePlus,
  Plus,
  Settings2,
  Square,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import { usePiRuntimeExtras } from "@assistant-ui/react-pi";
import type { ProviderSettings, ThinkingLevel } from "@grimoire/core";
import { useI18n } from "./i18n";
import { MetricsBar } from "./metrics-bar";
import { ModelPicker } from "./model-picker";
import { ExecutionControls, ApprovalRequests } from "./execution-controls";
import { usePiMetrics } from "./pi-metrics";
import { api } from "./api";
import { useWorkspace } from "./workspace";

export function GrimoireMark({ small = false }: { small?: boolean }) {
  return (
    <span
      className={`grimoire-mark ${small ? "small" : ""}`}
      aria-hidden="true"
    >
      <span className="grimoire-glyph" />
    </span>
  );
}

function Markdown() {
  return (
    <MarkdownTextPrimitive className="markdown" remarkPlugins={[remarkGfm]} />
  );
}
function Welcome() {
  const { t } = useI18n();
  const workspace = useWorkspace();
  return (
    <div className="welcome">
      <div className="welcome-symbol">
        <GrimoireMark />
      </div>
      <h1>{t("welcomeQuestion").replace("{workspace}", workspace.name)}</h1>
    </div>
  );
}
function Reasoning({ text }: ReasoningMessagePartProps) {
  const { t } = useI18n();
  return (
    <details className="reasoning">
      <summary>{t("thinkingDepth")}</summary>
      <div>{text}</div>
    </details>
  );
}

const groupToolActivity = groupPartByType({
  "tool-call": ["group-activity"],
});

function ToolActivity({
  indices,
  running,
  waiting,
  incomplete,
  children,
}: PropsWithChildren<{
  indices: readonly number[];
  running: boolean;
  waiting: boolean;
  incomplete: boolean;
}>) {
  const { t } = useI18n();
  const hasErrors = useAuiState((state) =>
    indices.some((index) => {
      const part = state.message.content[index];
      return part?.type === "tool-call" && part.isError;
    }),
  );
  const hasIncomplete = incomplete || hasErrors;
  const count = indices.length;
  return (
    <details className={`tool-activity ${hasIncomplete ? "tool-error" : ""}`}>
      <summary>
        {running ? (
          <LoaderCircle size={14} className="spin" />
        ) : hasIncomplete ? (
          <TriangleAlert size={14} />
        ) : waiting ? (
          <Square size={12} />
        ) : (
          <CheckCheck size={14} />
        )}
        <span>
          {t(
            running
              ? "activityRunning"
              : waiting
                ? "activityWaiting"
                : hasIncomplete
                  ? "activityIncomplete"
                  : "activityComplete",
          ).replace("{count}", String(count))}
        </span>
        <ChevronRight size={14} className="activity-chevron" />
      </summary>
      <div className="tool-activity-content">{children}</div>
    </details>
  );
}

function ToolCall({
  toolName,
  args,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  const { t } = useI18n();
  const pending = status.type === "running";
  const interrupted = isError || status.type === "incomplete";
  const waiting = status.type === "requires-action";
  const skillPath =
    toolName === "read" && typeof args?.path === "string"
      ? args.path.match(/(?:^|\/)([^/]+)\/SKILL\.md$/i)
      : null;
  return (
    <details className={`tool-call ${interrupted ? "tool-error" : ""}`}>
      <summary>
        {pending ? (
          <LoaderCircle size={15} className="spin" />
        ) : interrupted ? (
          <TriangleAlert size={15} />
        ) : waiting ? (
          <Square size={12} />
        ) : (
          <CheckCheck size={15} />
        )}
        <span>
          {skillPath
            ? `${t("readSkill")} · ${skillPath[1]}`
            : toolName === "inspect_dataset"
              ? t("inspectTool")
              : toolName}
        </span>
        <span className="tool-status">
          {pending
            ? t("toolRunning")
            : interrupted
              ? t("toolFailed")
              : waiting
                ? t("activityWaiting").replace("{count}", "1")
                : t("toolComplete")}
        </span>
        <ChevronRight size={13} className="activity-chevron" />
      </summary>
      <div className="tool-detail">
        <strong>{t("toolInput")}</strong>
        <pre>{JSON.stringify(args, null, 2)}</pre>
        {result !== undefined && (
          <>
            <strong>{t("toolResult")}</strong>
            <pre>
              {typeof result === "string"
                ? result
                : JSON.stringify(result, null, 2)}
            </pre>
          </>
        )}
      </div>
    </details>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="message user-message">
      <div className="user-content">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function UserText({ text }: TextMessagePartProps) {
  const { t } = useI18n();
  const skill = text.match(
    /^<skill name="([^"]+)" location="[^"]+">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]*))?$/,
  );
  if (!skill) return <span>{text}</span>;
  return (
    <>
      <span>{skill[3] || `/skill:${skill[1]}`}</span>
      <details className="skill-invocation">
        <summary>
          {t("readSkill")} · {skill[1]}
        </summary>
        <pre>{skill[2]}</pre>
      </details>
    </>
  );
}

function AssistantMessage() {
  const { t } = useI18n();
  const status = useAuiState((state) => state.message.status);
  const empty = useAuiState((state) => state.message.content.length === 0);
  const dataOnly = useAuiState(
    (state) =>
      state.message.content.length > 0 &&
      state.message.content.every((part) => part.type === "data"),
  );
  if (dataOnly) return null;
  return (
    <MessagePrimitive.Root className="message assistant-message">
      <div className="assistant-content">
        {empty && status?.type === "running" && (
          <span className="thinking">
            <LoaderCircle className="spin" size={14} />
            {t("thinking")}
          </span>
        )}
        <MessagePrimitive.GroupedParts
          groupBy={groupToolActivity}
          indicator="never"
        >
          {({ part, children }) => {
            switch (part.type) {
              case "group-activity":
                return (
                  <ToolActivity
                    indices={part.indices}
                    running={part.counts.running > 0}
                    waiting={part.counts.requiresAction > 0}
                    incomplete={part.counts.incomplete > 0}
                  >
                    {children}
                  </ToolActivity>
                );
              case "text":
                return <Markdown />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return <ToolCall {...part} />;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        {status?.type === "incomplete" && status.reason === "error" && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={15} />
            {typeof status.error === "string"
              ? status.error
              : t("requestFailed")}
          </div>
        )}
        {status?.type === "incomplete" && status.reason === "cancelled" && (
          <p className="stopped">
            <Square size={11} />
            {t("stopped")}
          </p>
        )}
        <ActionBarPrimitive.Root hideWhenRunning className="message-actions">
          <ActionBarPrimitive.Copy
            className="icon-button"
            aria-label={t("copy")}
          >
            <Copy size={14} />
          </ActionBarPrimitive.Copy>
        </ActionBarPrimitive.Root>
      </div>
    </MessagePrimitive.Root>
  );
}

export function ChatThread({
  isDemo,
  settings,
  onSelectModel,
  modelPending,
  onConfigureModel,
  onNewChat,
  ensureThread,
}: {
  isDemo: boolean;
  settings: ProviderSettings;
  onSelectModel: (providerId: string, model: string) => Promise<void>;
  modelPending: boolean;
  onConfigureModel: () => void;
  onNewChat: () => void;
  ensureThread: () => Promise<string>;
}) {
  const { t } = useI18n();
  const actions = useRef<HTMLDetailsElement>(null);
  const composerInput = useRef<HTMLTextAreaElement>(null);
  const running = useAuiState((state) => state.thread.isRunning);
  const extras = usePiRuntimeExtras();
  const metrics = usePiMetrics();
  const config = extras.metadata.config;
  const providerId = config?.provider ?? settings.activeProviderId;
  const modelId =
    config?.modelId ??
    settings.activeModel ??
    settings.providers.find((provider) => provider.id === providerId)?.model ??
    "grimoire-demo";
  const [capabilities, setCapabilities] = useState<{
    key: string;
    levels: ThinkingLevel[];
  }>();
  const modelKey = `${providerId}/${modelId}`;
  useEffect(() => {
    const controller = new AbortController();
    void api<{ levels: ThinkingLevel[] }>(
      `/pi/thinking-levels?${new URLSearchParams({ provider: providerId, modelId })}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setCapabilities({ key: modelKey, levels: value.levels });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [providerId, modelId]);
  const currentSettings = config?.provider
    ? {
        ...settings,
        activeProviderId: config.provider,
        activeModel: config.modelId,
        thinkingLevels:
          capabilities?.key === modelKey
            ? capabilities.levels
            : (["off"] as ThinkingLevel[]),
      }
    : {
        ...settings,
        thinkingLevels:
          capabilities?.key === modelKey
            ? capabilities.levels
            : (["off"] as ThinkingLevel[]),
      };
  const currentThinking = config?.thinkingLevel as ThinkingLevel | undefined;

  const needsProvider =
    providerId === "demo" ||
    !settings.providers.some((provider) => provider.id === providerId);
  const unavailable = extras.readiness && extras.readiness.state !== "ready";
  return (
    <ThreadPrimitive.Root className="thread">
      <ThreadPrimitive.Viewport className="thread-viewport">
        <ThreadPrimitive.Empty>
          <Welcome />
        </ThreadPrimitive.Empty>
        <div className="messages">
          <ThreadPrimitive.Messages
            components={{ UserMessage, AssistantMessage }}
          />
        </div>
        <ThreadPrimitive.ViewportFooter className="viewport-footer">
          <ThreadPrimitive.ScrollToBottom
            className="scroll-bottom icon-button"
            aria-label={t("scrollBottom")}
          >
            <ArrowDown size={17} />
          </ThreadPrimitive.ScrollToBottom>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
      <div className="composer-wrap">
        <ApprovalRequests />
        {unavailable && (
          <p className="error-banner" role="alert">
            {t("readinessUnavailable")}
          </p>
        )}
        {extras.queue.followUp.length + extras.queue.steering.length > 0 && (
          <p className="demo-notice">
            {t("queuedMessages")}:{" "}
            {extras.queue.followUp.length + extras.queue.steering.length}
          </p>
        )}

        <ComposerPrimitive.Root className="composer">
          <ComposerPrimitive.Input
            ref={composerInput}
            autoFocus
            disabled={needsProvider}
            className="composer-input"
            placeholder={t(needsProvider ? "selectModel" : "placeholder")}
            aria-label={t("placeholder")}
            minRows={1}
            maxRows={7}
            onHeightChange={(height) => {
              if (composerInput.current)
                composerInput.current.style.overflowY =
                  height >= 168 ? "auto" : "hidden";
            }}
          />
          <div className="composer-bottom">
            <div className="composer-left">
              <details className="composer-more" ref={actions}>
                <summary aria-label={t("moreActions")} title={t("moreActions")}>
                  <Plus size={18} />
                </summary>
                <div className="composer-action-menu">
                  <button
                    type="button"
                    onClick={() => {
                      actions.current?.removeAttribute("open");
                      onNewChat();
                    }}
                  >
                    <MessageSquarePlus size={15} />
                    {t("newChat")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      actions.current?.removeAttribute("open");
                      onConfigureModel();
                    }}
                  >
                    <Settings2 size={15} />
                    {t("providersTitle")}
                  </button>
                </div>
              </details>
              <ExecutionControls ensureThread={ensureThread} />
            </div>
            <div className="composer-controls">
              <ModelPicker
                settings={currentSettings}
                thinkingLevel={currentThinking ?? "off"}
                onThinkingLevelChange={async (level) => {
                  if (level === "max")
                    throw new Error(t("thinkingLevelUnavailable"));
                  await extras.setThinkingLevel(level);
                }}
                onSelectModel={async (provider, modelId) => {
                  await extras.setModel({ provider, modelId });
                  await onSelectModel(provider, modelId);
                }}
                onConfigureModel={onConfigureModel}
                pending={modelPending || running}
              />
              {running ? (
                <ComposerPrimitive.Cancel
                  className="send-button"
                  aria-label={t("stop")}
                >
                  <Square size={15} fill="currentColor" />
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send
                  disabled={
                    modelPending || Boolean(unavailable) || needsProvider
                  }
                  className="send-button"
                  aria-label={t("send")}
                >
                  <ArrowUp size={20} />
                </ComposerPrimitive.Send>
              )}
            </div>
          </div>
        </ComposerPrimitive.Root>
        <MetricsBar metrics={metrics} />
      </div>
    </ThreadPrimitive.Root>
  );
}
