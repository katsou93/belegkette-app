import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { sbServer } from "@/lib/server";
import { alsText, umbrechen, winAnsi, DOKUMENT_TYP, type DokumentTyp, type DokumentDaten } from "@/lib/dokument";

export const runtime = "nodejs";

/**
 * Erzeugt ein sendefertiges Schreiben aus einem Vermerk.
 * Versendet wird bewusst nicht — der Nutzer verschickt aus dem eigenen
 * Postfach, das ist beweisrechtlich besser und vermeidet Zustellprobleme.
 */
export async function POST(req: NextRequest) {
  const sb = await sbServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const body = await req.json().catch(() => null);
  const entryId = body?.entryId as string | undefined;
  const typ = body?.typ as DokumentTyp | undefined;
  const format = (body?.format as string) === "text" ? "text" : "pdf";
  if (!entryId || !typ || !DOKUMENT_TYP[typ]) {
    return NextResponse.json({ error: "Vermerk und Dokumenttyp erforderlich." }, { status: 400 });
  }

  // Zeilensicherheit greift: fremde Vermerke sind hier nicht sichtbar
  const { data: e } = await sb.from("entries")
    .select("id,seq,occurred_on,title,facts,quote,open_questions,suggestion,project_id")
    .eq("id", entryId).single();
  if (!e) return NextResponse.json({ error: "Vermerk nicht gefunden." }, { status: 404 });

  const { data: p } = await sb.from("projects")
    .select("name,contract_ref,org_id,customer_id,customers(name)")
    .eq("id", e.project_id).single();
  const { data: o } = p?.org_id
    ? await sb.from("orgs").select("name,letterhead,sender_name,sender_role").eq("id", p.org_id).single()
    : { data: null };

  const kunde = (p as { customers?: { name?: string } | null } | null)?.customers?.name ?? null;

  const daten: DokumentDaten = {
    typ,
    projekt: p?.name ?? "Projekt",
    vertragsnummer: p?.contract_ref ?? null,
    empfaenger: kunde,
    vermerkNr: e.seq,
    vorgangsdatum: e.occurred_on,
    titel: e.title,
    sachverhalt: e.facts,
    zitat: e.quote,
    offenePunkte: (e.open_questions as string[]) ?? [],
    vorschlag: e.suggestion,
    briefkopf: o?.letterhead ?? o?.name ?? null,
    unterzeichner: o?.sender_name ?? null,
    funktion: o?.sender_role ?? null,
  };

  const text = alsText(daten);
  if (format === "text") return NextResponse.json({ text });

  const pdf = await PDFDocument.create();
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const fett = await pdf.embedFont(StandardFonts.HelveticaBold);

  // Die Standardschriften koennen nur WinAnsi. Der Vermerktext stammt aus
  // der KI und kann Zeichen enthalten, die dort fehlen — dann bricht pdf-lib
  // ab. Deshalb vorher glaetten statt hinterher zu scheitern.
  const links = 64;
  const oben = 790;
  let seite = pdf.addPage([595, 842]); // A4
  let y = oben;

  const schreib = (zeile: string, groesse = 10.5, schrift = normal, farbe = rgb(0.05, 0.11, 0.17)) => {
    if (y < 64) { seite = pdf.addPage([595, 842]); y = oben; }
    seite.drawText(zeile, { x: links, y, size: groesse, font: schrift, color: farbe });
    y -= groesse + 4.5;
  };

  for (const roh of umbrechen(winAnsi(text), 92)) {
    const zeile = roh;
    const ueberschrift = ["Sachverhalt", "Offene Punkte"].includes(zeile.trim());
    const kopf = zeile.startsWith(winAnsi(DOKUMENT_TYP[typ].titel));
    if (!zeile.trim()) { y -= 7; continue; }
    schreib(zeile, kopf ? 12.5 : 10.5, kopf || ueberschrift ? fett : normal);
  }

  if (y < 78) { seite = pdf.addPage([595, 842]); y = oben; }
  y -= 14;
  seite.drawText(winAnsi("Erstellt aus Vermerk " + String(e.seq).padStart(3, "0") + " — Entwurf, vor Versand prüfen."),
    { x: links, y, size: 7.5, font: normal, color: rgb(0.45, 0.5, 0.55) });

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${typ}-vermerk-${String(e.seq).padStart(3, "0")}.pdf"`,
    },
  });
}
