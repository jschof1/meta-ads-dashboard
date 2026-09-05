import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireApiSession } from "@/lib/api-auth";
import { actionErrorResponse } from "@/app/api/actions/route";
import { approveMetaAction } from "@/lib/meta-actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireApiSession(request);
  if (unauthorized) return unauthorized;
  try {
    const { id } = await params;
    const result = await approveMetaAction(prisma, id);
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return actionErrorResponse(error);
  }
}
