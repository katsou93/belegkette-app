import Link from "next/link";
import { notFound } from "next/navigation";
import { sbServer } from "@/lib/server";
import { euro, type Entry, type Sicherheit } from "@/lib/browser";
import { VermerkKarte, Erfassen, ExportKnopf } from "@/components/ui";
import { Sicherheiten, Terminkette, SchlusszahlungWarnung } from "@/components/akte";
import { Projektabschluss } from "@/components/abschluss";
import { Projektdaten } from "@/components/stamm";
import { Seitenleiste } from "@/components/nav";
export const dynamic = "force-dynamic";
export default async function Projekt({ params }: { params: Promise<{ id: string }> }) {
const { id } = await params;
const sb = await sbServer();
const { data: p } = await sb.from("projects").select("*").eq("id", id).single();
const { data: aufbewahrung } = await sb.from("aufbewahrung")
  .select("rohtext_tage,mit_rohtext,bereits_bereinigt")
  .eq("project_id", id).maybeSingle();
if (!p) notFound();
const { data: rows } = await sb.from("entries").select("*").eq("project_id", id).order("seq", { ascending: false });
const list = (rows ?? []) as Entry[];
const offen = list.filter((e) => e.deviation === "ja" && e.status === "offen").length;

const { data: sich } = await sb.from("securities").select("*").eq("project_id", id).order("release_due_on", { ascending: true, nullsFirst: false });
const posten = (sich ?? []) as Sicherheit[];

const { data: lieferanten } = await sb.from("suppliers").select("id,name").order("name");
const offeneVorgaenge = list.filter((e) => e.deviation === "ja" && (e.status === "offen" || e.status === "angezeigt"));
const wertOffen = offeneVorgaenge.reduce((a, e) => a + Number(e.estimated_value ?? 0), 0);
const sicherheitenOffen = posten.filter((x) => x.status === "offen" || x.status === "angefordert").reduce((a, x) => a + Number(x.amount), 0);
const termine = list.filter((e) => e.schedule_impact && e.status !== "verworfen")
  .sort((a, b) => a.occurred_on.localeCompare(b.occurred_on) || a.seq - b.seq);
return (
<div className="shell">
<Seitenleiste />
<main className="main">
<div className="head">
<div>
<h1>{p.name}</h1>
<div className="sub">{list.length} Vermerk{list.length === 1 ? "" : "e"}{offen > 0 && ` - ${offen} offen`}{p.contract_value ? ` - Auftragswert ${euro(p.contract_value)}` : ""}</div>
</div>
<div style={{ display: "flex", gap: 8 }}>
<ExportKnopf projekt={p.name} entries={list} />
<Erfassen projectId={p.id} lieferanten={lieferanten ?? []} />
</div>
</div>
<div className="hinweis">Weiterleiten an: <b>p-{p.inbound_token}@in.aktenfest.de</b></div>
<SchlusszahlungWarnung offeneVorgaenge={offeneVorgaenge.length} wertOffen={wertOffen} sicherheitenOffen={sicherheitenOffen} />
<Projektdaten projekt={p} />
<Sicherheiten projectId={p.id} posten={posten} />
<Projektabschluss
  projectId={p.id}
  abgeschlossenAm={p.abgeschlossen_am ?? null}
  rohtextTage={aufbewahrung?.rohtext_tage ?? 90}
  mitRohtext={Number(aufbewahrung?.mit_rohtext ?? 0)}
  bereitsBereinigt={Number(aufbewahrung?.bereits_bereinigt ?? 0)}
/>
<Terminkette eintraege={termine} />
{!list.length ? <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: ".9rem" }}>Noch keine Vermerke.</div> : list.map((e) => <VermerkKarte key={e.id} e={e} />)}
</main>
</div>
);
}
