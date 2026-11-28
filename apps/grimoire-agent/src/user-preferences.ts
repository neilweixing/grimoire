import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  cacheCleanupDaysSchema,
  userPreferencesSchema,
  type UserPreferences,
} from "@grimoire/core";

export class UserPreferencesStore {
  constructor(
    readonly path = join(homedir(), ".grimoire", "config", "preferences.json"),
  ) {}
  private read(): Record<string, unknown> {
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Invalid user preferences file.");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (basename(dirname(this.path)) === "config") {
        const previous = join(dirname(dirname(this.path)), "preferences.json");
        if (existsSync(previous)) {
          const value = JSON.parse(readFileSync(previous, "utf8"));
          if (!value || typeof value !== "object" || Array.isArray(value))
            throw new Error("Invalid legacy user preferences file.");
          this.write(value);
          return value;
        }
      }
      let legacy = join(dirname(this.path), "browser-settings.json");
      if (!existsSync(legacy) && basename(dirname(this.path)) === "config")
        legacy = join(dirname(dirname(this.path)), "browser-settings.json");
      if (!existsSync(legacy)) return {};
      try {
        const value = JSON.parse(readFileSync(legacy, "utf8"));
        const migrated = {
          ignoreCertificateErrors: value?.ignoreCertificateErrors === true,
        };
        this.write(migrated);
        return migrated;
      } catch (error) {
        if (error instanceof SyntaxError) return {};
        throw error;
      }
    }
  }
  private write(value: Record<string, unknown>) {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    renameSync(temp, this.path);
  }
  get(): UserPreferences {
    const stored = this.read();
    return {
      appearance: stored.appearance === "dark" ? "dark" : "light",
      language: stored.language === "en" ? "en" : "zh",
      ignoreCertificateErrors: stored.ignoreCertificateErrors === true,
      cacheCleanupDays:
        cacheCleanupDaysSchema.safeParse(stored.cacheCleanupDays).data ?? 7,
    };
  }
  update(input: unknown): UserPreferences {
    const patch = userPreferencesSchema.partial().strict().parse(input);
    const stored = this.read();
    const next = { ...this.get(), ...patch };
    this.write({ ...stored, ...next });
    return next;
  }
}
