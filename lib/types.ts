export type Deviation = "ja" | "unklar" | "nein";
export type EntryStatus = "offen" | "angezeigt" | "erledigt" | "verworfen";

export interface Project {
  id: string;
  org_id: string;
  name: string;
  contract_value: number | null;
  inbound_token: string;
  status: "aktiv" | "archiviert";
  created_at: string;
}

export interface Entry {
  id: string;
  project_id: string;
  seq: number;
  occurred_on: string;
  source: string;
  source_meta: Record<string, unknown>;
  raw_text: string;
  title: string;
  facts: string;
  quote: string;
  affected_scope: string | null;
  change_type: string | null;
  deviation: Deviation;
  reasoning: string | null;
  open_questions: string[];
  suggestion: string | null;
  status: EntryStatus;
  created_at: string;
}
