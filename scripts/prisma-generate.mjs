import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const prismaBin = join(root, "node_modules", "prisma", "build", "index.js");
const env = {
  ...process.env,
  // Prisma Client generation only needs a valid schema URL. Runtime database
  // selection is handled by lib/db.ts and prefers TURSO_DATABASE_URL.
  DATABASE_URL: "file:/tmp/uktl-prisma-build.db",
};

execFileSync(process.execPath, [prismaBin, "generate"], {
  cwd: root,
  env,
  stdio: "inherit",
});
