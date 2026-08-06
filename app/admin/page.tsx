import { redirect } from "next/navigation";
import { sbServer } from "@/lib/server";
import { Seitenleiste } from "@/components/nav";
import { euro } from "@/lib/browser";
import { PlanSchalter } from "@/components/admin";

export const dynamic = "force-dynamic";

/**
 * Betreibersicht.
 *
 * Diese Seite zeigt bewusst keinen einzigen Vermerkinhalt. Kein Zitat,
 * kein Sachverhalt, kein Rohtext. Nur Zahlen, Zeitpunkte und Zustände.
 * Das ist die Zusage aus der Datenschutzerklärung, und sie wird nicht hier
 * durchgesetzt, sondern in den Sichten aus Migration 0011 — die Spalten
 * existieren gar nicht erst.
 *
 * Der Zugang hängt an app_admins. Wer nicht drinsteht, sieht überall
 * leere Listen, weil jede Sicht ein `where ist_admin()` trägt. Diese
 * Weiterleitung ist nur Bequemlichkeit, keine Sicherheitsgrenze.
 */

interface Betrieb {
  org_id: string;
  betrieb: string;
  plan: string;
  trial_ends_at: string | null;
  schreibrecht: boolean;
  registriert_am: string;
  notiz: string | null;
  nutzer: number;
  projekte: number;
  vermerke: number;
  abweichungen: number;
  letzter_vermerk: string | null;
  sicherheiten_gebunden: number;
}

interface Kosten {
  org_id: string;
  betrieb: string;
  tag: string;
  aufrufe: number;
  tokens_ein: number;
  tokens_aus: number;
  usd_geschaetzt: number;
}

interface Qualitaet {
  org_id: string;
  vermerke: number;
  verworfen: number;
  verworfen_prozent: number | null;
  grund_kein_vorgang: number;
  grund_war_beauftragt: number;
  grund_doppelung: number;
  bewertet_ja: number;
  bewertet_unklar: number;
  bewertet_nein: number;
  angezeigt: number;
}

