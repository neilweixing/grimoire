import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  createPiHttpClient,
  usePiRuntime,
  type PiClient,
} from "@assistant-ui/react-pi";
import { conversationsSchema } from "@grimoire/core";
import { api } from "./api";
import { useI18n } from "./i18n";
import { readStoredValue } from "./storage";
import type { AssistantRuntime } from "@assistant-ui/react";
import { workspaceApi } from "./workspace";
import { localAttachmentAdapter } from "./local-attachments";

export function useGrimoireChat(workspaceId: string, workspacePath: string) {
  const { t, locale } = useI18n();
  const attachments = useMemo(
    () =>
      localAttachmentAdapter(workspaceId, {
        tooLarge: t("attachmentTooLarge"),
        uploadFailed: t("attachmentUploadFailed"),
      }),
    [workspaceId, locale],
  );
  const activeKey = `grimoire.pi.activeThread.${workspaceId}`;
  const [storageError, setError] = useState("");
  const [initialThreadId] = useState(() => {
    try {
      return (
        localStorage.getItem(activeKey) ||
        (workspaceId === "default"
          ? localStorage.getItem("grimoire.pi.activeThread")
          : undefined) ||
        undefined
      );
    } catch {
      return undefined;
    }
  });
  const migration = useRef<Promise<void> | undefined>(undefined);
  const runtimeRef = useRef<AssistantRuntime | null>(null);
  const client = useMemo<PiClient>(() => {
    const remote = createPiHttpClient({
      fetchImpl: (input, init) => {
        const headers = new Headers(init?.headers);
        if (!headers.has("Accept")) headers.set("Accept", "application/json");
        headers.set("Accept-Language", document.documentElement.lang);
        headers.set("X-Grimoire-Workspace", workspaceId);
        return fetch(input, { ...init, headers, cache: "no-store" });
      },
    });
    const migrate = () =>
      (migration.current ??= (async () => {
        // Retain the original browser data even after importing native Pi sessions.
        if (workspaceId !== "default") return;
        const raw = readStoredValue("conversations");
        if (!raw) return;
        for (const chat of conversationsSchema.parse(JSON.parse(raw))) {
          if (chat.messages.length)
            await api("/pi/import", {
              method: "POST",
              body: JSON.stringify(chat),
            });
        }
      })());
    return {
      ...remote,
      sendMessage: async (threadId, input) => {
        await window.grimoireDesktop?.browser.command({
          action: "bind",
          context: { workspace: workspacePath, threadId },
        });
        await remote.sendMessage(threadId, input);
        // Title generation is metadata work and must not delay the agent response.
        void workspaceApi<{ title: string | null }>(
          workspaceId,
          `/pi/threads/${threadId}/title`,
          { method: "POST" },
        )
          .then(async (result) => {
            const current = runtimeRef.current;
            if (!current || !result.title) return;
            const item = Object.entries(
              current.threads.getState().threadItems,
            ).find(([, value]) => value.remoteId === threadId);
            if (item)
              await current.threads.getItemById(item[0]).rename(result.title);
          })
          .catch(() => {});
      },
      listThreads: async (input) => {
        try {
          await migrate();
        } catch {
          setError(t("legacyImportFailed"));
        }
        return remote.listThreads(input);
      },
    };
  }, [workspaceId, workspacePath]);
  const runtime = usePiRuntime({
    client,
    adapters: { attachments },
    initialThreadId,
    onThreadIdChange: (id) => {
      try {
        if (id) localStorage.setItem(activeKey, id);
        else localStorage.removeItem(activeKey);
      } catch {}
    },
    onError: (error) =>
      setError(error instanceof Error ? error.message : t("requestFailed")),
  });
  const list = useSyncExternalStore(
    runtime.threads.subscribe,
    runtime.threads.getState,
    runtime.threads.getState,
  );
  useEffect(() => {
    runtimeRef.current = runtime;
    return () => {
      runtimeRef.current = null;
    };
  }, [runtime]);
  const report = (promise: Promise<unknown>) => {
    void promise.catch((error) =>
      setError(error instanceof Error ? error.message : t("requestFailed")),
    );
  };
  useEffect(() => {
    if (list.loadError) setError(t("requestFailed"));
  }, [list.loadError]);
  const ensureThread = async () =>
    (await runtime.threads.mainItem.initialize()).remoteId;
  return {
    runtime,
    client,
    storageError,
    currentId: list.mainThreadId,
    currentRemoteId:
      list.threadItems[list.mainThreadId]?.remoteId ?? list.mainThreadId,
    conversations: list.threadIds.map((id) => ({
      id,
      remoteId: list.threadItems[id]?.remoteId ?? id,
      title: list.threadItems[id]?.title || "",
    })),
    createChat: () => report(runtime.threads.switchToNewThread()),
    selectChat: (id: string) => report(runtime.threads.switchToThread(id)),
    deleteChat: (id: string) => runtime.threads.getItemById(id).delete(),
    ensureThread,
  };
}
