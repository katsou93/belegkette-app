"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  sbBrowser, euro, datum,
  SICHERHEIT_ART, type Sicherheit, type SicherheitArt, type Entry,
} from "@/lib/browser";
import { DOKUMENT_TYP, type DokumentTyp } from "@/lib/dokument";

/* ------------------------------------------------------------------
   Warnung vor Annahme der Schlusszahlung
   Der einzige Fehler im Projekt, der sich nicht mehr reparieren laesst.
------------------------------------------------------------------ */
export function SchlusszahlungWarnung({
  offeneVorgaenge, wertOffen, sicherheitenOffen,
}: { offeneVorgaenge: number; wertOffen: number; sicherheitenOffen: number }) {
  if (!offeneVorgaenge && !sicherheitenOffen) return null;
  return (
    <div className="warnung">
      <div className="warnung-t">Vor Annahme der Schlusszahlung prüfen</div>
      <ul>
        {offeneVorgaenge > 0 && (
          <li>
            {offeneVorgaenge} dokumentierte {offeneVorgaenge === 1 ? "Abweichung ist" : "Abweichungen sind"} noch offen
            {wertOffen > 0 && <> — geschätzt <b>{euro(wertOffen)}</b></>}
          </li>
        )}
        {sicherheitenOffen > 0 && <li>Sicherheiten in Höhe von <b>{euro(sicherheitenOffen)}</b> sind noch nicht zurück</li>}
      </ul>
      <p className="warnung-h">
        Eine vorbehaltlos angenommene Schlusszahlung kann Nachforderungen ausschließen.
        Wenn noch etwas offen ist, sollte der Vorbehalt schriftlich erklärt werden.
        Das ist ein Hinweis, keine Rechtsberatung.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------
   Wertfeld am Vermerk — die Zahl, die aus einer Liste einen Bericht macht
------------------------------------------------------------------ */
export function WertFeld({ e }: { e: Entry }) {
  const [wert, setWert] = useState(e.estimated_value?.toString() ?? "");
  const [gesichert, setGesichert] = useState(false);
  const router = useRouter();

  async function sichern() {
    const zahl = wert.trim() === "" ? null : Number(wert.replace(/[^\d]/g, ""));
    if (zahl !== null && !Number.isFinite(zahl)) return;
    const { error } = await sbBrowser().from("entries").update({ estimated_value: zahl }).eq("id", e.id);
    if (!error) { setGesichert(true); setTimeout(() => setGesichert(false), 1600); router.refresh(); }
  }

  return (
    <span className="wertfeld">
      <label>Geschätzter Wert</label>
      <input
        className="inp" inputMode="numeric" placeholder="—" value={wert}
        onChange={(ev) => setWert(ev.target.value)} onBlur={sichern}
        onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); sichern(); } }}
      />
      <span className="einheit">€</span>
      {gesichert && <span className="ok">gespeichert</span>}
    </span>
  );
}

/* ------------------------------------------------------------------
   Sicherheiten: Einbehalte und Buergschaften mit Rueckgabefrist
------------------------------------------------------------------ */
const ARTEN = Object.keys(SICHERHEIT_ART) as SicherheitArt[];

