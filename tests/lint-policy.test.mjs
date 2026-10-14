import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ESLint } from "eslint";

const policy = JSON.parse(await readFile(new URL("../scripts/lint-policy.json", import.meta.url)));
const oxlint = JSON.parse(await readFile(new URL("../.oxlintrc.json", import.meta.url)));
const severity = (value) => {
  const level = Array.isArray(value) ? value[0] : value;
  return typeof level === "number" ? level : { off: 0, warn: 1, error: 2 }[level];
};

test("the dependency repair preserves every previously enabled lint rule and severity", async () => {
  const eslint = new ESLint();
  for (const [path, rules] of Object.entries(policy)) {
    const actual = (await eslint.calculateConfigForFile(path)).rules;
    for (const [name, expected] of Object.entries(rules)) {
      if (severity(expected) === 0) continue;
      if (name.startsWith("@next/next/") && !name.includes("no-location-assign")) {
        assert.equal(severity(oxlint.rules[name.replace("@next/next/", "nextjs/")]), severity(expected), name);
      } else {
        assert.deepEqual(actual[name], expected, `${path}: ${name}`);
      }
    }
  }
});

test("React Hooks, TypeScript, accessibility and retained navigation rules still detect invalid code", async () => {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(`
import { useState } from "react";
export function Example({ enabled }: { enabled: boolean }) {
  const data: any = 1;
  if (enabled) useState(data);
  window.location.href = "/internal";
  return <img aria-invalid-prop="bad" />;
}`, { filePath: "app/lint-check.tsx" });
  const names = new Set(result.messages.map((message) => message.ruleId));
  for (const name of ["react-hooks/rules-of-hooks", "@typescript-eslint/no-explicit-any", "jsx-a11y/alt-text", "jsx-a11y/aria-props", "@next/next/no-location-assign-relative-destination"]) {
    assert.ok(names.has(name), `Must detect ${name}`);
  }
});

test("Oxlint runs the Next error rules rather than only configuring them", () => {
  const directory = mkdtempSync(join(tmpdir(), "uktl-next-lint-"));
  const path = join(directory, "page.tsx");
  writeFileSync(path, 'import Document from "next/document"; export default function Example() { return <Document />; }');
  try {
    assert.throws(() => execFileSync(process.execPath, ["node_modules/oxlint/bin/oxlint", "--config", resolve(".oxlintrc.json"), path], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }), (error) => {
    assert.match(`${error.stdout}\n${error.stderr}`, /no-document-import-in-page/);
    return true;
  });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
