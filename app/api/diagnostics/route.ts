import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { buildSystemDiagnostics } from "@/lib/system-diagnostics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const diagnostics = await buildSystemDiagnostics();
    return NextResponse.json(diagnostics, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("system diagnostics failed:", error instanceof Error ? error.name : "unknown error");
    return NextResponse.json(
      { error: "System diagnostics are unavailable; no provider mutation was attempted." },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
