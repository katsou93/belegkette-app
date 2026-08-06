import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { oeffentlich, geheim } from "@/lib/env";

type Keks = { name: string; value: string; options?: Record<string, unknown> };

/** Supabase mit der Sitzung des angemeldeten Nutzers. Zeilensicherheit greift. */
export async function sbServer() {
  const store = await cookies();
  return createServerClient(oeffentlich.supabaseUrl, oeffentlich.supabaseAnonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (liste: Keks[]) => {
        // In Server Components ist Schreiben nicht erlaubt. Das ist erwartet:
        // die Middleware frischt die Sitzung auf, hier darf es fehlschlagen.
        try {
          liste.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* absichtlich still */
        }
      },
    },
  });
}

export const MODEL = "claude-sonnet-4-5";

/**
 * Die Systemanweisung ist das Produkt.
 *
 * Jede Regel steht hier, weil ihr Fehlen in der Erprobung zu einem
 * konkreten Fehler geführt hat — nicht, weil sie gut klingt:
 *
 *   Regel 1 und 2  gegen erfundene Details. Das Modell neigt dazu, eine
 *                  Lücke im Sachverhalt plausibel zu füllen. In einem
 *                  Beweismittel ist das der schlimmste denkbare Fehler.
 *   Regel 4        gegen paraphrasierte Zitate. Ein Zitat, das nicht wörtlich
 *                  ist, macht den ganzen Vermerk angreifbar.
 *   Regel 5        gegen Überempfindlichkeit. Ohne Leistungsumfang hielt das
 *                  Modell jede Rückfrage für einen Nachtrag.
 *   Regel 6        gegen Eskalation. Ein Formulierungsvorschlag mit Betrag
 *                  und Frist wird nie verschickt, weil er den Kunden verärgert.
 */
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
7. terminwirkung nur auf true setzen, wenn der Text eine Verzoegerung, eine Behinderung oder eine Terminverschiebung erkennen laesst.

MEHRERE VORGÄNGE
Eine Nachricht kann mehrere unabhängige Sachverhalte enthalten. Erstelle dann für jeden einen eigenen Vermerk.

KEIN VORGANG
Ohne dokumentationswürdigen Sachverhalt ein leeres Array zurückgeben.`;

export interface Draft {
  titel: string;
  sachverhalt: string;
  zitat: string;
  betroffene_leistung: string;
  art: string;
  abweichung: "ja" | "unklar" | "nein";
  begruendung: string;
  offene_punkte: string[];
  vorschlag: string;
  terminwirkung: boolean;
}

export interface Ergebnis {
  vermerke: Draft[];
  tokens: { ein: number; aus: number };
}

const WERKZEUG = {
  name: "vermerke_anlegen",
  description: "Legt Aktenvermerke aus der Nachricht an.",
  input_schema: {
    type: "object" as const,
    properties: {
      vermerke: {
        type: "array",
        items: {
          type: "object",
          properties: {
            titel: { type: "string" },
            sachverhalt: { type: "string" },
            zitat: { type: "string" },
            betroffene_leistung: { type: "string" },
            art: {
              type: "string",
              enum: ["Materialänderung", "Mengenänderung", "Terminänderung", "Funktionserweiterung", "Zusatzleistung", "Sonstiges"],
            },
            abweichung: { type: "string", enum: ["ja", "unklar", "nein"] },
            begruendung: { type: "string" },
            offene_punkte: { type: "array", items: { type: "string" } },
            vorschlag: { type: "string" },
            terminwirkung: { type: "boolean" },
          },
          required: [
            "titel", "sachverhalt", "zitat", "betroffene_leistung", "art",
            "abweichung", "begruendung", "offene_punkte", "vorschlag", "terminwirkung",
          ],
        },
      },
    },
    required: ["vermerke"],
  },
};

export interface Eingabe {
  projekt: string;
  auftragswert?: number | null;
  quelle: string;
  datum: string;
  text: string;
  umfang?: string | null;
}

export async function erstelleVermerke(i: Eingabe): Promise<Ergebnis> {
  const client = new Anthropic({
    apiKey: geheim.anthropicKey,
    maxRetries: 2,
    timeout: 45_000,
  });

  const kontext = [
    `Projekt: ${i.projekt}`,
    i.auftragswert ? `Auftragswert: ${i.auftragswert} EUR` : "",
    `Quelle: ${i.quelle}`,
    `Datum: ${i.datum}`,
    i.umfang ? `\nVEREINBARTER LEISTUNGSUMFANG:\n${i.umfang.slice(0, 8000)}` : "",
    "",
    "NACHRICHT:",
    i.text.slice(0, 40_000),
  ]
    .filter(Boolean)
    .join("\n");

  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    // Die Systemanweisung ist lang und bei jedem Aufruf identisch.
    // Zwischenspeichern senkt die Kosten je Aufruf spürbar.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    tools: [WERKZEUG],
    tool_choice: { type: "tool", name: "vermerke_anlegen" },
    messages: [{ role: "user", content: kontext }],
  });

  const tokens = { ein: res.usage?.input_tokens ?? 0, aus: res.usage?.output_tokens ?? 0 };
  const block = res.content.find((c) => c.type === "tool_use");
  if (!block || block.type !== "tool_use") return { vermerke: [], tokens };

  const roh = (block.input as { vermerke?: unknown }).vermerke;
  if (!Array.isArray(roh)) return { vermerke: [], tokens };

  // Das Modell hält sich fast immer an das Schema. Fast immer reicht hier
  // nicht: ein fehlendes Pflichtfeld würde beim Einfügen als
  // Datenbankfehler landen statt als verständliche Meldung.
  const vermerke = roh.filter(istDraft);
  return { vermerke, tokens };
}

function istDraft(x: unknown): x is Draft {
  if (typeof x !== "object" || x === null) return false;
  const d = x as Record<string, unknown>;
  return (
    typeof d.titel === "string" && d.titel.trim() !== "" &&
    typeof d.sachverhalt === "string" && d.sachverhalt.trim() !== "" &&
    typeof d.zitat === "string" &&
    ["ja", "unklar", "nein"].includes(d.abweichung as string) &&
    Array.isArray(d.offene_punkte)
  );
}
