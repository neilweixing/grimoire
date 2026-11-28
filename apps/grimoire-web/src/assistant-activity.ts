import type { MessageStatus, PartState } from "@assistant-ui/react";

export type ActivityPhase =
  "thinking" | "tools" | "waiting" | "answering" | "settled";

// Pi projects one run into one assistant message. Tool steps may be separated
// by progress text, so adjacent-only grouping produces multiple summaries.
export function splitAssistantActivity(
  parts: readonly PartState[],
  status: MessageStatus = { type: "complete", reason: "stop" },
) {
  let lastToolIndex = -1;
  parts.forEach((part, index) => {
    if (part.type === "tool-call") lastToolIndex = index;
  });
  const toolParents = new Set(
    parts.flatMap((part) =>
      part.type === "tool-call" && part.parentId ? [part.parentId] : [],
    ),
  );
  const latestCalls = new Map<string, number>();
  parts.forEach((part, index) => {
    if (part.type === "tool-call") latestCalls.set(part.toolCallId, index);
  });
  const activity: number[] = [];
  const answer: number[] = [];
  let waiting = false;
  let toolsRunning = false;
  let hasErrors = status.type === "incomplete";
  let hasReasoning = false;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!;
    if (part.type === "tool-call") {
      // Keep distinct calls to the same tool; only repeated identities coalesce.
      if (latestCalls.get(part.toolCallId) !== index) continue;
      activity.push(index);
      waiting ||= part.status.type === "requires-action";
      toolsRunning ||= part.status.type === "running";
      hasErrors ||= Boolean(part.isError) || part.status.type === "incomplete";
    } else if (part.type === "reasoning") {
      activity.push(index);
      hasReasoning = true;
    } else if (
      part.type === "text" &&
      (index < lastToolIndex ||
        Boolean(part.parentId && toolParents.has(part.parentId)))
    ) {
      activity.push(index);
    } else {
      answer.push(index);
    }
  }
  const hasAnswer = answer.some((index) => {
    const part = parts[index]!;
    return part.type === "text"
      ? Boolean(part.text.trim())
      : part.type !== "data";
  });
  const phase: ActivityPhase =
    waiting || status.type === "requires-action"
      ? "waiting"
      : status.type !== "running"
        ? "settled"
        : hasAnswer
          ? "answering"
          : toolsRunning
            ? "tools"
            : "thinking";
  return {
    activity,
    answer,
    toolCount: latestCalls.size,
    hasReasoning,
    hasAnswer,
    hasErrors,
    phase,
  };
}
