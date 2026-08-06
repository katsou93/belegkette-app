import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { oeffentlich, geheim } from "@/lib/env";
import { gleichInKonstanterZeit, fehler } from "@/lib/http";

export const runtime = "nodejs";

/**
 * Fristenwaechter. Laeuft taeglich per Vercel Cron.
 * Sammelt faellige Wiedervorlagen und Sicherheiten je Betrieb.
 *
 * Zugriff nur mit CRON_SECRET — der Dienstschluessel umgeht die
 * Zeilensicherheit, deshalb darf dieser Endpunkt nicht offen sein.
 */
export async function GET(req: NextRequest) {
  // Vergleich in konstanter Zeit, damit die Laufzeit das Geheimnis nicht verrät.
  const kopf = req.headers.get("authorization") ?? "";
  let erwartet: string;
  try {
    erwartet = `Bearer ${geheim.cronSecret}`;
  } catch {
    return fehler(500, "Nicht konfiguriert: CRON_SECRET fehlt.");
  }
  if (!gleichInKonstanterZeit(kopf, erwartet)) return fehler(401, "Nicht berechtigt.");

  const sb = createClient(oeffentlich.supabaseUrl, geheim.serviceRoleKey, {
    auth: { persistSession: false },
  });
  const heute = new Date().toISOString().slice(0, 10);

  const { data: vorgaenge } = await sb
    .from("entries")
    .select("id,seq,title,wiedervorlage_am,estimated_value,project_id,projects(name,org_id)")
    .lte("wiedervorlage_am", heute)
    .in("status", ["offen", "angezeigt"])
    .eq("deviation", "ja");

  // Befunde je Betrieb — das ist der Teil, der an die Geschäftsführung geht.
  const { data: berichte } = await sb
    .from("wochenbericht")
    .select("org_id,projekte,rot,gelb,gruen,betrag_rot,betrag_gesamt,sicherheiten_gebunden");

  const { data: rote } = await sb
    .from("projekt_ampel")
    .select("org_id,projekt,ampel,betrag_betroffen,zusammenfassung")
    .eq("ampel", "rot")
    .order("betrag_betroffen", { ascending: false })
    .limit(50);

  const { data: sicherheiten } = await sb
    .from("securities")
    .select("id,kind,amount,release_due_on,reminder_on,project_id,projects(name,org_id)")
    .lte("reminder_on", heute)
    .in("status", ["offen", "angefordert"]);

  const bericht = {
    stand: heute,
    faellige_vorgaenge: (vorgaenge ?? []).length,
    faellige_sicherheiten: (sicherheiten ?? []).length,
    summe_sicherheiten: (sicherheiten ?? []).reduce((a, s) => a + Number(s.amount ?? 0), 0),
    vorgaenge: vorgaenge ?? [],
    sicherheiten: sicherheiten ?? [],
    berichte: berichte ?? [],
    rote_projekte: rote ?? [],
  };

  // Versand nur, wenn ein Maildienst hinterlegt ist. Ohne Schluessel
  // liefert der Endpunkt den Bericht zurueck, statt stillschweigend nichts zu tun.
  // Aufräumen, solange wir ohnehin hier sind.
  await sb.rpc("ki_verbrauch_aufraeumen").then(undefined, () => undefined);

  // Rohtexte abgeschlossener Projekte nach Ablauf der Aufbewahrungsfrist
  // entfernen. Läuft täglich, damit die Löschung nicht davon abhängt, dass
  // jemand daran denkt — das ist der Kern eines belastbaren Löschkonzepts.
  const { data: bereinigt } = await sb.rpc("rohtexte_bereinigen").single<{
    betroffene: number; projekte: number;
  }>();

  const resend = geheim.resendKey;
  const an = geheim.fristenEmpfaenger;
  if (resend && an && (bericht.faellige_vorgaenge || bericht.faellige_sicherheiten)) {
    const ampeln = (rote ?? []).slice(0, 10)
      .map((r) => `  ${r.projekt}: ${r.zusammenfassung}`)
      .join("\n");

    const zeilen = [
      `Stand ${heute}`,
      ``,
      `${bericht.faellige_vorgaenge} Vorgang/Vorgaenge zur Wiedervorlage`,
      `${bericht.faellige_sicherheiten} Sicherheit(en) zur Rueckforderung, zusammen ${bericht.summe_sicherheiten.toLocaleString("de-DE")} EUR`,
      ``,
      `${(rote ?? []).length} Projekt(e) auf Rot:`,
      ampeln || `  keine`,
    ].join("\n");
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "Aktenfest <fristen@aktenfest.de>",
        to: [an],
        subject: `Aktenfest — ${bericht.faellige_vorgaenge + bericht.faellige_sicherheiten} Fristen faellig`,
        text: zeilen,
      }),
    }).catch(() => null);
  }

  return NextResponse.json({ ...bericht, rohtexte_bereinigt: bereinigt?.betroffene ?? 0 });
}
