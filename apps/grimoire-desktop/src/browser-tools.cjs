const { randomUUID } = require("node:crypto");

function snapshotPage({ id, context }) {
  const sensitive = (globalThis.__grimoireSensitiveFields ??= new WeakSet());
  for (const node of document.querySelectorAll(
    'input[type="password"],input[autocomplete*="password"]',
  ))
    sensitive.add(node);
  const label = (node) =>
    (
      node.getAttribute("aria-label") ||
      Array.from(node.labels || [])
        .map((n) => n.textContent)
        .join(" ") ||
      node.innerText ||
      node.getAttribute("placeholder") ||
      node.getAttribute("title") ||
      node.getAttribute("name") ||
      node.tagName.toLowerCase()
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
  const visible = (node) => {
    const r = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    return (
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < innerHeight &&
      r.left < innerWidth &&
      style.visibility !== "hidden" &&
      style.display !== "none"
    );
  };
  const targets = new Map();
  const elements = [];
  for (const node of document.querySelectorAll(
    'a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[contenteditable="true"]',
  )) {
    if (!visible(node) || elements.length >= 80) continue;
    const ref = `e${elements.length + 1}`;
    const item = {
      ref,
      label: label(node),
      tag: node.tagName.toLowerCase(),
      type: node.getAttribute("type") || "",
      href: node.href || "",
    };
    targets.set(ref, { ...item, node });
    elements.push({
      ...item,
      ...(!sensitive.has(node) &&
      node.type !== "password" &&
      typeof node.value === "string"
        ? { value: node.value.slice(0, 120) }
        : {}),
    });
  }
  globalThis.__grimoireSnapshot = {
    id,
    context,
    targets,
    label,
    visible,
  };
  return {
    source: "untrusted-webpage",
    snapshotId: id,
    url: location.href,
    title: document.title,
    text: (document.body?.innerText || "").slice(0, 16000),
    elements,
  };
}

function prepareAction({ args, context, typing }) {
  const store = globalThis.__grimoireSnapshot;
  if (
    !store ||
    store.id !== args.snapshotId ||
    store.context !== context ||
    location.href !== args.url
  )
    throw new Error(
      "The page or browser context changed. Take a fresh browser_snapshot.",
    );
  const item = store.targets.get(args.ref);
  if (
    !item ||
    !item.node.isConnected ||
    !store.visible(item.node) ||
    store.label(item.node) !== item.label ||
    args.label !== item.label ||
    (item.node.href || "") !== item.href ||
    (item.node.getAttribute("type") || "") !== item.type
  )
    throw new Error("The target changed. Take a fresh browser_snapshot.");
  const node = item.node;
  if (node.disabled) throw new Error("The target is disabled.");
  if (typing) {
    if (
      node.readOnly ||
      !(
        (node.tagName === "INPUT" &&
          ["text", "search", "email", "tel", "url", "password"].includes(
            node.type,
          )) ||
        node.tagName === "TEXTAREA" ||
        node.isContentEditable
      )
    )
      throw new Error("The target is not an editable text field.");
    node.focus();
    if (typeof node.select === "function") node.select();
    else {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  const r = node.getBoundingClientRect();
  const point = {
    x: Math.round((Math.max(0, r.left) + Math.min(innerWidth, r.right)) / 2),
    y: Math.round((Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2),
  };
  const hit = document.elementFromPoint(point.x, point.y);
  if (hit !== node && !node.contains(hit))
    throw new Error("The target is covered. Take a fresh browser_snapshot.");
  delete globalThis.__grimoireSnapshot;
  return point;
}

function createBrowserAutomation({
  getView,
  navigate,
  show,
  getState = () => ({}),
}) {
  let binding;
  let context = randomUUID();
  const matches = (request) =>
    binding?.workspace === request.workspace &&
    binding?.threadId === request.threadId &&
    Boolean(request.threadId);
  const evaluate = async (contents, fn, payload) => {
    const code = `(()=>{try{return {ok:true,value:(${fn.toString()})(${JSON.stringify(payload)})};}catch(error){return {ok:false,error:error.message};}})()`;
    const result = await contents.executeJavaScriptInIsolatedWorld(
      1101,
      [{ code }],
      true,
    );
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  return {
    bind(next) {
      if (
        !next ||
        typeof next.workspace !== "string" ||
        (next.threadId !== null && typeof next.threadId !== "string")
      )
        throw new Error("Invalid browser chat binding.");
      if (
        next.workspace !== binding?.workspace ||
        next.threadId !== binding?.threadId
      )
        context = randomUUID();
      binding = next;
    },
    async execute(request, signal) {
      signal?.throwIfAborted();
      const requestContext = context;
      if (!matches(request))
        throw new Error(
          "Browser tools are only available to the active project and chat.",
        );
      if (
        ![
          "browser_navigate",
          "browser_snapshot",
          "browser_click",
          "browser_type",
        ].includes(request.tool)
      )
        throw new Error("Unknown browser tool.");
      show();
      if (request.tool === "browser_navigate")
        return {
          ...navigate(request.args.url),
          message:
            "Navigation started. Read browser_snapshot before interacting.",
        };
      const view = getView();
      if (!view || view.webContents.isDestroyed())
        throw new Error("Open a webpage with browser_navigate first.");
      const contents = view.webContents;
      const checkPage = () => {
        const state = getState();
        if (state.error)
          throw new Error(
            `Browser page failed to load: ${state.errorCode || "unknown error"}. Browser certificate preferences can only be changed by the user in Settings.`,
          );
      };
      const deadline = Date.now() + 10_000;
      while (
        (contents.isLoadingMainFrame() || !view.getVisible()) &&
        Date.now() < deadline
      ) {
        checkPage();
        signal?.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (
          getView() !== view ||
          contents.isDestroyed() ||
          !matches(request) ||
          context !== requestContext
        )
          throw new Error("The browser context changed.");
      }
      signal?.throwIfAborted();
      checkPage();
      if (contents.isLoadingMainFrame())
        return {
          loading: true,
          url: contents.getURL(),
          message: "The page is still loading. Read another snapshot shortly.",
        };
      if (!view.getVisible())
        throw new Error(
          "The browser is hidden or blocked by a dialog. Close the dialog and retry.",
        );
      if (request.tool === "browser_snapshot") {
        const result = await evaluate(contents, snapshotPage, {
          id: randomUUID(),
          context: requestContext,
        });
        signal?.throwIfAborted();
        if (
          !matches(request) ||
          context !== requestContext ||
          getView() !== view
        )
          throw new Error("The browser context changed.");
        return result;
      }
      const args = request.args;
      if (
        typeof args.url !== "string" ||
        typeof args.snapshotId !== "string" ||
        typeof args.ref !== "string" ||
        typeof args.label !== "string" ||
        (request.tool === "browser_type" &&
          (typeof args.text !== "string" || args.text.length > 8000))
      )
        throw new Error("Invalid browser action.");
      const point = await evaluate(contents, prepareAction, {
        args,
        context: requestContext,
        typing: request.tool === "browser_type",
      });
      signal?.throwIfAborted();
      if (!matches(request) || context !== requestContext || getView() !== view)
        throw new Error("The browser context changed.");
      contents.focus();
      if (request.tool === "browser_type") await contents.insertText(args.text);
      else {
        contents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...point,
        });
        contents.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          ...point,
        });
      }
      return {
        ok: true,
        url: contents.getURL(),
        message:
          "Action completed. Take a fresh browser_snapshot before the next action.",
      };
    },
  };
}
module.exports = { createBrowserAutomation };
