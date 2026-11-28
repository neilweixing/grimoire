import { createServer, type Server } from "node:http";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PiService } from "../apps/grimoire-agent/src/pi-service";
import { piRoutes } from "../apps/grimoire-agent/src/pi-routes";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { WorkspaceRegistry } from "../apps/grimoire-agent/src/workspaces";

let directory: string;
let service: PiService;
let settings: SettingsStore;
let server: Server;
let offeredTools: string[];
let titleRequests: number;
let titleResponse: string;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-native-"));
  offeredTools = [];
  titleRequests = 0;
  titleResponse = '{"title":"Create a small file"}';
  server = createServer(async (request, response) => {
    let payload = "";
    for await (const chunk of request) payload += chunk;
    const body = JSON.parse(payload);
    if (!body.tools?.length) {
      titleRequests++;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = {
        id: "title-fixture",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
      };
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: titleResponse }, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
      return;
    }
    offeredTools = body.tools.map(
      (tool: { function: { name: string } }) => tool.function.name,
    );
    const toolResult = body.messages.at(-1).role === "tool";
    const text = JSON.stringify(
      body.messages.findLast(
        (message: { role: string }) => message.role === "user",
      )?.content,
    );
    const path = /cancel/.test(text)
      ? "cancel.txt"
      : /deny/.test(text)
        ? "deny.txt"
        : "approved.txt";
    const chunk = {
      id: "fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "test-model",
    };
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    const send = (choices: unknown[], usage?: unknown) =>
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices, ...(usage ? { usage } : {}) })}\n\n`,
      );
    send([
      {
        index: 0,
        delta: toolResult
          ? { role: "assistant", content: "Finished." }
          : {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: crypto.randomUUID(),
                  type: "function",
                  function: {
                    name: "write",
                    arguments: JSON.stringify({
                      path: join(directory, path),
                      content: "Approved code",
                    }),
                  },
                },
              ],
            },
        finish_reason: null,
      },
    ]);
    send([
      {
        index: 0,
        delta: {},
        finish_reason: toolResult ? "stop" : "tool_calls",
      },
    ]);
    send([], {
      prompt_tokens: 100,
      completion_tokens: 10,
      total_tokens: 110,
      prompt_tokens_details: { cached_tokens: 20 },
    });
    response.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  settings = new SettingsStore(join(directory, "providers.json"));
  settings.save(
    {
      name: "Fixture",
      kind: "openai-compatible",
      model: "test-model",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      apiKey: "fixture-key",
      contextWindow: 1000,
      models: ["test-model", "another-model"],
      modelOverrides: {
        "test-model": { thinkingLevels: ["off", "high"] },
        "another-model": {
          thinkingLevels: ["off", "high"],
          contextWindow: 64000,
          maxTokens: 2048,
          input: ["text", "image"],
        },
      },
    },
    "fixture",
  );
  settings.activate("fixture");
  service = new PiService(settings, {
    globalSkillRoot: join(directory, "home-agents"),
    dataDir: join(directory, "pi"),
    workspace: join(directory, "workspace"),
  });
});
afterEach(async () => {
  if (service) {
    const supervisor = await service.supervisor();
    for (const thread of await supervisor.listThreads())
      await supervisor.cancelRun(thread.id);
    await service.dispose();
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});
async function waitFor<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 5000;
  while (true) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline)
      throw new Error(`Timed out: ${JSON.stringify(value)}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}
