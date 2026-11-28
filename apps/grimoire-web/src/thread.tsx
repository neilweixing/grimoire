import { useEffect, useRef, useState, type PropsWithChildren } from "react";
import {
  ActionBarPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAuiState,
  useAui,
  useSmooth,
  type ToolCallMessagePartProps,
  type ReasoningMessagePartProps,
  type TextMessagePartProps,
} from "@assistant-ui/react";
import { useActionBarCopy } from "@assistant-ui/core/react";
import { writeClipboardText } from "./clipboard";
import {
  userCopyText,
  assistantCopyText,
  splitSkillInvocation,
} from "./message-copy";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
  ArrowDown,
  Check,
  ChevronRight,
  Copy,
  FileText,
  LoaderCircle,
  Square,
  Terminal,
  TriangleAlert,
} from "lucide-react";
import remarkGfm from "remark-gfm";
import { usePiRuntimeExtras } from "@assistant-ui/react-pi";
import {
  splitAttachmentReferences,
  type ProviderSettings,
  type ThinkingLevel,
} from "@grimoire/core";
import { useI18n } from "./i18n";
import { MetricsBar } from "./metrics-bar";
import { ModelPicker } from "./model-picker";
import { ExecutionControls, ApprovalRequests } from "./execution-controls";
import { usePiMetrics } from "./pi-metrics";
import { useWorkspace, workspaceApi } from "./workspace";
import { formatToolOutput, presentToolInput } from "./tool-presentation";
import { ComposerQueue, ComposerSendControls } from "./composer-send-controls";
import { ComposerActions } from "./composer-actions";
import { ComposerFiles } from "./composer-attachments";
import { ComposerSkillsProvider } from "./composer-skills";
import { ComposerSkillInput } from "./composer-skill-input";
import { ConversationNavigation } from "./conversation-navigation";
import {
  splitAssistantActivity,
  type ActivityPhase,
} from "./assistant-activity";

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
    <MarkdownTextPrimitive
      className="markdown"
      remarkPlugins={[remarkGfm]}
      smooth={{ drainMs: 150, minCommitMs: 32 }}
      defer
    />
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
function Reasoning({ text, status }: ReasoningMessagePartProps) {
  const { t } = useI18n();
  const reasoning = useSmooth(
    { type: "reasoning", text, status },
    { drainMs: 150, minCommitMs: 32 },
  );
  return (
    <div className="reasoning-step">
      <span className="reasoning-label">{t("reasoningDetails")}</span>
      <div className="reasoning-text">{reasoning.text}</div>
    </div>
  );
}

