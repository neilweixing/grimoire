import { createServer, type Server } from "node:http";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, expect, it } from "vitest";
import { PiService } from "../apps/grimoire-agent/src/pi-service";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { IntegrationStore } from "../apps/grimoire-agent/src/integrations";
import { WorkspaceRegistry } from "../apps/grimoire-agent/src/workspaces";
import { createApp } from "../apps/grimoire-agent/src/app";

let directory: string, service: PiService, server: Server, store: SettingsStore;
let actions: { name: string; args: Record<string, unknown> }[];
let requests: any[];
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-integrations-"));
  actions = [];
  requests = [];
  server = createServer(async (req, res) => {
    let data = "";
    for await (const chunk of req) data += chunk;
    const request = JSON.parse(data);
    requests.push(request);
    const next = actions.shift();
    const delta = next
      ? {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: crypto.randomUUID(),
              type: "function",
              function: {
                name: next.name,
                arguments: JSON.stringify(next.args),
              },
            },
          ],
        }
      : { role: "assistant", content: "Fixture complete." };
    const base = {
      id: "fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: "test-model",
    };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const [content, finish] of [
      [delta, null],
      [{}, next ? "tool_calls" : "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: content, finish_reason: finish }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  store = new SettingsStore(join(directory, "providers.json"));
  store.save(
    {
      name: "Fixture",
      kind: "openai-compatible",
      model: "test-model",
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
      apiKey: "fixture",
    },
    "fixture",
  );
  store.activate("fixture");
  service = new PiService(store, {
    dataDir: join(directory, "pi"),
    workspace: join(directory, "workspace"),
  });
});
afterEach(async () => {
  await service.dispose();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(directory, { recursive: true, force: true });
});
async function until<T>(fn: () => Promise<T>, accept: (value: T) => boolean) {
  const end = Date.now() + 7000;
  while (true) {
    const value = await fn();
    if (accept(value)) return value;
    if (Date.now() > end)
      throw new Error(`Integration timeout: ${JSON.stringify(value)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
function configure(exposure = "direct") {
  service.integrations.save({
    mcp: {
      mcpServers: {
        fixture: {
          command: process.execPath,
          args: [resolve("tests/fixtures/mcp-server.cjs")],
          env: { FIXTURE_LOG: join(directory, "calls.jsonl") },
          exposure,
        },
      },
    },
    skillPaths: [],
    disabledSkills: [],
  });
}
async function run(id: string, content = "Run fixture") {
  const supervisor = await service.supervisor();
  await supervisor.sendMessage(id, { content });
  return until(
    () => supervisor.getThread(id),
    (s) =>
      s.metadata.status !== "running" &&
      s.messages.some(
        (m) =>
          m.role === "assistant" &&
          JSON.stringify(m).includes("Fixture complete."),
      ),
  );
}
it("uses Pi native MCP tools and resources, preserves approvals, and hashes private arguments", async () => {
  configure();
  const supervisor = await service.supervisor();
  const { metadata } = await supervisor.createThread();
  actions = [
    { name: "mcp__fixture__read_echo", args: { text: "private mcp input" } },
    {
      name: "read_mcp_resource",
      args: { server: "fixture", uri: "fixture://readme" },
    },
    { name: "mcp__fixture__write_echo", args: { text: "approved mutation" } },
  ];
  await supervisor.sendMessage(metadata.id, { content: "Use MCP" });
  const pending = await until(
    () => supervisor.getThread(metadata.id),
    (s) => Boolean(s.hostUiRequests?.length),
  );
  expect(readFileSync(join(directory, "calls.jsonl"), "utf8")).not.toContain(
    "approved mutation",
  );
  await supervisor.respondToHostUiRequest(metadata.id, {
    requestId: pending.hostUiRequests![0].id,
    confirmed: true,
  });
  const done = await until(
    () => supervisor.getThread(metadata.id),
    (s) => s.metadata.status !== "running",
  );
  expect(JSON.stringify(done.messages)).toContain("Fixture resource content");
  expect(readFileSync(join(directory, "calls.jsonl"), "utf8")).toContain(
    "approved mutation",
  );
  expect(requests[0].tools.map((t: any) => t.function.name)).toContain(
    "mcp__fixture__read_echo",
  );
  const audit = readFileSync(join(directory, "pi", "audit.jsonl"), "utf8");
  expect(audit).toContain("approval-requested");
  expect(audit).not.toContain("private mcp input");
});
it("denies mutating MCP tools in read-only mode, including nested codemode calls", async () => {
  configure("codemode");
  const supervisor = await service.supervisor();
  const { metadata } = await supervisor.createThread();
  service.policy.setMode(metadata.id, "read-only");
  actions = [
    {
      name: "codemode",
      args: {
        code: 'const result = await tools.mcp__fixture__write_echo({text:"blocked mutation"}); text(result);',
      },
    },
  ];
  const done = await run(metadata.id);
  expect(JSON.stringify(done.messages)).toContain("Permission denied");
  expect(existsSync(join(directory, "calls.jsonl"))).toBe(false);
});
it("loads native Skills, permits their references, and expands /skill commands without exposing raw XML in tool calls", async () => {
  const skillDir = join(service.workspace, ".pi", "skills", "fixture-skill");
  mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, "SKILL.md");
  writeFileSync(
    path,
    "---\nname: fixture-skill\ndescription: Fixture task instructions\n---\nUse reference.txt for fixture context.",
  );
  writeFileSync(join(skillDir, "reference.txt"), "Skill reference content");
  const supervisor = await service.supervisor();
  const { metadata } = await supervisor.createThread();
  actions = [
    { name: "read", args: { path } },
    { name: "read", args: { path: join(skillDir, "reference.txt") } },
  ];
  const done = await run(metadata.id, "Use the fixture skill");
  expect(JSON.stringify(requests[0].messages)).toContain("available_skills");
  expect(JSON.stringify(done.messages)).toContain("Skill reference content");
  await run(metadata.id, "/skill:fixture-skill Explain this fixture");
  expect(JSON.stringify(requests.at(-1).messages)).toContain("<skill name=");
  expect(JSON.stringify(requests.at(-1).messages)).toContain(
    "Explain this fixture",
  );
  const linked = join(skillDir, "linked.txt");
  symlinkSync(join(directory, "providers.json"), linked);
  await expect(service.integrations.readSkill(linked)).rejects.toThrow(
    "Linked",
  );
  await expect(service.executor.writeFile(path, "overwrite")).rejects.toThrow(
    "protected",
  );
  await service.changeIntegrations(() =>
    service.integrations.save({
      ...service.integrations.config(),
      disabledSkills: ["fixture-skill"],
    }),
  );
  expect(
    (await service.integrationSnapshot()).skills.find(
      (s) => s.name === "fixture-skill",
    )?.enabled,
  ).toBe(false);
});
it("shares configuration across projects and requires explicit trust for installing plugins", async () => {
  const registry = new WorkspaceRegistry(store, {
    dataDir: join(directory, "global"),
    workspace: join(directory, "first"),
  });
  try {
    const first = registry.service();
    const extra = join(directory, "second");
    mkdirSync(extra);
    const second = registry.service(registry.add(extra).id);
    expect(first.integrations).toBe(second.integrations);
    await registry.changeIntegrations(() =>
      registry.integrations.save({
        mcp: {
          mcpServers: {
            docs: { url: "https://example.com/mcp", enabled: false },
          },
        },
        skillPaths: [],
        disabledSkills: [],
      }),
    );
    expect(second.integrations.config().mcp.mcpServers.docs.enabled).toBe(
      false,
    );
  } finally {
    await registry.dispose();
  }
  const app = createApp(store, { dataDir: join(directory, "api") });
  try {
    const response = await app.request("/api/plugins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "install", source: "npm:fixture" }),
    });
    expect(response.status).toBe(403);
  } finally {
    await app.dispose();
  }
});
it("installs, loads, disables, enables and removes a plugin through Pi's native package manager", async () => {
  writeFileSync(
    join(service.integrations.agentDir, "settings.json"),
    JSON.stringify({
      npmCommand: [process.execPath, resolve("tests/fixtures/npm-fixture.cjs")],
    }),
  );
  const supervisor = await service.supervisor();
  const { metadata } = await supervisor.createThread();
  const source = "npm:grimoire-fixture-plugin@1.0.0";
  const installed = await service.changePackage("install", source);
  expect(installed.packages).toContainEqual({ source, enabled: true });
  expect(installed.tools.map((t) => t.name)).toContain("fixture_plugin_echo");
  expect(installed.skills.map((t) => t.name)).toContain("plugin-fixture");
  actions = [{ name: "fixture_plugin_echo", args: {} }];
  const done = await run(metadata.id);
  expect(JSON.stringify(done.messages)).toContain("Native plugin executed");
  const disabled = await service.changePackage("disable", source);
  expect(disabled.packages).toContainEqual({ source, enabled: false });
  expect(disabled.tools.map((t) => t.name)).not.toContain(
    "fixture_plugin_echo",
  );
  const enabled = await service.changePackage("enable", source);
  expect(enabled.tools.map((t) => t.name)).toContain("fixture_plugin_echo");
  const removed = await service.changePackage("remove", source);
  expect(removed.packages).toEqual([]);
  expect(removed.tools.map((t) => t.name)).not.toContain("fixture_plugin_echo");
});
it("rejects invalid MCP and plugin sources and loads only explicitly configured external Skill directories", async () => {
  const integrations = new IntegrationStore(
    service.workspace,
    join(directory, "separate-agent"),
  );
  expect(() =>
    integrations.save({
      mcp: { mcpServers: { invalid: { url: "file:///etc/passwd" } } },
      skillPaths: [],
      disabledSkills: [],
    }),
  ).toThrow();
  await expect(
    integrations.packageAction("install", "npm:fixture; touch hacked"),
  ).rejects.toThrow();
  const skillDir = join(directory, "external-skills", "fixture");
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    "---\nname: fixture\ndescription: External fixture\n---\nFixture instructions",
  );
  integrations.save({
    mcp: { mcpServers: {} },
    skillPaths: [skillDir],
    disabledSkills: [],
  });
  await integrations.scan();
  expect(integrations.skillSnapshot().map((s) => s.name)).toEqual(["fixture"]);
  expect(
    (await integrations.readSkill(join(skillDir, "SKILL.md")))?.toString(),
  ).toContain("Fixture instructions");
  expect(
    await integrations.readSkill(join(directory, "providers.json")),
  ).toBeUndefined();
});

it("starts without a generated workspace while global integrations remain configurable", async () => {
  const dataDir = join(directory, "fresh-app");
  const app = createApp(store, { dataDir });
  try {
    expect(await (await app.request("/api/pi/workspaces")).json()).toEqual([]);
    expect(existsSync(join(dataDir, "workspace"))).toBe(false);
    const configured = await app.request("/api/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mcp: {
          mcpServers: {
            docs: { url: "https://example.com/mcp", enabled: false },
          },
        },
        skillPaths: [],
        disabledSkills: [],
      }),
    });
    expect(configured.status).toBe(200);
    expect((await configured.json()).config.mcp.mcpServers.docs.enabled).toBe(
      false,
    );
    expect(await (await app.request("/api/pi/workspaces")).json()).toEqual([]);
  } finally {
    await app.dispose();
  }
});
it("surfaces native MCP connection diagnostics", async () => {
  service.integrations.save({
    mcp: {
      mcpServers: {
        broken: {
          command: join(directory, "missing-mcp-executable"),
          exposure: "direct",
        },
      },
    },
    skillPaths: [],
    disabledSkills: [],
  });
  await (await service.supervisor()).createThread();
  const snapshot = await until(
    () => service.integrationSnapshot(),
    (s) => s.diagnostics.some((d) => /broken|ENOENT|spawn/.test(d.message)),
  );
  expect(snapshot.diagnostics.length).toBeGreaterThan(0);
});
