import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/desktop.ts"],
  format: ["esm"],
  outDir: "dist",
  splitting: false,
  clean: true,
  noExternal: ["@grimoire/core"],
});
