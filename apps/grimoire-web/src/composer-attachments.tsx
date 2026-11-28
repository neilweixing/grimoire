import {
  AttachmentPrimitive,
  ComposerPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { FileText, LoaderCircle, X, TriangleAlert } from "lucide-react";
import { useI18n } from "./i18n";

function ComposerFile() {
  const { t } = useI18n();
  const attachment = useAuiState((state) => state.attachment);
  const error = attachment.status.type === "incomplete";
  return (
    <AttachmentPrimitive.Root
      className={`composer-file ${error ? "attachment-error" : ""}`}
    >
      {attachment.status.type === "running" ? (
        <LoaderCircle size={18} className="spin" />
      ) : error ? (
        <TriangleAlert size={18} />
      ) : (
        <FileText size={18} />
      )}
      <div>
        <AttachmentPrimitive.Name />
        {error && (
          <span className="attachment-error-text" role="alert">
            {(attachment.status.type === "incomplete"
              ? attachment.status.message
              : "") || t("attachmentUploadFailed")}
          </span>
        )}
      </div>
      <AttachmentPrimitive.Remove
        className="icon-button"
        aria-label={`${t("removeAttachment")}: ${attachment.name}`}
      >
        <X size={13} />
      </AttachmentPrimitive.Remove>
    </AttachmentPrimitive.Root>
  );
}
export function ComposerFiles() {
  return (
    <div className="composer-files">
      <ComposerPrimitive.Attachments
        components={{ Attachment: ComposerFile }}
      />
    </div>
  );
}