it("uses native tools, persists sessions, and records real usage after one-time approval", async () => {
  const supervisor = await service.supervisor();
  const { metadata } = await supervisor.createThread({
    title: "Approval test",
  });
  const id = metadata.id;
  await supervisor.sendMessage(id, { content: "write approved.txt" });
  const pending = await waitFor(
    () => supervisor.getThread(id),
    (value) => Boolean(value.hostUiRequests?.length),
  );
  expect(existsSync(join(directory, "approved.txt"))).toBe(false);
  expect(offeredTools.sort()).toEqual([
    "bash",
    "edit",
    "inspect_dataset",
    "ls",
    "read",
    "write",
  ]);
  const request = pending.hostUiRequests![0];
  expect(request).toMatchObject({ kind: "confirm" });
  expect(JSON.stringify(request)).toContain("Approved code");
  const routes = piRoutes(() => service);
  const other = await supervisor.createThread();
  const answer = (thread: string) =>
    routes.request(`/threads/${thread}/host-ui`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response: { requestId: request.id, confirmed: true },
      }),
    });
  expect((await answer(other.metadata.id)).status).toBe(409);
  expect((await answer(id)).status).toBe(204);
  expect((await answer(id)).status).toBe(409);
  const finished = await waitFor(
    () => supervisor.getThread(id),
    (value) => value.metadata.status !== "running",
  );
  expect(JSON.stringify(finished.messages)).not.toContain('"isError":true');
  expect(readFileSync(join(directory, "approved.txt"), "utf8")).toBe(
    "Approved code",
  );
  expect(service.getMetrics(id)).toHaveLength(1);
  expect(service.getMetrics(id)[0]).toMatchObject({
    modelCalls: 2,
    toolCalls: 1,
    totalTokens: 220,
    usageComplete: true,
    cacheReadTokens: 40,
  });
  expect(
    readFileSync(join(directory, "pi", "audit.jsonl"), "utf8"),
  ).not.toContain("Approved code");
  await service.dispose();
  service = new PiService(
    new SettingsStore(join(directory, "providers.json")),
    { dataDir: join(directory, "pi"), workspace: join(directory, "workspace") },
  );
  const reopened = await service.supervisor();
  expect(
    (await reopened.listThreads()).some((thread) => thread.id === id),
  ).toBe(true);
  expect((await reopened.getThread(id)).messages.length).toBeGreaterThan(2);
}, 15000);
it("denies writes in read-only mode without asking for approval", async () => {
  const supervisor = await service.supervisor();
  const { metadata } = await supervisor.createThread();
  service.policy.setMode(metadata.id, "read-only");
  await supervisor.sendMessage(metadata.id, { content: "write deny.txt" });
  const completed = await waitFor(
    () => supervisor.getThread(metadata.id),
    (value) => value.metadata.status !== "running",
  );
  expect(completed.hostUiRequests ?? []).toEqual([]);
  expect(JSON.stringify(completed.messages)).toContain("Permission denied");
  expect(existsSync(join(directory, "deny.txt"))).toBe(false);
});
it("cancels native approval without applying changes and keeps new chats isolated", async () => {
  const supervisor = await service.supervisor();
  const first = await supervisor.createThread();
  const second = await supervisor.createThread();
  await supervisor.sendMessage(first.metadata.id, {
    content: "write cancel.txt",
  });
  await waitFor(
    () => supervisor.getThread(first.metadata.id),
    (value) => Boolean(value.hostUiRequests?.length),
  );
  expect((await supervisor.getThread(second.metadata.id)).messages).toEqual([]);
  await supervisor.cancelRun(first.metadata.id);
  const cancelled = await supervisor.getThread(first.metadata.id);
  expect(cancelled.hostUiRequests ?? []).toEqual([]);
  expect(cancelled.metadata.status).not.toBe("running");
  expect(existsSync(join(directory, "cancel.txt"))).toBe(false);
});
it("requires both server enablement and explicit acknowledgement for full access", async () => {
  const supervisor = await service.supervisor();
  const thread = await supervisor.createThread();
  const routes = piRoutes(() => service);
  const response = await routes.request(
    `/threads/${thread.metadata.id}/execution`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "full", acknowledgeFullAccess: true }),
    },
  );
  expect(response.status).toBe(403);
  expect(service.execution(thread.metadata.id).mode).toBe("workspace");
});
it("rejects approval and retains no write, then switches per-thread model and thinking settings", async () => {
  const supervisor = await service.supervisor();
  const thread = await supervisor.createThread();
  await supervisor.sendMessage(thread.metadata.id, {
    content: "write deny.txt",
  });
  const pending = await waitFor(
    () => supervisor.getThread(thread.metadata.id),
    (value) => Boolean(value.hostUiRequests?.length),
  );
  await supervisor.respondToHostUiRequest(thread.metadata.id, {
    requestId: pending.hostUiRequests![0].id,
    confirmed: false,
  });
  const finished = await waitFor(
    () => supervisor.getThread(thread.metadata.id),
    (value) => value.metadata.status !== "running",
  );
  expect(JSON.stringify(finished.messages)).toContain("Approval denied");
  expect(existsSync(join(directory, "deny.txt"))).toBe(false);
  await service.setThinking(thread.metadata.id, "high");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config
      ?.thinkingLevel,
  ).toBe("high");
  await expect(service.setThinking(thread.metadata.id, "max")).rejects.toThrow(
    "not supported",
  );
  await expect(
    service.setModel(thread.metadata.id, "fixture", "not-configured"),
  ).rejects.toThrow("not configured");
  await service.setModel(thread.metadata.id, "fixture", "another-model");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config?.modelId,
  ).toBe("another-model");
  expect(service.thinkingLevels("fixture", "another-model")).toContain("high");
  const configured = await supervisor.getThread(thread.metadata.id);
  expect(configured.metadata.config?.modelId).toBe("another-model");
});
it("rebinds updated model capabilities before applying reasoning and clamps on a model switch", async () => {
  const supervisor = await service.supervisor();
  const thread = await supervisor.createThread();
  const provider = settings.get("fixture")!;
  settings.save(
    {
      ...provider,
      modelOverrides: {
        ...provider.modelOverrides,
        "test-model": { thinkingLevels: ["off", "low"] },
        "another-model": { thinkingLevels: ["high"] },
      },
    },
    provider.id,
  );
  await service.setThinking(thread.metadata.id, "low");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config
      ?.thinkingLevel,
  ).toBe("low");
  await expect(service.setThinking(thread.metadata.id, "high")).rejects.toThrow(
    "not supported",
  );
  await service.setModel(thread.metadata.id, "fixture", "another-model");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config
      ?.thinkingLevel,
  ).toBe("high");
  expect(service.thinkingLevels("fixture", "another-model")).toEqual(["high"]);
});
it("persists Pi's Max level when configured and keeps it out of unsupported models", async () => {
  const supervisor = await service.supervisor();
  const thread = await supervisor.createThread();
  const provider = settings.get("fixture")!;
  settings.save(
    {
      ...provider,
      modelOverrides: {
        ...provider.modelOverrides,
        "test-model": { thinkingLevels: ["off", "high", "max"] },
      },
    },
    provider.id,
  );
  expect(service.thinkingLevels("fixture", "test-model")).toContain("max");
  await service.setThinking(thread.metadata.id, "max");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config
      ?.thinkingLevel,
  ).toBe("max");
  await service.setModel(thread.metadata.id, "fixture", "another-model");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config
      ?.thinkingLevel,
  ).toBe("off");
  await expect(service.setThinking(thread.metadata.id, "max")).rejects.toThrow(
    "not supported",
  );
});
it("imports old browser histories idempotently into native sessions", async () => {
  const legacy = {
    id: crypto.randomUUID(),
    title: "Previous browser chat",
    messages: [
      {
        id: "user-1",
        role: "user" as const,
        status: "complete" as const,
        content: [{ type: "text" as const, text: "Hello" }],
      },
      {
        id: "assistant-1",
        role: "assistant" as const,
        status: "complete" as const,
        content: [{ type: "text" as const, text: "Welcome" }],
      },
    ],
  };
  const id = await service.importConversation(legacy);
  expect(await service.importConversation(legacy)).toBe(id);
  const supervisor = await service.supervisor();
  expect(
    (await supervisor.listThreads()).filter((thread) => thread.id === id),
  ).toHaveLength(1);
  const snapshot = await supervisor.getThread(id);
  expect(snapshot.metadata.title).toBe("Previous browser chat");
  expect(snapshot.messages.map((message) => message.role)).toEqual([
    "user",
    "assistant",
  ]);
});
it("generates a concise title from the first query with no tools, once per chat", async () => {
  const supervisor = await service.supervisor();
  const thread = await supervisor.createThread();
  await supervisor.sendMessage(thread.metadata.id, {
    content: "write deny.txt",
  });
  const pending = await waitFor(
    () => supervisor.getThread(thread.metadata.id),
    (value) => Boolean(value.hostUiRequests?.length),
  );
  await supervisor.respondToHostUiRequest(thread.metadata.id, {
    requestId: pending.hostUiRequests![0].id,
    confirmed: false,
  });
  await waitFor(
    () => supervisor.getThread(thread.metadata.id),
    (value) => value.metadata.status !== "running",
  );
  const titles = await Promise.all([
    service.generateTitle(thread.metadata.id),
    service.generateTitle(thread.metadata.id),
  ]);
  expect(titles).toEqual(["Create a small file", "Create a small file"]);
  expect(titleRequests).toBe(1);
  expect((await supervisor.getThread(thread.metadata.id)).metadata.title).toBe(
    "Create a small file",
  );
  expect(await service.generateTitle(thread.metadata.id)).toBe(
    "Create a small file",
  );
  expect(titleRequests).toBe(1);
});

