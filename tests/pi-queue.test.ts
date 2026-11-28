import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, it, vi } from "vitest";
import { PiService } from "../apps/grimoire-agent/src/pi-service";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { piRoutes } from "../apps/grimoire-agent/src/pi-routes";

it.each([false, true])(
  "delivers native steering and follow-ups without reloading a running session (Skills changed: %s)",
  async (skillChanges) => {
    const directory = mkdtempSync(join(tmpdir(), "grimoire-queue-"));
    const workspace = join(directory, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "source.txt"), "Read-only queue fixture.");
    const global = join(directory, "global", "fixture");
    mkdirSync(global, { recursive: true });
    writeFileSync(
      join(global, "SKILL.md"),
      "---\nname: fixture\ndescription: Fixture Skill\n---\nGlobal instructions",
    );
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const firstRequest = new Promise<void>((resolve) => {
      started = resolve;
    });
    const requests: Array<{
      messages: Array<{ role: string; content: unknown }>;
    }> = [];
    const server = createServer(async (request, response) => {
      let payload = "";
      for await (const chunk of request) payload += chunk;
      requests.push(JSON.parse(payload));
      const index = requests.length;
      if (index === 1) {
        started();
        await gate;
      }
      if (response.destroyed) return;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = {
        id: `fixture-${index}`,
        object: "chat.completion.chunk",
        created: 1,
        model: "queue-fixture",
      };
      const delta =
        index === 1
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "read-fixture",
                  type: "function",
                  function: {
                    name: "read",
                    arguments: JSON.stringify({ path: "source.txt" }),
                  },
                },
              ],
            }
          : { role: "assistant", content: `Finished response ${index}.` };
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
      );
      response.write(
        `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: index === 1 ? "tool_calls" : "stop" }] })}\n\n`,
      );
      response.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    let service: PiService | undefined;
    try {
      const settings = new SettingsStore(join(directory, "providers.json"));
      settings.save(
        {
          name: "Queue fixture",
          kind: "openai-compatible",
          model: "queue-fixture",
          baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
          apiKey: "fixture-only",
        },
        "fixture",
      );
      settings.activate("fixture");
      service = new PiService(settings, {
        workspace,
        dataDir: join(directory, "pi"),
        globalSkillRoot: join(directory, "global"),
      });
      const current = service;
      const supervisor = await current.supervisor();
      const { metadata } = await supervisor.createThread({
        title: "Queue behavior",
      });
      const app = piRoutes(() => current);
      const send = (
        content: string,
        streamingBehavior?: "followUp" | "steer",
      ) =>
        app.request(`/threads/${metadata.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: {
              content,
              ...(streamingBehavior ? { streamingBehavior } : {}),
            },
          }),
        });
      expect((await send("Start")).status).toBe(204);
      await firstRequest;
      const reload = vi.spyOn(supervisor, "reloadThread");
      if (skillChanges) {
        const projectSkill = join(workspace, ".agents", "skills", "fixture");
        mkdirSync(projectSkill, { recursive: true });
        writeFileSync(
          join(projectSkill, "SKILL.md"),
          "---\nname: fixture\ndescription: Fixture Skill\n---\nLate project instructions",
        );
        await current.availableSkills();
      }
      const later = "/skill:fixture   Later\n<skill>\nKeep XML\n</skill>  ";
      const now = "/skill:fixture  Now  ";
      expect((await send("/skill:fixture Discard me", "followUp")).status).toBe(
        204,
      );
      expect(
        (
          await app.request(`/threads/${metadata.id}/queue/clear`, {
            method: "POST",
          })
        ).status,
      ).toBe(200);
      expect((await send(later, "followUp")).status).toBe(204);
      expect((await send(now, "steer")).status).toBe(204);
      expect(reload).not.toHaveBeenCalled();
      expect(
        (await supervisor.getThread(metadata.id)).metadata.queuedMessages
          ?.map((item) => item.mode)
          .sort(),
      ).toEqual(["followUp", "steer"]);
      release();
      const deadline = Date.now() + 5000;
      while (
        requests.length < 3 ||
        (await supervisor.getThread(metadata.id)).metadata.status === "running"
      ) {
        if (Date.now() > deadline)
          throw new Error("Native queue did not settle");
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      const users = requests.map((request) =>
        request.messages
          .filter((message) => message.role === "user")
          .map((message) => JSON.stringify(message.content)),
      );
      expect(users[0]?.join()).toContain("Start");
      expect(users[1]?.join()).toContain("Now");
      expect(users[1]?.join()).not.toContain("Later");
      expect(
        requests[1]?.messages.some((message) => message.role === "tool"),
      ).toBe(true);
      expect(users[2]?.join()).toContain("Later");
      expect(
        (await supervisor.getThread(metadata.id)).metadata.queuedMessages ?? [],
      ).toHaveLength(0);
      const usersInSession = (
        await supervisor.getThread(metadata.id)
      ).messages.filter((m) => m.role === "user");
      expect(
        usersInSession.map(
          (m) => (m as { originalText?: string }).originalText,
        ),
      ).toEqual(["Start", now, later]);
      expect(JSON.stringify(requests)).not.toContain("originalText");
      expect(JSON.stringify(requests)).not.toContain("Discard me");
      if (skillChanges) {
        expect(JSON.stringify(usersInSession)).toContain("Global instructions");
        expect(JSON.stringify(usersInSession)).not.toContain(
          "Late project instructions",
        );
        expect((await send("/skill:fixture Next task")).status).toBe(204);
        await vi.waitFor(async () =>
          expect(
            (await supervisor.getThread(metadata.id)).metadata.status,
          ).toBe("idle"),
        );
        const last = (await supervisor.getThread(metadata.id)).messages
          .filter((m) => m.role === "user")
          .at(-1);
        expect(JSON.stringify(last)).toContain("Late project instructions");
        expect(reload).toHaveBeenCalledTimes(1);
      }
    } finally {
      release();
      await service?.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15000,
);