export default async function Admin() {
  const sb = await sbServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const { data: admin } = await sb.from("app_admins").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) redirect("/projekte");

  const [{ data: betriebe }, { data: kosten }, { data: qualitaet }] = await Promise.all([
    sb.from("admin_betriebe").select("*").order("registriert_am", { ascending: false }).returns<Betrieb[]>(),
    sb.from("admin_ki_kosten").select("*").order("tag", { ascending: false }).limit(60).returns<Kosten[]>(),
    sb.from("admin_qualitaet").select("*").returns<Qualitaet[]>(),
  ]);

  const b = betriebe ?? [];
  const k = kosten ?? [];
  const q = qualitaet ?? [];

  const jetzt = Date.now();
  const heute = new Date().toISOString().slice(0, 10);
  const kostenHeute = k.filter((z) => String(z.tag).slice(0, 10) === heute);

  const kennzahl = {
    betriebe: b.length,
    aktiv: b.filter((z) => z.plan === "aktiv").length,
    inProbe: b.filter((z) => z.plan === "probe" && z.trial_ends_at && new Date(z.trial_ends_at).getTime() > jetzt).length,
    abgelaufen: b.filter((z) => !z.schreibrecht).length,
    vermerke: b.reduce((a, z) => a + Number(z.vermerke), 0),
    haben_genutzt: b.filter((z) => Number(z.vermerke) > 0).length,
    usdHeute: kostenHeute.reduce((a, z) => a + Number(z.usd_geschaetzt), 0),
    usdGesamt: k.reduce((a, z) => a + Number(z.usd_geschaetzt), 0),
  };

  const qGesamt = q.reduce(
    (a, z) => ({
      vermerke: a.vermerke + Number(z.vermerke),
      verworfen: a.verworfen + Number(z.verworfen),
      ja: a.ja + Number(z.bewertet_ja),
      unklar: a.unklar + Number(z.bewertet_unklar),
      nein: a.nein + Number(z.bewertet_nein),
      angezeigt: a.angezeigt + Number(z.angezeigt),
      kein_vorgang: a.kein_vorgang + Number(z.grund_kein_vorgang),
      war_beauftragt: a.war_beauftragt + Number(z.grund_war_beauftragt),
      doppelung: a.doppelung + Number(z.grund_doppelung),
    }),
    { vermerke: 0, verworfen: 0, ja: 0, unklar: 0, nein: 0, angezeigt: 0, kein_vorgang: 0, war_beauftragt: 0, doppelung: 0 },
  );

  return (
    <div className="shell">
      <Seitenleiste />
      <main className="main">
        <div className="head">
          <div>
            <h1>Betrieb</h1>
            <div className="sub">Kennzahlen über alle Betriebe. Ohne Vermerkinhalte.</div>
          </div>
        </div>

        {/* -------------------------------------------------- */}
        <section className="kacheln">
          <Kachel gross={String(kennzahl.betriebe)} klein="Registrierungen" />
          <Kachel gross={String(kennzahl.haben_genutzt)} klein="haben etwas erfasst" hinweis={
            kennzahl.betriebe > 0
              ? `${Math.round((100 * kennzahl.haben_genutzt) / kennzahl.betriebe)} % der Registrierungen`
              : undefined
          } />
          <Kachel gross={String(kennzahl.inProbe)} klein="Probe läuft" />
          <Kachel gross={String(kennzahl.aktiv)} klein="freigeschaltet" />
          <Kachel gross={String(kennzahl.vermerke)} klein="Vermerke gesamt" />
          <Kachel
            gross={`$${kennzahl.usdHeute.toFixed(2)}`}
            klein="KI-Kosten heute"
            hinweis={`$${kennzahl.usdGesamt.toFixed(2)} gesamt, geschätzt`}
          />
        </section>

        {/* -------------------------------------------------- */}
        <section className="card">
          <div className="abschnitt-kopf">
            <div>
              <h3>Betriebe</h3>
              <div className="sub">
                Probe läuft 24 Stunden ab Registrierung. Freischalten hebt die Frist auf.
              </div>
            </div>
          </div>

          {b.length === 0 ? (
            <p className="sub">Noch keine Registrierung.</p>
          ) : (
            <div className="tabellenrahmen">
              <table className="tab">
                <thead>
                  <tr>
                    <th>Betrieb</th>
                    <th>Zustand</th>
                    <th className="r">Nutzer</th>
                    <th className="r">Projekte</th>
                    <th className="r">Vermerke</th>
                    <th className="r">davon Abw.</th>
                    <th className="r">Sicherheiten</th>
                    <th>Zuletzt</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {b.map((z) => (
                    <tr key={z.org_id} className={Number(z.vermerke) > 0 ? "" : "blass"}>
                      <td>
                        <b>{z.betrieb}</b>
                        <div className="mini">seit {kurz(z.registriert_am)}</div>
                      </td>
                      <td>
                        <Zustand betrieb={z} jetzt={jetzt} />
                      </td>
                      <td className="r">{z.nutzer}</td>
                      <td className="r">{z.projekte}</td>
                      <td className="r">
                        <b>{z.vermerke}</b>
                      </td>
                      <td className="r">{z.abweichungen}</td>
                      <td className="r">{Number(z.sicherheiten_gebunden) > 0 ? euro(Number(z.sicherheiten_gebunden)) : "—"}</td>
                      <td>{z.letzter_vermerk ? kurz(z.letzter_vermerk) : "—"}</td>
                      <td className="r">
                        <PlanSchalter orgId={z.org_id} plan={z.plan} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* -------------------------------------------------- */}
        <section className="card">
          <div className="abschnitt-kopf">
            <div>
              <h3>Treffsicherheit</h3>
              <div className="sub">
                Wie oft ein Vorgang verworfen wird, ist die einzige ehrliche Rückmeldung. Über zwanzig
                Prozent heißt: die Bewertung muss nachgeschärft werden.
              </div>
            </div>
          </div>

          {qGesamt.vermerke === 0 ? (
            <p className="sub">Noch keine Vermerke.</p>
          ) : (
            <>
              <div className="balken">
                <Anteil n={qGesamt.ja} von={qGesamt.vermerke} klasse="t-ja" text="Abweichung" />
                <Anteil n={qGesamt.unklar} von={qGesamt.vermerke} klasse="t-unklar" text="unklar" />
                <Anteil n={qGesamt.nein} von={qGesamt.vermerke} klasse="t-nein" text="keine" />
              </div>
              <ul className="liste-eng">
                <li>
                  <b>
                    {qGesamt.verworfen} von {qGesamt.vermerke} verworfen
                  </b>{" "}
                  ({prozent(qGesamt.verworfen, qGesamt.vermerke)})
                </li>
                <li>
                  Gründe: {qGesamt.kein_vorgang} kein Vorgang · {qGesamt.war_beauftragt} war beauftragt ·{" "}
                  {qGesamt.doppelung} Doppelung
                </li>
                <li>
                  {qGesamt.angezeigt} Vorgänge wurden tatsächlich angezeigt (
                  {prozent(qGesamt.angezeigt, qGesamt.vermerke)}) — das ist die Zahl, die zeigt, ob das
                  Produkt bis zum Ende benutzt wird.
                </li>
              </ul>
            </>
          )}
        </section>

        {/* -------------------------------------------------- */}
        <section className="card">
          <div className="abschnitt-kopf">
            <div>
              <h3>KI-Verbrauch</h3>
              <div className="sub">
                Letzte 60 Tage. Der Dollarbetrag ist eine Hochrechnung aus Token mal Listenpreis, keine
                Abrechnung — die steht in der Konsole des Anbieters.
              </div>
            </div>
          </div>

          {k.length === 0 ? (
            <p className="sub">Noch kein Verbrauch.</p>
          ) : (
            <div className="tabellenrahmen">
              <table className="tab">
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Betrieb</th>
                    <th className="r">Aufrufe</th>
                    <th className="r">Token ein</th>
                    <th className="r">Token aus</th>
                    <th className="r">geschätzt</th>
                  </tr>
                </thead>
                <tbody>
                  {k.map((z, i) => (
                    <tr key={`${z.org_id}-${z.tag}-${i}`}>
                      <td>{kurz(z.tag)}</td>
                      <td>{z.betrieb}</td>
                      <td className="r">{z.aufrufe}</td>
                      <td className="r">{Number(z.tokens_ein).toLocaleString("de-DE")}</td>
                      <td className="r">{Number(z.tokens_aus).toLocaleString("de-DE")}</td>
                      <td className="r">${Number(z.usd_geschaetzt).toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Kachel({ gross, klein, hinweis }: { gross: string; klein: string; hinweis?: string }) {
  return (
    <div className="kachel">
      <div className="kachel-gross">{gross}</div>
      <div className="kachel-klein">{klein}</div>
      {hinweis && <div className="mini">{hinweis}</div>}
    </div>
  );
}

function Zustand({ betrieb, jetzt }: { betrieb: Betrieb; jetzt: number }) {
  if (betrieb.plan === "aktiv") return <span className="tag t-nein">freigeschaltet</span>;
  if (betrieb.plan === "gesperrt") return <span className="tag t-ja">gesperrt</span>;

  const ende = betrieb.trial_ends_at ? new Date(betrieb.trial_ends_at).getTime() : 0;
  if (ende <= jetzt) return <span className="tag t-ja">Probe abgelaufen</span>;

  const stunden = Math.max(0, Math.round((ende - jetzt) / 3_600_000));
  return <span className="tag t-unklar">Probe, noch {stunden} h</span>;
}

function Anteil({ n, von, klasse, text }: { n: number; von: number; klasse: string; text: string }) {
  if (!von) return null;
  const p = Math.round((100 * n) / von);
  if (p === 0) return null;
  return (
    <span className={`balken-teil ${klasse}`} style={{ width: `${p}%` }} title={`${text}: ${n} (${p} %)`}>
      {p >= 12 ? `${text} ${p} %` : ""}
    </span>
  );
}

const prozent = (n: number, von: number) => (von ? `${Math.round((100 * n) / von)} %` : "—");

const kurz = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
