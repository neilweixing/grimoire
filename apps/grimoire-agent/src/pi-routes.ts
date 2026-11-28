import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  conversationSchema,
  MAX_ATTACHMENT_BYTES,
  permissionModeSchema,
  thinkingLevelSchema,
} from "@grimoire/core";
import type { PiHostUiResponse } from "@assistant-ui/react-pi";
import { PiService } from "./pi-service.js";
import { PolicyError } from "./permissions.js";

const identifier = z.string().uuid();
const inputSchema = z
  .object({
    content: z
      .string()
      .max(100_000)
      .refine((value) => value.trim().length > 0),
    streamingBehavior: z.enum(["followUp", "steer"]).optional(),
  })
  .strict();

export function piRoutes(resolveService: (workspaceId?: string) => PiService) {
  const service = (c: Context) =>
    resolveService(c.req.header("x-grimoire-workspace"));
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json({ error: "Invalid Pi request." }, 400);
    if (error instanceof PolicyError)
      return c.json({ error: error.message }, 403);
    if (error.message.startsWith("Unknown Pi thread"))
      return c.json({ error: "Chat not found." }, 404);
    console.error("Pi request failed:", error.message);
    return c.json(
      { error: "Pi request failed. Check the Agent service logs." },
      500,
    );
  });
  const checkThread = async (c: Context, next: () => Promise<void>) => {
    const id = identifier.parse(c.req.param("id"));
    const current = service(c);
    const snapshot = await (await current.supervisor()).getThread(id);
    if (snapshot.metadata.workspacePath !== current.workspace)
      throw new PolicyError("This chat belongs to a different workspace.");
    await next();
  };
  app.use("/threads/:id/*", checkThread);
  app.use("/threads/:id", checkThread);
  const idle = async (id: string, c: Context) => {
    const client = await service(c).supervisor();
    const snapshot = await client.getThread(id);
    if (snapshot.metadata.status === "running")
      throw new PolicyError(
        "Stop the running task before changing its configuration.",
      );
    return client;
  };
  app.get("/skills", async (c) => c.json(await service(c).availableSkills()));
  app.post(
    "/attachments",
    bodyLimit({
      maxSize: MAX_ATTACHMENT_BYTES + 64 * 1024,
      onError: (c) =>
        c.json({ error: "Attachment exceeds the 8 MiB limit." }, 413),
    }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        return c.json({ error: "Select a local file." }, 400);
      if (file.size > MAX_ATTACHMENT_BYTES)
        return c.json({ error: "Attachment exceeds the 8 MiB limit." }, 413);
      return c.json(
        await service(c).attachments.save(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
          file.type,
        ),
        201,
      );
    },
  );
  app.get("/execution", (c) => c.json(service(c).execution()));
  app.get("/thinking-levels", (c) => {
    const { provider, modelId } = z
      .object({
        provider: z.string().min(1).max(200),
        modelId: z.string().min(1).max(200),
      })
      .parse(c.req.query());
    return c.json({ levels: service(c).thinkingLevels(provider, modelId) });
  });
  app.get("/threads", async (c) => {
    const requested = c.req.query("workspacePath");
    if (requested && requested !== service(c).workspace)
      throw new PolicyError("Workspace is configured by the server.");
    return c.json(
      await (
        await service(c).supervisor()
      ).listThreads({
        includeArchived: c.req.query("includeArchived") === "true",
      }),
    );
  });
  app.post("/threads", async (c) => {
    await service(c).prepareIntegrations();
    const body = z
      .object({
        title: z.string().max(200).optional(),
        workspacePath: z.string().optional(),
        initialMessage: inputSchema.optional(),
      })
      .strict()
      .parse(await c.req.json());
    if (body.workspacePath && body.workspacePath !== service(c).workspace)
      throw new PolicyError("Workspace is configured by the server.");
    const snapshot = await (
      await service(c).supervisor()
    ).createThread({
      title:
        body.title ??
        (c.req.header("accept-language")?.startsWith("en")
          ? "New chat"
          : "新聊天"),
    });
    service(c).locale(snapshot.metadata.id, c.req.header("accept-language"));
    if (body.initialMessage)
      await (
        await service(c).supervisor()
      ).sendMessage(snapshot.metadata.id, body.initialMessage);
    return c.json(snapshot, 201);
  });
  app.post("/import", async (c) => {
    const conversation = conversationSchema
      .extend({ id: identifier })
      .parse(await c.req.json());
    if (!conversation.messages.length) return c.json({ id: null });
    return c.json({ id: await service(c).importConversation(conversation) });
  });
  app.get("/threads/:id", async (c) =>
    c.json(await (await service(c).supervisor()).getThread(c.req.param("id"))),
  );
  app.patch("/threads/:id", async (c) => {
    const { title } = z
      .object({ title: z.string().trim().min(1).max(200) })
      .strict()
      .parse(await c.req.json());
    await (
      await service(c).supervisor()
    ).renameThread(c.req.param("id"), title);
    return c.body(null, 204);
  });
  app.delete("/threads/:id", async (c) => {
    const id = c.req.param("id");
    await service(c).deleteThread(id);
    return c.body(null, 204);
  });
  app.post("/threads/:id/messages", async (c) => {
    const { input } = z
      .object({ input: inputSchema })
      .strict()
      .parse(await c.req.json());
    const id = c.req.param("id");
    await service(c).prepareIntegrations(id);
    service(c).locale(id, c.req.header("accept-language"));
    await (await service(c).supervisor()).sendMessage(id, input);
    return c.body(null, 204);
  });
  app.post("/threads/:id/cancel", async (c) => {
    await (await service(c).supervisor()).cancelRun(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/threads/:id/queue/clear", async (c) =>
    c.json(await (await service(c).supervisor()).clearQueue(c.req.param("id"))),
  );
  app.post("/threads/:id/model", async (c) => {
    const { provider, modelId } = z
      .object({
        provider: z.string().min(1).max(200),
        modelId: z.string().min(1).max(200),
      })
      .strict()
      .parse(await c.req.json());
    await idle(c.req.param("id"), c);
    await service(c).setModel(c.req.param("id"), provider, modelId);
    return c.body(null, 204);
  });
  app.post("/threads/:id/thinking", async (c) => {
    const { level } = z
      .object({ level: thinkingLevelSchema })
      .strict()
      .parse(await c.req.json());
    await idle(c.req.param("id"), c);
    await service(c).setThinking(c.req.param("id"), level);
    return c.body(null, 204);
  });
  for (const action of ["archive", "unarchive"] as const)
    app.post(`/threads/:id/${action}`, async (c) => {
      const client = await idle(c.req.param("id"), c);
      await (action === "archive"
        ? client.archiveThread(c.req.param("id"))
        : client.unarchiveThread(c.req.param("id")));
      return c.body(null, 204);
    });
  app.get("/threads/:id/execution", async (c) => {
    await (await service(c).supervisor()).getThread(c.req.param("id"));
    return c.json(service(c).execution(c.req.param("id")));
  });
  app.put("/threads/:id/execution", async (c) => {
    const { mode, acknowledgeFullAccess } = z
      .object({
        mode: permissionModeSchema,
        acknowledgeFullAccess: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    await idle(c.req.param("id"), c);
    service(c).policy.setMode(c.req.param("id"), mode, acknowledgeFullAccess);
    return c.json(service(c).execution(c.req.param("id")));
  });
  app.get("/threads/:id/metrics", async (c) => {
    await (await service(c).supervisor()).getThread(c.req.param("id"));
    return c.json({ runs: service(c).getMetrics(c.req.param("id")) });
  });
  app.post("/threads/:id/title", async (c) =>
    c.json({ title: await service(c).generateTitle(c.req.param("id")) }),
  );
  app.get("/models", async (c) =>
    c.json(await (await service(c).supervisor()).getAvailableModels()),
  );
  app.post("/threads/:id/host-ui", async (c) => {
    const { response } = z
      .object({
        response: z.union([
          z
            .object({
              requestId: z.string().min(1).max(200),
              confirmed: z.boolean(),
            })
            .strict(),
          z
            .object({
              requestId: z.string().min(1).max(200),
              value: z.string().max(100_000),
            })
            .strict(),
          z
            .object({
              requestId: z.string().min(1).max(200),
              dismissed: z.literal(true),
            })
            .strict(),
        ]),
      })
      .strict()
      .parse(await c.req.json());
    const client = await service(c).supervisor();
    const snapshot = await client.getThread(c.req.param("id"));
    const request = snapshot.hostUiRequests?.find(
      (request) => request.id === response.requestId,
    );
    if (!request)
      return c.json(
        { error: "Approval is no longer pending in this chat." },
        409,
      );
    if (
      request.kind === "confirm"
        ? !("confirmed" in response)
        : "confirmed" in response
    )
      return c.json(
        { error: "Response does not match the pending request." },
        400,
      );
    if (
      request.kind === "select" &&
      "value" in response &&
      !request.options.includes(response.value)
    )
      return c.json({ error: "Select a listed option." }, 400);
    await client.respondToHostUiRequest(
      c.req.param("id"),
      response satisfies PiHostUiResponse,
    );
    return c.body(null, 204);
  });
  app.get("/threads/:id/events", async (c) => {
    const client = await service(c).supervisor();
    const id = c.req.param("id");
    await client.getThread(id);
    return streamSSE(c, async (stream) => {
      let end!: () => void;
      const closed = new Promise<void>((resolve) => {
        end = resolve;
      });
      let writes = Promise.resolve();
      const unsubscribe = client.subscribe(
        id,
        (event) => {
          writes = writes
            .then(async () => {
              if (!stream.aborted)
                await stream.writeSSE({ data: JSON.stringify(event) });
            })
            .catch(() => end());
        },
        { includeSnapshot: c.req.query("snapshot") !== "false" },
      );
      stream.onAbort(end);
      const heartbeat = setInterval(() => {
        writes = writes
          .then(async () => {
            if (!stream.aborted) await stream.write(": ping\n\n");
          })
          .catch(() => end());
      }, 15_000);
      try {
        await closed;
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    });
  });
  return app;
}
