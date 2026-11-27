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
import { afterEach, beforeEach, expect, it } from "vitest";
import { PiService } from "../apps/grimoire-agent/src/pi-service";
import { piRoutes } from "../apps/grimoire-agent/src/pi-routes";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { WorkspaceRegistry } from "../apps/grimoire-agent/src/workspaces";

let directory: string;
let service: PiService;
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
                      path,
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
  const settings = new SettingsStore(join(directory, "providers.json"));
  settings.save(
    {
      name: "Fixture",
      kind: "openai-compatible",
      model: "test-model",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      apiKey: "fixture-key",
      contextWindow: 1000,
    },
    "fixture",
  );
  settings.activate("fixture");
  service = new PiService(settings, {
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
  expect(existsSync(join(service.workspace, "approved.txt"))).toBe(false);
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
  expect(readFileSync(join(service.workspace, "approved.txt"), "utf8")).toBe(
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
  expect(existsSync(join(service.workspace, "deny.txt"))).toBe(false);
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
  expect(existsSync(join(service.workspace, "cancel.txt"))).toBe(false);
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
  expect(existsSync(join(service.workspace, "deny.txt"))).toBe(false);
  await service.setThinking(thread.metadata.id, "high");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config
      ?.thinkingLevel,
  ).toBe("high");
  await expect(service.setThinking(thread.metadata.id, "max")).rejects.toThrow(
    "not supported",
  );
  await service.setModel(thread.metadata.id, "fixture", "another-model");
  expect(
    (await supervisor.getThread(thread.metadata.id)).metadata.config?.modelId,
  ).toBe("another-model");
  expect(service.thinkingLevels("fixture", "another-model")).toContain("high");
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
