const { mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
const latest = process.env.GRIMOIRE_NPM_FIXTURE_LATEST || "1.0.0";
const spec = args.find((arg) => arg.startsWith("grimoire-fixture-plugin@"));
const requested = spec?.slice(spec.lastIndexOf("@") + 1);
const version =
  requested && /^\d+\.\d+\.\d+/.test(requested) ? requested : latest;
const index = args.indexOf("--prefix");
const root = index >= 0 ? args[index + 1] : process.cwd();
const target = join(root, "node_modules", "grimoire-fixture-plugin");
if (args[0] === "install") {
  mkdirSync(join(target, "skills", "plugin-fixture"), { recursive: true });
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify({
      name: "grimoire-fixture-plugin",
      version,
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
else if (args[0] === "view") console.log(JSON.stringify(latest));
else if (args[0] === "root") console.log(join(root, "node_modules"));
