/**
 * Probezeitraum, Kostenbremse und Betreibersicht.
 *
 * Die Probe ist eine harte Sperre. Wenn sie falsch greift, sperrt sie
 * zahlende Kunden aus — der teuerste denkbare Fehler in einem jungen
 * Produkt. Deshalb wird hier jeder Zustand einzeln geprüft.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { frischeDatenbank, nutzerAnlegen, type Datenbank } from "./harness";

let d: Datenbank;

beforeAll(async () => {
  d = await frischeDatenbank();
}, 60_000);

afterAll(async () => d?.schliessen());

/* ------------------------------------------------------------------ */
describe("Probezeitraum", () => {
  it("gibt einem neuen Betrieb 24 Stunden", async () => {
    const { orgId } = await nutzerAnlegen(d, "neu@betrieb-eins.de");
    const { rows } = await d.db.query<{ plan: string; stunden: number }>(
      `select plan, round(extract(epoch from (trial_ends_at - now())) / 3600)::int as stunden
         from orgs where id = $1`,
      [orgId],
    );
    expect(rows[0].plan).toBe("probe");
    expect(rows[0].stunden).toBe(24);
  });

  it("erlaubt das Anlegen während der Probe", async () => {
    const { orgId } = await nutzerAnlegen(d, "aktiv@betrieb-zwei.de");
    await expect(
      d.db.query("insert into projects (org_id, name) values ($1,'Läuft noch')", [orgId]),
    ).resolves.toBeTruthy();
  });

  it("sperrt das Anlegen nach Ablauf", async () => {
    const { orgId } = await nutzerAnlegen(d, "alt@betrieb-drei.de");
    await d.db.query("update orgs set trial_ends_at = now() - interval '1 minute' where id = $1", [orgId]);
    await expect(
      d.db.query("insert into projects (org_id, name) values ($1,'Zu spät')", [orgId]),
    ).rejects.toThrow(/Testzeitraum/i);
  });

  it("lässt die Akte nach Ablauf vollständig lesbar", async () => {
    const { orgId } = await nutzerAnlegen(d, "lesen@betrieb-vier.de");
    const { rows: p } = await d.db.query<{ id: string }>(
      "insert into projects (org_id, name) values ($1,'Fertig') returning id",
      [orgId],
    );
    await d.db.query(
      `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
       values ($1,'2026-03-14','Mail','x','Vorgang','x','x','ja')`,
      [p[0].id],
    );
    await d.db.query("update orgs set trial_ends_at = now() - interval '1 day' where id = $1", [orgId]);

    // Neu anlegen: gesperrt.
    await expect(
      d.db.query(
        `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
         values ($1,'2026-03-15','Mail','y','Zweiter','y','y','ja')`,
        [p[0].id],
      ),
    ).rejects.toThrow(/Testzeitraum/i);

    // Lesen: unverändert möglich. Das ist die Zusage.
    const { rows } = await d.db.query<{ n: number }>(
      "select count(*)::int as n from entries where project_id = $1",
      [p[0].id],
    );
    expect(rows[0].n).toBe(1);
  });

  it("hebt die Sperre auf, sobald der Betrieb aktiv geschaltet wird", async () => {
    const { orgId } = await nutzerAnlegen(d, "zahlt@betrieb-fuenf.de");
    await d.db.query("update orgs set trial_ends_at = now() - interval '1 day' where id = $1", [orgId]);
    await expect(
      d.db.query("insert into projects (org_id, name) values ($1,'Vorher')", [orgId]),
    ).rejects.toThrow();

    await d.db.query("update orgs set plan = 'aktiv' where id = $1", [orgId]);
    await expect(
      d.db.query("insert into projects (org_id, name) values ($1,'Nachher')", [orgId]),
    ).resolves.toBeTruthy();
  });

  it("sperrt einen gesperrten Betrieb auch mit laufender Frist", async () => {
    const { orgId } = await nutzerAnlegen(d, "raus@betrieb-sechs.de");
    await d.db.query(
      "update orgs set plan = 'gesperrt', trial_ends_at = now() + interval '30 days' where id = $1",
      [orgId],
    );
    await expect(
      d.db.query("insert into projects (org_id, name) values ($1,'Trotzdem')", [orgId]),
    ).rejects.toThrow(/Testzeitraum/i);
  });
});

