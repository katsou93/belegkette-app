import Link from "next/link";
import { sbServer } from "@/lib/server";

export async function Seitenleiste({ aktiv }: { aktiv?: "projekte" | "kunden" | "lieferanten" | "admin" }) {
  const sb = await sbServer();
  const { data: { user } } = await sb.auth.getUser();
  const [{ data: projekte }, { data: admin }] = await Promise.all([
    sb.from("projects").select("id,name").eq("status", "aktiv").order("created_at", { ascending: false }),
    user ? sb.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <aside className="side">
      <Link href="/projekte" className="brand">
        <svg width="20" height="20" viewBox="0 0 32 32"><path d="M16 6 L26 26 H6 Z" fill="none" stroke="#ff9e2c" strokeWidth="3" strokeLinejoin="round" /><circle cx="16" cy="20" r="2.5" fill="#ff9e2c" /></svg>
        Aktenfest
      </Link>
      <div className="grp">Stammdaten</div>
      <Link href="/kunden" className={aktiv === "kunden" ? "itm an" : "itm"}>Auftraggeber</Link>
      <Link href="/lieferanten" className={aktiv === "lieferanten" ? "itm an" : "itm"}>Lieferanten</Link>
      <div className="grp">Projekte</div>
      {(projekte ?? []).map((p) => <Link key={p.id} href={`/projekte/${p.id}`} className="itm">{p.name}</Link>)}
      {admin && (
        <>
          <div className="grp">Betrieb</div>
          <Link href="/admin" className={aktiv === "admin" ? "itm an" : "itm"}>Kennzahlen</Link>
        </>
      )}
      <div className="sidefoot">{user?.email}</div>
    </aside>
  );
}
