export function normalizeBrowserUrl(input: string): string {
  const value = input.trim();
  if (!value || value.length > 8192 || /\s/.test(value))
    throw new Error("Invalid URL.");
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(
    value,
  );
  const hostPort = /^[a-z\d.-]+:\d+(?:[/?#]|$)/i.test(value);
  const explicit = /^[a-z][a-z\d+.-]*:/i.test(value) && !local && !hostPort;
  const url = new URL(
    explicit ? value : `${local ? "http" : "https"}://${value}`,
  );
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    !url.hostname
  )
    throw new Error("Only HTTP and HTTPS URLs are supported.");
  return url.href;
}
