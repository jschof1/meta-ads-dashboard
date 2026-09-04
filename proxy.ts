import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const valid = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET);
  if (valid) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/",
    "/api/((?!auth(?:/|$)|cron(?:/|$)).*)",
  ],
};
