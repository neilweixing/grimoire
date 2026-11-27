import { createContext, useContext, useEffect, useRef, useState } from "react";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  X,
  LoaderCircle,
  ChevronRight,
} from "lucide-react";
import { api } from "./api";
import { useI18n } from "./i18n";
import { ProjectActions } from "./project-actions";

export type Workspace = { id: string; name: string; path: string };
export type WorkspaceChat = {
  id: string;
  title: string;
  workspaceId: string;
  updatedAt?: string;
};
export const WorkspaceContext = createContext<Workspace>({
  id: "default",
  name: "Grimoire",
  path: "",
});
export const useWorkspace = () => useContext(WorkspaceContext);
export function useSectionCollapsed(section: "projects" | "recent") {
  const key = `grimoire.sidebar.${section}.collapsed`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  });
  return [
    collapsed,
    () =>
      setCollapsed((current) => {
        const next = !current;
        try {
          localStorage.setItem(key, String(next));
        } catch {}
        return next;
      }),
  ] as const;
}
export function SidebarSectionHeader({
  section,
  collapsed,
  onToggle,
  children,
}: {
  section: "projects" | "recent";
  collapsed: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      className={`sidebar-section-heading ${section === "recent" ? "recent-heading" : ""}`}
    >
      <div className="section-heading-title">
        <span>{t(section)}</span>
        <button
          type="button"
          className="icon-button section-toggle"
          aria-expanded={!collapsed}
          aria-controls={`sidebar-${section}-list`}
          aria-label={t(
            section === "projects"
              ? collapsed
                ? "expandProjects"
                : "collapseProjects"
              : collapsed
                ? "expandRecent"
                : "collapseRecent",
          )}
          onClick={onToggle}
        >
          <ChevronRight
            size={14}
            className={collapsed ? "" : "section-expanded"}
          />
        </button>
      </div>
      {children && <div className="section-heading-actions">{children}</div>}
    </div>
  );
}
export function workspaceApi<T>(id: string, path: string, init?: RequestInit) {
  return api<T>(path, {
    ...init,
    headers: { ...init?.headers, "X-Grimoire-Workspace": id },
  });
}

