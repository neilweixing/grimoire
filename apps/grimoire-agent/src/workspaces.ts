import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  realpathSync,
  statSync,
  rmSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve, relative, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { PiService, type PiServiceOptions } from "./pi-service.js";
import { PolicyError } from "./permissions.js";
import { SettingsStore } from "./settings.js";
import { IntegrationStore } from "./integrations.js";

const workspaceSchema = z.object({
  id: z.union([z.literal("default"), z.string().uuid()]),
  name: z.string().min(1).max(80),
  path: z.string().min(1),
});
export type Workspace = z.infer<typeof workspaceSchema>;

/** Each registered folder owns its session store, policy state, and executor. */
export class WorkspaceRegistry {
  readonly integrations: IntegrationStore;
  private updatingIntegrations = false;
  private entries: Workspace[];
  private readonly services = new Map<string, PiService>();
  private readonly removing = new Set<string>();
  private readonly dataDir: string;
  private readonly path: string;
  constructor(
    private readonly settings: SettingsStore,
    private readonly options: PiServiceOptions = {},
  ) {
    this.dataDir = resolve(
      options.dataDir ??
        fileURLToPath(new URL("../../../.data/pi", import.meta.url)),
    );
    mkdirSync(this.dataDir, { recursive: true, mode: 0o700 });
    const integrationDir = join(this.dataDir, "integrations");
    this.integrations = new IntegrationStore(
      integrationDir,
      integrationDir,
      options.globalSkillRoot,
    );
    this.path = join(this.dataDir, "workspaces.json");
    try {
      this.entries = z
        .array(workspaceSchema)
        .parse(JSON.parse(readFileSync(this.path, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const configuredRoot =
        options.executor?.root ??
        options.workspace ??
        process.env.GRIMOIRE_WORKSPACE;
      const root = configuredRoot ? resolve(configuredRoot) : undefined;
      if (root) mkdirSync(root, { recursive: true, mode: 0o700 });
      this.entries = root
        ? [
            {
              id: "default",
              name: basename(root) || "Grimoire",
              path: realpathSync(root),
            },
          ]
        : [];
      writeFileSync(this.path, JSON.stringify(this.entries, null, 2), {
        mode: 0o600,
      });
    }
  }
  list() {
    return this.entries.map((entry) => ({ ...entry }));
  }
  private persist(entries: Workspace[]) {
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(entries, null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
    this.entries = entries;
  }
  add(path: string, name?: string): Workspace {
    if (!isAbsolute(path))
      throw new PolicyError("Enter an absolute folder path.");
    let canonical: string;
    try {
      canonical = realpathSync(path);
      if (!statSync(canonical).isDirectory()) throw new Error();
    } catch {
      throw new PolicyError("The folder does not exist or is unavailable.");
    }
    const existing = this.entries.find((entry) => entry.path === canonical);
    if (existing) {
      if (this.removing.has(existing.id))
        throw new PolicyError("Project deletion is in progress.");
      return existing;
    }
    const statePath = relative(realpathSync(this.dataDir), canonical);
    if (
      !statePath ||
      [
        "agent",
        "integrations",
        "workspaces",
        "metrics",
        "titles",
        "imports",
      ].some(
        (name) => statePath === name || statePath.startsWith(`${name}${sep}`),
      )
    )
      throw new PolicyError(
        "Agent state directories cannot be project folders.",
      );
    const entry = workspaceSchema.parse({
      id: randomUUID(),
      path: canonical,
      name: name?.trim() || basename(canonical) || "Workspace",
    });
    const next = [...this.entries, entry];
    this.persist(next);
    return entry;
  }
  rename(id: string, name: string) {
    const entry = this.entries.find((entry) => entry.id === id);
    if (!entry || this.removing.has(id))
      throw new PolicyError("Workspace not found or unavailable.");
    const updated = workspaceSchema.parse({ ...entry, name: name.trim() });
    this.persist(
      this.entries.map((entry) => (entry.id === id ? updated : entry)),
    );
    return updated;
  }
  async remove(id: string) {
    if (!this.entries.some((entry) => entry.id === id) || this.removing.has(id))
      throw new PolicyError("Workspace not found or unavailable.");
    this.removing.add(id);
    try {
      await this.services.get(id)?.dispose();
      this.services.delete(id);
      // Remove application-owned state only. The registered source folder is retained.
      if (id === "default") {
        for (const name of [
          "agent",
          "metrics",
          "titles",
          "imports",
          "shell",
          "audit.jsonl",
          "permissions.json",
        ])
          rmSync(join(this.dataDir, name), { recursive: true, force: true });
      } else
        rmSync(join(this.dataDir, "workspaces", id), {
          recursive: true,
          force: true,
        });
      this.persist(this.entries.filter((entry) => entry.id !== id));
    } finally {
      this.removing.delete(id);
    }
  }
  service(id = "default") {
    if (this.removing.has(id))
      throw new PolicyError("Project deletion is in progress.");
    const entry = this.entries.find((entry) => entry.id === id);
    if (!entry) throw new PolicyError("Workspace not found.");
    // Never silently recreate a registered project folder that was moved or deleted.
    try {
      if (
        realpathSync(entry.path) !== entry.path ||
        !statSync(entry.path).isDirectory()
      )
        throw new Error();
    } catch {
      throw new PolicyError("The workspace folder is unavailable.");
    }
    let service = this.services.get(id);
    if (!service) {
      service = new PiService(this.settings, {
        ...this.options,
        integrations: this.integrations,
        integrationsUpdating: () => this.updatingIntegrations,
        workspace: entry.path,
        executor: id === "default" ? this.options.executor : undefined,
        dataDir:
          id === "default"
            ? this.dataDir
            : join(this.dataDir, "workspaces", id),
      });
      this.services.set(id, service);
    }
    return service;
  }
  syncProviders() {
    for (const service of this.services.values()) service.syncProviders();
  }
  async integrationSnapshot() {
    await this.integrations.scan();
    const snapshots = await Promise.all(
      [...this.services.values()].map((service) =>
        service.integrationSnapshot(),
      ),
    );
    const tools = new Map(
      snapshots.flatMap((s) => s.tools).map((tool) => [tool.name, tool]),
    );
    return {
      config: this.integrations.config(),
      skills: this.integrations.skillSnapshot(),
      diagnostics: [
        ...this.integrations.issues(),
        ...snapshots.flatMap((s) => s.diagnostics),
      ],
      packages: await this.integrations.listPackages(),
      tools: [...tools.values()],
      pendingReloads: snapshots.reduce(
        (total, s) => total + s.pendingReloads,
        0,
      ),
    };
  }
  async changeIntegrations(
    action: () => Promise<void> | void,
    packageChange = false,
  ) {
    if (this.updatingIntegrations)
      throw new PolicyError("An integration update is already in progress.");
    if (
      packageChange &&
      [...this.services.values()].some((s) => s.integrationBusy())
    )
      throw new PolicyError("Stop running tasks before changing plugins.");
    this.updatingIntegrations = true;
    try {
      await action();
      for (const service of this.services.values())
        await service.changeIntegrations(() => {});
      return await this.integrationSnapshot();
    } finally {
      this.updatingIntegrations = false;
    }
  }
  async dispose() {
    for (const service of this.services.values()) await service.dispose();
  }
}
