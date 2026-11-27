import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Copy, MoreHorizontal, Pencil, SquarePen, X } from "lucide-react";
import { api } from "./api";
import { useI18n } from "./i18n";
import type { Workspace } from "./workspace";
import { ConfirmDialog } from "./confirm-dialog";

export function ProjectActions({
  workspace,
  onNewChat,
  onRenamed,
  onDeleted,
}: {
  workspace: Workspace;
  onNewChat: () => void;
  onRenamed: (workspace: Workspace) => void;
  onDeleted: (workspaceId: string) => void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [menu, setMenu] = useState<{ left: number; top: number }>();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  useEffect(() => {
    if (!menu) return;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !trigger.current?.contains(event.target as Node)
      )
        setMenu(undefined);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(undefined);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menu]);
  useEffect(() => {
    if (renaming && !dialog.current?.open) dialog.current?.showModal();
    if (!renaming && dialog.current?.open) dialog.current?.close();
  }, [renaming]);
  const rename = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const updated = await api<Workspace>(`/pi/workspaces/${workspace.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name: name.trim() }),
      });
      onRenamed(updated);
      setRenaming(false);
    } catch {
      setError(t("projectRenameFailed"));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <div className="project-actions">
        <button
          ref={trigger}
          type="button"
          className="icon-button"
          aria-label={`${t("projectActions")}: ${workspace.name}`}
          title={t("projectActions")}
          aria-haspopup="menu"
          aria-expanded={Boolean(menu)}
          onClick={() => {
            const rect = trigger.current!.getBoundingClientRect();
            setMenu(
              menu
                ? undefined
                : {
                    left: Math.max(
                      8,
                      Math.min(rect.right + 6, window.innerWidth - 198),
                    ),
                    top: Math.max(
                      8,
                      Math.min(rect.top, window.innerHeight - 130),
                    ),
                  },
            );
            setCopied(false);
            setError("");
          }}
        >
          <MoreHorizontal size={15} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={`${t("newChat")}: ${workspace.name}`}
          title={t("newChat")}
          onClick={onNewChat}
        >
          <SquarePen size={14} />
        </button>
      </div>
      {menu &&
        createPortal(
          <div
            ref={panel}
            className="project-more-menu"
            style={menu}
            role="menu"
            aria-label={`${t("projectActions")}: ${workspace.name}`}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setName(workspace.name);
                setError("");
                setMenu(undefined);
                setRenaming(true);
              }}
            >
              <Pencil size={14} />
              {t("renameProject")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                void navigator.clipboard
                  .writeText(workspace.path)
                  .then(() => setCopied(true))
                  .catch(() => setError(t("copyPathFailed")));
              }}
            >
              <Copy size={14} />
              {copied ? t("copied") : t("copyFolderPath")}
            </button>
            <div className="model-menu-divider" />
            <button
              type="button"
              role="menuitem"
              className="danger-menu-item"
              onClick={() => {
                setMenu(undefined);
                setError("");
                setDeleting(true);
              }}
            >
              <X size={14} />
              {t("deleteProject")}
            </button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </div>,
          document.body,
        )}
      <dialog
        className="project-dialog"
        ref={dialog}
        onCancel={() => setRenaming(false)}
        onClose={() => setRenaming(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setRenaming(false);
        }}
      >
        <div className="project-dialog-content">
          <header>
            <h2>{t("renameProject")}</h2>
            <button
              type="button"
              className="icon-button"
              aria-label={t("close")}
              onClick={() => setRenaming(false)}
            >
              <X size={18} />
            </button>
          </header>
          <form onSubmit={(event) => void rename(event)}>
            <label>
              {t("projectName")}
              <input
                autoFocus
                value={name}
                maxLength={80}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="project-folder-path">{workspace.path}</p>
            {error && (
              <p className="error-banner" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                className="project-cancel"
                type="button"
                onClick={() => setRenaming(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="workspace-add-confirm"
                type="submit"
                disabled={pending || !name.trim()}
              >
                {t("save")}
              </button>
            </footer>
          </form>
        </div>
      </dialog>
      <ConfirmDialog
        open={deleting}
        title={`${t("deleteProject")}: ${workspace.name}`}
        description={t("deleteProjectDescription")}
        confirmLabel={t("deleteProject")}
        pending={deletePending}
        error={error}
        onCancel={() => setDeleting(false)}
        onConfirm={() => {
          setDeletePending(true);
          setError("");
          void api(`/pi/workspaces/${workspace.id}`, { method: "DELETE" })
            .then(() => {
              setDeleting(false);
              onDeleted(workspace.id);
            })
            .catch(() => setError(t("deleteProjectFailed")))
            .finally(() => setDeletePending(false));
        }}
      />
    </>
  );
}
