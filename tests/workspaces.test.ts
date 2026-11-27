import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WorkspaceRegistry } from "../apps/grimoire-agent/src/workspaces";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { piRoutes } from "../apps/grimoire-agent/src/pi-routes";
import { createApp } from "../apps/grimoire-agent/src/app";

let directory: string;
let registry: WorkspaceRegistry;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-workspaces-"));
  registry = new WorkspaceRegistry(
    new SettingsStore(join(directory, "providers.json")),
    {
      dataDir: join(directory, "data"),
      workspace: join(directory, "project-a"),
    },
  );
});
afterEach(async () => {
  await registry.dispose();
  rmSync(directory, { recursive: true, force: true });
});
it("binds each session to a registered folder and refuses cross-workspace thread access", async () => {
  const projectB = join(directory, "project-b");
  mkdirSync(projectB);
  const second = registry.add(projectB);
  expect(registry.add(`${projectB}/.`).id).toBe(second.id);
  const firstService = registry.service("default");
  const secondService = registry.service(second.id);
  await firstService.executor.writeFile("source.ts", "project A");
  await secondService.executor.writeFile("source.ts", "project B");
  const firstId = await firstService.importConversation({
    id: crypto.randomUUID(),
    title: "Project A chat",
    messages: [
      {
        id: "user",
        role: "user",
        status: "complete",
        content: [{ type: "text", text: "Project A" }],
      },
      {
        id: "assistant",
        role: "assistant",
        status: "complete",
        content: [{ type: "text", text: "Ready" }],
      },
    ],
  });
  const routes = piRoutes((id) => registry.service(id));
  const inWorkspace = (id: string) => ({
    headers: { "X-Grimoire-Workspace": id },
  });
  expect(
    (await routes.request(`/threads/${firstId}`, inWorkspace("default")))
      .status,
  ).toBe(200);
  expect(
    (await routes.request(`/threads/${firstId}`, inWorkspace(second.id)))
      .status,
  ).toBe(404);
  expect(
    await (await routes.request("/threads", inWorkspace(second.id))).json(),
  ).toEqual([]);
  const snapshot = await (await firstService.supervisor()).getThread(firstId);
  expect(snapshot.metadata.workspacePath).toBe(firstService.executor.root);
  expect((await firstService.executor.readFile("source.ts")).toString()).toBe(
    "project A",
  );
  expect((await secondService.executor.readFile("source.ts")).toString()).toBe(
    "project B",
  );
  await expect(
    firstService.executor.readFile(join(secondService.workspace, "source.ts")),
  ).rejects.toThrow("outside");
  const override = await routes.request("/threads", {
    method: "POST",
    headers: {
      ...inWorkspace(second.id).headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ workspacePath: firstService.workspace }),
  });
  expect(override.status).toBe(403);
});
it("persists folder registration and rejects missing folders and unknown workspace IDs", () => {
  const projectB = join(directory, "project-b");
  mkdirSync(projectB);
  const second = registry.add(projectB);
  const reopened = new WorkspaceRegistry(
    new SettingsStore(join(directory, "providers.json")),
    {
      dataDir: join(directory, "data"),
      workspace: join(directory, "project-a"),
    },
  );
  expect(reopened.list().find((entry) => entry.id === second.id)?.path).toBe(
    second.path,
  );
  expect(() => registry.add("relative/path")).toThrow("absolute");
  expect(() => registry.add(join(directory, "missing"))).toThrow(
    "does not exist",
  );
  expect(() => registry.service("unknown")).toThrow("not found");
  rmSync(projectB, { recursive: true });
  expect(() => registry.service(second.id)).toThrow("unavailable");
});
it("registers project folders through the namespaced API", async () => {
  const app = createApp(new SettingsStore(join(directory, "providers.json")), {
    dataDir: join(directory, "data"),
    workspace: join(directory, "project-a"),
  });
  const folder = join(directory, "api-project");
  mkdirSync(folder);
  const response = await app.request("/api/pi/workspaces", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: folder, name: "Named project" }),
  });
  expect(response.status).toBe(201);
  const created = await response.json();
  expect(created.name).toBe("Named project");
  const renamed = await app.request(`/api/pi/workspaces/${created.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Renamed project" }),
  });
  expect((await renamed.json()).name).toBe("Renamed project");
  const listing = await app.request("/api/pi/workspaces");
  expect(
    (await listing.json()).some(
      (workspace: { id: string }) => workspace.id === created.id,
    ),
  ).toBe(true);
  expect(
    (
      await app.request("/api/pi/threads", {
        headers: { "X-Grimoire-Workspace": "unregistered" },
      })
    ).status,
  ).toBe(403);
  writeFileSync(join(folder, "code.ts"), "export const value = 1;");
  const removed = await app.request(`/api/pi/workspaces/${created.id}`, {
    method: "DELETE",
  });
  expect(removed.status).toBe(200);
  expect(readFileSync(join(folder, "code.ts"), "utf8")).toContain("value");
  expect(
    (await (await app.request("/api/pi/workspaces")).json()).some(
      (entry: { id: string }) => entry.id === created.id,
    ),
  ).toBe(false);
});

it("deletes project chats and metadata, preserves code and other projects, and supports deleting the last project", async () => {
  const otherPath = join(directory, "other-project");
  mkdirSync(otherPath);
  const other = registry.add(otherPath);
  const legacy = () => ({
    id: crypto.randomUUID(),
    title: "Saved chat",
    messages: [
      {
        id: "user",
        role: "user" as const,
        status: "complete" as const,
        content: [{ type: "text" as const, text: "Task" }],
      },
      {
        id: "assistant",
        role: "assistant" as const,
        status: "complete" as const,
        content: [{ type: "text" as const, text: "Done" }],
      },
    ],
  });
  const first = registry.service("default");
  const second = registry.service(other.id);
  const firstId = await first.importConversation(legacy());
  const secondId = await second.importConversation(legacy());
  await first.executor.writeFile("code.ts", "project A");
  await second.executor.writeFile("code.ts", "project B");
  registry.rename(other.id, "Renamed");
  expect(registry.list().find((entry) => entry.id === other.id)?.path).toBe(
    other.path,
  );
  await registry.remove("default");
  expect(() => registry.service("default")).toThrow("not found");
  expect(existsSync(join(directory, "data", "agent"))).toBe(false);
  expect(readFileSync(join(directory, "project-a", "code.ts"), "utf8")).toBe(
    "project A",
  );
  expect(
    (await (await second.supervisor()).getThread(secondId)).metadata.title,
  ).toBe("Saved chat");
  expect(firstId).not.toBe(secondId);
  await registry.remove(other.id);
  expect(registry.list()).toEqual([]);
  expect(existsSync(join(directory, "data", "workspaces", other.id))).toBe(
    false,
  );
  expect(readFileSync(join(other.path, "code.ts"), "utf8")).toBe("project B");
  const reopened = new WorkspaceRegistry(
    new SettingsStore(join(directory, "providers.json")),
    {
      dataDir: join(directory, "data"),
      workspace: join(directory, "project-a"),
    },
  );
  expect(reopened.list()).toEqual([]);
});