it("retains a generic placeholder after invalid title output and retries instead of using a query prefix", async () => {
  const supervisor = await service.supervisor();
  const thread = await supervisor.createThread();
  service.policy.setMode(thread.metadata.id, "read-only");
  await supervisor.sendMessage(thread.metadata.id, {
    content: "write deny.txt",
  });
  await waitFor(
    () => supervisor.getThread(thread.metadata.id),
    (value) => value.metadata.status !== "running",
  );
  titleResponse = "not JSON";
  expect(await service.generateTitle(thread.metadata.id)).toBe("New chat");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.title,
  ).not.toBe("write deny.txt");
  titleResponse = '{"title":"Create a small file"}';
  expect(await service.generateTitle(thread.metadata.id)).toBe(
    "Create a small file",
  );
  expect(titleRequests).toBe(2);
});
it("cancels pending approvals before cascading project deletion and preserves source files", async () => {
  const registry = new WorkspaceRegistry(
    new SettingsStore(join(directory, "providers.json")),
    {
      globalSkillRoot: join(directory, "home-agents"),
      dataDir: join(directory, "project-data"),
      workspace: join(directory, "default-project"),
    },
  );
  try {
    const folder = join(directory, "deletable-project");
    mkdirSync(folder);
    writeFileSync(join(folder, "source.ts"), "existing source");
    const project = registry.add(folder);
    const client = await registry.service(project.id).supervisor();
    const thread = await client.createThread();
    await client.sendMessage(thread.metadata.id, {
      content: "write approved.txt",
    });
    await waitFor(
      () => client.getThread(thread.metadata.id),
      (value) => Boolean(value.hostUiRequests?.length),
    );
    await registry.remove(project.id);
    expect(() => registry.service(project.id)).toThrow("not found");
    expect(existsSync(join(folder, "approved.txt"))).toBe(false);
    expect(readFileSync(join(folder, "source.ts"), "utf8")).toBe(
      "existing source",
    );
    expect(
      existsSync(join(directory, "project-data", "workspaces", project.id)),
    ).toBe(false);
  } finally {
    await registry.dispose();
  }
});

