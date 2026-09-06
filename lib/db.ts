import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { createClient, type Client } from "@libsql/client";
import { resolve } from "node:path";
import { validateDatabaseEnvironment } from "@/lib/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  databaseTargets: WeakMap<PrismaClient, Readonly<{ url: string; authToken?: string }>> | undefined;
};

// Survives development module reloads alongside the cached Prisma instance.
const databaseTargets = globalForPrisma.databaseTargets ??= new WeakMap();

export type DatabaseOptions = {
  url?: string;
  authToken?: string;
};

function unconfiguredPrismaClient(): PrismaClient {
  // Keep route modules loadable so authenticated diagnostics can report a
  // redacted configuration failure. The proxy has no local fallback and
  // throws on every database operation; durable routes validate the
  // environment before reaching it.
  return new Proxy({} as PrismaClient, {
    get() {
      throw new Error("Database configuration is required in production");
    },
  });
}

export function createPrismaClient(options: DatabaseOptions = {}): PrismaClient {
  const url = options.url || process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production" && !options.url && validateDatabaseEnvironment().length > 0) return unconfiguredPrismaClient();
  const selectedUrl = url || "file:./dev.db";
  const target = Object.freeze({
    // Resolve file targets now, so a later cwd change cannot redirect a batch.
    url: selectedUrl.startsWith("file:") && !selectedUrl.includes(":memory:")
      ? `file:${resolve(selectedUrl.slice(5))}` : selectedUrl,
    authToken: options.authToken ?? (options.url ? undefined : process.env.TURSO_AUTH_TOKEN),
  });
  const adapter = new PrismaLibSQL(target);
  const client = new PrismaClient({ adapter }) as unknown as PrismaClient;
  databaseTargets.set(client, target);
  return client;
}

export async function withDatabaseClient<T>(db: PrismaClient, operation: (client: Client) => Promise<T>): Promise<T> {
  const target = databaseTargets.get(db);
  if (!target) throw new Error("Snapshot batches require a client created by createPrismaClient; database target is unknown");
  // A second connection to an in-memory URL is a different database.
  if (target.url.includes(":memory:")) throw new Error("Snapshot batches require a shared file or remote database target");
  const client = createClient(target);
  try {
    return await operation(client);
  } finally {
    client.close();
  }
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
