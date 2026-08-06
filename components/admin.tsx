"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sbBrowser } from "@/lib/browser";

/**
 * Betrieb freischalten, verlängern oder sperren.
 *
 * Der Schreibzugriff hängt an der Policy org_admin_setzen aus Migration
 * 0011 — dieser Knopf ist nur die Oberfläche dazu. Wer kein Admin ist,
 * bekommt hier eine Fehlermeldung von der Datenbank, nicht heimlich Erfolg.
 */
export function PlanSchalter({ orgId, plan }: { orgId: string; plan: string }) {
  const [fehler, setFehler] = useState("");
  const [laeuft, starten] = useTransition();
  const router = useRouter();

  function setzen(felder: Record<string, unknown>) {
    setFehler("");
    starten(async () => {
      const { error } = await sbBrowser().from("orgs").update(felder).eq("id", orgId);
      if (error) {
        setFehler(error.message);
        return;
      }
      router.refresh();
    });
  }

  const inStunden = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

  return (
    <span className="adminakt">
      {plan !== "aktiv" && (
        <button
          className="btn sec sm"
          disabled={laeuft}
          onClick={() => setzen({ plan: "aktiv", gesperrt_am: null })}
          title="Hebt die Frist dauerhaft auf"
        >
          Freischalten
        </button>
      )}
      {plan === "probe" && (
        <button
          className="btn sec sm"
          disabled={laeuft}
          onClick={() => setzen({ trial_ends_at: inStunden(24) })}
          title="Setzt die Probe auf weitere 24 Stunden"
        >
          +24 h
        </button>
      )}
      {plan !== "gesperrt" ? (
        <button
          className="btn sec sm"
          disabled={laeuft}
          onClick={() => setzen({ plan: "gesperrt", gesperrt_am: new Date().toISOString() })}
        >
          Sperren
        </button>
      ) : (
        <button
          className="btn sec sm"
          disabled={laeuft}
          onClick={() => setzen({ plan: "probe", gesperrt_am: null, trial_ends_at: inStunden(24) })}
        >
          Entsperren
        </button>
      )}
      {fehler && <div className="err">{fehler}</div>}
    </span>
  );
}

/**
 * Hinweisleiste für den Kunden, solange die Probe läuft.
 *
 * Bewusst zurückhaltend formuliert: kein Countdown mit Sekunden, keine
 * roten Balken. Wer gerade zum ersten Mal etwas erfasst, soll das Produkt
 * beurteilen und nicht die Uhr.
 */
export function ProbeHinweis({ endetAm, plan }: { endetAm: string | null; plan: string }) {
  if (plan !== "probe" || !endetAm) return null;

  const rest = new Date(endetAm).getTime() - Date.now();
  if (rest <= 0) {
    return (
      <div className="warnung">
        <div className="warnung-t">Der Testzeitraum ist beendet</div>
        <p className="warnung-h">
          Alles, was Sie erfasst haben, bleibt vollständig lesbar und exportierbar — die Akte gehört
          Ihnen. Zum Weiterarbeiten schalten wir Sie gern frei.
        </p>
      </div>
    );
  }

  const stunden = Math.ceil(rest / 3_600_000);
  return (
    <div className="hinweis">
      <b>Testzugang</b> — noch {stunden} {stunden === 1 ? "Stunde" : "Stunden"}. Danach bleibt Ihre Akte
      lesbar; neue Vorgänge lassen sich dann erst nach Freischaltung anlegen.
    </div>
  );
}
