const { mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const index = args.indexOf("--prefix");
const root = index >= 0 ? args[index + 1] : process.cwd();
const target = join(root, "node_modules", "grimoire-fixture-plugin");
if (args[0] === "install") {
  mkdirSync(join(target, "skills", "plugin-fixture"), { recursive: true });
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify({
      name: "grimoire-fixture-plugin",
      version: "1.0.0",
      type: "module",
      keywords: ["pi-package"],
      pi: { extensions: ["extension.mjs"], skills: ["skills"] },
    }),
  );
  writeFileSync(
    join(target, "extension.mjs"),
    `export default function(pi){pi.registerTool({name:"fixture_plugin_echo",label:"Fixture plugin",description:"Read fixture plugin data",parameters:{type:"object",properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:async()=>({content:[{type:"text",text:"Native plugin executed"}],details:{}})});}`,
  );
  writeFileSync(
    join(target, "skills", "plugin-fixture", "SKILL.md"),
    "---\nname: plugin-fixture\ndescription: Fixture package Skill\n---\nFixture package instructions.",
  );
} else if (args[0] === "uninstall")
  rmSync(target, { recursive: true, force: true });
else if (args[0] === "view") console.log('"1.0.0"');
else if (args[0] === "root") console.log(join(root, "node_modules"));
