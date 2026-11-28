import { describe, expect, it } from "vitest";
import {
  formatToolOutput,
  presentToolInput,
} from "../apps/grimoire-web/src/tool-presentation";

describe("tool presentation", () => {
  it("shows shell commands as terminal input without JSON quoting", () => {
    expect(presentToolInput("bash", { command: "printf 'hello\\n'" })).toEqual({
      shell: true,
      summary: "printf 'hello\\n'",
      input: "$ printf 'hello\\n'",
    });
  });
  it("keeps additional shell parameters available in the expanded input", () => {
    const view = presentToolInput("shell", { command: "ls", timeout: 30 });
    expect(view.summary).toBe("ls");
    expect(view.input).toContain('"timeout": 30');
  });
  it("keeps file paths and generic tool parameters readable without losing fields", () => {
    const args = { path: "/project/file.ts", offset: 4 };
    const view = presentToolInput("read", args);
    expect(view.shell).toBe(false);
    expect(view.summary).toBe("read · /project/file.ts");
    expect(JSON.parse(view.input)).toEqual(args);
  });
  it("handles partial streaming arguments without inventing a command", () => {
    expect(presentToolInput("bash", {}).shell).toBe(false);
    expect(presentToolInput("mcp_list", {}).summary).toBe("mcp_list");
  });
  it("preserves multiline output and error text exactly", () => {
    const output = "Error: not found\n  at task\n<script>literal</script>";
    expect(formatToolOutput(output)).toBe(output);
  });
  it("formats structured output and distinguishes absent, empty and null results", () => {
    expect(JSON.parse(formatToolOutput({ count: 0 }))).toEqual({ count: 0 });
    expect(formatToolOutput(undefined)).toBe("");
    expect(formatToolOutput("")).toBe("");
    expect(formatToolOutput(null)).toBe("null");
  });
});
