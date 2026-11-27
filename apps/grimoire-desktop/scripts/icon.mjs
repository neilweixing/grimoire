import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const build = fileURLToPath(new URL("../build/", import.meta.url));
const source = readFileSync(
  new URL("../../grimoire-web/public/grimoire-mark.svg", import.meta.url),
  "utf8",
);
const svg = source
  .replace(
    'viewBox="0 0 64 64"',
    'viewBox="0 0 80 80" width="1024" height="1024"',
  )
  .replace(
    "<title>",
    '<rect x="1" y="1" width="78" height="78" rx="18" fill="#f5eee7"/><g transform="translate(8 8)"><title>',
  )
  .replace("</svg>", "</g></svg>");
mkdirSync(build, { recursive: true });
writeFileSync(join(build, "icon.svg"), svg);
const png = (size) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
writeFileSync(join(build, "icon.png"), png(512));
const windowsPng = png(256);
const ico = Buffer.alloc(22);
ico.writeUInt16LE(1, 2);
ico.writeUInt16LE(1, 4);
ico.writeUInt16LE(1, 10);
ico.writeUInt16LE(32, 12);
ico.writeUInt32LE(windowsPng.length, 14);
ico.writeUInt32LE(22, 18);
writeFileSync(join(build, "icon.ico"), Buffer.concat([ico, windowsPng]));
if (process.platform === "darwin") {
  const iconset = join(build, "icon.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const size of [16, 32, 128, 256, 512])
    for (const scale of [1, 2])
      writeFileSync(
        join(iconset, `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`),
        png(size * scale),
      );
  execFileSync("iconutil", [
    "-c",
    "icns",
    iconset,
    "-o",
    join(build, "icon.icns"),
  ]);
  rmSync(iconset, { recursive: true });
}