export function Sicherheiten({ projectId, posten }: { projectId: string; posten: Sicherheit[] }) {
  const [offen, setOffen] = useState(false);
  const [art, setArt] = useState<SicherheitArt>("gewaehrleistungsbuergschaft");
  const [betrag, setBetrag] = useState("");
  const [bis, setBis] = useState("");
  const [satz, setSatz] = useState("");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  const router = useRouter();

  const gebunden = posten.filter((s) => s.status === "offen" || s.status === "angefordert")
    .reduce((a, s) => a + Number(s.amount), 0);
  const heute = new Date().toISOString().slice(0, 10);
  const faellig = posten.filter((s) => s.status === "offen" && s.release_due_on && s.release_due_on <= heute)
    .reduce((a, s) => a + Number(s.amount), 0);

  async function anlegen(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setFehler("");
    const zahl = Number(betrag.replace(/[^\d]/g, ""));
    if (!zahl) { setFehler("Betrag fehlt."); setBusy(false); return; }
    const { error } = await sbBrowser().from("securities").insert({
      project_id: projectId, kind: art, amount: zahl,
      release_due_on: bis || null,
      aval_rate: satz ? Number(satz.replace(",", ".")) : null,
    });
    setBusy(false);
    if (error) { setFehler("Konnte nicht gespeichert werden."); return; }
    setBetrag(""); setBis(""); setSatz(""); setOffen(false); router.refresh();
  }

  async function status(id: string, neu: string) {
    const { error } = await sbBrowser().from("securities").update({ status: neu }).eq("id", id);
    if (!error) router.refresh();
  }

  return (
    <section className="card">
      <div className="abschnitt-kopf">
        <div>
          <h3>Sicherheiten</h3>
          <div className="sub">
            {gebunden > 0 ? <>{euro(gebunden)} gebunden{faellig > 0 && <> · <b className="faellig">{euro(faellig)} rückforderbar</b></>}</> : "Nichts hinterlegt"}
          </div>
        </div>
        {!offen && <button className="btn sec sm" onClick={() => setOffen(true)}>Sicherheit erfassen</button>}
      </div>

      {offen && (
        <form onSubmit={anlegen} style={{ marginTop: 14 }}>
          <div className="row">
            <div>
              <label>Art</label>
              <select className="inp" value={art} onChange={(ev) => setArt(ev.target.value as SicherheitArt)}>
                {ARTEN.map((a) => <option key={a} value={a}>{SICHERHEIT_ART[a]}</option>)}
              </select>
            </div>
            <div><label>Betrag in Euro</label><input className="inp" inputMode="numeric" value={betrag} onChange={(ev) => setBetrag(ev.target.value)} placeholder="45000" /></div>
          </div>
          <div className="row">
            <div><label>Rückgabe fällig am</label><input type="date" className="inp" value={bis} onChange={(ev) => setBis(ev.target.value)} /></div>
            <div><label>Avalprovision % p. a. (optional)</label><input className="inp" value={satz} onChange={(ev) => setSatz(ev.target.value)} placeholder="1,2" /></div>
          </div>
          {fehler && <div className="err">{fehler}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn acc sm" disabled={busy}>{busy ? "Speichert ..." : "Speichern"}</button>
            <button type="button" className="btn sec sm" onClick={() => setOffen(false)}>Abbrechen</button>
          </div>
          <p className="fussnote">Die Erinnerung wird automatisch 60 Tage vor dem Rückgabetermin gesetzt.</p>
        </form>
      )}

      {posten.length > 0 && (
        <table style={{ marginTop: 14 }}>
          <thead><tr><th>Art</th><th className="num">Betrag</th><th>Rückgabe</th><th>Status</th></tr></thead>
          <tbody>
            {posten.map((s) => {
              const ueberfaellig = s.status === "offen" && s.release_due_on && s.release_due_on <= heute;
              return (
                <tr key={s.id}>
                  <td>{SICHERHEIT_ART[s.kind]}</td>
                  <td className="num">{euro(Number(s.amount))}</td>
                  <td>{s.release_due_on ? <span className={ueberfaellig ? "faellig" : ""}>{datum(s.release_due_on)}</span> : "—"}</td>
                  <td>
                    <select className="inp mini" value={s.status} onChange={(ev) => status(s.id, ev.target.value)}>
                      <option value="offen">offen</option>
                      <option value="angefordert">angefordert</option>
                      <option value="zurueck">zurück</option>
                      <option value="verfallen">verfallen</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------
   Terminkette — die Grundlage, um eine Vertragsstrafe abzuwehren
------------------------------------------------------------------ */
export function Terminkette({ eintraege }: { eintraege: Entry[] }) {
  if (!eintraege.length) return null;
  return (
    <section className="card">
      <div className="abschnitt-kopf">
        <div>
          <h3>Terminkette</h3>
          <div className="sub">{eintraege.length} Vorgang{eintraege.length === 1 ? "" : "änge"} mit Wirkung auf den Ablauf</div>
        </div>
      </div>
      <ol className="kette">
        {eintraege.map((e) => (
          <li key={e.id}>
            <span className="kette-datum">{datum(e.occurred_on)}</span>
            <span className="kette-text">
              <b>{e.title}</b>
              <span className="kette-quelle">
                {e.counterparty_kind === "lieferant" ? "Lieferant" : "Auftraggeber"} · Vermerk {String(e.seq).padStart(3, "0")}
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="fussnote">
        Chronologie aller Vorgänge, die einen Termin berührt haben. Als Anlage geeignet,
        wenn die Ursache einer Verzögerung belegt werden muss.
      </p>
    </section>
  );
}


/* ------------------------------------------------------------------
   Sendefertiges Schreiben aus einem Vermerk.
   Erzeugen ja, versenden nein — das bleibt eine bewusste Handlung.
------------------------------------------------------------------ */
export function Schreiben({ entryId, seq }: { entryId: string; seq: number }) {
  const [offen, setOffen] = useState(false);
  const [typ, setTyp] = useState<DokumentTyp>("bestaetigung");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();

  async function hole(format: "pdf" | "text") {
    setBusy(true); setMsg("");
    const r = await fetch("/api/dokument", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId, typ, format }),
    });
    if (!r.ok) { setBusy(false); setMsg("Konnte nicht erzeugt werden."); return; }
    if (format === "text") {
      const j = await r.json();
      await navigator.clipboard.writeText(j.text);
      setMsg("Text kopiert.");
    } else {
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${typ}-vermerk-${String(seq).padStart(3, "0")}.pdf`;
      a.click(); URL.revokeObjectURL(a.href);
    }
    await sbBrowser().from("entries")
      .update({ notified_on: new Date().toISOString().slice(0, 10), notified_kind: typ, status: "angezeigt" })
      .eq("id", entryId);
    setBusy(false); router.refresh();
  }

  if (!offen) return <button className="btn sec sm" onClick={() => setOffen(true)}>Schreiben erzeugen</button>;

  return (
    <div className="card" style={{ marginTop: 10, width: "100%" }}>
      <label>Art des Schreibens</label>
      <select className="inp" value={typ} onChange={(e) => setTyp(e.target.value as DokumentTyp)}>
        {(Object.keys(DOKUMENT_TYP) as DokumentTyp[]).map((t) => (
          <option key={t} value={t}>{DOKUMENT_TYP[t].titel}</option>
        ))}
      </select>
      <p className="fussnote">{DOKUMENT_TYP[typ].erklaerung}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button className="btn acc sm" disabled={busy} onClick={() => hole("pdf")}>{busy ? "..." : "PDF laden"}</button>
        <button className="btn sec sm" disabled={busy} onClick={() => hole("text")}>Text kopieren</button>
        <button className="btn sec sm" onClick={() => setOffen(false)}>Schließen</button>
      </div>
      {msg && <p className="fussnote">{msg}</p>}
      <p className="fussnote">
        Entwurf. Versendet wird aus Ihrem eigenen Postfach — der Nachweis liegt dann in Ihrem Postausgang.
        Vor dem Versand bitte prüfen; das ist keine Rechtsberatung.
      </p>
    </div>
  );
}
