import type { ThreadMessage } from "@assistant-ui/react";
import { splitAttachmentReferences } from "@grimoire/core";

export type ConversationTurn = { id: string; query: string; answer: string };

export function conversationTurns(
  messages: readonly ThreadMessage[],
): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      const view = splitAttachmentReferences(
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n"),
      );
      turns.push({
        id: message.id,
        query: view.text || view.files.map((file) => file.name).join(", "),
        answer: "",
      });
    } else if (message.role === "assistant" && turns.length) {
      const toolParents = new Set(
        message.content.flatMap((part) =>
          part.type === "tool-call" && part.parentId ? [part.parentId] : [],
        ),
      );
      let lastTool = -1;
      message.content.forEach((part, index) => {
        if (part.type === "tool-call") lastTool = index;
      });
      const text = message.content
        .flatMap((part, index) =>
          part.type === "text" &&
          index > lastTool &&
          (!part.parentId || !toolParents.has(part.parentId))
            ? [part.text]
            : [],
        )
        .join("\n");
      if (text) turns[turns.length - 1]!.answer = text;
    }
  }
  return turns;
}
