import { redirect } from "next/navigation";
import { sbServer } from "@/lib/server";
export default async function Home() {
const sb = await sbServer();
const { data: { user } } = await sb.auth.getUser();
redirect(user ? "/projekte" : "/login");
}
