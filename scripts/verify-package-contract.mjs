import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const target = mkdtempSync(join(tmpdir(), "schema-consumer-"));
try {
  const spec =
    process.env.CONSUMER_PACKAGE ??
    join(
      target,
      execFileSync("npm", ["pack", "--silent", "--pack-destination", target], {
        cwd: root,
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .at(-1),
    );
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify({ name: "schema-consumer", private: true, type: "module" }),
  );
  execFileSync(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", spec],
    { cwd: target, stdio: "pipe" },
  );
  const packageRoot = join(target, "node_modules", ...manifest.name.split("/"));
  const installed = JSON.parse(
    readFileSync(join(packageRoot, "package.json"), "utf8"),
  );
  for (const key of ["name", "version", "license"])
    if (installed[key] !== manifest[key])
      throw new Error(`metadata mismatch: ${key}`);
  for (const path of [
    "LICENSE",
    "SECURITY.md",
    ...Object.values(installed.exports).flatMap((value) =>
      Object.values(value),
    ),
  ])
    if (!existsSync(join(packageRoot, path)))
      throw new Error(`missing distribution file: ${path}`);
  for (const file of ["consumer.mjs", "consumer-types.mts"])
    copyFileSync(join(root, "tests", file), join(target, file));
  writeFileSync(
    join(target, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        types: [],
      },
      include: ["*.mts"],
    }),
  );
  execFileSync(process.execPath, [join(target, "consumer.mjs")], {
    cwd: target,
    stdio: "inherit",
  });
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "-p",
      join(target, "tsconfig.json"),
    ],
    { cwd: target, stdio: "inherit" },
  );
  execFileSync("npm", ["ls", "--all"], { cwd: target, stdio: "inherit" });
  execFileSync("npm", ["audit", "--omit=dev", "--audit-level=high"], {
    cwd: target,
    stdio: "inherit",
  });
  console.log("installed positive/negative TypeScript contract: PASS");
} finally {
  rmSync(target, { recursive: true, force: true });
}
