import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { oeffentlich } from "@/lib/env";

/**
 * Sitzung auffrischen und ungebetene Besucher zur Anmeldung schicken.
 *
 * Zwei Dinge, die hier vorher falsch waren und teuer geworden wären:
 *
 * 1. /api/fristen war nicht ausgenommen. Vercel Cron schickt einen
 *    Bearer-Token, aber kein Sitzungscookie — die Middleware hat den
 *    Aufruf also auf /login umgeleitet und der Fristenwächter lief nie.
 *    Ein Fehler, den man erst bemerkt, wenn eine Bürgschaft verfallen ist.
 *
 * 2. Der matcher lief über alles, also auch über jede Bilddatei. Jeder
 *    dieser Aufrufe war ein Netzaufruf zu Supabase. Statische Pfade sind
 *    jetzt ausgenommen.
 *
 * Grundsatz: diese Middleware ist Bequemlichkeit, keine Sicherheitsgrenze.
 * Die eigentliche Absicherung liegt in der Zeilensicherheit der Datenbank
 * und in der Prüfung in jeder Route. Wer das hier umgeht, sieht trotzdem
 * nichts.
 */

type Keks = { name: string; value: string; options?: Record<string, unknown> };

/** Pfade, die ohne Anmeldung erreichbar sein müssen. */
const OFFEN = [
  "/login",
  "/auth",
  "/api/fristen", // Cron, prüft selbst gegen CRON_SECRET
  "/api/inbound", // Maileingang, prüft selbst gegen die Signatur des Anbieters
];

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const sb = createServerClient(oeffentlich.supabaseUrl, oeffentlich.supabaseAnonKey, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (liste: Keks[]) => {
        liste.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        liste.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const pfad = req.nextUrl.pathname;
  const offen = OFFEN.some((p) => pfad === p || pfad.startsWith(`${p}/`));
  if (offen) return res;

  const {
    data: { user },
  } = await sb.auth.getUser();

  if (!user) {
    // API-Routen bekommen einen ehrlichen Statuscode statt einer
    // Weiterleitung — sonst sieht der Aufrufer eine HTML-Seite mit 200.
    if (pfad.startsWith("/api/")) {
      return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    }
    const ziel = req.nextUrl.clone();
    ziel.pathname = "/login";
    ziel.searchParams.set("weiter", pfad);
    return NextResponse.redirect(ziel);
  }

  return res;
}

export const config = {
  matcher: [
    /*
     * Alles außer:
     *   _next/static, _next/image  — Build-Ausgaben
     *   favicon, robots, sitemap   — statische Dateien
     *   Dateien mit Endung         — Bilder, Schriften und Ähnliches
     */
    "/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|sitemap\\.xml|.*\\.[\\w]+$).*)",
  ],
};
