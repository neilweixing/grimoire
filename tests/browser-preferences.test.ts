import { createRequire } from "node:module";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
const require = createRequire(import.meta.url);
const {
  BrowserPreferences,
} = require("../apps/grimoire-desktop/src/browser-preferences.cjs");
const directories: string[] = [];
const fixture = () => {
  const directory = mkdtempSync(join(tmpdir(), "grimoire-browser-prefs-"));
  directories.push(directory);
  return join(directory, "browser-settings.json");
};
afterEach(() => {
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});
it("defaults to verification and persists only an explicit boolean", () => {
  const path = fixture();
  const store = new BrowserPreferences(path);
  expect(store.ignoreCertificateErrors).toBe(false);
  store.setIgnoreCertificateErrors(true);
  expect(new BrowserPreferences(path).ignoreCertificateErrors).toBe(true);
  expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(() => store.setIgnoreCertificateErrors("true")).toThrow();
  store.setIgnoreCertificateErrors(false);
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
    ignoreCertificateErrors: false,
  });
});
it.each(["invalid", "null", '{"ignoreCertificateErrors":"true"}'])(
  "keeps verification for malformed preferences",
  (value) => {
    const path = fixture();
    writeFileSync(path, value);
    expect(new BrowserPreferences(path).ignoreCertificateErrors).toBe(false);
  },
);
