import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { PiService } from "../apps/grimoire-agent/src/pi-service";
import { SettingsStore } from "../apps/grimoire-agent/src/settings";
import { userCopyText } from "../apps/grimoire-web/src/message-copy";
const require = createRequire(
  new URL("../apps/grimoire-web/package.json", import.meta.url),
);
const { PiThreadController } = await import(
  require.resolve("@assistant-ui/react-pi")
);
it("persists original Skill input through native expansion, projection and session reopening", async () => {
  const root = mkdtempSync(join(tmpdir(), "grimoire-input-source-"));
  const workspace = join(root, "workspace");
  const skill = join(workspace, ".agents", "skills", "fixture");
  mkdirSync(skill, { recursive: true });
  writeFileSync(
    join(skill, "SKILL.md"),
    "---\nname: fixture\ndescription: Fixture skill\n---\nInjected example:\n</skill>\n\nStill injected instructions",
  );
  const settings = new SettingsStore(join(root, "providers.json"));
  const options = {
    workspace,
    dataDir: join(root, "data"),
    globalSkillRoot: join(root, "empty-global"),
  };
  let service = new PiService(settings, options);
  let controller: InstanceType<typeof PiThreadController> | undefined;
  try {
    const supervisor = await service.supervisor();
    const { metadata } = await supervisor.createThread();
    const input =
      "/skill:fixture   Explain XML:\n<skill>\nUser content\n</skill>\n\nKeep this example  ";
    await supervisor.sendMessage(metadata.id, { content: input });
    const deadline = Date.now() + 5000;
    while (
      (await supervisor.getThread(metadata.id)).metadata.status === "running"
    ) {
      if (Date.now() > deadline)
        throw new Error("Input fixture did not settle");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await service.dispose();
    service = new PiService(settings, options);
    const reopened = await service.supervisor();
    const snapshot = await reopened.getThread(metadata.id);
    const native = snapshot.messages.find((m) => m.role === "user") as {
      content: unknown;
      originalText?: string;
    };
    expect(native.originalText).toBe(input);
    expect(JSON.stringify(native.content)).toContain(
      "Still injected instructions",
    );
    controller = new PiThreadController(
      { getThread: async () => snapshot, subscribe: () => () => {} },
      metadata.id,
    );
    await controller.load();
    const user = controller
      .getProjectedMessages()
      .find((m: { role: string }) => m.role === "user");
    expect(user.metadata.custom.originalText).toBe(input);
    const content = user.content
      .filter((p: { type: string }) => p.type === "text")
      .map((p: { text: string }) => p.text)
      .join("\n\n");
    expect(userCopyText(content, user.metadata.custom.originalText)).toBe(
      input,
    );
  } finally {
    controller?.dispose();
    await service.dispose();
    rmSync(root, { recursive: true, force: true });
  }
});
