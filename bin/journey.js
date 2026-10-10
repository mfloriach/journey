#!/usr/bin/env node
// One-shot installer: npx journey-sitemap [--force] [--dry-run]
// Copies the opencode command + crawler script + viewer template into the
// target app (cwd) and scaffolds sitemap/. Idempotent, no deps, no prompts.
"use strict";
const { cpSync, existsSync, mkdirSync } = require("node:fs");
const { join, dirname } = require("node:path");

const PKG_DIR = dirname(__dirname);
// npm i -D journey-sitemap: postinstall runs with cwd = package dir inside
// node_modules, INIT_CWD = target app dir. npx: cwd = target app dir.
const target = process.env.INIT_CWD && process.env.INIT_CWD !== PKG_DIR
  ? process.env.INIT_CWD
  : process.cwd();
if (target === PKG_DIR) {
  console.log("skip: refusing to install into own package dir");
  process.exit(0);
}
const args = new Set(process.argv.slice(2));
if (args.has("--help") || args.has("-h")) {
  console.log(`usage: npx journey-sitemap [--force] [--dry-run]

Installs:
  .opencode/commands/sitemap.md            opencode command
  .opencode/scripts/shoot.ts               crawler (playwright, run by agent)
  .opencode/templates/sitemap.html         viewer template
  sitemap/                                 crawl output dir (kept)

Crawl afterwards via opencode (/sitemap) or:
  BASE_URL=http://localhost:3000 npx tsx .opencode/scripts/shoot.ts`);
  process.exit(0);
}
const FORCE = args.has("--force");
const DRY = args.has("--dry-run");

const jobs = [
  ["commands/sitemap.md", ".opencode/commands/sitemap.md"],
  ["scripts/shoot.ts", ".opencode/scripts/shoot.ts"],
  ["templates/sitemap.html", ".opencode/templates/sitemap.html"],
];
let copied = 0,
  skipped = 0;
for (const [src, destRel] of jobs) {
  const from = join(PKG_DIR, src);
  const to = join(target, destRel);
  if (!existsSync(from)) {
    console.error(`missing in package: ${src}`);
    process.exitCode = 1;
    continue;
  }
  if (existsSync(to) && !FORCE) {
    console.log(`skip (exists, use --force): ${destRel}`);
    skipped++;
    continue;
  }
  if (!DRY) {
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }
  console.log(`${DRY ? "would copy" : "copied"}: ${destRel}`);
  copied++;
}
if (!DRY) mkdirSync(join(target, "sitemap", "shots"), { recursive: true });
console.log(
  `done: ${copied} copied, ${skipped} skipped. Run /sitemap in opencode to crawl.`,
);
