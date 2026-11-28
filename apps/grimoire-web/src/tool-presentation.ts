export function presentToolInput(
  toolName: string,
  args: Record<string, unknown>,
) {
  const shell =
    ["bash", "shell"].includes(toolName) && typeof args.command === "string";
  const target = [
    args.path,
    args.file_path,
    args.url,
    args.query,
    args.pattern,
  ].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const command = shell ? (args.command as string) : undefined;
  const extraArgs = Object.fromEntries(
    Object.entries(args).filter(([key]) => key !== "command"),
  );
  return {
    shell,
    summary: command ?? (target ? `${toolName} · ${target}` : toolName),
    input:
      command !== undefined
        ? `$ ${command}${Object.keys(extraArgs).length ? `\n\n${JSON.stringify(extraArgs, null, 2)}` : ""}`
        : JSON.stringify(args, null, 2),
  };
}

export function formatToolOutput(result: unknown): string {
  return typeof result === "string"
    ? result
    : (JSON.stringify(result, null, 2) ?? "");
}
