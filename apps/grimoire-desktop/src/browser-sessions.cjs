function createBrowserSessions(createPage) {
  const pages = new Map();
  let active;
  const removed = new Set();
  const key = (context) =>
    JSON.stringify([context.workspace, context.threadId]);
  const validate = (context) => {
    if (
      !context ||
      typeof context.workspace !== "string" ||
      (context.threadId !== null && typeof context.threadId !== "string")
    )
      throw new Error("Invalid browser session binding.");
  };
  const open = (context) => {
    const id = key(context);
    if (removed.has(id)) throw new Error("The browser chat was deleted.");
    if (!pages.has(id))
      pages.set(id, {
        page: createPage(context),
        context,
        tail: Promise.resolve(),
      });
    return pages.get(id);
  };
  return {
    bind(context) {
      validate(context);
      const id = key(context);
      // Keep a page opened before the first message when the draft gets its session ID.
      if (
        !pages.has(id) &&
        active?.context.workspace === context.workspace &&
        active.context.threadId === null &&
        context.threadId
      ) {
        pages.delete(key(active.context));
        active.context = context;
        active.page.bind(context);
        pages.set(id, active);
      }
      active = open(context);
      return active.page;
    },
    async remove(context) {
      const selected = [...pages.entries()].filter(
        ([, record]) =>
          record.context.workspace === context.workspace &&
          (context.threadId === undefined ||
            record.context.threadId === context.threadId),
      );
      const blocked = context.threadId
        ? [key(context)]
        : selected
            .filter(([, record]) => record.context.threadId)
            .map(([id]) => id);
      const added = blocked.filter((id) => !removed.has(id));
      for (const id of added) removed.add(id);
      const previous = active?.context;
      const closing = [];
      for (const [id, record] of selected) {
        record.removed = true;
        pages.delete(id);
        if (active === record) active = undefined;
        closing.push(record.page.dispose());
      }
      await Promise.all(closing);
      await Promise.allSettled(selected.map(([, record]) => record.tail));
      return () => {
        for (const id of added) removed.delete(id);
        if (
          (!active || !active.context.workspace) &&
          previous &&
          selected.some(([, record]) => record.context === previous)
        )
          active = open(previous);
      };
    },
    active: () => active?.page,
    values: () => Array.from(pages.values(), (record) => record.page),
    execute(request, signal) {
      validate(request);
      if (!request.workspace || !request.threadId)
        throw new Error("A browser session is required.");
      const record = open({
        workspace: request.workspace,
        threadId: request.threadId,
      });
      const result = record.tail.then(() => {
        if (record.removed) throw new Error("The browser chat was deleted.");
        return record.page.execute(request, signal);
      });
      record.tail = result.catch(() => {});
      return result;
    },
  };
}

module.exports = { createBrowserSessions };
