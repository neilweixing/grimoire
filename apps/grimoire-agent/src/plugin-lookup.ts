import { maxSatisfying } from "semver";
import { z } from "zod";
import type { PluginLookup } from "@grimoire/core";
import { packageSourceSchema } from "./integrations.js";

export function normalizeNpmSource(input: string): string {
  let source = z.string().trim().min(1).max(300).parse(input);
  if (source.startsWith("https://")) {
    const url = new URL(source);
    if (
      !["npmjs.com", "www.npmjs.com"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Enter an npm package name or an npmjs.com package URL.");
    const path = decodeURIComponent(url.pathname).replace(/\/$/, "");
    const match = /^\/package\/((?:@[^/]+\/)?[^/]+)(?:\/v\/([^/]+))?$/.exec(
      path,
    );
    if (!match) throw new Error("Enter a valid npm package URL.");
    source = match[1] + (match[2] ? `@${match[2]}` : "");
  }
  return packageSourceSchema.parse(
    source.startsWith("npm:") ? source : `npm:${source}`,
  );
}

export async function lookupPlugin(input: string): Promise<PluginLookup> {
  const source = normalizeNpmSource(input);
  const spec = source.slice(4);
  const versionIndex = spec.lastIndexOf("@");
  const name = versionIndex > 0 ? spec.slice(0, versionIndex) : spec;
  const selector = versionIndex > 0 ? spec.slice(versionIndex + 1) : "latest";
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`,
    {
      headers: { Accept: "application/vnd.npm.install-v1+json" },
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    },
  );
  if (response.status === 404) return { found: false };
  if (!response.ok)
    throw new Error("The npm registry is unavailable. Try again.");
  const body = z
    .object({
      name: z.string(),
      "dist-tags": z.record(z.string(), z.string()).default({}),
      versions: z.record(
        z.string(),
        z.object({ name: z.string(), version: z.string() }),
      ),
    })
    .parse(await response.json());
  if (body.name !== name)
    throw new Error("The npm registry returned an unexpected package.");
  const version =
    body["dist-tags"][selector] ??
    maxSatisfying(Object.keys(body.versions), selector);
  const metadata = version ? body.versions[version] : undefined;
  if (!metadata) return { found: false };
  if (metadata.name !== name || metadata.version !== version)
    throw new Error("The npm registry returned invalid package metadata.");
  return { found: true, source, name, version: metadata.version };
}
