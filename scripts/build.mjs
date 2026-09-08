import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const prismaBin = join(root, "node_modules", "prisma", "build", "index.js");
const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const env = {
  ...process.env,
  // Keep Prisma's local SQLite datasource valid during the Vercel build while
  // retaining TURSO_DATABASE_URL for any application-side build evaluation.
  DATABASE_URL: "file:/tmp/uktl-prisma-build.db",
};

execFileSync(process.execPath, [prismaBin, "generate"], { cwd: root, env, stdio: "inherit" });
execFileSync(process.execPath, [nextBin, "build"], { cwd: root, env, stdio: "inherit" });