function ToolActivity({
  count,
  phase,
  hasErrors,
  hasReasoning,
  children,
}: PropsWithChildren<{
  count: number;
  phase: ActivityPhase;
  hasErrors: boolean;
  hasReasoning: boolean;
}>) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const previousPhase = useRef(phase);
  useEffect(() => {
    if (
      previousPhase.current !== phase &&
      (phase === "answering" || phase === "settled")
    )
      setOpen(false);
    previousPhase.current = phase;
  }, [phase]);
  const running = phase === "thinking" || phase === "tools";
  const label =
    phase === "waiting"
      ? t("activityWaiting")
      : running
        ? count
          ? t("activityRunning")
          : t("thinking")
        : hasErrors
          ? t("activityIncomplete")
          : count
            ? t("activityComplete")
            : hasReasoning
              ? t("reasoningDetails")
              : t("activityDetails");
  return (
    <details
      className={`tool-activity ${hasErrors ? "tool-error" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {phase === "waiting" ? (
          <Square size={13} />
        ) : running ? (
          <LoaderCircle size={14} className="spin" />
        ) : hasErrors ? (
          <TriangleAlert size={14} />
        ) : null}
        <span className="activity-label" role="status">
          {label.replace("{count}", String(count))}
        </span>
        <ChevronRight size={14} className="activity-chevron" />
      </summary>
      {open && <div className="tool-activity-content">{children}</div>}
    </details>
  );
}

const assistantParts = {
  Text: Markdown,
  Reasoning,
  tools: { Fallback: ToolCall },
};

export function ToolCall({
  toolName,
  args,
  result,
  isError,
  status,
}: ToolCallMessagePartProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const pending = status.type === "running";
  const interrupted = isError || status.type === "incomplete";
  const waiting = status.type === "requires-action";
  const presentation = presentToolInput(toolName, args);
  const skillPath =
    toolName === "read" && typeof args?.path === "string"
      ? args.path.match(/(?:^|\/)([^/]+)\/SKILL\.md$/i)
      : null;
  const label = skillPath
    ? `${t("readSkill")} · ${skillPath[1]}`
    : toolName === "inspect_dataset"
      ? t("inspectTool")
      : presentation.summary;
  const stateLabel = pending
    ? t("toolRunning")
    : interrupted
      ? t("toolFailed")
      : waiting
        ? t("toolWaiting")
        : t("toolSuccess");
  const StateIcon = pending
    ? LoaderCircle
    : interrupted
      ? TriangleAlert
      : waiting
        ? Square
        : Check;

  return (
    <details
      className={`tool-call ${interrupted ? "tool-error" : ""}`}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {presentation.shell ? (
          <Terminal size={15} />
        ) : (
          <StateIcon size={15} className={pending ? "spin" : undefined} />
        )}
        <span
          className={presentation.shell ? "tool-command-summary" : undefined}
        >
          {label}
        </span>
        <ChevronRight size={13} className="activity-chevron" />
      </summary>
      {open && (
        <div className="tool-detail">
          <div className="tool-detail-header">
            {presentation.shell ? "Shell" : toolName}
          </div>
          <div className="tool-io">
            <pre className="tool-input">{presentation.input}</pre>
            {result !== undefined && (
              <>
                <pre className="tool-output">
                  {formatToolOutput(result) || t("toolNoOutput")}
                </pre>
              </>
            )}
          </div>
          <div className="tool-detail-status" role="status">
            <StateIcon size={14} className={pending ? "spin" : undefined} />
            <span>{stateLabel}</span>
          </div>
        </div>
      )}
    </details>
  );
}

function MessageTime() {
  const { locale } = useI18n();
  const createdAt = useAuiState((state) => state.message.createdAt);
  if (!createdAt || !Number.isFinite(createdAt.getTime())) return null;
  return (
    <time
      dateTime={createdAt.toISOString()}
      title={new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
      }).format(createdAt)}
    >
      {new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(createdAt)}
    </time>
  );
}

function MessageCopyButton({
  text,
  disabled = false,
  user = false,
}: {
  text?: string;
  disabled?: boolean;
  user?: boolean;
}) {
  const { t } = useI18n();
  const {
    copy,
    isCopied,
    disabled: unavailable,
  } = useActionBarCopy({
    copyToClipboard: (value) => writeClipboardText(text ?? value),
  });
  const label = isCopied
    ? t("copied")
    : user
      ? t("copyUserMessage")
      : t("copy");
  return (
    <button
      type="button"
      className="icon-button"
      disabled={disabled || unavailable}
      aria-label={label}
      title={label}
      data-copied={isCopied ? "true" : undefined}
      onClick={copy}
    >
      {isCopied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function UserMessage() {
  const messageId = useAuiState((state) => state.message.id);
  const messageContent = useAuiState((state) => state.message.content);
  const originalText = useAuiState(
    (state) => state.message.metadata.custom.originalText,
  );
  const copyText = userCopyText(
    messageContent
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n"),
    originalText,
  );
  return (
    <MessagePrimitive.Root
      className="message user-message"
      data-turn-id={messageId}
    >
      <div className="user-content">
        <MessagePrimitive.Parts components={{ Text: UserText }} />
      </div>
      <ActionBarPrimitive.Root className="message-actions user-message-actions">
        <MessageTime />
        <MessageCopyButton user text={copyText} disabled={!copyText} />
      </ActionBarPrimitive.Root>
    </MessagePrimitive.Root>
  );
}

function UserText({ text }: TextMessagePartProps) {
  const { t } = useI18n();
  const originalText = useAuiState(
    (state) => state.message.metadata.custom.originalText,
  );
  const skill = splitSkillInvocation(text, originalText);
  const attachmentView = splitAttachmentReferences(skill?.query ?? text);
  text = attachmentView.text;
  const files =
    attachmentView.files.length > 0 ? (
      <div className="sent-files">
        {attachmentView.files.map((file) => (
          <span className="sent-file" key={file.id}>
            <FileText size={16} />
            {file.name}
          </span>
        ))}
      </div>
    ) : null;
  if (!skill)
    return (
      <>
        {files}
        <span>{text}</span>
      </>
    );
  return (
    <>
      {files}
      <span>{text || `/skill:${skill.name}`}</span>
      <details className="skill-invocation">
        <summary>
          {t("readSkill")} · {skill.name}
        </summary>
        <pre>{skill.instructions}</pre>
      </details>
    </>
  );
}

export function AssistantMessage() {
  const { t } = useI18n();
  const status = useAuiState((state) => state.message.status);
  const parts = useAuiState((state) => state.message.parts);
  const view = splitAssistantActivity(parts, status);
  const copyText = assistantCopyText(parts, status);
  const empty = parts.length === 0;
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
        {view.activity.length > 0 && (
          <ToolActivity
            count={view.toolCount}
            phase={view.phase}
            hasErrors={view.hasErrors}
            hasReasoning={view.hasReasoning}
          >
            {view.activity.map((index) => (
              <MessagePrimitive.PartByIndex
                key={
                  parts[index]?.type === "tool-call"
                    ? parts[index].toolCallId
                    : index
                }
                index={index}
                components={assistantParts}
              />
            ))}
          </ToolActivity>
        )}
        <div
          className="assistant-answer"
          aria-busy={view.phase === "answering"}
        >
          {view.answer.map((index) => (
            <MessagePrimitive.PartByIndex
              key={index}
              index={index}
              components={assistantParts}
            />
          ))}
        </div>
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
        {view.hasAnswer && (
          <ActionBarPrimitive.Root hideWhenRunning className="message-actions">
            <MessageCopyButton text={copyText} disabled={!copyText} />
            {status?.type === "complete" && <MessageTime />}
          </ActionBarPrimitive.Root>
        )}
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
  ensureThread,
}: {
  isDemo: boolean;
  settings: ProviderSettings;
  onSelectModel: (providerId: string, model: string) => Promise<void>;
  modelPending: boolean;
  onConfigureModel: () => void;
  ensureThread: () => Promise<string>;
}) {
  const { t } = useI18n();
  const workspace = useWorkspace();
  const aui = useAui();
  const viewport = useRef<HTMLDivElement>(null);
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
    void workspaceApi<{ levels: ThinkingLevel[] }>(
      workspace.id,
      `/pi/thinking-levels?${new URLSearchParams({ provider: providerId, modelId })}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted)
          setCapabilities({ key: modelKey, levels: value.levels });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [workspace.id, providerId, modelId, settings.providers]);
  const currentSettings = config?.provider
    ? {
        ...settings,
        activeProviderId: config.provider,
        activeModel: config.modelId,
        thinkingLevels:
          capabilities?.key === modelKey
            ? capabilities.levels
            : ([] as ThinkingLevel[]),
      }
    : {
        ...settings,
        thinkingLevels:
          capabilities?.key === modelKey
            ? capabilities.levels
            : ([] as ThinkingLevel[]),
      };
  const currentThinking = config?.thinkingLevel as ThinkingLevel | undefined;

  const needsProvider =
    providerId === "demo" ||
    !settings.providers.some((provider) => provider.id === providerId);
  const unavailable = extras.readiness && extras.readiness.state !== "ready";
  const sendDisabled = modelPending || Boolean(unavailable) || needsProvider;
  return (
    <ThreadPrimitive.Root className="thread">
      <div className="thread-body">
        <ThreadPrimitive.Viewport className="thread-viewport" ref={viewport}>
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
        <ConversationNavigation viewport={viewport} />
      </div>
      <div className="composer-wrap">
        <ApprovalRequests />
        {unavailable && (
          <p className="error-banner" role="alert">
            {t("readinessUnavailable")}
          </p>
        )}
        <ComposerSkillsProvider>
          <ComposerPrimitive.TriggerPopoverRoot>
            <ComposerPrimitive.Root
              className="composer"
              onSubmit={(event) => {
                event.preventDefault();
                if (!sendDisabled && aui.composer.getState().canSend)
                  aui.composer.send({ steer: false });
              }}
            >
              <ComposerQueue
                steering={extras.queue.steering}
                followUp={extras.queue.followUp}
                takeBack={extras.clearQueue}
              />
              <ComposerFiles />
              <ComposerSkillInput
                disabled={needsProvider}
                placeholder={t(needsProvider ? "selectModel" : "placeholder")}
              />
              <div className="composer-bottom">
                <div className="composer-left">
                  <ComposerActions />
                  <ExecutionControls ensureThread={ensureThread} />
                </div>
                <div className="composer-controls">
                  <ModelPicker
                    settings={currentSettings}
                    thinkingLevel={currentThinking ?? "off"}
                    onThinkingLevelChange={async (level) => {
                      await extras.setThinkingLevel(level);
                    }}
                    onSelectModel={async (provider, modelId) => {
                      await extras.setModel({ provider, modelId });
                      await onSelectModel(provider, modelId);
                    }}
                    onConfigureModel={onConfigureModel}
                    pending={modelPending || running}
                  />
                  <ComposerSendControls disabled={sendDisabled} />
                </div>
              </div>
            </ComposerPrimitive.Root>
          </ComposerPrimitive.TriggerPopoverRoot>
        </ComposerSkillsProvider>
        <MetricsBar metrics={metrics} />
      </div>
    </ThreadPrimitive.Root>
  );
}
