function createBrowserSessions(createPage) {
  const pages = new Map();
  let active;
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
      const result = record.tail.then(() =>
        record.page.execute(request, signal),
      );
      record.tail = result.catch(() => {});
      return result;
    },
  };
}

module.exports = { createBrowserSessions };
