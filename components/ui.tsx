"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { sbBrowser, datum, type Entry, type EntryStatus } from "@/lib/browser";

const LABEL: Record<string, string> = { ja: "Abweichung", unklar: "unklar", nein: "keine Abweichung" };
const STATI: EntryStatus[] = ["offen", "angezeigt", "erledigt", "verworfen"];
const QUELLEN = ["E-Mail vom Kunden", "Besprechungsprotokoll", "Telefonnotiz", "Nachricht auf der Baustelle", "Sonstiges"];

export function NeuesProjekt() {
const [offen, setOffen] = useState(false);
const [name, setName] = useState(""); const [wert, setWert] = useState("");
const [busy, setBusy] = useState(false); const [fehler, setFehler] = useState("");
const router = useRouter();
async function anlegen(e: React.FormEvent) {
e.preventDefault(); setBusy(true); setFehler("");
const sb = sbBrowser();
const { data: { user } } = await sb.auth.getUser();
const { data: m } = await sb.from("memberships").select("org_id").eq("user_id", user!.id).limit(1).single();
if (!m) { setFehler("Kein Betrieb zugeordnet."); setBusy(false); return; }
const { data, error } = await sb.from("projects").insert({ org_id: m.org_id, name: name.trim(), contract_value: wert ? Number(wert.replace(/[^\d]/g, "")) : null }).select("id").single();
setBusy(false);
if (error) { setFehler(error.message); return; }
setOffen(false); setName(""); setWert(""); router.push(`/projekte/${data.id}`); router.refresh();
}
if (!offen) return <button className="btn acc" onClick={() => setOffen(true)}>Projekt anlegen</button>;
return (
<form onSubmit={anlegen} className="card" style={{ width: "100%", maxWidth: 430 }}>
<h3 style={{ fontSize: ".95rem", marginBottom: 12 }}>Neues Projekt</h3>
<label>Bezeichnung</label>
<input className="inp" required value={name} onChange={(e) => setName(e.target.value)} placeholder="A-2418 Abfuellanlage" />
<label style={{ marginTop: 12 }}>Auftragswert in Euro (optional)</label>
<input className="inp" value={wert} onChange={(e) => setWert(e.target.value)} placeholder="4200000" inputMode="numeric" />
{fehler && <div className="err">{fehler}</div>}
<div style={{ display: "flex", gap: 8, marginTop: 16 }}>
<button className="btn acc" disabled={busy}>{busy ? "Wird angelegt ..." : "Anlegen"}</button>
<button type="button" className="btn sec" onClick={() => setOffen(false)}>Abbrechen</button>
</div>
</form>
);
}

