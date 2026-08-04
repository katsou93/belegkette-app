import { NextResponse, type NextRequest } from "next/server";
import { sbServer } from "@/lib/server";
export async function GET(req: NextRequest) {
const code = req.nextUrl.searchParams.get("code");
if (code) { const sb = await sbServer(); await sb.auth.exchangeCodeForSession(code); }
return NextResponse.redirect(new URL("/projekte", req.url));
}
