/**
 * Umgebungsvariablen an einer Stelle, geprüft statt erhofft.
 *
 * Vorher stand überall `process.env.X!`. Das nicht-null-Ausrufezeichen ist
 * eine Behauptung gegenüber dem Übersetzer, die zur Laufzeit niemand prüft:
 * fehlt die Variable, entsteht irgendwo tief im Supabase-Client ein
 * unverständlicher Fehler. Hier fällt stattdessen sofort ein Satz, der
 * sagt, was fehlt.
 *
 * Bewusst ohne Zod — eine Abhängigkeit für dreißig Zeilen lohnt nicht.
 */

type Quelle = "pflicht" | "server" | "optional";

function lies(name: string, quelle: Quelle): string {
  const wert = process.env[name];
  if (wert && wert.trim() !== "") return wert;
  if (quelle === "optional") return "";
  throw new Error(
    `Umgebungsvariable ${name} fehlt. ` +
      `Lokal gehört sie in .env.local, auf Vercel unter Settings → Environment Variables. ` +
      `Vorlage steht in .env.example.`,
  );
}

/** Im Browser verfügbar. Der anon key ist öffentlich — die Sicherheit liegt in der Zeilensicherheit, nicht im Schlüssel. */
export const oeffentlich = {
  get supabaseUrl() {
    return lies("NEXT_PUBLIC_SUPABASE_URL", "pflicht");
  },
  get supabaseAnonKey() {
    return lies("NEXT_PUBLIC_SUPABASE_ANON_KEY", "pflicht");
  },
};

/**
 * Nur serverseitig. Jeder Zugriff auf diese Werte im Client-Bündel wäre ein
 * schwerer Fehler, deshalb die Absicherung.
 */
export const geheim = {
  get anthropicKey() {
    nurServer("ANTHROPIC_API_KEY");
    return lies("ANTHROPIC_API_KEY", "server");
  },
  get serviceRoleKey() {
    nurServer("SUPABASE_SERVICE_ROLE_KEY");
    return lies("SUPABASE_SERVICE_ROLE_KEY", "server");
  },
  get cronSecret() {
    nurServer("CRON_SECRET");
    return lies("CRON_SECRET", "server");
  },
  get resendKey() {
    nurServer("RESEND_API_KEY");
    return lies("RESEND_API_KEY", "optional");
  },
  get fristenEmpfaenger() {
    nurServer("FRISTEN_EMPFAENGER");
    return lies("FRISTEN_EMPFAENGER", "optional");
  },
};

/** Kontingente. Über die Umgebung anpassbar, ohne den Code anzufassen. */
export const grenzen = {
  /** KI-Aufrufe je Nutzer und Tag. */
  get kiProTag() {
    return zahl("KI_LIMIT_TAG", 200);
  },
  /** KI-Aufrufe je Nutzer und Stunde — fängt Endlosschleifen im Browser ab. */
  get kiProStunde() {
    return zahl("KI_LIMIT_STUNDE", 30);
  },
  /** Größte akzeptierte Nachricht in Zeichen. Eine weitergeleitete Mail ist nie größer. */
  maxNachricht: 60_000,
  /** Größter akzeptierter Anfragekörper in Bytes. */
  maxKoerper: 256 * 1024,
};

function zahl(name: string, vorgabe: number): number {
  const roh = process.env[name];
  if (!roh) return vorgabe;
  const n = Number.parseInt(roh, 10);
  return Number.isFinite(n) && n > 0 ? n : vorgabe;
}

function nurServer(name: string) {
  if (typeof window !== "undefined") {
    throw new Error(`${name} darf nie im Browser gelesen werden.`);
  }
}

/**
 * Beim Start einmal alles Wichtige anfassen, damit eine fehlende Variable
 * beim Hochfahren auffällt und nicht erst beim ersten Nutzer.
 */
export function umgebungPruefen(): { ok: true } | { ok: false; fehlt: string[] } {
  const fehlt: string[] = [];
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]) {
    if (!process.env[name]) fehlt.push(name);
  }
  return fehlt.length ? { ok: false, fehlt } : { ok: true };
}
