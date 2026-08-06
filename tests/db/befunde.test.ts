/**
 * Befunde, Ampel und Wochenbericht.
 *
 * Das ist die Auswertung, die ein Geschäftsführer zu sehen bekommt. Wenn
 * sie einen Befund erfindet, den es nicht gibt, verliert das Produkt genau
 * einmal Vertrauen — und dann für immer. Deshalb prüft jeder Test hier
 * beides: dass ein Befund erscheint, wenn er soll, und dass er ausbleibt,
 * wenn er nicht soll.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { frischeDatenbank, nutzerAnlegen, type Datenbank } from "./harness";

let d: Datenbank;
let orgId: string;

beforeAll(async () => {
  d = await frischeDatenbank();
  ({ orgId } = await nutzerAnlegen(d, "gf@anlagenbau-mueller.de"));
}, 60_000);

afterAll(async () => d?.schliessen());

async function projekt(name: string, wert: number | null = 2_000_000) {
  const { rows } = await d.db.query<{ id: string }>(
    "insert into projects (org_id, name, contract_value) values ($1,$2,$3) returning id",
    [orgId, name, wert],
  );
  return rows[0].id;
}

async function vorgang(
  p: string,
  ueber: {
    tageAlt?: number; deviation?: string; status?: string;
    wert?: number | null; termin?: boolean; angezeigt?: boolean;
  } = {},
) {
  const {
    tageAlt = 1, deviation = "ja", status = "offen",
    wert = 20_000, termin = false, angezeigt = false,
  } = ueber;
  const { rows } = await d.db.query<{ id: string }>(
    `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote,
                          deviation, schedule_impact)
     values ($1, current_date - ($2)::int, 'E-Mail', 'x', 'Vorgang', 'S', 'Z', $3, $4)
     returning id`,
    [p, tageAlt, deviation, termin],
  );
  const felder: string[] = [];
  const werte: unknown[] = [rows[0].id];
  if (wert !== null) { felder.push(`estimated_value = $${werte.push(wert)}`); }
  if (status !== "offen") { felder.push(`status = $${werte.push(status)}`); }
  if (angezeigt) {
    felder.push(`notified_on = current_date, notified_kind = 'leistungsaenderung'`);
  }
  if (felder.length) {
    await d.db.query(`update entries set ${felder.join(", ")} where id = $1`, werte);
  }
  return rows[0].id;
}

const befunde = async (p: string) =>
  (await d.db.query<{ art: string; anzahl: number; betrag: string; befund: string }>(
    "select art, anzahl, betrag, befund from projekt_befunde where project_id = $1 order by art",
    [p],
  )).rows;

const ampel = async (p: string) =>
  (await d.db.query<{ ampel: string; befunde: number; betrag_betroffen: string; zusammenfassung: string }>(
    "select ampel, befunde, betrag_betroffen, zusammenfassung from projekt_ampel where project_id = $1",
    [p],
  )).rows[0];

/* ------------------------------------------------------------------ */
describe("Ein sauberes Projekt bleibt grün", () => {
  it("meldet nichts bei frischen, angezeigten Vorgängen", async () => {
    const p = await projekt("Sauber");
    await vorgang(p, { tageAlt: 3, angezeigt: true, wert: 5_000 });
    expect(await befunde(p)).toHaveLength(0);
    const a = await ampel(p);
    expect(a.ampel).toBe("gruen");
    expect(a.zusammenfassung).toBe("Keine Auffälligkeiten");
  });

  it("meldet nichts bei einem Vorgang ohne Abweichung", async () => {
    const p = await projekt("Nur Rückfragen");
    await vorgang(p, { tageAlt: 200, deviation: "nein", wert: null });
    expect(await befunde(p)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
describe("Anspruch verfällt", () => {
  it("meldet alte, offene, nie angezeigte Abweichungen mit Betrag", async () => {
    const p = await projekt("Vergessen");
    await vorgang(p, { tageAlt: 60, wert: 30_000 });
    await vorgang(p, { tageAlt: 45, wert: 30_000 });
    const b = (await befunde(p)).find((x) => x.art === "anspruch_verfaellt");
    expect(b).toBeDefined();
    expect(b!.anzahl).toBe(2);
    expect(Number(b!.betrag)).toBe(60_000);
    expect(b!.befund).toMatch(/2 Abweichungen seit über 30 Tagen/);
    expect((await ampel(p)).ampel).toBe("rot");
  });

  it("meldet nicht, was innerhalb der Frist liegt", async () => {
    const p = await projekt("Frisch");
    await vorgang(p, { tageAlt: 10 });
    expect((await befunde(p)).some((x) => x.art === "anspruch_verfaellt")).toBe(false);
  });

  it("meldet nicht, was bereits angezeigt wurde", async () => {
    const p = await projekt("Angezeigt");
    await vorgang(p, { tageAlt: 90, angezeigt: true });
    expect((await befunde(p)).some((x) => x.art === "anspruch_verfaellt")).toBe(false);
  });

  it("richtet sich nach der Schwelle des Betriebs", async () => {
    await d.db.query("update orgs set befund_tage_offen = 120 where id = $1", [orgId]);
    const p = await projekt("Lange Projekte");
    await vorgang(p, { tageAlt: 60 });
    expect((await befunde(p)).some((x) => x.art === "anspruch_verfaellt")).toBe(false);
    await d.db.query("update orgs set befund_tage_offen = 30 where id = $1", [orgId]);
    expect((await befunde(p)).some((x) => x.art === "anspruch_verfaellt")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe("Verzug ohne Anzeige", () => {
  it("meldet Terminwirkung, die nie angezeigt wurde", async () => {
    const p = await projekt("Behinderung");
    await vorgang(p, { tageAlt: 5, termin: true, deviation: "nein", wert: null });
    const b = (await befunde(p)).find((x) => x.art === "verzug_ohne_anzeige");
    expect(b?.anzahl).toBe(1);
    expect((await ampel(p)).ampel).toBe("rot");
  });

  it("schweigt, sobald angezeigt wurde", async () => {
    const p = await projekt("Behinderung angezeigt");
    await vorgang(p, { tageAlt: 5, termin: true, angezeigt: true, deviation: "nein", wert: null });
    expect((await befunde(p)).some((x) => x.art === "verzug_ohne_anzeige")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe("Schlusszahlung ohne Vorbehalt", () => {
  it("schlägt an, wenn Geld eingeht und noch etwas offen ist", async () => {
    const p = await projekt("Schlussrechnung");
    await vorgang(p, { tageAlt: 5, wert: 40_000 });
    await d.db.query(
      `insert into final_invoices (project_id, amount, received_on, reservation_made)
       values ($1, 2000000, current_date, false)`, [p],
    );
    const b = (await befunde(p)).find((x) => x.art === "schlusszahlung_ohne_vorbehalt");
    expect(b).toBeDefined();
    expect(Number(b!.betrag)).toBe(40_000);
  });

  it("schweigt, wenn der Vorbehalt erklärt wurde", async () => {
    const p = await projekt("Mit Vorbehalt");
    await vorgang(p, { tageAlt: 5, wert: 40_000 });
    await d.db.query(
      `insert into final_invoices (project_id, amount, received_on, reservation_made)
       values ($1, 2000000, current_date, true)`, [p],
    );
    expect((await befunde(p)).some((x) => x.art === "schlusszahlung_ohne_vorbehalt")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe("Sicherheiten", () => {
  it("meldet, was rückforderbar ist", async () => {
    const p = await projekt("Bürgschaft fällig");
    await d.db.query(
      `insert into securities (project_id, kind, amount, release_due_on)
       values ($1,'gewaehrleistungsbuergschaft', 92500, current_date - 5)`, [p],
    );
    const b = (await befunde(p)).find((x) => x.art === "sicherheit_rueckforderbar");
    expect(Number(b?.betrag)).toBe(92_500);
    expect(b?.befund).toMatch(/92.500/);
  });

  it("meldet nichts, was noch nicht fällig ist", async () => {
    const p = await projekt("Bürgschaft läuft");
    await d.db.query(
      `insert into securities (project_id, kind, amount, release_due_on)
       values ($1,'einbehalt', 50000, current_date + 400)`, [p],
    );
    expect((await befunde(p)).some((x) => x.art === "sicherheit_rueckforderbar")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe("Margenrisiko", () => {
  it("meldet, wenn offene Abweichungen die Schwelle überschreiten", async () => {
    const p = await projekt("Margenrisiko", 1_000_000);
    await vorgang(p, { tageAlt: 2, wert: 50_000 }); // 5 % > 3 %
    const b = (await befunde(p)).find((x) => x.art === "margenrisiko");
    expect(b?.befund).toMatch(/5(\.|,)0 Prozent/);
  });

  it("schweigt unterhalb der Schwelle", async () => {
    const p = await projekt("Klein", 1_000_000);
    await vorgang(p, { tageAlt: 2, wert: 10_000 }); // 1 %
    expect((await befunde(p)).some((x) => x.art === "margenrisiko")).toBe(false);
  });

  it("rechnet nicht ohne Auftragswert", async () => {
    const p = await projekt("Ohne Wert", null);
    await vorgang(p, { tageAlt: 2, wert: 500_000 });
    expect((await befunde(p)).some((x) => x.art === "margenrisiko")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe("Beschleunigung", () => {
  it("erkennt ein Projekt, das gerade kippt", async () => {
    const p = await projekt("Kippt");
    for (let i = 0; i < 6; i++) await vorgang(p, { tageAlt: 5 + i, angezeigt: true });
    await vorgang(p, { tageAlt: 100, angezeigt: true });
    const b = (await befunde(p)).find((x) => x.art === "beschleunigung");
    expect(b).toBeDefined();
    expect(b!.anzahl).toBe(6);
  });

  it("meldet nichts bei gleichmäßigem Verlauf", async () => {
    const p = await projekt("Ruhig");
    for (const t of [10, 40, 70, 100]) await vorgang(p, { tageAlt: t, angezeigt: true });
    expect((await befunde(p)).some((x) => x.art === "beschleunigung")).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe("Wochenbericht", () => {
  it("zählt Ampeln und Beträge über alle Projekte", async () => {
    const { rows } = await d.db.query<{
      projekte: number; rot: number; gelb: number; gruen: number;
      betrag_rot: string; sicherheiten_gebunden: string;
    }>("select * from wochenbericht where org_id = $1", [orgId]);
    const w = rows[0];
    expect(w.projekte).toBe(w.rot + w.gelb + w.gruen);
    expect(w.rot).toBeGreaterThan(0);
    expect(Number(w.betrag_rot)).toBeGreaterThan(0);
    expect(Number(w.sicherheiten_gebunden)).toBeGreaterThan(0);
  });

  it("zeigt einem fremden Betrieb nur die eigenen Projekte", async () => {
    const { userId, orgId: fremd } = await nutzerAnlegen(d, "fremd@woanders.de");
    const zeilen = await d.alsNutzer(userId, async () => {
      const { rows } = await d.db.query<{ org_id: string }>("select org_id from projekt_befunde");
      return rows;
    });
    // Der fremde Betrieb hat sein eigenes Beispielprojekt — aber kein
    // einziger Befund darf aus einem anderen Betrieb stammen.
    expect(zeilen.every((z) => z.org_id === fremd)).toBe(true);
    expect(zeilen.some((z) => z.org_id === orgId)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
describe("Jahresbilanz", () => {
  it("trennt geltend Gemachtes von Liegengelassenem", async () => {
    const p = await projekt("Bilanz");
    await vorgang(p, { tageAlt: 20, status: "erledigt", wert: 80_000, angezeigt: true });
    await vorgang(p, { tageAlt: 25, wert: 45_000 });

    const { rows } = await d.db.query<{
      abweichungen: number; angezeigt: number; nie_angezeigt: number;
      wert_erledigt: string; wert_nie_angezeigt: string;
    }>(
      "select * from jahresbilanz where org_id = $1 and jahr = extract(year from current_date)::int",
      [orgId],
    );
    const j = rows[0];
    expect(j.abweichungen).toBeGreaterThan(0);
    expect(j.angezeigt).toBeGreaterThan(0);
    expect(j.nie_angezeigt).toBeGreaterThan(0);
    expect(Number(j.wert_erledigt)).toBeGreaterThanOrEqual(80_000);
    expect(Number(j.wert_nie_angezeigt)).toBeGreaterThanOrEqual(45_000);
  });
});