it("waits for browser data cleanup before deleting the native chat and keeps other chats intact", async () => {
  await service.dispose();
  let finish!: () => void;
  const clearBrowserData = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  service = new PiService(settings, {
    dataDir: join(directory, "pi"),
    workspace: join(directory, "workspace"),
    globalSkillRoot: join(directory, "home-agents"),
    clearBrowserData,
  });
  const client = await service.supervisor();
  const one = await client.createThread(),
    two = await client.createThread();
  const deleting = piRoutes(() => service).request(
    `/threads/${one.metadata.id}`,
    { method: "DELETE" },
  );
  await waitFor(
    async () => clearBrowserData.mock.calls.length,
    (count) => count === 1,
  );
  expect(clearBrowserData).toHaveBeenCalledWith({
    workspace: service.workspace,
    threadId: one.metadata.id,
  });
  expect((await client.getThread(one.metadata.id)).metadata.id).toBe(
    one.metadata.id,
  );
  finish();
  expect((await deleting).status).toBe(204);
  await expect(client.getThread(one.metadata.id)).rejects.toThrow();
  expect((await client.getThread(two.metadata.id)).metadata.id).toBe(
    two.metadata.id,
  );
});
it("retains the native chat after browser cleanup failure so deletion can be retried", async () => {
  await service.dispose();
  const clearBrowserData = vi
    .fn()
    .mockRejectedValueOnce(new Error("cleanup busy"))
    .mockResolvedValue(undefined);
  service = new PiService(settings, {
    dataDir: join(directory, "pi"),
    workspace: join(directory, "workspace"),
    globalSkillRoot: join(directory, "home-agents"),
    clearBrowserData,
  });
  const client = await service.supervisor();
  const thread = await client.createThread();
  const routes = piRoutes(() => service);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(
      (
        await routes.request(`/threads/${thread.metadata.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(500);
    expect((await client.getThread(thread.metadata.id)).metadata.id).toBe(
      thread.metadata.id,
    );
    expect(
      (
        await routes.request(`/threads/${thread.metadata.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(204);
    expect(clearBrowserData).toHaveBeenCalledTimes(2);
  } finally {
    log.mockRestore();
  }
});
it("cleans the registered project's browser data before deleting its private state", async () => {
  const clearBrowserData = vi
    .fn()
    .mockRejectedValueOnce(new Error("cleanup busy"))
    .mockResolvedValue(undefined);
  const registry = new WorkspaceRegistry(settings, {
    dataDir: join(directory, "registry"),
    globalSkillRoot: join(directory, "home-agents"),
    clearBrowserData,
  });
  const source = join(directory, "browser-project");
  mkdirSync(source);
  writeFileSync(join(source, "code.txt"), "keep source");
  const project = registry.add(source);
  try {
    await expect(registry.remove(project.id)).rejects.toThrow("cleanup busy");
    expect(registry.list().some((entry) => entry.id === project.id)).toBe(true);
    await registry.remove(project.id);
    expect(clearBrowserData).toHaveBeenLastCalledWith({
      workspace: project.path,
    });
    expect(registry.list().some((entry) => entry.id === project.id)).toBe(
      false,
    );
    expect(readFileSync(join(source, "code.txt"), "utf8")).toBe("keep source");
  } finally {
    await registry.dispose();
  }
});

it("cleans legacy browser partitions for persisted project chats after a cold restart without recreating a missing folder", async () => {
  const dataDir = join(directory, "legacy-browser-registry");
  const options = { dataDir, globalSkillRoot: join(directory, "home-agents") };
  const first = new WorkspaceRegistry(settings, options);
  const source = join(directory, "legacy-browser-project");
  mkdirSync(source);
  const project = first.add(source);
  const stateDir = join(dataDir, "workspaces", project.id);
  const threadId = await first.service(project.id).importConversation({
    id: crypto.randomUUID(),
    title: "Legacy chat",
    messages: [
      {
        id: "user",
        role: "user",
        status: "complete",
        content: [{ type: "text", text: "Hello" }],
      },
      {
        id: "assistant",
        role: "assistant",
        status: "complete",
        content: [{ type: "text", text: "Saved answer" }],
      },
    ],
  });
  await first.dispose();
  rmSync(source, { recursive: true });
  const clearBrowserData = vi.fn(async () => {
    expect(existsSync(stateDir)).toBe(true);
  });
  const reopened = new WorkspaceRegistry(settings, {
    ...options,
    clearBrowserData,
  });
  try {
    await reopened.remove(project.id);
    expect(clearBrowserData.mock.calls).toEqual([
      [{ workspace: project.path, threadIds: [threadId] }],
    ]);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(stateDir)).toBe(false);
  } finally {
    await reopened.dispose();
  }
});