export function Erfassen({ projectId }: { projectId: string }) {
const [offen, setOffen] = useState(false);
const [text, setText] = useState(""); const [quelle, setQuelle] = useState(QUELLEN[0]);
const [tag, setTag] = useState(new Date().toISOString().slice(0, 10));
const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
const router = useRouter();
async function senden(e: React.FormEvent) {
e.preventDefault(); setBusy(true); setMsg("");
const r = await fetch("/api/vermerk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId, text, quelle, datum: tag }) });
const j = await r.json(); setBusy(false);
if (!r.ok) { setMsg(j.error ?? "Fehler."); return; }
if (!j.vermerke?.length) { setMsg(j.hinweis ?? "Kein Vorgang erkannt."); return; }
setText(""); setOffen(false); router.refresh();
}
if (!offen) return <button className="btn acc" onClick={() => setOffen(true)}>Vorgang erfassen</button>;
return (
<form onSubmit={senden} className="card" style={{ width: "100%" }}>
<h3 style={{ fontSize: ".95rem", marginBottom: 4 }}>Vorgang erfassen</h3>
<p style={{ fontSize: ".82rem", color: "var(--muted)", marginBottom: 14 }}>Weitergeleitete Mail, Protokollabsatz oder Gespraechsnotiz einfuegen.</p>
<div className="row">
<div><label>Quelle</label><select className="inp" value={quelle} onChange={(e) => setQuelle(e.target.value)}>{QUELLEN.map((q) => <option key={q}>{q}</option>)}</select></div>
<div><label>Datum des Vorgangs</label><input type="date" className="inp" value={tag} onChange={(e) => setTag(e.target.value)} /></div>
</div>
<label>Wortlaut</label>
<textarea className="inp" required value={text} onChange={(e) => setText(e.target.value)} placeholder="Hier die weitergeleitete Nachricht einfuegen ..." />
{msg && <div className="err">{msg}</div>}
<div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
<button className="btn acc" disabled={busy || text.trim().length < 20}>{busy ? "Vermerk wird erstellt ..." : "Vermerk erstellen"}</button>
<button type="button" className="btn sec" onClick={() => setOffen(false)}>Abbrechen</button>
</div>
</form>
);
}

function alsText(e: Entry) {
return `VERMERK ${String(e.seq).padStart(3, "0")} - ${e.title}
Vorgang: ${datum(e.occurred_on)} | Quelle: ${e.source} | Erfasst: ${datum(e.created_at)}

SACHVERHALT
${e.facts}

WOERTLICHES ZITAT
"${e.quote}"

EINORDNUNG
Betroffene Leistung: ${e.affected_scope ?? "-"}
Art: ${e.change_type ?? "-"}
Ausserhalb des vereinbarten Umfangs: ${e.deviation}
Begruendung: ${e.reasoning ?? "-"}
${e.open_questions?.length ? "\nOFFENE PUNKTE\n" + e.open_questions.map((q) => "- " + q).join("\n") + "\n" : ""}
FORMULIERUNGSVORSCHLAG
${e.suggestion ?? "-"}`;
}

export function VermerkKarte({ e }: { e: Entry }) {
const [status, setStatus] = useState<EntryStatus>(e.status);
const [busy, setBusy] = useState(false);
const router = useRouter();
async function setze(neu: EntryStatus) {
setBusy(true);
const { error } = await sbBrowser().from("entries").update({ status: neu }).eq("id", e.id);
setBusy(false);
if (!error) { setStatus(neu); router.refresh(); }
}
return (
<article className={status === "verworfen" ? "vm aus" : "vm"}>
<header className="vmh">
<div>
<div className="vmnr">VERMERK {String(e.seq).padStart(3, "0")}</div>
<div className="vmt">{e.title}</div>
</div>
<div className="vmm">Vorgang: {datum(e.occurred_on)}<br />Quelle: {e.source}<br />Erfasst: {datum(e.created_at)}</div>
</header>
<div className="blk"><div className="k">Sachverhalt</div><p style={{ fontSize: ".9rem" }}>{e.facts}</p></div>
<div className="blk"><div className="k">Woertliches Zitat</div><blockquote className="zitat">{e.quote}</blockquote></div>
<div className="blk"><div className="k">Einordnung</div>
<dl className="kv">
<dt>Betroffene Leistung</dt><dd>{e.affected_scope ?? "-"}</dd>
<dt>Art</dt><dd>{e.change_type ?? "-"}</dd>
<dt>Ausserhalb des Umfangs</dt><dd><span className={"tag t-" + e.deviation}>{LABEL[e.deviation]}</span></dd>
<dt>Begruendung</dt><dd>{e.reasoning ?? "-"}</dd>
</dl>
</div>
{!!e.open_questions?.length && <div className="blk"><div className="k">Offene Punkte</div><ul className="off">{e.open_questions.map((q, i) => <li key={i}>{q}</li>)}</ul></div>}
{e.suggestion && <div className="blk"><div className="k">Formulierungsvorschlag fuer die Mitteilung</div><div className="vorschlag">{e.suggestion}</div></div>}
<footer className="vmact">
<select className="inp" style={{ width: "auto", padding: "6px 10px", fontSize: ".8rem" }} value={status} disabled={busy} onChange={(ev) => setze(ev.target.value as EntryStatus)}>
{STATI.map((s) => <option key={s} value={s}>{s}</option>)}
</select>
<button className="btn sec sm" onClick={() => navigator.clipboard.writeText(alsText(e))}>Vermerk kopieren</button>
{e.suggestion && <button className="btn sec sm" onClick={() => navigator.clipboard.writeText(e.suggestion!)}>Nur Mitteilung kopieren</button>}
</footer>
</article>
);
}

export function ExportKnopf({ projekt, entries }: { projekt: string; entries: Entry[] }) {
function go() {
const L = [`PROJEKTAKTE - ${projekt}`, `Stand: ${new Date().toLocaleDateString("de-DE")}`, `Vermerke: ${entries.length}`, "=".repeat(70), ""];
[...entries].sort((a, b) => a.seq - b.seq).forEach((e) => { L.push(alsText(e), "", "-".repeat(70), ""); });
const a = document.createElement("a");
a.href = URL.createObjectURL(new Blob([L.join("\n")], { type: "text/plain;charset=utf-8" }));
a.download = `Projektakte_${projekt.replace(/[^\w-]+/g, "_")}.txt`;
a.click(); URL.revokeObjectURL(a.href);
}
return <button className="btn sec" onClick={go} disabled={!entries.length}>Akte exportieren</button>;
}
