import type {
  AttachmentAdapter,
  CompleteAttachment,
} from "@assistant-ui/react";
import {
  attachmentReference,
  localAttachmentSchema,
  MAX_ATTACHMENT_BYTES,
} from "@grimoire/core";

export function localAttachmentAdapter(
  workspaceId: string,
  messages: { tooLarge: string; uploadFailed: string },
): AttachmentAdapter {
  const uploaded = new Map<string, CompleteAttachment>();
  return {
    accept: "*",
    async add({ file }) {
      return {
        id: crypto.randomUUID(),
        type: "document",
        name: file.name,
        file,
        contentType: file.type,
        status:
          file.size > MAX_ATTACHMENT_BYTES
            ? {
                type: "incomplete",
                reason: "error",
                message: messages.tooLarge,
              }
            : { type: "requires-action", reason: "composer-send" },
      };
    },
    async remove(attachment) {
      uploaded.delete(attachment.id);
    },
    async send(attachment, options) {
      options?.signal?.throwIfAborted();
      const existing = uploaded.get(attachment.id);
      if (existing) return existing;
      const form = new FormData();
      form.set("file", attachment.file);
      const response = await fetch("/api/pi/attachments", {
        method: "POST",
        headers: { "X-Grimoire-Workspace": workspaceId },
        body: form,
        signal: options?.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 413 ? messages.tooLarge : messages.uploadFailed,
        );
      const record = localAttachmentSchema.parse(await response.json());
      const complete: CompleteAttachment = {
        ...attachment,
        status: { type: "complete" },
        content: [{ type: "text", text: attachmentReference(record) }],
      };
      uploaded.set(attachment.id, complete);
      return complete;
    },
  };
}
