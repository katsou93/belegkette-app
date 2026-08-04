import { createBrowserClient } from "@supabase/ssr";
export const sbBrowser = () => createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
export type Deviation = "ja" | "unklar" | "nein";
export type EntryStatus = "offen" | "angezeigt" | "erledigt" | "verworfen";
export interface Entry {
  id: string; project_id: string; seq: number; occurred_on: string; source: string;
  raw_text: string; title: string; facts: string; quote: string;
  affected_scope: string | null; change_type: string | null; deviation: Deviation;
  reasoning: string | null; open_questions: string[]; suggestion: string | null;
  status: EntryStatus; created_at: string;
}
export const euro = (n: number | null | undefined) => n == null ? "" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
export const datum = (iso: string) => new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
