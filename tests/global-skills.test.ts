import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceRegistry } from "../apps/grimoire-agent/src/workspaces";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { IntegrationStore } from "../apps/grimoire-agent/src/integrations";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grimoire-global-skills-"));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));
const skill = (
  root: string,
  name: string,
  content = "Fixture instructions",
) => {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(
    path,
    `---\nname: ${name}\ndescription: Fixture skill\n---\n${content}`,
  );
  return path;
};
const create = (workspace = "workspace") => {
  const root = join(directory, workspace);
  mkdirSync(root, { recursive: true });
  return new IntegrationStore(
    root,
    join(directory, "integrations"),
    join(directory, "home", ".agents"),
  );
};

describe("global Skills", () => {
  it("defaults to the real user .agents directory without creating it", () => {
    const integrations = new IntegrationStore(
      directory,
      join(directory, "default-integrations"),
    );
    expect(integrations.globalSkillRoot).toBe(join(homedir(), ".agents"));
    expect(integrations.config()).not.toHaveProperty("loadGlobalSkills");
  });

  it("loads nested global Skills by default for every workspace", async () => {
    const global = skill(
      join(directory, "home", ".agents", "skills"),
      "global-fixture",
    );
    const first = create("one");
    const second = create("two");
    await first.scan();
    await second.scan();
    expect(first.skillSnapshot().map((item) => item.name)).toContain(
      "global-fixture",
    );
    expect(second.skillSnapshot().map((item) => item.name)).toContain(
      "global-fixture",
    );
    expect((await first.readSkill(global))?.toString()).toContain(
      "Fixture instructions",
    );
  });

  it("persists per-Skill disable choices without changing files or custom Skills", async () => {
    const global = skill(
      join(directory, "home", ".agents", "skills"),
      "global-fixture",
    );
    const custom = skill(join(directory, "external"), "custom-fixture");
    const integrations = create();
    integrations.save({ ...integrations.config(), skillPaths: [custom] });
    await integrations.scan();
    expect(await integrations.readSkill(global)).toBeDefined();
    integrations.save({
      ...integrations.config(),
      disabledSkills: ["global-fixture"],
    });
    await integrations.scan();
    expect(
      integrations
        .skillSnapshot()
        .find((item) => item.name === "global-fixture")?.enabled,
    ).toBe(false);
    expect(
      integrations
        .skillSnapshot()
        .find((item) => item.name === "custom-fixture")?.enabled,
    ).toBe(true);
    expect(await integrations.readSkill(global)).toBeUndefined();
    expect(integrations.readRoots()).not.toContain(
      join(directory, "home", ".agents", "skills", "global-fixture"),
    );
    expect(readFileSync(global, "utf8")).toContain("Fixture instructions");
    const reopened = create();
    await reopened.scan();
    expect(
      reopened.skillSnapshot().find((item) => item.name === "global-fixture")
        ?.enabled,
    ).toBe(false);
    expect(await reopened.readSkill(global)).toBeUndefined();
    reopened.save({ ...reopened.config(), disabledSkills: [] });
    await reopened.scan();
    expect(
      reopened.skillSnapshot().find((item) => item.name === "global-fixture")
        ?.enabled,
    ).toBe(true);
    expect(await reopened.readSkill(global)).toBeDefined();
  });

  it("prefers a project Skill over a same-named global Skill", async () => {
    const integrations = create();
    skill(
      join(directory, "home", ".agents", "skills"),
      "shared-fixture",
      "Global content",
    );
    const local = skill(
      join(integrations.workspace, ".agents", "skills"),
      "shared-fixture",
      "Project content",
    );
    await integrations.scan();
    expect(
      integrations
        .skillSnapshot()
        .filter((item) => item.name === "shared-fixture"),
    ).toHaveLength(1);
    expect(integrations.skillSnapshot()[0]?.filePath).toBe(local);
  });

  it("loads global Skills with legacy preferences and tolerates a missing folder", async () => {
    const integrations = create();
    expect(existsSync(integrations.globalSkillRoot)).toBe(false);
    await integrations.scan();
    expect(integrations.skillSnapshot()).toEqual([]);
    writeFileSync(
      join(integrations.agentDir, "grimoire-integrations.json"),
      JSON.stringify({ skillPaths: [], disabledSkills: [] }),
    );
    const reopened = create();
    expect(reopened.config()).not.toHaveProperty("loadGlobalSkills");
    skill(join(directory, "home", ".agents", "skills"), "late-global-fixture");
    await reopened.scan();
    expect(reopened.skillSnapshot().map((item) => item.name)).toContain(
      "late-global-fixture",
    );
  });
});

