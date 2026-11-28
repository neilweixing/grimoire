import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import {
  chatRequestSchema,
  configuredModelIds,
  providerInputSchema,
  modelSelectionSchema,
  type AgentStreamEvent,
} from "@grimoire/core";
import {
  createGrimoireAgent,
  modelContextWindow,
  modelThinkingLevels,
  toPiMessages,
} from "./agent.js";
import {
  knownModel,
  providerCatalog,
  describeModel,
  selectProviderModel,
} from "./provider-catalog.js";
import { SettingsStore } from "./settings.js";
import { errorMessage } from "./errors.js";
import { RunMetricsCollector } from "./metrics.js";
import { probeModel } from "./model-probe.js";
import { listProviderModels } from "./models.js";
import { type PiServiceOptions } from "./pi-service.js";
import { WorkspaceRegistry } from "./workspaces.js";
import { PolicyError } from "./permissions.js";
import { z } from "zod";
import { piRoutes } from "./pi-routes.js";
import { nativeFolderPicker } from "./native-folder-picker.js";
import { searchPlugins } from "./integrations.js";
import { lookupPlugin } from "./plugin-lookup.js";

export function createApp(
  settings = new SettingsStore(),
  options: PiServiceOptions & {
    selectFolder?: typeof nativeFolderPicker.select;
  } = {},
) {
  const app = new Hono();
  const probes = new Set<string>();
  let registry: WorkspaceRegistry | undefined;
  const workspaces = () =>
    (registry ??= new WorkspaceRegistry(settings, options));
  const publicSettings = () => {
    registry?.syncProviders();
    return {
      ...settings.publicSettings(),
      thinkingLevels: modelThinkingLevels(settings.active()),
    };
  };
  app.use("/api/*", bodyLimit({ maxSize: 2 * 1024 * 1024 }));
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    await next();
  });
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    const hostname = new URL(c.req.url).hostname;
    if (
      hostname !== "localhost" &&
      hostname !== "127.0.0.1" &&
      hostname !== "[::1]"
    )
      return c.json(
        {
          error: errorMessage(c.req.header("accept-language"), "invalidOrigin"),
        },
        403,
      );
    const allowed = new Set([
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      new URL(c.req.url).origin,
    ]);
    if (origin && !allowed.has(origin))
      return c.json(
        {
          error: errorMessage(c.req.header("accept-language"), "invalidOrigin"),
        },
        403,
      );
    await next();
  });
  app.onError((error, c) => {
    if (error instanceof PolicyError)
      return c.json({ error: error.message }, 403);
    if (error instanceof z.ZodError)
      return c.json({ error: "Invalid request." }, 400);
    if (error instanceof SyntaxError)
      return c.json(
        { error: errorMessage(c.req.header("accept-language"), "invalidJson") },
        400,
      );
    console.error("Grimoire request failed:", error.message);
    return c.json(
      { error: errorMessage(c.req.header("accept-language"), "serviceError") },
      500,
    );
  });
  app.route(
    "/api/pi",
    piRoutes((id) => workspaces().service(id)),
  );
  app.get("/api/integrations", async (c) =>
    c.json(await workspaces().integrationSnapshot()),
  );
  app.put("/api/integrations", async (c) => {
    const input = await c.req.json();
    return c.json(
      await workspaces().changeIntegrations(() =>
        workspaces().integrations.save(input),
      ),
    );
  });
  app.post("/api/integrations/reload", async (c) =>
    c.json(await workspaces().changeIntegrations(() => {})),
  );
  app.get("/api/plugins/lookup", async (c) => {
    const { source } = z
      .object({ source: z.string().min(1).max(300) })
      .parse(c.req.query());
    return c.json(await lookupPlugin(source));
  });
  app.get("/api/plugins/catalog", async (c) => {
    const { query, offset } = z
      .object({
        query: z.string().max(200).default(""),
        offset: z.coerce.number().int().min(0).max(10000).default(0),
      })
      .parse(c.req.query());
    return c.json(await searchPlugins(query, offset));
  });
  app.get("/api/plugins/updates", async (c) =>
    c.json(
      await workspaces().integrations.checkPackageUpdates(
        c.req.query("refresh") === "1",
        c.req.raw.signal,
      ),
    ),
  );
  app.post("/api/plugins", async (c) => {
    const { action, source, trust } = z
      .object({
        action: z.enum(["install", "remove", "enable", "disable", "update"]),
        source: z.string().max(300),
        trust: z.boolean().optional(),
      })
      .strict()
      .parse(await c.req.json());
    if (["install", "enable", "update"].includes(action) && trust !== true)
      throw new PolicyError(
        "Installing, enabling, or updating a plugin requires explicit trust.",
      );
    return c.json(
      await workspaces().changeIntegrations(
        () => workspaces().integrations.packageAction(action, source),
        true,
      ),
    );
  });
  app.get("/api/pi/workspaces", (c) => c.json(workspaces().list()));
  app.post("/api/pi/folders/select", async (c) => {
    const { initialPath } = z
      .object({ initialPath: z.string().max(4096).optional() })
      .strict()
      .parse(await c.req.json());
    return c.json({
      path: await (
        options.selectFolder ??
        nativeFolderPicker.select.bind(nativeFolderPicker)
      )(initialPath, c.req.header("accept-language"), c.req.raw.signal),
    });
  });
  app.patch("/api/pi/workspaces/:id", async (c) => {
    const { name } = z
      .object({ name: z.string().trim().min(1).max(80) })
      .strict()
      .parse(await c.req.json());
    return c.json(workspaces().rename(c.req.param("id"), name));
  });
  app.delete("/api/pi/workspaces/:id", async (c) => {
    await workspaces().remove(c.req.param("id"));
    return c.json({ id: c.req.param("id") });
  });
  app.post("/api/pi/workspaces", async (c) => {
    const { path, name } = z
      .object({
        path: z.string().trim().min(1).max(4096),
        name: z.string().trim().min(1).max(80).optional(),
      })
      .strict()
      .parse(await c.req.json());
    return c.json(workspaces().add(path, name), 201);
  });
  app.get("/api/health", (c) =>
    c.json({ status: "ok", name: "grimoire-agent" }),
  );
  app.get("/api/providers", (c) => c.json(publicSettings()));
  app.get("/api/providers/catalog", (c) => c.json(providerCatalog()));
  app.post("/api/providers/discover", async (c) => {
    const body = await c.req.json();
    const input = providerInputSchema.parse({
      ...body.provider,
      name: body.provider?.name || "Provider",
      model: body.provider?.model || "__discovery__",
    });
    const previous =
      typeof body.id === "string" ? settings.get(body.id) : undefined;
    // Reuse a stored secret only for the same connection. Editing an endpoint
    // must never send an existing secret to a new host implicitly.
    const sameConnection =
      previous &&
      previous.kind === input.kind &&
      previous.nativeProvider === input.nativeProvider &&
      (previous.baseUrl || "") === (input.baseUrl || "");
    const provider = {
      ...input,
      id: "preview",
      apiKey: input.apiKey || (sameConnection ? previous.apiKey : undefined),
      modelOverrides: undefined,
    };
    try {
      return c.json({ models: await listProviderModels(provider) });
    } catch {
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "modelListUnavailable",
          ),
        },
        502,
      );
    }
  });
  app.post("/api/providers/probe", async (c) => {
    const body = await c.req.json();
    const input = providerInputSchema.parse(body.provider);
    if (input.kind === "native" && !knownModel(input))
      return c.json({ error: "Unknown native model." }, 400);
    const previous =
      typeof body.id === "string" ? settings.get(body.id) : undefined;
    const sameConnection =
      previous &&
      previous.kind === input.kind &&
      previous.nativeProvider === input.nativeProvider &&
      (previous.baseUrl || "") === (input.baseUrl || "");
    const key = `${input.kind}:${input.nativeProvider}:${input.baseUrl}:${input.model}`;
    if (probes.has(key))
      return c.json(
        { error: "A test is already running for this model." },
        409,
      );
    probes.add(key);
    try {
      return c.json(
        await probeModel(
          {
            ...input,
            id: "probe",
            apiKey:
              input.apiKey || (sameConnection ? previous.apiKey : undefined),
          },
          c.req.raw.signal,
        ),
      );
    } finally {
      probes.delete(key);
    }
  });
  app.get("/api/providers/:id/models", async (c) => {
    const provider = settings.get(c.req.param("id"));
    if (!provider)
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "missingProvider",
          ),
        },
        404,
      );
    return c.json({
      models: configuredModelIds(provider).map((id) =>
        describeModel(selectProviderModel(provider, id)),
      ),
    });
  });
  app.put("/api/providers/selection", async (c) => {
    const parsed = modelSelectionSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "invalidProvider",
          ),
        },
        400,
      );
    if (
      parsed.data.providerId !== "demo" &&
      !settings.has(parsed.data.providerId)
    )
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "missingProvider",
          ),
        },
        404,
      );
    const selected = settings.get(parsed.data.providerId);
    if (selected && !configuredModelIds(selected).includes(parsed.data.model))
      return c.json(
        { error: "Model is not configured for this provider." },
        400,
      );
    settings.selectModel(parsed.data.providerId, parsed.data.model);
    return c.json(publicSettings());
  });
  app.post("/api/providers", async (c) => {
    const parsed = providerInputSchema.safeParse(await c.req.json());
    if (
      !parsed.success ||
      (parsed.data.kind === "native" &&
        configuredModelIds(parsed.data).some(
          (id) => !knownModel(selectProviderModel(parsed.data, id)),
        ))
    )
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "invalidProvider",
          ),
        },
        400,
      );
    settings.save(parsed.data);
    return c.json(publicSettings(), 201);
  });
  app.put("/api/providers/active", async (c) => {
    const body = await c.req.json();
    if (
      typeof body?.id !== "string" ||
      (body.id !== "demo" && !settings.has(body.id))
    ) {
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "missingProvider",
          ),
        },
        404,
      );
    }
    settings.activate(body.id);
    return c.json(publicSettings());
  });
  app.put("/api/providers/:id", async (c) => {
    const id = c.req.param("id");
    if (!settings.has(id))
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "missingProvider",
          ),
        },
        404,
      );
    const parsed = providerInputSchema.safeParse(await c.req.json());
    if (
      !parsed.success ||
      (parsed.data.kind === "native" &&
        configuredModelIds(parsed.data).some(
          (id) => !knownModel(selectProviderModel(parsed.data, id)),
        ))
    )
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "invalidProvider",
          ),
        },
        400,
      );
    settings.save(parsed.data, id);
    return c.json(publicSettings());
  });
  app.delete("/api/providers/:id", (c) => {
    if (!settings.has(c.req.param("id")))
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "missingProvider",
          ),
        },
        404,
      );
    settings.remove(c.req.param("id"));
    return c.json(publicSettings());
  });

  app.post("/api/chat", async (c) => {
    const parsed = chatRequestSchema.safeParse(await c.req.json());
    if (!parsed.success)
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "invalidMessages",
          ),
        },
        400,
      );
    let agent;
    const provider = settings.active();
    const metrics = new RunMetricsCollector(
      provider?.model ?? "grimoire-demo",
      provider?.id ?? "demo",
      modelContextWindow(provider),
    );
    try {
      agent = createGrimoireAgent(
        provider,
        c.req.header("accept-language")?.startsWith("en") ? "en" : "zh",
        parsed.data.thinkingLevel,
        (event) => metrics.observeProviderEvent(event),
      );
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof Error
              ? error.message
              : errorMessage(
                  c.req.header("accept-language"),
                  "invalidProvider",
                ),
        },
        400,
      );
    }
    const history = toPiMessages(parsed.data.messages, agent.state.model);
    const prompt = history.pop();
    if (!prompt || prompt.role !== "user")
      return c.json(
        {
          error: errorMessage(
            c.req.header("accept-language"),
            "missingMessage",
          ),
        },
        400,
      );
    agent.state.messages = [...agent.state.messages, ...history];
    return streamSSE(c, async (stream) => {
      const emit = (event: AgentStreamEvent) =>
        stream.writeSSE({ data: JSON.stringify(event) });
      const timeout = setTimeout(() => agent.abort(), 120_000);
      stream.onAbort(() => agent.abort());
      const unsubscribe = agent.subscribe(async (event) => {
        if (stream.aborted) return;
        if (metrics.observe(event))
          await emit({ type: "metrics", metrics: metrics.snapshot() });
        if (
          event.type === "message_update" &&
          event.assistantMessageEvent.type === "text_delta"
        ) {
          await emit({
            type: "text-delta",
            delta: event.assistantMessageEvent.delta,
          });
        } else if (event.type === "tool_execution_start") {
          await emit({
            type: "tool-start",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.args,
          });
        } else if (event.type === "tool_execution_end") {
          await emit({
            type: "tool-result",
            toolCallId: event.toolCallId,
            result: event.result.details ?? event.result.content,
            isError: event.isError,
          });
        } else if (
          event.type === "message_end" &&
          event.message.role === "assistant"
        ) {
          if (
            event.message.stopReason === "error" ||
            event.message.stopReason === "aborted"
          ) {
            await emit({
              type: "error",
              message:
                event.message.errorMessage ||
                errorMessage(c.req.header("accept-language"), "aborted"),
            });
          }
        }
      });
      try {
        await agent.prompt(prompt);
        if (!stream.aborted)
          await emit({ type: "metrics", metrics: metrics.snapshot() });
        if (!stream.aborted) await emit({ type: "done" });
      } catch (error) {
        if (!stream.aborted)
          await emit({
            type: "error",
            message:
              error instanceof Error
                ? error.message
                : errorMessage(c.req.header("accept-language"), "agentFailed"),
          });
      } finally {
        clearTimeout(timeout);
        unsubscribe();
        agent.abort();
      }
    });
  });
  return Object.assign(app, {
    dispose: async () => registry?.dispose(),
  });
}
