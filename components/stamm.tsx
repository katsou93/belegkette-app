"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sbBrowser } from "@/lib/browser";

async function meineOrg() {
  const sb = sbBrowser();
  const { data: { user } } = await sb.auth.getUser();
  const { data } = await sb.from("memberships").select("org_id").eq("user_id", user!.id).limit(1).single();
  return data?.org_id as string | undefined;
}

/* Auftraggeber oder Lieferant anlegen — dieselbe Maske, zwei Tabellen */
export function NeueGegenseite({ tabelle, titel }: { tabelle: "customers" | "suppliers"; titel: string }) {
  const [offen, setOffen] = useState(false);
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  const router = useRouter();

  async function anlegen(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setFehler("");
    const org = await meineOrg();
    if (!org) { setFehler("Kein Betrieb gefunden."); setBusy(false); return; }
    const domains = domain.trim() ? [domain.trim().toLowerCase().replace(/^@/, "")] : [];
    const { error } = await sbBrowser().from(tabelle).insert({ org_id: org, name: name.trim(), domains });
    setBusy(false);
    if (error) { setFehler(error.code === "23505" ? "Gibt es schon." : "Konnte nicht angelegt werden."); return; }
    setName(""); setDomain(""); setOffen(false); router.refresh();
  }

  if (!offen) return <button className="btn acc" onClick={() => setOffen(true)}>{titel}</button>;
  return (
    <form onSubmit={anlegen} className="card" style={{ width: "100%", maxWidth: 430 }}>
      <h3 style={{ fontSize: ".95rem", marginBottom: 12 }}>{titel}</h3>
      <label>Name</label>
      <input className="inp" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Musterbau Anlagentechnik GmbH" />
      <label style={{ marginTop: 12 }}>E-Mail-Domain (optional)</label>
      <input className="inp" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="musterbau.de" />
      <p className="fussnote">Dient der automatischen Zuordnung eingehender Nachrichten. Freemail-Adressen werden nie zugeordnet.</p>
      {fehler && <div className="err">{fehler}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <button className="btn acc" disabled={busy}>{busy ? "Speichert ..." : "Anlegen"}</button>
        <button type="button" className="btn sec" onClick={() => setOffen(false)}>Abbrechen</button>
      </div>
    </form>
  );
}

/* Vereinbarter Leistungsumfang und Vertragsdaten am Projekt */
export function Projektdaten({ projekt }: {
  projekt: {
    id: string; scope_text: string | null; payment_terms_days: number | null;
    penalty_rate: number | null; penalty_cap_percent: number | null;
    warranty_months: number | null; retention_percent: number | null; acceptance_rule: string | null;
  };
}) {
  const [offen, setOffen] = useState(false);
  const [umfang, setUmfang] = useState(projekt.scope_text ?? "");
  const [ziel, setZiel] = useState(projekt.payment_terms_days?.toString() ?? "");
  const [strafe, setStrafe] = useState(projekt.penalty_rate?.toString() ?? "");
  const [deckel, setDeckel] = useState(projekt.penalty_cap_percent?.toString() ?? "");
  const [gewaehr, setGewaehr] = useState(projekt.warranty_months?.toString() ?? "");
  const [einbehalt, setEinbehalt] = useState(projekt.retention_percent?.toString() ?? "");
  const [abnahme, setAbnahme] = useState(projekt.acceptance_rule ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();

  const zahl = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

  async function sichern(ev: React.FormEvent) {
    ev.preventDefault(); setBusy(true); setMsg("");
    const { error } = await sbBrowser().from("projects").update({
      scope_text: umfang.trim() || null,
      payment_terms_days: zahl(ziel), penalty_rate: zahl(strafe),
      penalty_cap_percent: zahl(deckel), warranty_months: zahl(gewaehr),
      retention_percent: zahl(einbehalt), acceptance_rule: abnahme.trim() || null,
    }).eq("id", projekt.id);
    setBusy(false);
    if (error) { setMsg("Konnte nicht gespeichert werden."); return; }
    setOffen(false); router.refresh();
  }

  const ungedeckelt = projekt.penalty_rate != null && projekt.penalty_cap_percent == null;

  if (!offen) {
    return (
      <section className="card">
        <div className="abschnitt-kopf">
          <div>
            <h3>Vertrag und Leistungsumfang</h3>
            <div className="sub">
              {projekt.scope_text
                ? "Leistungsumfang hinterlegt — die Einstufung prüft dagegen"
                : "Kein Leistungsumfang hinterlegt — die Einstufung urteilt zurückhaltender"}
            </div>
          </div>
          <button className="btn sec sm" onClick={() => setOffen(true)}>Bearbeiten</button>
        </div>
        {ungedeckelt && (
          <div className="warnung" style={{ marginTop: 12, marginBottom: 0 }}>
            <div className="warnung-t">Vertragsstrafe ohne Deckel</div>
            <p className="warnung-h">
              Es ist eine Vertragsstrafe von {projekt.penalty_rate} % je Woche hinterlegt, aber keine Obergrenze.
              Das ist ungewöhnlich und sollte geprüft werden. Hinweis, keine Rechtsberatung.
            </p>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="card">
      <form onSubmit={sichern}>
        <h3 style={{ fontSize: ".95rem", marginBottom: 4 }}>Vertrag und Leistungsumfang</h3>
        <p style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 14 }}>
          Der Leistungsumfang ist die Messlatte: Ohne ihn rät die Einstufung, mit ihm prüft sie dagegen.
        </p>
        <label>Vereinbarter Leistungsumfang</label>
        <textarea className="inp" value={umfang} onChange={(e) => setUmfang(e.target.value)}
          placeholder="Stichworte oder Auszug aus Lastenheft, LV oder Auftragsbestätigung ..." />
        <div className="row" style={{ marginTop: 12 }}>
          <div><label>Zahlungsziel in Tagen</label><input className="inp" inputMode="numeric" value={ziel} onChange={(e) => setZiel(e.target.value)} placeholder="30" /></div>
          <div><label>Gewährleistung in Monaten</label><input className="inp" inputMode="numeric" value={gewaehr} onChange={(e) => setGewaehr(e.target.value)} placeholder="24" /></div>
        </div>
        <div className="row">
          <div><label>Vertragsstrafe % je Woche</label><input className="inp" value={strafe} onChange={(e) => setStrafe(e.target.value)} placeholder="0,5" /></div>
          <div><label>Deckel in % der Auftragssumme</label><input className="inp" value={deckel} onChange={(e) => setDeckel(e.target.value)} placeholder="5" /></div>
        </div>
        <div className="row">
          <div><label>Sicherheitseinbehalt in %</label><input className="inp" value={einbehalt} onChange={(e) => setEinbehalt(e.target.value)} placeholder="5" /></div>
          <div><label>Abnahmeregelung</label><input className="inp" value={abnahme} onChange={(e) => setAbnahme(e.target.value)} placeholder="förmlich, schriftlich" /></div>
        </div>
        {msg && <div className="err">{msg}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn acc sm" disabled={busy}>{busy ? "Speichert ..." : "Speichern"}</button>
          <button type="button" className="btn sec sm" onClick={() => setOffen(false)}>Abbrechen</button>
        </div>
      </form>
    </section>
  );
}
