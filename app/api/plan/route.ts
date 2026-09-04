import { NextResponse } from "next/server";
import { readPlan } from "@/lib/plan-context";
import { requireApiSession } from "@/lib/api-auth";

export const dynamic = "force-static";

export async function GET(request: Request) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  const plan = await readPlan();
  return NextResponse.json({ plan });
}
