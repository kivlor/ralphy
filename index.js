#!/usr/bin/env node

const { spawn } = require("node:child_process");
const path = require("node:path");

const vitePkgPath = require.resolve("vite/package.json");
const vitePkg = require(vitePkgPath);
const binRel =
  typeof vitePkg.bin === "string" ? vitePkg.bin : vitePkg.bin?.vite;

if (!binRel) {
  console.error("Could not find Vite binary in vite/package.json");
  process.exit(1);
}

const viteBin = path.join(path.dirname(vitePkgPath), binRel);
const args = [
  "--port",
  "7257",
  "--logLevel",
  "error",
  "--clearScreen",
  "false",
];

console.log("Access ralphy at http://localhost:7257/");

const child = spawn(process.execPath, [viteBin, ...args], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: process.env,
});

child.on("exit", (code) => {
  process.exit(code ?? 0);
});
