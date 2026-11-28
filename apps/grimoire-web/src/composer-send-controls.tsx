import { useState } from "react";
import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import {
  ArrowUp,
  ListPlus,
  Square,
  SquarePen,
  LoaderCircle,
} from "lucide-react";
import { useI18n } from "./i18n";
import { attachmentReference, splitAttachmentReferences } from "@grimoire/core";

export function ComposerSendControls({ disabled }: { disabled: boolean }) {
  const { t } = useI18n();
  const aui = useAui();
  const running = useAuiState((state) => state.thread.isRunning);
  const canSend = useAuiState((state) => state.composer.canSend);
  const hasDraft = useAuiState(
    (state) =>
      Boolean(state.composer.text.trim()) ||
      state.composer.attachments.length > 0,
  );
  return (
    <div className="composer-send-actions">
      {running && hasDraft && (
        <button
          type="button"
          className="composer-insert-button"
          disabled={disabled || !canSend}
          title={t("insertMessageHint")}
          onClick={() => aui.composer.send({ steer: true })}
        >
          {t("insertMessage")}
        </button>
      )}
      {(!running || hasDraft) && (
        <button
          type="submit"
          className="send-button"
          disabled={disabled || !canSend}
          aria-label={t(running ? "queueMessage" : "send")}
          title={t(running ? "queueMessageHint" : "send")}
        >
          {running ? <ListPlus size={18} /> : <ArrowUp size={20} />}
        </button>
      )}
      {running && (
        <ComposerPrimitive.Cancel
          className="send-button composer-stop-button"
          aria-label={t("stop")}
          title={t("stop")}
        >
          <Square size={14} fill="currentColor" />
        </ComposerPrimitive.Cancel>
      )}
    </div>
  );
}

export function ComposerQueue({
  steering,
  followUp,
  takeBack,
}: {
  steering: readonly string[];
  followUp: readonly string[];
  takeBack: () => Promise<{ steering: string[]; followUp: string[] }>;
}) {
  const { t } = useI18n();
  const aui = useAui();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const preview = (text: string) => {
    const value = splitAttachmentReferences(text);
    return [value.text, ...value.files.map((file) => file.name)]
      .filter(Boolean)
      .join(" · ");
  };
  const count = steering.length + followUp.length;
  if (!count && !error) return null;
  const edit = async () => {
    if (pending) return;
    setPending(true);
    setError(false);
    try {
      const cleared = await takeBack();
      const restored = splitAttachmentReferences(
        [...cleared.steering, ...cleared.followUp].join("\n\n"),
      );
      for (const file of restored.files) {
        if (
          aui.composer
            .getState()
            .attachments.some((item) => item.id === file.id)
        )
          continue;
        await aui.composer.addAttachment({
          id: file.id,
          type: "document",
          name: file.name,
          contentType: file.contentType,
          content: [{ type: "text", text: attachmentReference(file) }],
        });
      }
      if (restored.text || restored.files.length) {
        const draft = aui.composer.getState().text;
        aui.composer.setText(
          restored.text
            ? draft
              ? `${restored.text}\n\n${draft}`
              : restored.text
            : draft,
        );
        document.querySelector<HTMLTextAreaElement>(".composer-input")?.focus();
      }
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="composer-queue" aria-label={t("queuedMessages")}>
      <div className="composer-queue-heading">
        <span>
          {t("queuedMessages")} <span>{count}</span>
        </span>
        {count > 0 && (
          <button
            type="button"
            className="icon-button"
            disabled={pending}
            aria-label={t(
              count > 1 ? "editQueuedMessages" : "editQueuedMessage",
            )}
            title={t(count > 1 ? "editQueuedMessages" : "editQueuedMessage")}
            onClick={() => void edit()}
          >
            {pending ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <SquarePen size={14} />
            )}
          </button>
        )}
      </div>
      {steering.length > 0 && (
        <ul>
          {steering.map((text, index) => (
            <li key={index}>
              <span className="queue-mode">{t("queuedSteering")}</span>
              <span>{preview(text)}</span>
            </li>
          ))}
        </ul>
      )}
      <ul className="composer-queue-follow-up">
        <ComposerPrimitive.Queue>
          {({ queueItem }) => (
            <li key={queueItem.id}>
              <span>
                {preview(
                  queueItem.parts
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n"),
                )}
              </span>
            </li>
          )}
        </ComposerPrimitive.Queue>
      </ul>
      {error && (
        <p className="error-text" role="alert">
          {t("editQueueFailed")}
        </p>
      )}
    </div>
  );
}
