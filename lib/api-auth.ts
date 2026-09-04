import { NextResponse } from "next/server";
import { requestHasValidSession } from "@/lib/session";

export async function requireApiSession(request: Request): Promise<NextResponse | null> {
  return (await requestHasValidSession(request))
    ? null
    : NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
