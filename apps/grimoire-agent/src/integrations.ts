import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  realpathSync,
  statSync,
} from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import {
  DefaultPackageManager,
  SettingsManager,
  loadSkills,
  type Skill,
  type ResourceDiagnostic,
} from "@earendil-works/pi-coding-agent";
import type { IntegrationConfig, PluginCatalog } from "@grimoire/core";
import { PolicyError } from "./permissions.js";

const exposure = z.enum([
  "direct",
  "deferred",
  "codemode",
  "hidden",
  "codemode-deferred",
]);
const serverSchema = z
  .object({
    command: z.string().min(1).max(4096).optional(),
    args: z.array(z.string().max(8192)).max(200).optional(),
    env: z.record(z.string(), z.string().max(8192)).optional(),
    cwd: z.string().max(4096).optional(),
    url: z.url({ protocol: /^https?$/ }).optional(),
    headers: z.record(z.string(), z.string().max(8192)).optional(),
    enabled: z.boolean().optional(),
    exposure: exposure.optional(),
    toolExposure: z.record(z.string(), exposure).optional(),
    timeout: z.number().positive().max(600).optional(),
  })
  .passthrough()
  .refine(
    (v) => Boolean(v.command) !== Boolean(v.url),
    "Each MCP server needs either command or url.",
  );
export const integrationConfigSchema = z
  .object({
    mcp: z
      .object({
        mcpServers: z.record(
          z.string().regex(/^[a-zA-Z0-9_-]+$/),
          serverSchema,
        ),
        autoEnableCodemode: z.boolean().optional(),
      })
      .strict(),
    skillPaths: z.array(z.string().trim().min(1).max(4096)).max(50),
    disabledSkills: z.array(z.string().min(1).max(64)).max(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    const names = Object.keys(v.mcp.mcpServers).map((n) =>
      n.replace(/-/g, "_"),
    );
    if (new Set(names).size !== names.length)
      ctx.addIssue({
        code: "custom",
        message: "MCP server names must have distinct namespaces.",
      });
  });
const packageSourceSchema = z
  .string()
  .regex(
    /^npm:(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9._^~+-]+)?$/,
  );
const within = (root: string, path: string) => {
  const local = relative(root, path);
  return local !== ".." && !local.startsWith(`..${sep}`) && !isAbsolute(local);
};