export function WorkspacePicker({
  workspaces,
  onSelect,
  onAdded,
  chats,
  currentChatId,
  onOpenChat,
  onNewChat,
  onRenamed,
  onDeleted,
  openSignal = 0,
}: {
  workspaces: Workspace[];
  onSelect: (id: string) => void;
  onAdded: (workspace: Workspace) => void;
  chats: WorkspaceChat[];
  currentChatId: string;
  onOpenChat: (workspaceId: string, threadId: string) => void;
  onNewChat: (workspaceId: string) => void;
  onRenamed: (workspace: Workspace) => void;
  onDeleted: (workspaceId: string) => void;
  openSignal?: number;
}) {
  const { t } = useI18n();
  const current = useWorkspace();
  const [collapsed, toggleSection] = useSectionCollapsed("projects");
  const [expanded, setExpanded] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("grimoire.expandedProjects") || "[]",
      );
      return [
        ...new Set([
          ...(Array.isArray(saved)
            ? saved.filter((id) => typeof id === "string")
            : []),
          current.id,
        ]),
      ];
    } catch {
      return [current.id];
    }
  });
  const toggle = (id: string) => {
    const next = expanded.includes(id)
      ? expanded.filter((entry) => entry !== id)
      : [...expanded, id];
    setExpanded(next);
    try {
      localStorage.setItem("grimoire.expandedProjects", JSON.stringify(next));
    } catch {}
  };
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [selectingFolder, setSelectingFolder] = useState(false);
  const folderRequest = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    if (!open) folderRequest.current?.abort();
    return () => folderRequest.current?.abort();
  }, [open]);
  const browseFolder = async () => {
    const controller = new AbortController();
    folderRequest.current = controller;
    setSelectingFolder(true);
    setError("");
    try {
      const selected = await api<{ path: string | null }>(
        "/pi/folders/select",
        {
          method: "POST",
          body: JSON.stringify({ initialPath: path }),
          signal: controller.signal,
        },
      );
      if (selected.path && !controller.signal.aborted) setPath(selected.path);
    } catch {
      if (!controller.signal.aborted) setError(t("nativeFolderPickerFailed"));
    } finally {
      if (folderRequest.current === controller) setSelectingFolder(false);
    }
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (openSignal) {
      setOpen(true);
      setName("");
      setPath("");
      setError("");
    }
  }, [openSignal]);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current?.close();
  }, [open]);
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const workspace = await api<Workspace>("/pi/workspaces", {
        method: "POST",
        body: JSON.stringify({
          path,
          ...(name.trim() ? { name: name.trim() } : {}),
        }),
      });
      onAdded(workspace);
      setOpen(false);
    } catch {
      setError(t("workspaceAddFailed"));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <section className="project-section" aria-label={t("projects")}>
        <SidebarSectionHeader
          section="projects"
          collapsed={collapsed}
          onToggle={toggleSection}
        >
          <button
            type="button"
            className="icon-button"
            aria-label={t("addProject")}
            onClick={() => {
              setOpen(true);
              setError("");
              setName("");
              setPath("");
            }}
          >
            <Plus size={15} />
          </button>
        </SidebarSectionHeader>
        <nav
          id="sidebar-projects-list"
          className="project-list"
          hidden={collapsed}
          aria-label={t("selectWorkspace")}
        >
          {workspaces.map((workspace) => (
            <div key={workspace.id} className="project-folder">
              <div
                className={`project-row ${workspace.id === current.id ? "selected" : ""}`}
              >
                <button
                  className={`project-item ${workspace.id === current.id ? "selected" : ""}`}
                  type="button"
                  title={workspace.path}
                  aria-expanded={expanded.includes(workspace.id)}
                  aria-current={
                    workspace.id === current.id ? "page" : undefined
                  }
                  onClick={() => {
                    if (workspace.id === current.id) toggle(workspace.id);
                    else {
                      const next = [...new Set([...expanded, workspace.id])];
                      try {
                        localStorage.setItem(
                          "grimoire.expandedProjects",
                          JSON.stringify(next),
                        );
                      } catch {}
                      onSelect(workspace.id);
                    }
                  }}
                >
                  <ChevronRight
                    size={11}
                    className={`project-chevron ${expanded.includes(workspace.id) ? "project-expanded" : ""}`}
                  />
                  {expanded.includes(workspace.id) ? (
                    <FolderOpen size={15} />
                  ) : (
                    <Folder size={15} />
                  )}
                  <span>{workspace.name}</span>
                </button>
                <ProjectActions
                  workspace={workspace}
                  onNewChat={() => onNewChat(workspace.id)}
                  onRenamed={onRenamed}
                  onDeleted={onDeleted}
                />
              </div>
              {expanded.includes(workspace.id) && (
                <ul
                  className="project-thread-list"
                  aria-label={`${workspace.name} ${t("chats")}`}
                >
                  {chats
                    .filter((chat) => chat.workspaceId === workspace.id)
                    .map((chat) => (
                      <li key={chat.id}>
                        <button
                          type="button"
                          className={`project-thread ${workspace.id === current.id && chat.id === currentChatId ? "selected" : ""}`}
                          title={chat.title || t("newChat")}
                          aria-current={
                            workspace.id === current.id &&
                            chat.id === currentChatId
                              ? "page"
                              : undefined
                          }
                          onClick={() => onOpenChat(workspace.id, chat.id)}
                        >
                          <span>{chat.title || t("newChat")}</span>
                        </button>
                      </li>
                    ))}
                  {!chats.some((chat) => chat.workspaceId === workspace.id) && (
                    <li className="project-empty">{t("noProjectChats")}</li>
                  )}
                </ul>
              )}
            </div>
          ))}
        </nav>
      </section>
      <dialog
        className="project-dialog"
        ref={dialog}
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === dialog.current) setOpen(false);
        }}
      >
        <div className="project-dialog-content">
          <header>
            <div className="project-dialog-icon">
              <FolderPlus size={22} />
            </div>
            <button
              className="icon-button"
              type="button"
              aria-label={t("close")}
              onClick={() => setOpen(false)}
            >
              <X size={18} />
            </button>
          </header>
          <h2>{t("addProject")}</h2>
          <p className="project-dialog-description">
            {t("projectDescription")}
          </p>
          <form onSubmit={(event) => void add(event)}>
            <label>
              {t("projectName")}
              <input
                autoFocus
                value={name}
                placeholder={t("projectNamePlaceholder")}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label>
              {t("folderPath")}
              <div className="folder-path-control">
                <input
                  aria-label={t("folderPath")}
                  value={path}
                  placeholder="/absolute/path/to/project"
                  onChange={(event) => setPath(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="folder-browse-button"
                  disabled={pending || selectingFolder}
                  onClick={() => void browseFolder()}
                >
                  {selectingFolder ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <FolderOpen size={15} />
                  )}
                  {t("browseFolders")}
                </button>
              </div>
            </label>

            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                className="project-cancel"
                onClick={() => setOpen(false)}
              >
                {t("cancel")}
              </button>
              <button
                className="workspace-add-confirm"
                type="submit"
                disabled={pending || selectingFolder || !path.trim()}
              >
                {pending && <LoaderCircle size={13} className="spin" />}
                {t("addProject")}
              </button>
            </footer>
          </form>
        </div>
      </dialog>
    </>
  );
}