it("uses the same project Skill in the picker and native Pi commands with shared integrations", async () => {
  const global = join(directory, "global");
  skill(join(global, "skills"), "same-name", "Global instructions");
  const project = join(directory, "project");
  const other = join(directory, "other");
  mkdirSync(project);
  mkdirSync(other);
  const first = skill(
    join(project, ".agents", "skills"),
    "same-name",
    "Project instructions",
  );
  const second = skill(
    join(other, ".agents", "skills"),
    "same-name",
    "Other project instructions",
  );
  const registry = new WorkspaceRegistry(
    new SettingsStore(join(directory, "providers.json")),
    {
      dataDir: join(directory, "data"),
      workspace: project,
      globalSkillRoot: global,
    },
  );
  try {
    const registered = registry.add(other, "Other");
    for (const [id, expected, content] of [
      ["default", first, "Project instructions"],
      [registered.id, second, "Other project instructions"],
      ["default", first, "Project instructions"],
    ]) {
      const service = registry.service(id);
      const choices = await service.availableSkills();
      const chosen = choices.find((value) => value.name === "same-name")!;
      expect(chosen.filePath.replace(/^\/var\//, "/private/var/")).toBe(
        expected.replace(/^\/var\//, "/private/var/"),
      );
      const supervisor = await service.supervisor();
      const current = await supervisor.createThread();
      await supervisor.sendMessage(current.metadata.id, {
        content: "/skill:same-name Task",
      });
      const end = Date.now() + 5000;
      while (
        (await supervisor.getThread(current.metadata.id)).metadata.status ===
        "running"
      ) {
        if (Date.now() > end) throw new Error("Skill fixture did not settle");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const snapshot = await supervisor.getThread(current.metadata.id);
      const user = JSON.stringify(
        snapshot.messages.find((message) => message.role === "user"),
      );
      expect(user).toContain(content);
      expect(user).not.toContain("Global instructions");
    }
  } finally {
    await registry.dispose();
  }
});

it.each([true, false])(
  "refreshes opened native sessions after project Skills change (picker opened: %s)",
  async (openPicker) => {
    const global = join(directory, "global");
    skill(join(global, "skills"), "same-name", "Global instructions");
    const project = join(directory, "project");
    mkdirSync(project);
    const registry = new WorkspaceRegistry(
      new SettingsStore(join(directory, "providers.json")),
      {
        dataDir: join(directory, "data"),
        workspace: project,
        globalSkillRoot: global,
      },
    );
    try {
      const service = registry.service("default");
      const supervisor = await service.supervisor();
      const first = await supervisor.createThread();
      const second = await supervisor.createThread();
      const reload = vi.spyOn(supervisor, "reloadThread");
      await service.prepareIntegrations(first.metadata.id);
      await service.prepareIntegrations(first.metadata.id);
      expect(reload).not.toHaveBeenCalled();
      const local = skill(
        join(project, ".agents", "skills"),
        "same-name",
        "Late project instructions",
      );
      if (openPicker)
        expect(
          (await service.availableSkills()).find((s) => s.name === "same-name")
            ?.filePath,
        ).toContain("project/.agents/skills/same-name");
      const send = async (id: string, content: string) => {
        await service.prepareIntegrations(id);
        await supervisor.sendMessage(id, { content });
        const deadline = Date.now() + 5000;
        while ((await supervisor.getThread(id)).metadata.status === "running") {
          if (Date.now() > deadline)
            throw new Error("Skill fixture did not settle");
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return (await supervisor.getThread(id)).messages
          .filter((m) => m.role === "user")
          .at(-1);
      };
      for (const current of [first, second]) {
        const user = JSON.stringify(
          await send(current.metadata.id, "/skill:same-name Task"),
        );
        expect(user).toContain("Late project instructions");
        expect(user).not.toContain("Global instructions");
      }
      expect(reload).toHaveBeenCalledTimes(2);
      await service.prepareIntegrations(second.metadata.id);
      expect(reload).toHaveBeenCalledTimes(2);
      rmSync(local);
      expect(
        JSON.stringify(
          await send(first.metadata.id, "/skill:same-name Next task"),
        ),
      ).toContain("Global instructions");
      const snapshot = await supervisor.getThread(first.metadata.id);
      expect(snapshot.messages.filter((m) => m.role === "user")).toHaveLength(
        2,
      );
    } finally {
      await registry.dispose();
    }
  },
);
