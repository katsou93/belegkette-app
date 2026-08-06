import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { grenzen } from "@/lib/env";

/**
 * Kleine Bausteine, die in jeder Route gebraucht werden. Bewusst ohne
 * Rahmenwerk — vier Funktionen rechtfertigen keine Abhängigkeit.
 */

/** Fehlerantwort. Nach außen knapp, nach innen mit Kennung zum Wiederfinden im Protokoll. */
export function fehler(status: number, nachricht: string, intern?: unknown) {
  const kennung = Math.random().toString(36).slice(2, 10);
  if (intern) console.error(`[${kennung}] ${nachricht}`, intern);
  return NextResponse.json({ error: nachricht, kennung }, { status });
}

/**
 * Körper einer Anfrage lesen, mit Obergrenze.
 *
 * Ohne Grenze nimmt die Route ein Megabyte genauso an wie hundert und
 * zieht es durch JSON.parse. Das ist der billigste Weg, eine
 * Serverless-Funktion in die Zeitüberschreitung zu treiben.
 */
export async function koerperLesen<T = unknown>(req: Request): Promise<T | null> {
  const laenge = req.headers.get("content-length");
  if (laenge && Number(laenge) > grenzen.maxKoerper) return null;

  const roh = await req.text().catch(() => null);
  if (roh === null || roh.length > grenzen.maxKoerper) return null;

  try {
    return JSON.parse(roh) as T;
  } catch {
    return null;
  }
}

/**
 * Vergleich in konstanter Zeit.
 *
 * Ein gewöhnliches === bricht beim ersten abweichenden Zeichen ab. Über
 * genügend Versuche lässt sich daraus die Laufzeit ablesen und das Geheimnis
 * zeichenweise erraten. Über das offene Netz ist das schwer, aber der
 * Aufwand, es richtig zu machen, ist eine Zeile.
 */
export function gleichInKonstanterZeit(a: string, b: string): boolean {
  const pa = Buffer.from(a, "utf8");
  const pb = Buffer.from(b, "utf8");
  if (pa.length !== pb.length) {
    // Auch bei ungleicher Länge einmal vergleichen, damit die Laufzeit
    // nicht schon daran verrät, ob die Länge stimmt.
    timingSafeEqual(pa, pa);
    return false;
  }
  return timingSafeEqual(pa, pb);
}

/** Zeichenkette aus unsicherer Quelle: trimmen, kürzen, leer wird null. */
export function text(wert: unknown, maxLaenge: number): string | null {
  if (typeof wert !== "string") return null;
  const t = wert.trim();
  if (!t) return null;
  return t.slice(0, maxLaenge);
}

/** uuid aus unsicherer Quelle. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uuid(wert: unknown): string | null {
  return typeof wert === "string" && UUID.test(wert) ? wert : null;
}

/** Datum im Format JJJJ-MM-TT, sonst heute. */
export function isoDatum(wert: unknown): string {
  if (typeof wert === "string" && /^\d{4}-\d{2}-\d{2}$/.test(wert)) {
    const d = new Date(`${wert}T00:00:00Z`);
    if (!Number.isNaN(d.getTime())) return wert;
  }
  return new Date().toISOString().slice(0, 10);
}