export class IntegrationStore {
  readonly nativeSettings: SettingsManager;
  readonly packages: DefaultPackageManager;
  private skills: Skill[] = [];
  private readonly skillRoots = new Map<string, string>();
  private diagnostics: ResourceDiagnostic[] = [];
  private readonly preferencesPath: string;
  private readonly mcpPath: string;
  private preferences: { skillPaths: string[]; disabledSkills: string[] };
  constructor(
    readonly workspace: string,
    readonly agentDir: string,
  ) {
    mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    this.preferencesPath = join(agentDir, "grimoire-integrations.json");
    this.mcpPath = join(agentDir, "mcp.json");
    this.preferences = this.read(this.preferencesPath, {
      skillPaths: [],
      disabledSkills: [],
    });
    this.nativeSettings = SettingsManager.create(workspace, agentDir, {
      projectTrusted: false,
    });
    this.packages = new DefaultPackageManager({
      cwd: workspace,
      agentDir,
      settingsManager: this.nativeSettings,
      commandOutput: "capture",
    });
  }
  private read<T>(path: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(path, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return fallback;
    }
  }
  private write(path: string, value: unknown) {
    const temp = `${path}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temp, path);
  }
  config(): IntegrationConfig {
    return structuredClone({
      mcp: this.read(this.mcpPath, { mcpServers: {} }),
      ...this.preferences,
    });
  }
  save(input: unknown) {
    const config = integrationConfigSchema.parse(input);
    for (const path of config.skillPaths) {
      const full = this.resolve(path);
      if (
        !existsSync(full) ||
        (!statSync(full).isDirectory() && !statSync(full).isFile())
      )
        throw new PolicyError("A configured skill path is unavailable.");
    }
    this.write(this.mcpPath, config.mcp);
    this.preferences = {
      skillPaths: config.skillPaths,
      disabledSkills: config.disabledSkills,
    };
    this.write(this.preferencesPath, this.preferences);
  }
  resolve(path: string) {
    return resolve(
      this.workspace,
      path.startsWith("~/") ? join(homedir(), path.slice(2)) : path,
    );
  }
  selectSkills(base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) {
    const paths = [
      join(this.agentDir, "skills"),
      join(this.workspace, ".pi", "skills"),
      join(this.workspace, ".agents", "skills"),
      ...this.preferences.skillPaths.map((p) => this.resolve(p)),
    ].filter(existsSync);
    const extra = loadSkills({
      cwd: this.workspace,
      agentDir: this.agentDir,
      skillPaths: paths,
      includeDefaults: false,
    });
    const byName = new Map<string, Skill>();
    const nativeSkills = base.skills.filter(
      (s) =>
        within(this.workspace, s.filePath) || within(this.agentDir, s.filePath),
    );
    for (const skill of [...extra.skills, ...nativeSkills])
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    this.skills = [...byName.values()];
    this.skillRoots.clear();
    for (const skill of this.skills) {
      try {
        this.skillRoots.set(skill.name, realpathSync(skill.baseDir));
      } catch {}
    }
    this.diagnostics = [...base.diagnostics, ...extra.diagnostics];
    return {
      skills: this.skills.filter(
        (s) => !this.preferences.disabledSkills.includes(s.name),
      ),
      diagnostics: this.diagnostics,
    };
  }
  skillSnapshot() {
    return this.skills.map((s) => ({
      name: s.name,
      description: s.description,
      filePath: s.filePath,
      enabled: !this.preferences.disabledSkills.includes(s.name),
      modelInvocable: !s.disableModelInvocation,
    }));
  }
  async scan() {
    await this.nativeSettings.reload();
    const resources = await this.packages.resolve(async () => "skip");
    const loaded = loadSkills({
      cwd: this.workspace,
      agentDir: this.agentDir,
      skillPaths: resources.skills.filter((r) => r.enabled).map((r) => r.path),
      includeDefaults: false,
    });
    this.selectSkills(loaded);
  }
  issues() {
    return this.diagnostics.map(({ path, message }) => ({ path, message }));
  }
  readRoots() {
    return this.skills
      .filter((s) => !this.preferences.disabledSkills.includes(s.name))
      .flatMap((s) => {
        try {
          const pinned = this.skillRoots.get(s.name);
          return pinned && realpathSync(s.baseDir) === pinned ? [pinned] : [];
        } catch {
          return [];
        }
      });
  }
  async skillPath(path: string) {
    const requested = this.resolve(path);
    for (const skill of this.skills) {
      if (this.preferences.disabledSkills.includes(skill.name)) continue;
      const root = this.skillRoots.get(skill.name);
      if (!root) continue;
      const logical = resolve(skill.baseDir);
      const absolute = within(logical, requested)
        ? join(root, relative(logical, requested))
        : requested;
      if (!within(root, absolute)) continue;
      if (realpathSync(logical) !== root)
        throw new PolicyError("The skill folder changed.");
      let current = root;
      for (const part of relative(root, absolute).split(sep).filter(Boolean)) {
        if (
          [
            ".git",
            ".env",
            ".ssh",
            ".aws",
            ".data",
            ".npmrc",
            "credentials.json",
          ].includes(part) ||
          part.startsWith(".env.") ||
          /\.(pem|key)$/i.test(part)
        )
          throw new PolicyError("This skill resource is protected.");
        current = join(current, part);
        const info = await lstat(current);
        if (
          info.isSymbolicLink() ||
          (info.isFile() && info.nlink > 1) ||
          (!info.isDirectory() && !info.isFile())
        )
          throw new PolicyError(
            "Linked or special skill resources are not allowed.",
          );
      }
      if (realpathSync(root) !== root)
        throw new PolicyError("The skill folder changed.");
      return absolute;
    }
    return undefined;
  }
  async readSkill(path: string) {
    const safe = await this.skillPath(path);
    if (!safe) return undefined;
    if ((await lstat(safe)).size > 8 * 1024 * 1024)
      throw new PolicyError("Skill resource exceeds the read limit.");
    return readFile(safe);
  }
  async listPackages() {
    await this.nativeSettings.reload();
    return this.nativeSettings.getPackages().map((p) => ({
      source: typeof p === "string" ? p : p.source,
      enabled:
        typeof p === "string" ||
        p.extensions?.length !== 0 ||
        p.skills?.length !== 0,
    }));
  }
  async packageAction(
    action: "install" | "remove" | "enable" | "disable",
    source: string,
  ) {
    source = packageSourceSchema.parse(source);
    await this.nativeSettings.reload();
    if (action === "install") await this.packages.installAndPersist(source);
    else if (action === "remove") await this.packages.removeAndPersist(source);
    else {
      const current = this.nativeSettings.getPackages();
      if (
        !current.some((p) => (typeof p === "string" ? p : p.source) === source)
      )
        throw new PolicyError("Package not found.");
      this.nativeSettings.setPackages(
        current.map((p) =>
          (typeof p === "string" ? p : p.source) !== source
            ? p
            : action === "enable"
              ? source
              : { source, extensions: [], skills: [], prompts: [], themes: [] },
        ),
      );
    }
    await this.nativeSettings.flush();
  }
}

export async function searchPlugins(
  query: string,
  offset = 0,
): Promise<PluginCatalog> {
  const url = new URL("https://registry.npmjs.org/-/v1/search");
  url.search = new URLSearchParams({
    text: `keywords:pi-package ${query}`,
    size: "24",
    from: String(offset),
  }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("The Pi package catalog is unavailable.");
  const body = (await response.json()) as {
    total: number;
    objects: {
      package: { name: string; description?: string; version: string };
    }[];
  };
  return {
    total: body.total,
    packages: body.objects.map(({ package: p }) => ({
      name: p.name,
      description: p.description || "",
      version: p.version,
      url: `https://www.npmjs.com/package/${encodeURIComponent(p.name)}`,
    })),
  };
}
