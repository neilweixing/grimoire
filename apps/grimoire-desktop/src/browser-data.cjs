const {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  readdirSync,
  rmSync,
} = require("node:fs");
const { join, dirname } = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const partitionPattern =
  /^grimoire-browser-[a-f0-9]{64}(?:[a-f0-9-]{36})?(?:-unverified)?$/;

function browserPartition(context) {
  return (
    "grimoire-browser-" +
    createHash("sha256")
      .update(
        JSON.stringify({
          workspace: context.workspace,
          threadId: context.threadId,
        }),
      )
      .digest("hex") +
    (context.threadId ? "" : randomUUID())
  );
}
function validateContext(context, allowDraft = false) {
  if (
    !context ||
    typeof context.workspace !== "string" ||
    (!allowDraft && !context.workspace) ||
    context.workspace.length > 4096 ||
    (context.threadIds !== undefined &&
      (!Array.isArray(context.threadIds) ||
        context.threadIds.some(
          (id) => typeof id !== "string" || !id || id.length > 200,
        ))) ||
    (allowDraft && context.threadId === undefined) ||
    (context.threadId !== undefined &&
      !(allowDraft && context.threadId === null) &&
      (typeof context.threadId !== "string" ||
        !context.threadId ||
        context.threadId.length > 200))
  )
    throw new Error("Invalid browser data context.");
}

function createBrowserData({
  session,
  dataPath,
  indexPath = join(dataPath, "browser-data.json"),
}) {
  let owners = {};
  try {
    const saved = JSON.parse(readFileSync(indexPath, "utf8"));
    if (
      saved.version !== 1 ||
      !saved.partitions ||
      typeof saved.partitions !== "object" ||
      Array.isArray(saved.partitions)
    )
      throw new Error("Invalid browser data index.");
    for (const [name, context] of Object.entries(saved.partitions)) {
      if (!partitionPattern.test(name))
        throw new Error("Invalid indexed browser partition.");
      validateContext(context, true);
    }
    owners = saved.partitions;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  function persist(next) {
    mkdirSync(dirname(indexPath), { recursive: true, mode: 0o700 });
    const temp = `${indexPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify({ version: 1, partitions: next }), {
        mode: 0o600,
        flag: "wx",
      });
      renameSync(temp, indexPath);
      owners = next;
    } finally {
      rmSync(temp, { force: true });
    }
  }
  function partitions() {
    const names = new Set(Object.keys(owners));
    try {
      for (const entry of readdirSync(join(dataPath, "Partitions"), {
        withFileTypes: true,
      }))
        if (entry.isDirectory() && partitionPattern.test(entry.name))
          names.add(entry.name);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return names;
  }
  const selected = (context) => {
    validateContext(context);
    const names = new Set(
      Object.entries(owners)
        .filter(
          ([, owner]) =>
            owner.workspace === context.workspace &&
            (context.threadId === undefined ||
              owner.threadId === context.threadId),
        )
        .map(([name]) => name),
    );
    // Older non-draft partitions can be identified without an ownership index.
    const legacyIds = context.threadId
      ? [context.threadId]
      : (context.threadIds ?? []);
    const available = partitions();
    for (const threadId of new Set(legacyIds)) {
      const bindings = [
        { workspace: context.workspace, threadId },
        { threadId, workspace: context.workspace },
      ];
      for (const binding of bindings) {
        const base =
          "grimoire-browser-" +
          createHash("sha256").update(JSON.stringify(binding)).digest("hex");
        for (const name of available)
          if (name === base || name === `${base}-unverified`) names.add(name);
      }
    }
    return [...names];
  };
  let cacheTask;
  return {
    partition(context) {
      validateContext(context, true);
      const canonical = browserPartition(context);
      if (!context.threadId) return canonical;
      const own = (owner) =>
        owner?.workspace === context.workspace &&
        owner.threadId === context.threadId;
      if (own(owners[canonical]) || own(owners[`${canonical}-unverified`]))
        return canonical;
      const previous = Object.entries(owners).find(([, owner]) => own(owner));
      return previous ? previous[0].replace(/-unverified$/, "") : canonical;
    },
    register(name, context) {
      if (!partitionPattern.test(name))
        throw new Error("Invalid browser partition.");
      validateContext(context, true);
      const existing = owners[name];
      if (
        existing &&
        (existing.workspace !== context.workspace ||
          (existing.threadId !== null &&
            existing.threadId !== context.threadId))
      )
        throw new Error("A browser partition cannot change its owning chat.");
      if (
        existing?.workspace === context.workspace &&
        existing?.threadId === context.threadId
      )
        return;
      persist({
        ...owners,
        [name]: { workspace: context.workspace, threadId: context.threadId },
      });
    },
    rebind(base, context) {
      validateContext(context, true);
      const next = { ...owners };
      for (const name of [base, `${base}-unverified`]) {
        if (!next[name]) continue;
        if (
          next[name].workspace !== context.workspace ||
          (next[name].threadId !== null &&
            next[name].threadId !== context.threadId)
        )
          throw new Error("A browser partition cannot change its owning chat.");
        next[name] = {
          workspace: context.workspace,
          threadId: context.threadId,
        };
      }
      persist(next);
    },
    async clearCache() {
      if (cacheTask) return cacheTask;
      cacheTask = (async () => {
        const sessions = new Set([session.defaultSession]);
        for (const name of partitions())
          sessions.add(session.fromPartition(`persist:${name}`));
        const results = await Promise.allSettled(
          [...sessions].map(async (entry) => {
            await entry.clearCache();
            await entry.clearCodeCaches({ urls: [] });
          }),
        );
        const failures = results.filter((entry) => entry.status === "rejected");
        if (failures.length)
          throw new AggregateError(
            failures.map((entry) => entry.reason),
            "Could not clear every browser cache.",
          );
      })().finally(() => {
        cacheTask = undefined;
      });
      return cacheTask;
    },
    async clear(context) {
      const names = selected(context);
      const results = await Promise.allSettled(
        names.map(async (name) => {
          const entry = session.fromPartition(`persist:${name}`);
          await entry.closeAllConnections();
          await entry.clearStorageData();
          await entry.clearAuthCache();
          await entry.clearCache();
          await entry.clearCodeCaches({ urls: [] });
        }),
      );
      const failures = results.filter((entry) => entry.status === "rejected");
      if (failures.length)
        throw new AggregateError(
          failures.map((entry) => entry.reason),
          "Could not clear the chat's browser data.",
        );
      const next = { ...owners };
      for (const name of names) delete next[name];
      persist(next);
    },
  };
}
module.exports = { browserPartition, createBrowserData, validateContext };
