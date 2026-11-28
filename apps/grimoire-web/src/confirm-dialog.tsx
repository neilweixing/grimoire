import { useEffect, useRef } from "react";
import { LoaderCircle, Trash2, X, type LucideIcon } from "lucide-react";
import { useI18n } from "./i18n";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onCancel,
  onConfirm,
  icon: Icon = Trash2,
  tone = "danger",
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error?: string;
  icon?: LucideIcon;
  tone?: "danger" | "primary";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open && !ref.current?.open) {
      ref.current?.showModal();
      cancel.current?.focus({ preventScroll: true });
    }
    if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="project-dialog confirm-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      onClick={(event) => {
        if (!pending && event.target === ref.current) onCancel();
      }}
    >
      <div className="project-dialog-content">
        <header>
          <div className="confirm-dialog-icon">
            <Icon size={21} />
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label={t("close")}
            disabled={pending}
            onClick={onCancel}
          >
            <X size={18} />
          </button>
        </header>
        <h2>{title}</h2>
        <p className="confirm-description">{description}</p>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button
            type="button"
            ref={cancel}
            className="project-cancel"
            autoFocus
            disabled={pending}
            onClick={onCancel}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className={tone === "danger" ? "confirm-danger" : "primary-button"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending && <LoaderCircle size={14} className="spin" />}
            {confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
