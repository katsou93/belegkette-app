import Link from "next/link";
import { sbServer } from "@/lib/server";
import { euro } from "@/lib/browser";
import { NeuesProjekt } from "@/components/ui";
import { Seitenleiste } from "@/components/nav";
import { ProbeHinweis } from "@/components/admin";
export const dynamic = "force-dynamic";
export default async function Projekte() {
const sb = await sbServer();
const { data: { user } } = await sb.auth.getUser();
const { data: projekte } = await sb.from("projects").select("id,name,contract_value").eq("status", "aktiv").order("created_at", { ascending: false });
const { data: kunden } = await sb.from("customers").select("id,name").order("name");
const { data: m } = user ? await sb.from("memberships").select("org_id").eq("user_id", user.id).limit(1).maybeSingle() : { data: null };
const { data: betrieb } = m ? await sb.from("orgs").select("plan,trial_ends_at").eq("id", m.org_id).maybeSingle() : { data: null };
const ids = (projekte ?? []).map((p) => p.id);
const { data: ampeln } = await sb.from("projekt_ampel")
  .select("project_id,ampel,befunde_rot,betrag_betroffen,zusammenfassung");
const { data: wb } = await sb.from("wochenbericht").select("*").maybeSingle();
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
{betrieb && <ProbeHinweis plan={betrieb.plan} endetAm={betrieb.trial_ends_at} />}
{wb && Number(wb.rot) > 0 && (
  <div className="warnung">
    <div className="warnung-t">
      {wb.rot} {Number(wb.rot) === 1 ? "Projekt braucht" : "Projekte brauchen"} jetzt eine Entscheidung
    </div>
    <p className="warnung-h" style={{ marginTop: 4 }}>
      {Number(wb.betrag_rot) > 0 && <>Betroffen sind rund <b>{euro(Number(wb.betrag_rot))}</b>. </>}
      Es geht um Ansprüche, die dokumentiert, aber nie angezeigt wurden, und um
      Sicherheiten, die zurückgefordert werden könnten.
    </p>
  </div>
)}
{!projekte?.length ? <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: ".9rem" }}>Noch kein Projekt angelegt.</div> : (
<table>
<thead><tr><th>Projekt</th><th className="num">Auftragswert</th><th className="num">Vermerke</th><th className="num">Offen</th><th>Stand</th></tr></thead>
<tbody>
{projekte.map((p) => {
  const z = zaehl(p.id);
  const a = (ampeln ?? []).find((x) => x.project_id === p.id);
  return (
<tr key={p.id}>
<td style={{ fontWeight: 600 }}><Link href={`/projekte/${p.id}`}>{p.name}</Link></td>
<td className="num">{euro(p.contract_value)}</td>
<td className="num">{z.g}</td>
<td className="num">{z.o > 0 ? <span className="tag t-ja">{z.o}</span> : <span style={{ color: "var(--muted)" }}>-</span>}</td>
{/* Der Befund im Klartext statt einer Punktzahl. Wer eine Zahl sieht,
    fragt nach der Formel; wer einen Satz liest, handelt. */}
<td style={{ fontSize: ".8rem", maxWidth: 340 }}>
  {a?.ampel === "rot" && <span className="tag t-ja">handeln</span>}
  {a?.ampel === "gelb" && <span className="tag t-unklar">beobachten</span>}
  {(!a || a.ampel === "gruen") && <span style={{ color: "var(--muted)" }}>unauffällig</span>}
  {a && a.ampel !== "gruen" && (
    <div style={{ color: "var(--muted)", marginTop: 3, lineHeight: 1.4 }}>{a.zusammenfassung}</div>
  )}
</td>
</tr>); })}
</tbody>
</table>
)}
</main>
</div>
);
}
