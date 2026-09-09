import { NextResponse } from "next/server";
import { requireApiSession } from "@/lib/api-auth";
import { readLeadRegister, syncLeadRegister } from "@/lib/lead-register";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;
const headers={"Cache-Control":"private, no-store"};
export async function GET(request: Request) {
  const unauthorized=await requireApiSession(request); if(unauthorized)return unauthorized;
  try { return NextResponse.json({data:await readLeadRegister()},{headers}); }
  catch {return NextResponse.json({error:"Saved lead register unavailable."},{status:503,headers});}
}
export async function POST(request: Request) {
  const unauthorized=await requireApiSession(request); if(unauthorized)return unauthorized;
  // Next may normalize request.url to an internal host; compare with the HTTP host.
  const origin=request.headers.get("origin");
  let sameOrigin=false;
  try { const parsed=new URL(origin || ""); sameOrigin=["http:","https:"].includes(parsed.protocol) && parsed.origin===origin && parsed.host===(request.headers.get("host") || new URL(request.url).host); } catch { /* Invalid origin. */ }
  if(!sameOrigin) return NextResponse.json({error:"Invalid origin"},{status:403,headers});
  try {return NextResponse.json({data:await syncLeadRegister()},{headers});}
  catch {return NextResponse.json({error:"Refresh failed. The last complete saved register has been preserved."},{status:503,headers});}
}
