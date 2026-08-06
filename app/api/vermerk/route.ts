import { NextResponse, type NextRequest } from "next/server";
import { sbServer, erstelleVermerke, MODEL } from "@/lib/server";
import { fehler, koerperLesen, text, uuid, isoDatum } from "@/lib/http";
import { grenzen } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Aus einer weitergeleiteten Nachricht Aktenvermerke machen.
 *
 * Reihenfolge ist Absicht:
 *   1. Anmeldung      — ohne Nutzer gar nichts.
 *   2. Eingabe prüfen — bevor irgendetwas Geld kostet.
 *   3. Kontingent     — atomar in der Datenbank, siehe 0010.
 *   4. Modellaufruf   — erst jetzt.
 *
 * Schritt 3 vor Schritt 4 ist der ganze Punkt: Wer erst das Modell fragt
 * und danach zählt, hat schon bezahlt.
 */
export async function POST(req: NextRequest) {
  const sb = await sbServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return fehler(401, "Nicht angemeldet.");

  const body = await koerperLesen<Record<string, unknown>>(req);
  if (!body) return fehler(413, "Anfrage zu groß oder kein gültiges JSON.");

  const projectId = uuid(body.projectId);
  const inhalt = text(body.text, grenzen.maxNachricht);
  if (!projectId) return fehler(400, "Projekt fehlt.");
  if (!inhalt || inhalt.length < 20) {
    return fehler(400, "Der Wortlaut ist zu kurz. Bitte die Nachricht vollständig einfügen.");
  }

  const quelle = text(body.quelle, 200) ?? "E-Mail vom Kunden";
  const datum = isoDatum(body.datum);
  const herkunft = body.herkunft === "eigene_notiz" || body.herkunft === "sprachnotiz"
    ? (body.herkunft as string)
    : "weitergeleitet";
  const supplierId = uuid(body.supplierId);
  const gegenseite = supplierId ? "lieferant" : "auftraggeber";

  // Zeilensicherheit greift: ein fremdes Projekt liefert hier schlicht nichts.
  const { data: p, error: projektFehler } = await sb
    .from("projects")
    .select("id,name,contract_value,scope_text")
    .eq("id", projectId)
    .single();
  if (projektFehler || !p) return fehler(404, "Projekt nicht gefunden.");

  // ---- Kostenbremse ------------------------------------------------
  const { data: kontingent, error: kontingentFehler } = await sb
    .rpc("ki_kontingent_verbrauchen", {
      p_limit_tag: grenzen.kiProTag,
      p_limit_stunde: grenzen.kiProStunde,
    })
    .single<{ erlaubt: boolean; grund: string | null; rest_heute: number }>();

  if (kontingentFehler) {
    return fehler(500, "Kontingent konnte nicht geprüft werden.", kontingentFehler);
  }
  if (!kontingent?.erlaubt) {
    return NextResponse.json(
      {
        error: `${kontingent?.grund ?? "Kontingent erreicht"}. Bitte später erneut versuchen.`,
        rest_heute: kontingent?.rest_heute ?? 0,
      },
      { status: 429, headers: { "retry-after": "3600" } },
    );
  }

  // ---- Modellaufruf ------------------------------------------------
  let ergebnis;
  try {
    ergebnis = await erstelleVermerke({
      projekt: p.name,
      auftragswert: p.contract_value,
      quelle,
      datum,
      text: inhalt,
      umfang: p.scope_text,
    });
  } catch (e) {
    return fehler(502, "Der Vermerk konnte nicht erstellt werden. Bitte erneut versuchen.", e);
  }

  // Verbrauch nachtragen, aber daran darf die Antwort nicht scheitern.
  void sb
    .rpc("ki_verbrauch_nachtragen", {
      p_in: ergebnis.tokens.ein,
      p_out: ergebnis.tokens.aus,
    })
    .then(undefined, () => undefined);

  if (!ergebnis.vermerke.length) {
    return NextResponse.json({
      vermerke: [],
      hinweis: "Kein dokumentationswürdiger Vorgang erkannt.",
      rest_heute: kontingent.rest_heute,
    });
  }

  const zeilen = ergebnis.vermerke.map((d) => ({
    project_id: projectId,
    occurred_on: datum,
    source: quelle,
    raw_text: inhalt,
    title: d.titel,
    facts: d.sachverhalt,
    quote: d.zitat,
    affected_scope: d.betroffene_leistung,
    change_type: d.art,
    deviation: d.abweichung,
    reasoning: d.begruendung,
    open_questions: d.offene_punkte,
    suggestion: d.vorschlag,
    model: MODEL,
    created_by: user.id,
    source_kind: herkunft,
    counterparty_kind: gegenseite,
    supplier_id: supplierId,
    schedule_impact: d.terminwirkung === true,
  }));

  const { data, error } = await sb.from("entries").insert(zeilen).select();
  if (error) return fehler(500, "Speichern fehlgeschlagen.", error);

  return NextResponse.json({ vermerke: data, rest_heute: kontingent.rest_heute });
}
