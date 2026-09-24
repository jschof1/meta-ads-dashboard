import { NextResponse } from "next/server";
import { leadRegisterFailureDiagnostic, syncLeadRegister } from "@/lib/lead-register";
export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request) {
 const secret=process.env.CRON_SECRET;
 if(!secret || secret.length<32 || request.headers.get("authorization")!==`Bearer ${secret}`)return NextResponse.json({error:"Unauthorized"},{status:401});
 try {const data=await syncLeadRegister();return NextResponse.json({ok:true,checkedAt:data.checkedAt,records:data.entries.length});}
 catch(error){
  // Log only the fixed operation label and HTTP status. Provider bodies and
  // credentials must not reach Worker logs or the response.
  console.error("Lead register scheduled sync failed", leadRegisterFailureDiagnostic(error));
  return NextResponse.json({ok:false,error:"Lead register refresh failed; saved records preserved."},{status:503});
 }
}
