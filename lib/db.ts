import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export type DatabaseOptions = {
  url?: string;
  authToken?: string;
};

export function createPrismaClient(options: DatabaseOptions = {}): PrismaClient {
  const url = options.url || process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL || "file:./dev.db";
  const adapter = new PrismaLibSQL({
    url,
    authToken: options.authToken ?? process.env.TURSO_AUTH_TOKEN,
  });
  return new PrismaClient({ adapter }) as unknown as PrismaClient;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
