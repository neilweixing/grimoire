import { useEffect, useState } from "react";
import { usePiRuntimeExtras } from "@assistant-ui/react-pi";
import {
  summarizeConversation,
  type ChatMessage,
  type RunMetrics,
} from "@grimoire/core";
import { useWorkspace, workspaceApi } from "./workspace";

export function usePiMetrics() {
  const { metadata, status, state } = usePiRuntimeExtras();
  const workspace = useWorkspace();
  const [saved, setSaved] = useState<{ id: string; runs: RunMetrics[] }>();
  useEffect(() => {
    if (!metadata.id || metadata.id.startsWith("__")) return;
    const controller = new AbortController();
    const poll = () => {
      void workspaceApi<{ runs: RunMetrics[] }>(
        workspace.id,
        `/pi/threads/${metadata.id}/metrics`,
        { signal: controller.signal },
      )
        .then((value) => {
          if (!controller.signal.aborted)
            setSaved({ id: metadata.id, runs: value.runs });
        })
        .catch(() => {});
    };
    poll();
    const timer = status === "running" ? setInterval(poll, 1000) : undefined;
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [metadata.id, status, workspace.id]);
  const runs = saved?.id === metadata.id ? saved.runs : [];
  const messages: ChatMessage[] = state.messages
    .filter((message) => message.role === "user")
    .map((_, index) => ({
      id: `user-${index}`,
      role: "user",
      status: "complete",
      content: [],
    }));
  for (const [index, metrics] of runs.entries())
    messages.push({
      id: `run-${index}`,
      role: "assistant",
      status: "complete",
      content: [],
      metrics,
    });
  const result = summarizeConversation(messages);
  return {
    ...result,
    stepsComplete:
      runs.length ===
      messages.filter((message) => message.role === "user").length,
  };
}
