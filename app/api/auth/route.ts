import { NextRequest, NextResponse } from "next/server";
import { validateAuthEnvironment, validateDatabaseEnvironment } from "@/lib/env";
import { checkLoginRateLimit, clearLoginRateLimit } from "@/lib/login-rate-limit";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SECONDS } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function valuesMatch(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export async function POST(request: NextRequest) {
  const configurationErrors = [...validateAuthEnvironment(), ...validateDatabaseEnvironment()];
  if (configurationErrors.length > 0) {
    return NextResponse.json({ error: "Authentication is not configured" }, { status: 503 });
  }

  const key = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  let limit;
  try {
    limit = await checkLoginRateLimit({ key, secret: process.env.AUTH_SECRET! });
  } catch {
    return NextResponse.json({ error: "Authentication is temporarily unavailable" }, { status: 503 });
  }
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many login attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === "string" ? body.password : "";
  if (!(await valuesMatch(password, process.env.DASHBOARD_PASSWORD!))) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  try {
    await clearLoginRateLimit({ key, secret: process.env.AUTH_SECRET! });
  } catch {
    return NextResponse.json({ error: "Authentication is temporarily unavailable" }, { status: 503 });
  }
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, await createSessionToken(process.env.AUTH_SECRET!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  return response;
}
