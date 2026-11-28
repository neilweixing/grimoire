import { createRequire } from "node:module";
import { expect, it, vi } from "vitest";
const require = createRequire(
  new URL("../apps/grimoire-web/package.json", import.meta.url),
);
const { PiThreadController } = await import(
  require.resolve("@assistant-ui/react-pi")
);
const block = (name = "fixture") =>
  `<skill name="${name}" location="/fixture/skills/${name}/SKILL.md">\nReferences are relative to /fixture/skills/${name}.\n\nFixture Skill body.\n</skill>`;
const user = (content: string, timestamp = 1) => ({
  role: "user",
  content,
  timestamp,
});
async function fixture(initial: ReturnType<typeof user>[] = []) {
  let listener: (event: unknown) => void = () => {};
  const client = {
    getThread: vi.fn(async () => ({
      metadata: { id: "fixture", status: "idle" },
      messages: initial,
    })),
    subscribe: vi.fn((_id: string, callback: typeof listener) => {
      listener = callback;
      return () => {};
    }),
    sendMessage: vi.fn(async () => {}),
  };
  const controller = new PiThreadController(client, "fixture", {
    scheduleNotify: (flush: () => void) => flush(),
  });
  await controller.load();
  const send = (text: string) =>
    controller.sendMessage({
      role: "user",
      content: [{ type: "text", text }],
      attachments: [],
      parentId: null,
      sourceId: null,
      runConfig: {},
    });
  const echo = (content: string) => {
    const message = user(content, Date.now());
    listener({ threadId: "fixture", type: "message_start", message });
    listener({ threadId: "fixture", type: "message_end", message });
  };
  const users = () =>
    controller
      .getProjectedMessages()
      .filter((message: { role: string }) => message.role === "user");
  return { controller, client, send, echo, users };
}
it.each([
  ["/skill:fixture Explain the query", `${block()}\n\nExplain the query`],
  ["/skill:fixture   Explain the query  ", `${block()}\n\nExplain the query`],
  ["/skill:fixture", block()],
  ["/skill:missing Query", "/skill:missing Query"],
])(
  "reconciles a single Skill send with Pi's actual echoed content: %s",
  async (input, expanded) => {
    const current = await fixture();
    try {
      await current.send(input);
      expect(current.users()).toHaveLength(1);
      current.echo(expanded);
      expect(current.users()).toHaveLength(1);
      expect(current.users()[0].content).toEqual([
        { type: "text", text: expanded },
      ]);
      expect(current.client.sendMessage).toHaveBeenCalledTimes(1);
    } finally {
      current.controller.dispose();
    }
  },
);
it.each([
  `${block("other")}\n\nQuery`,
  `${block()}\n\nDifferent query`,
  '<skill name="fixture" location="broken\nBody\n</skill>\n\nQuery',
])(
  "does not consume an unrelated or malformed echoed message",
  async (expanded) => {
    const current = await fixture();
    try {
      await current.send("/skill:fixture Query");
      current.echo(expanded);
      expect(current.users()).toHaveLength(2);
    } finally {
      current.controller.dispose();
    }
  },
);
it("preserves separate identical user turns already stored in the session", async () => {
  const expanded = `${block()}\n\nQuery`;
  const current = await fixture([user(expanded)]);
  try {
    await current.send("/skill:fixture Query");
    expect(current.users()).toHaveLength(2);
    current.echo(expanded);
    expect(current.users()).toHaveLength(2);
  } finally {
    current.controller.dispose();
  }
});
