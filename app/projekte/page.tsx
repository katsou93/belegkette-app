import Link from "next/link";
import { sbServer } from "@/lib/server";
import { euro } from "@/lib/browser";
import { NeuesProjekt } from "@/components/ui";
import { Seitenleiste } from "@/components/nav";
export const dynamic = "force-dynamic";
export default async function Projekte() {
const sb = await sbServer();
const { data: { user } } = await sb.auth.getUser();
const { data: projekte } = await sb.from("projects").select("id,name,contract_value").eq("status", "aktiv").order("created_at", { ascending: false });
const { data: kunden } = await sb.from("customers").select("id,name").order("name");
const ids = (projekte ?? []).map((p) => p.id);
const { data: entries } = ids.length ? await sb.from("entries").select("project_id,deviation,status").in("project_id", ids) : { data: [] as { project_id: string; deviation: string; status: string }[] };
const zaehl = (id: string) => {
const e = (entries ?? []).filter((x) => x.project_id === id);
return { g: e.length, o: e.filter((x) => x.deviation === "ja" && x.status === "offen").length };
};
return (
<div className="shell">
<Seitenleiste aktiv="projekte" />
<main className="main">
<div className="head">
<div><h1>Projekte</h1><div className="sub">{projekte?.length ?? 0} aktiv</div></div>
<NeuesProjekt kunden={kunden ?? []} />
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
