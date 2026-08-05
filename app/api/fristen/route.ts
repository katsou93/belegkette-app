import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/**
 * Fristenwaechter. Laeuft taeglich per Vercel Cron.
 * Sammelt faellige Wiedervorlagen und Sicherheiten je Betrieb.
 *
 * Zugriff nur mit CRON_SECRET — der Dienstschluessel umgeht die
 * Zeilensicherheit, deshalb darf dieser Endpunkt nicht offen sein.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const kopf = req.headers.get("authorization");
  if (!secret || kopf !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Nicht berechtigt." }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const dienst = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !dienst) {
    return NextResponse.json({ error: "Nicht konfiguriert." }, { status: 500 });
  }

  const sb = createClient(url, dienst, { auth: { persistSession: false } });
  const heute = new Date().toISOString().slice(0, 10);

  const { data: vorgaenge } = await sb
    .from("entries")
    .select("id,seq,title,wiedervorlage_am,estimated_value,project_id,projects(name,org_id)")
    .lte("wiedervorlage_am", heute)
    .in("status", ["offen", "angezeigt"])
    .eq("deviation", "ja");

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
  };

  // Versand nur, wenn ein Maildienst hinterlegt ist. Ohne Schluessel
  // liefert der Endpunkt den Bericht zurueck, statt stillschweigend nichts zu tun.
  const resend = process.env.RESEND_API_KEY;
  const an = process.env.FRISTEN_EMPFAENGER;
  if (resend && an && (bericht.faellige_vorgaenge || bericht.faellige_sicherheiten)) {
    const zeilen = [
      `Stand ${heute}`,
      ``,
      `${bericht.faellige_vorgaenge} Vorgang/Vorgaenge zur Wiedervorlage`,
      `${bericht.faellige_sicherheiten} Sicherheit(en) zur Rueckforderung, zusammen ${bericht.summe_sicherheiten.toLocaleString("de-DE")} EUR`,
    ].join("\n");
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resend}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "Prooftrail <fristen@prooftrail.de>",
        to: [an],
        subject: `Prooftrail — ${bericht.faellige_vorgaenge + bericht.faellige_sicherheiten} Fristen faellig`,
        text: zeilen,
      }),
    }).catch(() => null);
  }

  return NextResponse.json(bericht);
}
