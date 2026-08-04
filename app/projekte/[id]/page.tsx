import Link from "next/link";
import { notFound } from "next/navigation";
import { sbServer } from "@/lib/server";
import { euro, type Entry } from "@/lib/browser";
import { VermerkKarte, Erfassen, ExportKnopf } from "@/components/ui";
export const dynamic = "force-dynamic";
export default async function Projekt({ params }: { params: Promise<{ id: string }> }) {
const { id } = await params;
const sb = await sbServer();
const { data: p } = await sb.from("projects").select("id,name,contract_value,inbound_token").eq("id", id).single();
if (!p) notFound();
const { data: alle } = await sb.from("projects").select("id,name").eq("status", "aktiv").order("created_at", { ascending: false });
const { data: rows } = await sb.from("entries").select("*").eq("project_id", id).order("seq", { ascending: false });
const list = (rows ?? []) as Entry[];
const offen = list.filter((e) => e.deviation === "ja" && e.status === "offen").length;
return (
<div className="shell">
<aside className="side">
<Link href="/projekte" className="brand">
<svg width="20" height="20" viewBox="0 0 32 32"><path d="M16 6 L26 26 H6 Z" fill="none" stroke="#ff9e2c" strokeWidth="3" strokeLinejoin="round"/><circle cx="16" cy="20" r="2.5" fill="#ff9e2c"/></svg>
Belegkette
</Link>
<div className="grp">Projekte</div>
{(alle ?? []).map((x) => <Link key={x.id} href={`/projekte/${x.id}`} className="itm">{x.name}</Link>)}
</aside>
<main className="main">
<div className="head">
<div>
<h1>{p.name}</h1>
<div className="sub">{list.length} Vermerk{list.length === 1 ? "" : "e"}{offen > 0 && ` - ${offen} offen`}{p.contract_value ? ` - Auftragswert ${euro(p.contract_value)}` : ""}</div>
</div>
<div style={{ display: "flex", gap: 8 }}>
<ExportKnopf projekt={p.name} entries={list} />
<Erfassen projectId={p.id} />
</div>
</div>
<div className="hinweis">Weiterleiten an: <b>p-{p.inbound_token}@in.belegkette.de</b></div>
{!list.length ? <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: ".9rem" }}>Noch keine Vermerke.</div> : list.map((e) => <VermerkKarte key={e.id} e={e} />)}
</main>
</div>
);
}
