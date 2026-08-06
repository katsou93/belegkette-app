/**
 * Löschkonzept und Späterfassung.
 *
 * Die zentrale Zusage aus Migration 0012: Der Rohtext lässt sich löschen,
 * ohne dass die Beweiskette bricht — und der Kunde kann hinterher trotzdem
 * nachweisen, dass eine bestimmte Mail zu einem Vermerk gehört.
 *
 * Wenn dieser Test fällt, ist entweder der Datenschutz oder der Beweiswert
 * kaputt. Beides wäre tödlich.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { frischeDatenbank, nutzerAnlegen, type Datenbank } from "./harness";

let d: Datenbank;
let orgId: string;
let projekt: string;

const ROHTEXT =
  "Von: einkauf@muster-werke.de\nBetreff: Pumpe\n\nBitte die Pumpe in Edelstahl statt Guss ausfuehren. Gruss, H. Meier, Tel. 0711 123456";

beforeAll(async () => {
  d = await frischeDatenbank();
  ({ orgId } = await nutzerAnlegen(d, "kauf@anlagenbau.de"));
  const p = await d.db.query<{ id: string }>(
    "insert into projects (org_id, name) values ($1,'A-2418 Abfüllanlage') returning id",
    [orgId],
  );
  projekt = p.rows[0].id;

  for (const [i, titel] of ["Materialwechsel", "Terminverschiebung", "Zusatzleistung"].entries()) {
    await d.db.query(
      `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
       values ($1, $2, 'E-Mail', $3, $4, 'Sachverhalt', 'Zitat', 'ja')`,
      [projekt, `2026-03-${14 + i}`, `${ROHTEXT} #${i}`, titel],
    );
  }
}, 60_000);

afterAll(async () => d?.schliessen());

/* ------------------------------------------------------------------ */
describe("Prüfsumme über den Rohtext", () => {
  it("speichert zu jedem Vermerk den Hash des Rohtexts", async () => {
    const { rows } = await d.db.query<{ raw_text_hash: string }>(
      "select raw_text_hash from entries where project_id = $1 order by seq",
      [projekt],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r.raw_text_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("erzeugt für jeden Rohtext einen eigenen Hash", async () => {
    const { rows } = await d.db.query<{ raw_text_hash: string }>(
      "select raw_text_hash from entries where project_id = $1",
      [projekt],
    );
    expect(new Set(rows.map((r) => r.raw_text_hash)).size).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
describe("Löschung des Rohtexts", () => {
  it("entfernt den Rohtext und hält den Zeitpunkt fest", async () => {
    const n = await d.db.query<{ rohtexte_loeschen: number }>(
      "select rohtexte_loeschen($1)", [projekt],
    );
    expect(Number(n.rows[0].rohtexte_loeschen)).toBe(3);

    const { rows } = await d.db.query<{ roh: string | null; am: string | null }>(
      "select raw_text as roh, raw_text_geloescht_am as am from entries where project_id = $1",
      [projekt],
    );
    expect(rows.every((r) => r.roh === null)).toBe(true);
    expect(rows.every((r) => r.am !== null)).toBe(true);
  });

  it("lässt die Kette danach unversehrt — das ist der ganze Punkt", async () => {
    const { rows } = await d.db.query<{
      inhalt_unveraendert: boolean; kette_intakt: boolean; rohtext_vorhanden: boolean;
    }>("select * from kette_pruefen($1)", [projekt]);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.inhalt_unveraendert)).toBe(true);
    expect(rows.every((r) => r.kette_intakt)).toBe(true);
    expect(rows.every((r) => r.rohtext_vorhanden === false)).toBe(true);
  });

  it("lässt Vermerk, Zitat und Sachverhalt stehen", async () => {
    const { rows } = await d.db.query<{ title: string; quote: string; facts: string }>(
      "select title, quote, facts from entries where project_id = $1 and seq = 1",
      [projekt],
    );
    expect(rows[0].title).toBe("Materialwechsel");
    expect(rows[0].quote).toBe("Zitat");
    expect(rows[0].facts).toBe("Sachverhalt");
  });

  it("bestätigt den Originaltext, obwohl er gelöscht ist", async () => {
    const { rows: e } = await d.db.query<{ id: string }>(
      "select id from entries where project_id = $1 and seq = 1", [projekt],
    );
    const treffer = await d.db.query<{ rohtext_nachweisen: boolean }>(
      "select rohtext_nachweisen($1, $2)", [e[0].id, `${ROHTEXT} #0`],
    );
    expect(treffer.rows[0].rohtext_nachweisen).toBe(true);
  });

  it("weist einen abgewandelten Text zurück", async () => {
    const { rows: e } = await d.db.query<{ id: string }>(
      "select id from entries where project_id = $1 and seq = 1", [projekt],
    );
    const treffer = await d.db.query<{ rohtext_nachweisen: boolean }>(
      "select rohtext_nachweisen($1, $2)", [e[0].id, `${ROHTEXT} #0 `],
    );
    expect(treffer.rows[0].rohtext_nachweisen).toBe(false);
  });

  it("verweigert das Überschreiben eines Rohtexts", async () => {
    await expect(
      d.db.query("update entries set raw_text = 'untergeschoben' where project_id = $1 and seq = 1", [projekt]),
    ).rejects.toThrow(/nur geloescht/i);
  });

  it("verweigert Änderungen am Rohtext-Hash", async () => {
    await expect(
      d.db.query("update entries set raw_text_hash = repeat('0',64) where project_id = $1 and seq = 1", [projekt]),
    ).rejects.toThrow(/unveraenderlich/i);
  });
});

/* ------------------------------------------------------------------ */
describe("Automatische Bereinigung", () => {
  it("räumt erst auf, wenn Projekt abgeschlossen und Frist abgelaufen ist", async () => {
    const p = await d.db.query<{ id: string }>(
      "insert into projects (org_id, name) values ($1,'Läuft noch') returning id", [orgId],
    );
    await d.db.query(
      `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
       values ($1,'2026-03-14','E-Mail','geheim','T','S','Z','ja')`, [p.rows[0].id],
    );

    // Projekt läuft: nichts wird angefasst.
    let r = await d.db.query<{ betroffene: number }>("select * from rohtexte_bereinigen()");
    expect(Number(r.rows[0].betroffene)).toBe(0);

    // Abgeschlossen, aber Frist läuft noch.
    await d.db.query("update projects set abgeschlossen_am = current_date - 10 where id = $1", [p.rows[0].id]);
    r = await d.db.query<{ betroffene: number }>("select * from rohtexte_bereinigen()");
    expect(Number(r.rows[0].betroffene)).toBe(0);

    // Frist abgelaufen.
    await d.db.query("update projects set abgeschlossen_am = current_date - 200 where id = $1", [p.rows[0].id]);
    r = await d.db.query<{ betroffene: number }>("select * from rohtexte_bereinigen()");
    expect(Number(r.rows[0].betroffene)).toBe(1);
  });

  it("richtet sich nach der Frist des jeweiligen Betriebs", async () => {
    const { orgId: streng } = await nutzerAnlegen(d, "streng@betrieb.de");
    await d.db.query("update orgs set rohtext_tage = 0 where id = $1", [streng]);
    const p = await d.db.query<{ id: string }>(
      "insert into projects (org_id, name, abgeschlossen_am) values ($1,'Sofort', current_date - 1) returning id",
      [streng],
    );
    await d.db.query(
      `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
       values ($1,'2026-03-14','E-Mail','geheim','T','S','Z','nein')`, [p.rows[0].id],
    );
    const r = await d.db.query<{ betroffene: number }>("select * from rohtexte_bereinigen()");
    expect(Number(r.rows[0].betroffene)).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
describe("Späterfassung", () => {
  it("markiert nicht, was zeitnah erfasst wurde", async () => {
    const p = await d.db.query<{ id: string }>(
      "insert into projects (org_id, name) values ($1,'Zeitnah') returning id", [orgId],
    );
    await d.db.query(
      `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
       values ($1, current_date - 2, 'E-Mail','x','Frisch','S','Z','ja')`, [p.rows[0].id],
    );
    const { rows } = await d.db.query<{ spaet_erfasst: boolean }>(
      "select spaet_erfasst from entries where project_id = $1", [p.rows[0].id],
    );
    expect(rows[0].spaet_erfasst).toBe(false);
  });

  it("markiert eine Mail, die ein halbes Jahr später auftaucht", async () => {
    const p = await d.db.query<{ id: string }>(
      "insert into projects (org_id, name) values ($1,'Nachgereicht') returning id", [orgId],
    );
    await d.db.query(
      `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
       values ($1, current_date - 180, 'E-Mail','x','Alt','S','Z','ja')`, [p.rows[0].id],
    );
    const { rows } = await d.db.query<{ spaet_erfasst: boolean }>(
      "select spaet_erfasst from entries where project_id = $1", [p.rows[0].id],
    );
    // Nicht verhindern, sondern kenntlich machen. Ein Vermerk mit dem
    // richtigen Datum und einem ehrlichen Hinweis ist mehr wert als keiner.
    expect(rows[0].spaet_erfasst).toBe(true);
  });

  it("lässt die Markierung nicht nachträglich entfernen", async () => {
    const { rows: e } = await d.db.query<{ id: string }>(
      "select e.id from entries e join projects p on p.id = e.project_id where p.name = 'Nachgereicht'",
    );
    await expect(
      d.db.query("update entries set spaet_erfasst = false where id = $1", [e[0].id]),
    ).rejects.toThrow(/unveraenderlich/i);
  });
});

/* ------------------------------------------------------------------ */
describe("Auskunft für den Datenschutzbeauftragten", () => {
  it("zeigt je Projekt, wie viele Rohtexte noch liegen und ab wann gelöscht wird", async () => {
    const { rows } = await d.db.query<{
      projekt: string; mit_rohtext: number; bereits_bereinigt: number; rohtext_loeschung_ab: string | null;
    }>("select * from aufbewahrung where org_id = $1 order by projekt", [orgId]);
    expect(rows.length).toBeGreaterThan(0);
    const abgefuellt = rows.find((r) => r.projekt.startsWith("A-2418"));
    expect(Number(abgefuellt?.bereits_bereinigt)).toBe(3);
    expect(Number(abgefuellt?.mit_rohtext)).toBe(0);
  });
});
