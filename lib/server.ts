import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";

export async function sbServer() {
const store = await cookies();
return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
cookies: {
getAll: () => store.getAll(),
setAll: (list: { name: string; value: string; options?: Record<string, unknown> }[]) => { try { list.forEach(({ name, value, options }) => store.set(name, value, options)); } catch {} },
},
});
}

export const MODEL = "claude-sonnet-4-5";

export const SYSTEM = `Du bist ein erfahrener Projektkaufmann im deutschen Maschinen- und Anlagenbau und erstellst Aktenvermerke.

AUFGABE
Aus einer weitergeleiteten Nachricht einen sachlichen, gerichtsfesten Aktenvermerk erstellen.

GRUNDREGELN
1. Nur festhalten, was im Text steht. Nichts ergänzen, nichts vermuten.
2. Was unklar ist, gehört unter offene_punkte, nicht in den Sachverhalt.
3. Sachlicher Kanzleiton. Keine Wertung, keine Schuldzuweisung.
4. Das Zitat muss WÖRTLICH aus dem Original stammen.
5. Bei abweichung streng sein. Ist ein LEISTUNGSUMFANG angegeben, pruefe ausschliesslich dagegen: ja nur, wenn die Anforderung dort erkennbar nicht enthalten ist. Ohne Leistungsumfang urteile zurueckhaltender und nutze haeufiger unklar. Rueckfragen und Bestaetigungen sind immer nein.
6. Der Formulierungsvorschlag ist eine höfliche Mitteilung, kein Forderungsschreiben. Nie Beträge nennen, nie drohen.

MEHRERE VORGÄNGE
Eine Nachricht kann mehrere unabhängige Sachverhalte enthalten. Erstelle dann für jeden einen eigenen Vermerk.

KEIN VORGANG
Ohne dokumentationswürdigen Sachverhalt ein leeres Array zurückgeben.`;

export interface Draft {
titel: string; sachverhalt: string; zitat: string; betroffene_leistung: string;
art: string; abweichung: "ja" | "unklar" | "nein"; begruendung: string;
offene_punkte: string[]; vorschlag: string; terminwirkung: boolean;
}

export async function erstelleVermerke(i: { projekt: string; auftragswert?: number | null; quelle: string; datum: string; text: string; umfang?: string | null }): Promise<Draft[]> {
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
const kontext = [
`Projekt: ${i.projekt}`,
i.auftragswert ? `Auftragswert: ${i.auftragswert} EUR` : "",
`Quelle: ${i.quelle}`,
`Datum: ${i.datum}`,
i.umfang ? `\nVEREINBARTER LEISTUNGSUMFANG:\n${i.umfang.slice(0, 8000)}` : "",
"",
"NACHRICHT:",
i.text.slice(0, 40000),
].filter(Boolean).join("\n");
const res = await client.messages.create({
model: MODEL,
max_tokens: 2000,
system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
tools: [{
name: "vermerke_anlegen",
description: "Legt Aktenvermerke aus der Nachricht an.",
input_schema: {
type: "object",
properties: {
vermerke: {
type: "array",
items: {
type: "object",
properties: {
titel: { type: "string" }, sachverhalt: { type: "string" }, zitat: { type: "string" },
betroffene_leistung: { type: "string" },
art: { type: "string", enum: ["Materialänderung","Mengenänderung","Terminänderung","Funktionserweiterung","Zusatzleistung","Sonstiges"] },
abweichung: { type: "string", enum: ["ja","unklar","nein"] },
begruendung: { type: "string" },
offene_punkte: { type: "array", items: { type: "string" } },
vorschlag: { type: "string" },
terminwirkung: { type: "boolean" },
},
required: ["titel","sachverhalt","zitat","betroffene_leistung","art","abweichung","begruendung","offene_punkte","vorschlag","terminwirkung"],
},
},
},
required: ["vermerke"],
},
}],
tool_choice: { type: "tool", name: "vermerke_anlegen" },
messages: [{ role: "user", content: kontext }],
});
const b = res.content.find((c) => c.type === "tool_use");
if (!b || b.type !== "tool_use") return [];
return ((b.input as { vermerke?: Draft[] }).vermerke ?? []);
}
