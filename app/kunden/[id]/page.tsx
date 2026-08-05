import Link from "next/link";
import { notFound } from "next/navigation";
import { sbServer } from "@/lib/server";
import { euro, datum } from "@/lib/browser";
import { Seitenleiste } from "@/components/nav";
export const dynamic = "force-dynamic";

export default async function Kundenakte({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await sbServer();
  const { data: k } = await sb.from("customers").select("id,name,domains,note").eq("id", id).single();
  if (!k) notFound();

  const { data: projekte } = await sb.from("projects")
    .select("id,name,contract_value,status,created_at,archived_at")
    .eq("customer_id", id).order("created_at", { ascending: false });

  const { data: kz } = await sb.from("kunden_kennzahlen").select("*").eq("customer_id", id).maybeSingle();

  const ids = (projekte ?? []).map((p) => p.id);
  const { data: vermerke } = ids.length
    ? await sb.from("entries").select("id,seq,title,occurred_on,deviation,status,change_type,project_id")
        .in("project_id", ids).eq("deviation", "ja").order("occurred_on", { ascending: false }).limit(8)
    : { data: [] as { id: string; seq: number; title: string; occurred_on: string; deviation: string; status: string; change_type: string | null; project_id: string }[] };

  const laufend = (projekte ?? []).filter((p) => p.status === "aktiv");
  const fertig = (projekte ?? []).filter((p) => p.status !== "aktiv");
  const arten = new Map<string, number>();
  for (const v of vermerke ?? []) if (v.change_type) arten.set(v.change_type, (arten.get(v.change_type) ?? 0) + 1);
  const haeufigste = [...arten.entries()].sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="shell">
      <Seitenleiste aktiv="kunden" />
      <main className="main">
        <div className="head">
          <div>
            <h1>{k.name}</h1>
            <div className="sub">
              {kz?.projekte_gesamt ?? 0} Projekte · {kz?.vermerke_gesamt ?? 0} Vermerke
              {k.domains?.length ? ` · ${k.domains.join(", ")}` : ""}
            </div>
          </div>
          <Link href="/kunden" className="btn sec sm">Zurück</Link>
        </div>

        <section className="card">
          <div className="abschnitt-kopf"><div><h3>Zahlen</h3><div className="sub">Über alle Projekte dieses Auftraggebers</div></div></div>
          <table style={{ marginTop: 12 }}>
            <tbody>
              <tr><td>Projekte laufend / abgeschlossen</td><td className="num">{kz?.projekte_aktiv ?? 0} / {kz?.projekte_abgeschlossen ?? 0}</td></tr>
              <tr><td>Dokumentierte Abweichungen</td><td className="num">{kz?.abweichungen ?? 0}</td></tr>
              <tr><td>Davon noch offen</td><td className="num">{kz?.abweichungen_offen ?? 0}</td></tr>
              <tr><td>Wert offen</td><td className="num">{kz?.wert_offen ? euro(Number(kz.wert_offen)) : "-"}</td></tr>
              <tr><td>Wert erledigt</td><td className="num">{kz?.wert_erledigt ? euro(Number(kz.wert_erledigt)) : "-"}</td></tr>
            </tbody>
          </table>
          {haeufigste && (
            <p className="fussnote">
              Häufigste Art von Abweichung bei diesem Auftraggeber: <b>{haeufigste[0]}</b> ({haeufigste[1]}×).
              Beobachtung aus den erfassten Vorgängen, keine Bewertung.
            </p>
          )}
        </section>

        <section className="card">
          <div className="abschnitt-kopf"><div><h3>Laufende Projekte</h3></div></div>
          {!laufend.length ? <p className="fussnote">Keine laufenden Projekte.</p> : (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Projekt</th><th className="num">Auftragswert</th></tr></thead>
              <tbody>{laufend.map((p) => (
                <tr key={p.id}><td style={{ fontWeight: 600 }}><Link href={`/projekte/${p.id}`}>{p.name}</Link></td>
                <td className="num">{p.contract_value ? euro(Number(p.contract_value)) : "-"}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>

        <section className="card">
          <div className="abschnitt-kopf"><div><h3>Abgeschlossene Projekte</h3><div className="sub">Akte bleibt für die Gewährleistung lesbar</div></div></div>
          {!fertig.length ? <p className="fussnote">Noch keins abgeschlossen.</p> : (
            <table style={{ marginTop: 12 }}>
              <thead><tr><th>Projekt</th><th className="num">Auftragswert</th><th>Archiviert</th></tr></thead>
              <tbody>{fertig.map((p) => (
                <tr key={p.id}><td style={{ fontWeight: 600 }}><Link href={`/projekte/${p.id}`}>{p.name}</Link></td>
                <td className="num">{p.contract_value ? euro(Number(p.contract_value)) : "-"}</td>
                <td>{p.archived_at ? datum(p.archived_at) : "-"}</td></tr>
              ))}</tbody>
            </table>
          )}
        </section>

        {!!vermerke?.length && (
          <section className="card">
            <div className="abschnitt-kopf"><div><h3>Zuletzt dokumentierte Abweichungen</h3></div></div>
            <ol className="kette">
              {vermerke.map((v) => (
                <li key={v.id}>
                  <span className="kette-datum">{datum(v.occurred_on)}</span>
                  <span className="kette-text"><b>{v.title}</b>
                    <span className="kette-quelle">{v.change_type ?? "-"} · Status {v.status}</span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="fussnote">Auszug aus den Projektakten. Die Vermerke selbst stehen unverändert im jeweiligen Projekt.</p>
          </section>
        )}
      </main>
    </div>
  );
}
