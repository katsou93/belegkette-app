"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sbBrowser, datum } from "@/lib/browser";

/**
 * Projektabschluss und Löschung der Rohtexte.
 *
 * Die Frage „Was passiert mit unseren Daten, wenn das Projekt vorbei ist?"
 * kommt in jedem Gespräch mit einem Datenschutzbeauftragten. Eine ehrliche
 * Antwort darauf ist hier ein Bedienelement und keine Zusicherung im
 * Vertrag — das ist der Unterschied zwischen einem Versprechen und einem
 * Nachweis.
 *
 * Was gelöscht wird: nur der Rohtext der weitergeleiteten Nachricht, also
 * das personenbezogenste Stück (Klarnamen, Signaturen, Durchwahlen).
 * Was bleibt: Vermerk, Zitat, Sachverhalt, Prüfsumme — die Akte.
 */
export function Projektabschluss({
  projectId,
  abgeschlossenAm,
  rohtextTage,
  mitRohtext,
  bereitsBereinigt,
}: {
  projectId: string;
  abgeschlossenAm: string | null;
  rohtextTage: number;
  mitRohtext: number;
  bereitsBereinigt: number;
}) {
  const [fehler, setFehler] = useState("");
  const [frage, setFrage] = useState(false);
  const [laeuft, starten] = useTransition();
  const router = useRouter();

  function abschliessen() {
    setFehler("");
    starten(async () => {
      const { error } = await sbBrowser()
        .from("projects")
        .update({ abgeschlossen_am: new Date().toISOString().slice(0, 10), status: "archiviert" })
        .eq("id", projectId);
      if (error) return setFehler(error.message);
      router.refresh();
    });
  }

  function sofortLoeschen() {
    setFehler("");
    starten(async () => {
      const { error } = await sbBrowser().rpc("rohtexte_loeschen", { p_projekt: projectId });
      if (error) return setFehler(error.message);
      setFrage(false);
      router.refresh();
    });
  }

  const loeschungAb = abgeschlossenAm
    ? new Date(new Date(abgeschlossenAm).getTime() + rohtextTage * 86_400_000)
    : null;

  return (
    <section className="card">
      <div className="abschnitt-kopf">
        <div>
          <h3>Abschluss und Aufbewahrung</h3>
          <div className="sub">
            {abgeschlossenAm
              ? `Abgeschlossen am ${datum(abgeschlossenAm)}`
              : "Projekt läuft"}
          </div>
        </div>
        {!abgeschlossenAm && (
          <button className="btn sec sm" disabled={laeuft} onClick={abschliessen}>
            Projekt abschließen
          </button>
        )}
      </div>

      <ul className="liste-eng">
        <li>
          <b>{mitRohtext}</b> {mitRohtext === 1 ? "Vermerk hat" : "Vermerke haben"} noch den Rohtext
          der weitergeleiteten Nachricht gespeichert.
          {bereitsBereinigt > 0 && <> Bei {bereitsBereinigt} wurde er bereits entfernt.</>}
        </li>
        <li>
          {abgeschlossenAm && loeschungAb ? (
            <>
              Automatische Löschung der Rohtexte ab <b>{datum(loeschungAb.toISOString())}</b> —{" "}
              {rohtextTage} Tage nach Abschluss.
            </>
          ) : (
            <>
              Nach Abschluss werden die Rohtexte {rohtextTage} Tage aufbewahrt und dann automatisch
              entfernt. Die Frist stellen Sie in den Betriebsdaten ein.
            </>
          )}
        </li>
        <li>
          Vermerke, wörtliche Zitate und Prüfsummen bleiben in jedem Fall erhalten. Die Kette bleibt
          prüfbar, weil in sie nur die Prüfsumme des Rohtexts eingeht — nicht der Text selbst.
        </li>
      </ul>

      {mitRohtext > 0 && (
        <>
          {!frage ? (
            <button className="btn sec sm" onClick={() => setFrage(true)}>
              Rohtexte jetzt löschen
            </button>
          ) : (
            <div className="warnung">
              <div className="warnung-t">
                {mitRohtext} {mitRohtext === 1 ? "Rohtext" : "Rohtexte"} endgültig entfernen?
              </div>
              <p className="warnung-h">
                Das lässt sich nicht rückgängig machen. Die Vermerke bleiben vollständig, aber der
                ursprüngliche Nachrichtentext ist danach weg — auch für Sie. Wenn Sie ihn später
                noch brauchen könnten, sichern Sie ihn vorher über den Export.
              </p>
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <button className="btn sec sm" disabled={laeuft} onClick={sofortLoeschen}>
                  Ja, löschen
                </button>
                <button className="btn sec sm" onClick={() => setFrage(false)}>
                  Abbrechen
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {fehler && <div className="err">{fehler}</div>}
    </section>
  );
}
