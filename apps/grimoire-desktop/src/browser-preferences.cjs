const { readFileSync, writeFileSync, renameSync } = require("node:fs");

class BrowserPreferences {
  constructor(path) {
    this.path = path;
    this.ignoreCertificateErrors = false;
    try {
      this.ignoreCertificateErrors =
        JSON.parse(readFileSync(path, "utf8"))?.ignoreCertificateErrors ===
        true;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
  }
  applyIgnoreCertificateErrors(value) {
    if (typeof value !== "boolean")
      throw new Error("Invalid certificate preference.");
    const changed = this.ignoreCertificateErrors !== value;
    this.ignoreCertificateErrors = value;
    return changed;
  }
  setIgnoreCertificateErrors(value) {
    if (typeof value !== "boolean")
      throw new Error("Invalid certificate preference.");
    let current = {};
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      if (value && typeof value === "object" && !Array.isArray(value))
        current = value;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError))
        throw error;
    }
    const temp = `${this.path}.tmp`;
    writeFileSync(
      temp,
      JSON.stringify({ ...current, ignoreCertificateErrors: value }, null, 2),
      { mode: 0o600 },
    );
    renameSync(temp, this.path);
    this.ignoreCertificateErrors = value;
  }
}
module.exports = { BrowserPreferences };
