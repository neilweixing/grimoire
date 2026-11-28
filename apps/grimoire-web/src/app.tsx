import { useEffect, useState } from "react";
import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
  Folder,
  Puzzle,
  PanelLeftClose,
  PanelLeftOpen,
  SquarePen,
  Settings2,
  Trash2,
} from "lucide-react";
import { DEMO_PROVIDER_ID, type ProviderSettings } from "@grimoire/core";
import { api } from "./api";
import { useI18n } from "./i18n";
import { Settings } from "./settings";
import { SettingsFooter, UpdateButton } from "./desktop-updates";
import { Plugins } from "./plugins";
import { ChatThread, GrimoireMark } from "./thread";
import { useGrimoireChat } from "./use-chat";
import { ConfirmDialog } from "./confirm-dialog";
import { BrowserDrawer, BrowserTopbar } from "./browser-drawer";
import {
  WorkspaceContext,
  useSectionCollapsed,
  SidebarSectionHeader,
  WorkspacePicker,
  workspaceApi,
  type Workspace,
  type WorkspaceChat,
} from "./workspace";

export function App() {
  const { t } = useI18n();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedId, setSelectedId] = useState(() => {
    try {
      return localStorage.getItem("grimoire.workspace") || "default";
    } catch {
      return "default";
    }
  });
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [target, setTarget] = useState<{
    workspaceId: string;
    threadId?: string;
  }>();
  const load = async () => {
    try {
      setWorkspaces(await api<Workspace[]>("/pi/workspaces"));
      setLoaded(true);
      setError("");
    } catch (error) {
      console.error("Workspace loading failed:", error);
      setError(t("workspaceLoadFailed"));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const select = (id: string) => {
    setTarget(undefined);
    setSelectedId(id);
    try {
      localStorage.setItem("grimoire.workspace", id);
    } catch {}
  };
  const workspace =
    workspaces.find((entry) => entry.id === selectedId) ?? workspaces[0];
  const added = (entry: Workspace) => {
    setWorkspaces((previous) =>
      previous.some((workspace) => workspace.id === entry.id)
        ? previous
        : [...previous, entry],
    );
    select(entry.id);
  };
  const renamed = (entry: Workspace) =>
    setWorkspaces((previous) =>
      previous.map((workspace) =>
        workspace.id === entry.id ? entry : workspace,
      ),
    );
  const deleted = (id: string) => {
    setWorkspaces((previous) =>
      previous.filter((workspace) => workspace.id !== id),
    );
    setTarget(undefined);
    try {
      localStorage.removeItem(`grimoire.pi.activeThread.${id}`);
      if (id === selectedId) localStorage.removeItem("grimoire.workspace");
    } catch {}
    if (id === selectedId)
      setSelectedId(
        workspaces.find((workspace) => workspace.id !== id)?.id ?? "",
      );
  };
  if (!workspace && loaded) return <EmptyProjects onAdded={added} />;
  if (!workspace)
    return (
      <div className="workspace-loading" role="status">
        {error || t("connecting")}
        {error && (
          <button className="text-button" onClick={() => void load()}>
            {t("retryConnection")}
          </button>
        )}
      </div>
    );
  return (
    <WorkspaceContext.Provider value={workspace}>
      <WorkspaceApp
        key={workspace.id}
        workspace={workspace}
        workspaces={workspaces}
        onSelect={select}
        target={target}
        onNewChat={(id) => {
          select(id);
          setTarget({ workspaceId: id });
        }}
        onRenamed={renamed}
        onDeleted={deleted}
        onOpenChat={(workspaceId, threadId) => {
          try {
            localStorage.setItem(
              `grimoire.pi.activeThread.${workspaceId}`,
              threadId,
            );
          } catch {}
          select(workspaceId);
          setTarget({ workspaceId, threadId });
        }}
        onAdded={added}
      />
    </WorkspaceContext.Provider>
  );
}

function WorkspaceApp({
  workspace,
  workspaces,
  onSelect,
  onAdded,
  target,
  onOpenChat,
  onNewChat,
  onRenamed,
  onDeleted,
}: {
  workspace: Workspace;
  workspaces: Workspace[];
  onSelect: (id: string) => void;
  onAdded: (workspace: Workspace) => void;
  target?: { workspaceId: string; threadId?: string };
  onOpenChat: (workspaceId: string, threadId: string) => void;
  onNewChat: (workspaceId: string) => void;
  onRenamed: (workspace: Workspace) => void;
  onDeleted: (workspaceId: string) => void;
}) {
  const { t } = useI18n();
  const chat = useGrimoireChat(workspace.id, workspace.path);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [recentCollapsed, toggleRecent] = useSectionCollapsed("recent");
  useEffect(() => {
    if (target?.workspaceId === workspace.id) {
      setPluginsOpen(false);
      if (target.threadId) chat.selectChat(target.threadId);
      else chat.createChat();
    }
  }, [target, workspace.id]);
  const [catalog, setCatalog] = useState<WorkspaceChat[]>([]);
  const [catalogError, setCatalogError] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const chatVersion = JSON.stringify(
    chat.conversations.map((conversation) => [
      conversation.remoteId,
      conversation.title,
    ]),
  );
  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled(
      workspaces.map(async (entry) => {
        const threads = await workspaceApi<
          Array<{ id: string; title?: string; updatedAt?: string }>
        >(entry.id, "/pi/threads", { signal: controller.signal });
        return threads.map((thread) => ({
          id: thread.id,
          title: thread.title || "",
          updatedAt: thread.updatedAt,
          workspaceId: entry.id,
        }));
      }),
    ).then((results) => {
      if (controller.signal.aborted) return;
      setCatalogError(results.some((result) => result.status === "rejected"));
      setCatalog((previous) => {
        const next = [...previous];
        for (const [index, result] of results.entries())
          if (result.status === "fulfilled") {
            for (let i = next.length - 1; i >= 0; i--)
              if (next[i]!.workspaceId === workspaces[index]!.id)
                next.splice(i, 1);
            next.push(...result.value);
          }
        return next;
      });
    });
    return () => controller.abort();
  }, [workspaces, workspace.id, chatVersion, catalogRevision]);
  const allChats: WorkspaceChat[] = [
    ...catalog.filter(
      (conversation) =>
        conversation.workspaceId !== workspace.id &&
        workspaces.some((entry) => entry.id === conversation.workspaceId),
    ),
    ...chat.conversations.map((conversation) => ({
      id: conversation.remoteId,
      title: conversation.title,
      workspaceId: workspace.id,
      updatedAt:
        catalog.find((entry) => entry.id === conversation.remoteId)
          ?.updatedAt ?? new Date().toISOString(),
    })),
  ];
  const recent = [...allChats]
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
    .slice(0, 30);
  const [settings, setSettings] = useState<ProviderSettings>({
    providers: [],
    activeProviderId: DEMO_PROVIDER_ID,
  });
  const [modelPending, setModelPending] = useState(false);
  const applySettings = (next: ProviderSettings) => {
    setSettings(next);
  };
  const selectModel = async (providerId: string, model: string) => {
    setModelPending(true);
    try {
      applySettings(
        await api<ProviderSettings>("/providers/selection", {
          method: "PUT",
          body: JSON.stringify({ providerId, model }),
        }),
      );
    } finally {
      setModelPending(false);
    }
  };
  const [settingsSection, setSettingsSection] = useState<
    "general" | "providers" | null
  >(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [browserOpen, setBrowserOpen] = useState(false);
  useEffect(
    () => window.grimoireDesktop?.browser.onOpen(() => setBrowserOpen(true)),
    [],
  );
  useEffect(() => {
    void window.grimoireDesktop?.browser
      .command({
        action: "bind",
        context: {
          workspace: workspace.path,
          threadId: chat.currentRemoteId || null,
        },
      })
      .catch(() => {});
  }, [workspace.path, chat.currentRemoteId]);
  const [deletingChat, setDeletingChat] = useState<WorkspaceChat>();
  const requestDeleteChat = (conversation: WorkspaceChat) => {
    setDeleteError("");
    setDeletingChat(conversation);
  };
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [connection, setConnection] = useState<
    "connecting" | "ready" | "error"
  >("connecting");
  const loadSettings = async () => {
    setConnection("connecting");
    try {
      applySettings(await api<ProviderSettings>("/providers"));
      setConnection("ready");
    } catch {
      setConnection("error");
    }
  };
  useEffect(() => {
    void loadSettings();
  }, []);
  const isDemo = settings.activeProviderId === DEMO_PROVIDER_ID;
  const createChat = () => {
    setPluginsOpen(false);
    chat.createChat();
    if (window.innerWidth < 760) setSidebarOpen(false);
  };

  return (
    <AssistantRuntimeProvider runtime={chat.runtime}>
      <div
        className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
      >
        {!sidebarOpen && (
          <SidebarRail
            onExpand={() => setSidebarOpen(true)}
            onNewChat={createChat}
            onSettings={() => setSettingsSection("general")}
            onPlugins={() => setPluginsOpen(true)}
          />
        )}
        {sidebarOpen && (
          <button
            className="sidebar-overlay"
            aria-label={t("chat")}
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside className="sidebar">
          <div className="brand">
            <GrimoireMark small />
            <strong>Grimoire</strong>
            <button
              className="icon-button collapse-sidebar"
              aria-label={t("collapseSidebar")}
              title={t("collapseSidebar")}
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose size={17} />
            </button>
          </div>
          <button className="new-chat-button" onClick={createChat}>
            <SquarePen size={16} />
            {t("newChat")}
          </button>
          <button
            className={`new-chat-button plugins-button ${pluginsOpen ? "selected" : ""}`}
            onClick={() => setPluginsOpen(true)}
          >
            <Puzzle size={16} />
            {t("plugins")}
          </button>
          <WorkspacePicker
            workspaces={workspaces}
            onSelect={onSelect}
            onAdded={onAdded}
            chats={allChats}
            currentChatId={chat.currentRemoteId}
            onOpenChat={onOpenChat}
            onDeleteChat={requestDeleteChat}
            onNewChat={onNewChat}
            onRenamed={onRenamed}
            onDeleted={onDeleted}
          />
          <SidebarSectionHeader
            section="recent"
            collapsed={recentCollapsed}
            onToggle={toggleRecent}
          />
          {catalogError && (
            <p className="sidebar-load-error" role="status">
              {t("projectChatsLoadFailed")}
            </p>
          )}
          <nav
            id="sidebar-recent-list"
            className="chat-list"
            hidden={recentCollapsed}
            aria-label={t("chats")}
          >
            {recent.map((conversation) => (
              <div
                key={conversation.id}
                className={`chat-item ${conversation.workspaceId === workspace.id && conversation.id === chat.currentRemoteId ? "selected" : ""}`}
              >
                <button
                  className="chat-select"
                  onClick={() => {
                    onOpenChat(conversation.workspaceId, conversation.id);
                    if (window.innerWidth < 760) setSidebarOpen(false);
                  }}
                >
                  <span>{conversation.title || t("newChat")}</span>
                </button>
                <button
                  type="button"
                  className="chat-delete icon-button"
                  aria-label={`${t("deleteChat")}: ${conversation.title || t("newChat")}`}
                  title={t("deleteChat")}
                  onClick={() => requestDeleteChat(conversation)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </nav>
          <SettingsFooter onSettings={() => setSettingsSection("general")} />
        </aside>
        <main className="main-panel">
          <BrowserTopbar
            open={browserOpen}
            onToggle={() => setBrowserOpen((current) => !current)}
          />
          {chat.storageError && (
            <div className="top-notice" role="alert">
              {chat.storageError}
            </div>
          )}
          {connection === "error" && (
            <div className="top-notice" role="alert">
              {t("providerLoadFailed")}
              <button
                className="text-button"
                onClick={() => void loadSettings()}
              >
                {t("retryConnection")}
              </button>
            </div>
          )}
          {pluginsOpen ? (
            <Plugins />
          ) : (
            <ChatThread
              isDemo={isDemo}
              settings={settings}
              onSelectModel={selectModel}
              modelPending={modelPending}
              onConfigureModel={() => setSettingsSection("providers")}
              ensureThread={chat.ensureThread}
            />
          )}
        </main>
        <BrowserDrawer
          open={browserOpen}
          onClose={() => setBrowserOpen(false)}
        />
      </div>
      {settingsSection && (
        <Settings
          initialSection={settingsSection}
          settings={settings}
          onChange={applySettings}
          onClose={() => setSettingsSection(null)}
        />
      )}
      <ConfirmDialog
        open={Boolean(deletingChat)}
        title={t("deleteChatTitle")}
        description={`${t("deleteChatDescription")}“${deletingChat?.title || t("newChat")}”`}
        confirmLabel={t("delete")}
        pending={deletePending}
        error={deleteError}
        onCancel={() => setDeletingChat(undefined)}
        onConfirm={async () => {
          if (!deletingChat || deletePending) return;
          const target = deletingChat;
          const wasActive =
            target.workspaceId === workspace.id &&
            target.id === chat.currentRemoteId;
          setDeletePending(true);
          setDeleteError("");
          try {
            if (target.workspaceId === workspace.id) {
              const item = chat.conversations.find(
                (entry) => entry.remoteId === target.id,
              );
              if (!item) throw new Error("Chat is not available");
              await chat.deleteChat(item.id);
            } else {
              await workspaceApi(
                target.workspaceId,
                `/pi/threads/${encodeURIComponent(target.id)}`,
                { method: "DELETE" },
              );
            }
            setCatalog((previous) =>
              previous.filter(
                (entry) =>
                  entry.workspaceId !== target.workspaceId ||
                  entry.id !== target.id,
              ),
            );
            setCatalogRevision((revision) => revision + 1);
            try {
              const key = `grimoire.pi.activeThread.${target.workspaceId}`;
              if (localStorage.getItem(key) === target.id)
                localStorage.removeItem(key);
            } catch {}
            if (wasActive) {
              setPluginsOpen(false);
              await chat.runtime.threads.switchToNewThread();
            }
            setDeletingChat(undefined);
          } catch {
            setDeleteError(t("deleteChatFailed"));
          } finally {
            setDeletePending(false);
          }
        }}
      />
    </AssistantRuntimeProvider>
  );
}

function SidebarRail({
  onExpand,
  onNewChat,
  onSettings,
  onPlugins,
}: {
  onExpand: () => void;
  onNewChat: () => void;
  onSettings: () => void;
  onPlugins?: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="sidebar-rail" aria-label={t("sidebarActions")}>
      <button
        type="button"
        className="icon-button desktop-sidebar-toggle"
        aria-label={t("expandSidebar")}
        title={t("expandSidebar")}
        onClick={onExpand}
      >
        <PanelLeftOpen size={18} />
      </button>
      <button
        type="button"
        className="icon-button rail-brand"
        aria-label={t("expandSidebar")}
        title={t("expandSidebar")}
        onClick={onExpand}
      >
        <GrimoireMark small />
        <PanelLeftOpen size={20} className="rail-expand-icon" />
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label={t("newChat")}
        title={t("newChat")}
        onClick={onNewChat}
      >
        <SquarePen size={19} />
      </button>
      {onPlugins && (
        <button
          type="button"
          className="icon-button"
          aria-label={t("plugins")}
          title={t("plugins")}
          onClick={onPlugins}
        >
          <Puzzle size={19} />
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label={t("projects")}
        title={t("projects")}
        onClick={onExpand}
      >
        <Folder size={19} />
      </button>
      <div className="rail-footer">
        <UpdateButton compact />
        <button
          type="button"
          className="icon-button rail-settings"
          aria-label={t("settings")}
          title={t("settings")}
          onClick={onSettings}
        >
          <Settings2 size={19} />
        </button>
      </div>
    </aside>
  );
}

function EmptyProjects({
  onAdded,
}: {
  onAdded: (workspace: Workspace) => void;
}) {
  const { t } = useI18n();
  const [openSignal, setOpenSignal] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth >= 760);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [recentCollapsed, toggleRecent] = useSectionCollapsed("recent");
  const [settings, setSettings] = useState<ProviderSettings>({
    providers: [],
    activeProviderId: DEMO_PROVIDER_ID,
  });
  useEffect(() => {
    void api<ProviderSettings>("/providers")
      .then(setSettings)
      .catch(() => {});
  }, []);
  const add = () => {
    setSidebarOpen(true);
    setOpenSignal((value) => value + 1);
  };
  return (
    <div
      className={`app-shell ${sidebarOpen ? "sidebar-open" : "sidebar-closed"}`}
    >
      {!sidebarOpen && (
        <SidebarRail
          onExpand={() => setSidebarOpen(true)}
          onNewChat={add}
          onSettings={() => setSettingsOpen(true)}
          onPlugins={() => setPluginsOpen(true)}
        />
      )}
      {sidebarOpen && (
        <button
          className="sidebar-overlay"
          aria-label={t("chat")}
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className="sidebar">
        <div className="brand">
          <GrimoireMark small />
          <strong>Grimoire</strong>
          <button
            className="icon-button collapse-sidebar"
            aria-label={t("collapseSidebar")}
            title={t("collapseSidebar")}
            onClick={() => setSidebarOpen(false)}
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
        <button className="new-chat-button" onClick={add}>
          <SquarePen size={16} />
          {t("newChat")}
        </button>
        <button
          className="new-chat-button plugins-button"
          onClick={() => setPluginsOpen(true)}
        >
          <Puzzle size={16} />
          {t("plugins")}
        </button>
        <WorkspacePicker
          workspaces={[]}
          chats={[]}
          currentChatId=""
          onSelect={() => {}}
          onOpenChat={() => {}}
          onDeleteChat={() => {}}
          onNewChat={add}
          onRenamed={() => {}}
          onDeleted={() => {}}
          onAdded={onAdded}
          openSignal={openSignal}
        />
        <SidebarSectionHeader
          section="recent"
          collapsed={recentCollapsed}
          onToggle={toggleRecent}
        />
        <SettingsFooter onSettings={() => setSettingsOpen(true)} />
      </aside>
      <main className="main-panel">
        <BrowserTopbar
          open={browserOpen}
          onToggle={() => setBrowserOpen((current) => !current)}
        />
        {pluginsOpen ? (
          <Plugins />
        ) : (
          <div className="empty-projects">
            <h1>{t("noProjects")}</h1>

            <button className="workspace-add-confirm" onClick={add}>
              {t("addProject")}
            </button>
          </div>
        )}
      </main>
      <BrowserDrawer open={browserOpen} onClose={() => setBrowserOpen(false)} />
      {settingsOpen && (
        <Settings
          initialSection="general"
          settings={settings}
          onChange={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
