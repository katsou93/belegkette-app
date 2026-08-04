import Link from "next/link";
import { sbServer } from "@/lib/server";
import { euro } from "@/lib/browser";
import { NeuesProjekt } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Projekte() {
const sb = await sbServer();
const { data: { user } } = await sb.auth.getUser();
const { data: projekte } = await sb.from("projects").select("id,name,contract_value").eq("status", "aktiv").order("created_at", { ascending: false });
const ids = (projekte ?? []).map((p) => p.id);
const { data: entries } = ids.length ? await sb.from("entries").select("project_id,deviation,status").in("project_id", ids) : { data: [] as { project_id: string; deviation: string; status: string }[] };
const zaehl = (id: string) => {
const e = (entries ?? []).filter((x) => x.project_id === id);
return { g: e.length, o: e.filter((x) => x.deviation === "ja" && x.status === "offen").length };
};
return (
<div className="shell">
<aside className="side">
<Link href="/projekte" className="brand">
<svg width="20" height="20" viewBox="0 0 32 32"><path d="M16 6 L26 26 H6 Z" fill="none" stroke="#ff9e2c" strokeWidth="3" strokeLinejoin="round"/><circle cx="16" cy="20" r="2.5" fill="#ff9e2c"/></svg>
Belegkette
</Link>
<div className="grp">Projekte</div>
{(projekte ?? []).map((p) => <Link key={p.id} href={`/projekte/${p.id}`} className="itm">{p.name}</Link>)}
<div className="sidefoot">{user?.email}</div>
</aside>
<main className="main">
<div className="head">
<div><h1>Projekte</h1><div className="sub">{projekte?.length ?? 0} aktiv</div></div>
<NeuesProjekt />
</div>
{!projekte?.length ? <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: ".9rem" }}>Noch kein Projekt angelegt.</div> : (
<table>
<thead><tr><th>Projekt</th><th className="num">Auftragswert</th><th className="num">Vermerke</th><th className="num">Offen</th></tr></thead>
<tbody>
{projekte.map((p) => { const z = zaehl(p.id); return (
<tr key={p.id}>
<td style={{ fontWeight: 600 }}><Link href={`/projekte/${p.id}`}>{p.name}</Link></td>
<td className="num">{euro(p.contract_value)}</td>
<td className="num">{z.g}</td>
<td className="num">{z.o > 0 ? <span className="tag t-ja">{z.o}</span> : <span style={{ color: "var(--muted)" }}>-</span>}</td>
</tr>); })}
</tbody>
</table>
)}
</main>
</div>
);
}
