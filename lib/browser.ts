import { createBrowserClient } from "@supabase/ssr";
export const sbBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
export type Deviation = "ja" | "unklar" | "nein";
export type EntryStatus = "offen" | "angezeigt" | "erledigt" | "verworfen";
export type SourceKind = "weitergeleitet" | "eigene_notiz" | "sprachnotiz";
export type DiscardReason = "kein_vorgang" | "war_beauftragt" | "doppelung" | "sonstiges";
export type Gegenseite = "auftraggeber" | "lieferant";
export interface Kunde { id: string; name: string; domains: string[]; note: string | null; created_at: string; }
export interface Lieferant { id: string; name: string; domains: string[]; note: string | null; created_at: string; }
export type SicherheitArt = "einbehalt" | "vertragserfuellungsbuergschaft" | "gewaehrleistungsbuergschaft" | "anzahlungsbuergschaft" | "sonstige";
export interface Sicherheit {
id: string; project_id: string; kind: SicherheitArt; amount: number; percent: number | null;
issued_on: string | null; release_due_on: string | null; reminder_on: string | null;
status: "offen" | "angefordert" | "zurueck" | "verfallen";
aval_rate: number | null; bank: string | null; reference: string | null; note: string | null;
}
export const SICHERHEIT_ART: Record<SicherheitArt, string> = {
einbehalt: "Sicherheitseinbehalt",
vertragserfuellungsbuergschaft: "Vertragserfüllungsbürgschaft",
gewaehrleistungsbuergschaft: "Gewährleistungsbürgschaft",
anzahlungsbuergschaft: "Anzahlungsbürgschaft",
sonstige: "Sonstige Sicherheit",
};
export interface Projekt { id: string; name: string; contract_value: number | null; scope_text: string | null; customer_id: string | null; status: string; inbound_token: string; }
export interface Entry {
id: string; project_id: string; seq: number; occurred_on: string; source: string;
raw_text: string; title: string; facts: string; quote: string;
affected_scope: string | null; change_type: string | null; deviation: Deviation;
reasoning: string | null; open_questions: string[]; suggestion: string | null;
status: EntryStatus; created_at: string;
estimated_value: number | null; wiedervorlage_am: string | null;
discard_reason: DiscardReason | null; source_kind: SourceKind;
prev_hash: string | null; hash: string | null;
counterparty_kind: Gegenseite; supplier_id: string | null; schedule_impact: boolean;
notified_on: string | null; notified_kind: string | null;
}
export const HERKUNFT: Record<SourceKind, { text: string; hinweis: string }> = {
weitergeleitet: { text: "Weitergeleitet", hinweis: "Nachricht Dritter — enthält den Wortlaut der Gegenseite." },
eigene_notiz:   { text: "Eigene Notiz",   hinweis: "Selbst erfasst — Parteierklärung, kein fremder Wortlaut." },
sprachnotiz:    { text: "Sprachnotiz",    hinweis: "Transkribiert — selbst erfasst, Parteierklärung." },
};
export const euro = (n: number | null | undefined) => n == null ? "" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const datum = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