/* ------------------------------------------------------------------ */
describe("Kostenbremse", () => {
  it("lässt Aufrufe bis zum Kontingent durch und bremst danach", async () => {
    const { userId } = await nutzerAnlegen(d, "vielnutzer@betrieb-sieben.de");

    const ergebnisse = await d.alsNutzer(userId, async () => {
      const alle: { erlaubt: boolean; grund: string | null }[] = [];
      for (let i = 0; i < 5; i++) {
        const { rows } = await d.db.query<{ erlaubt: boolean; grund: string | null }>(
          "select * from ki_kontingent_verbrauchen(100, 3)",
        );
        alle.push(rows[0]);
      }
      return alle;
    });

    expect(ergebnisse.slice(0, 3).every((r) => r.erlaubt)).toBe(true);
    expect(ergebnisse[3].erlaubt).toBe(false);
    expect(ergebnisse[3].grund).toMatch(/Stundenkontingent/);
  });

  it("zählt je Nutzer getrennt", async () => {
    const { userId } = await nutzerAnlegen(d, "anderer@betrieb-acht.de");
    const r = await d.alsNutzer(userId, async () => {
      const { rows } = await d.db.query<{ erlaubt: boolean }>(
        "select * from ki_kontingent_verbrauchen(100, 3)",
      );
      return rows[0];
    });
    expect(r.erlaubt).toBe(true);
  });

  it("verweigert ohne Anmeldung", async () => {
    const { rows } = await d.db.query<{ erlaubt: boolean; grund: string }>(
      "select * from ki_kontingent_verbrauchen(100, 30)",
    );
    expect(rows[0].erlaubt).toBe(false);
    expect(rows[0].grund).toMatch(/nicht angemeldet/);
  });

  it("trägt verbrauchte Token nach", async () => {
    const { userId, orgId } = await nutzerAnlegen(d, "token@betrieb-neun.de");
    await d.alsNutzer(userId, async () => {
      await d.db.query("select ki_kontingent_verbrauchen(100, 30)");
      await d.db.query("select ki_verbrauch_nachtragen(1500, 400)");
    });
    const { rows } = await d.db.query<{ tokens_in: string; tokens_out: string }>(
      "select tokens_in, tokens_out from ai_usage where org_id = $1 and art = 'tag'",
      [orgId],
    );
    expect(Number(rows[0].tokens_in)).toBe(1500);
    expect(Number(rows[0].tokens_out)).toBe(400);
  });
});

/* ------------------------------------------------------------------ */
describe("Betreibersicht", () => {
  it("zeigt einem gewöhnlichen Nutzer nichts", async () => {
    const { userId } = await nutzerAnlegen(d, "normalo@betrieb-zehn.de");
    const anzahl = await d.alsNutzer(userId, async () => {
      const { rows } = await d.db.query<{ n: number }>("select count(*)::int as n from admin_betriebe");
      return rows[0].n;
    });
    expect(anzahl).toBe(0);
  });

  it("zeigt dem Betreiber alle Betriebe", async () => {
    const { userId } = await nutzerAnlegen(d, "chef@prooftrail.de");
    await d.db.query("insert into app_admins (user_id, note) values ($1,'Gründer')", [userId]);

    const zeilen = await d.alsNutzer(userId, async () => {
      const { rows } = await d.db.query<{ betrieb: string; plan: string }>(
        "select betrieb, plan from admin_betriebe",
      );
      return rows;
    });
    expect(zeilen.length).toBeGreaterThan(5);
    expect(zeilen.some((z) => z.betrieb === "betrieb-eins.de")).toBe(true);
  });

  it("gibt dem Betreiber keine Vermerkinhalte", async () => {
    const { rows } = await d.db.query<{ spalte: string }>(
      `select column_name as spalte from information_schema.columns
        where table_name = 'admin_betriebe'`,
    );
    const spalten = rows.map((r) => r.spalte);
    for (const verboten of ["raw_text", "facts", "quote", "title", "suggestion"]) {
      expect(spalten, `Betreibersicht darf ${verboten} nicht enthalten`).not.toContain(verboten);
    }
  });

  it("lässt den Betreiber einen Betrieb freischalten", async () => {
    const { userId } = await nutzerAnlegen(d, "chef2@prooftrail.de");
    await d.db.query("insert into app_admins (user_id) values ($1)", [userId]);
    const { rows: o } = await d.db.query<{ id: string }>(
      "select id from orgs where name = 'betrieb-drei.de'",
    );
    await d.alsNutzer(userId, () =>
      d.db.query("update orgs set plan = 'aktiv' where id = $1", [o[0].id]),
    );
    const { rows } = await d.db.query<{ plan: string }>("select plan from orgs where id = $1", [o[0].id]);
    expect(rows[0].plan).toBe("aktiv");
  });
});
