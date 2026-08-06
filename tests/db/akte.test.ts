/**
 * Die Eigenschaften, die dieses Produkt verkaufen, sind Datenbank-
 * eigenschaften: lückenlose Nummern, unveränderliche Inhalte, eine
 * überprüfbare Kette und harte Mandantentrennung.
 *
 * Wenn eine dieser Zusagen bricht, ist die Akte als Beweismittel wertlos.
 * Deshalb steht hier für jede Zusage ein Test, der sie zu brechen versucht.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { frischeDatenbank, nutzerAnlegen, vermerk, type Datenbank } from "./harness";

let d: Datenbank;
let a: { userId: string; orgId: string };
let b: { userId: string; orgId: string };
let projektA: string;
let projektB: string;

beforeAll(async () => {
  d = await frischeDatenbank();
  a = await nutzerAnlegen(d, "kaufmann@anlagenbau-mueller.de");
  b = await nutzerAnlegen(d, "leitung@fremder-betrieb.de");

  const p1 = await d.db.query<{ id: string }>(
    "insert into projects (org_id, name, contract_value) values ($1,$2,$3) returning id",
    [a.orgId, "Förderanlage Werk 2", 1_850_000],
  );
  projektA = p1.rows[0].id;

  const p2 = await d.db.query<{ id: string }>(
    "insert into projects (org_id, name) values ($1,$2) returning id",
    [b.orgId, "Fremdprojekt"],
  );
  projektB = p2.rows[0].id;
}, 60_000);

afterAll(async () => d?.schliessen());

/* ------------------------------------------------------------------ */
describe("Migrationen", () => {
  it("laufen vollständig durch und legen alle erwarteten Objekte an", async () => {
    const { rows } = await d.db.query<{ tabelle: string }>(`
      select table_name as tabelle from information_schema.tables
       where table_schema = 'public' order by 1
    `);
    const namen = rows.map((r) => r.tabelle);
    for (const erwartet of [
      "orgs", "memberships", "projects", "entries", "entry_events",
      "customers", "customer_profiles", "suppliers", "securities", "final_invoices",
      "kunden_kennzahlen", "sicherheiten_portfolio", "terminkette", "schlusszahlung_warnung",
    ]) {
      expect(namen, `fehlt: ${erwartet}`).toContain(erwartet);
    }
  });

  it("aktivieren Zeilensicherheit auf jeder Tabelle mit Kundendaten", async () => {
    const { rows } = await d.db.query<{ relname: string; relrowsecurity: boolean }>(`
      select c.relname, c.relrowsecurity
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'
       order by 1
    `);
    for (const r of rows) {
      expect(r.relrowsecurity, `RLS fehlt auf ${r.relname}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
describe("Lückenlose Nummerierung", () => {
  it("vergibt 1, 2, 3 … ohne Lücke", async () => {
    for (let i = 0; i < 5; i++) {
      await einfuegen(vermerk(projektA, { title: `Vorgang ${i + 1}` }));
    }
    const { rows } = await d.db.query<{ seq: number }>(
      "select seq from entries where project_id = $1 order by seq",
      [projektA],
    );
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it("zählt je Projekt getrennt, nicht global", async () => {
    await d.alsDienst(async () => {
      await d.db.query(
        `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
         values ($1,'2026-03-14','Notiz','x','x','x','x','nein')`,
        [projektB],
      );
    });
    const { rows } = await d.db.query<{ seq: number }>(
      "select seq from entries where project_id = $1",
      [projektB],
    );
    expect(rows[0].seq).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
describe("Hash-Kette", () => {
  it("verkettet jeden Vermerk mit seinem Vorgänger", async () => {
    const { rows } = await d.db.query<{ seq: number; hash: string; prev_hash: string }>(
      "select seq, hash, prev_hash from entries where project_id = $1 order by seq",
      [projektA],
    );
    expect(rows[0].prev_hash).toBe(`genesis:${projektA}`);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].prev_hash).toBe(rows[i - 1].hash);
    }
  });

  it("bestätigt eine unversehrte Kette", async () => {
    const { rows } = await d.db.query<{ inhalt_unveraendert: boolean; kette_intakt: boolean }>(
      "select seq, inhalt_unveraendert, kette_intakt from kette_pruefen($1)",
      [projektA],
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.inhalt_unveraendert && r.kette_intakt)).toBe(true);
  });

  it("schlägt an, wenn jemand am Datenbestand vorbei manipuliert", async () => {
    // Der Trigger verhindert das Ändern. Wir schalten ihn bewusst ab, um
    // den Fall nachzustellen, dass jemand direkten Datenbankzugriff hat —
    // genau dafür ist die Kette da.
    await d.db.exec("alter table entries disable trigger trg_entries_immutable");
    await d.db.query("update entries set facts = 'nachtraeglich geschoent' where project_id = $1 and seq = 2", [projektA]);
    await d.db.exec("alter table entries enable trigger trg_entries_immutable");

    const { rows } = await d.db.query<{ seq: number; inhalt_unveraendert: boolean }>(
      "select seq, inhalt_unveraendert, kette_intakt from kette_pruefen($1) order by seq",
      [projektA],
    );
    const betroffen = rows.find((r) => r.seq === 2);
    expect(betroffen?.inhalt_unveraendert).toBe(false);
    // Die anderen bleiben unauffällig — die Manipulation ist punktgenau lokalisierbar.
    expect(rows.filter((r) => r.seq !== 2).every((r) => r.inhalt_unveraendert)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe("Unveränderlichkeit", () => {
  it("verweigert Änderungen am Sachverhalt", async () => {
    await expect(
      d.db.query("update entries set facts = 'anders' where project_id = $1 and seq = 1", [projektA]),
    ).rejects.toThrow(/unveraenderlich/i);
  });

  it("verweigert Änderungen an der Richtung der Gegenseite", async () => {
    await expect(
      d.db.query("update entries set counterparty_kind = 'lieferant' where project_id = $1 and seq = 1", [projektA]),
    ).rejects.toThrow(/unveraenderlich/i);
  });

  it("verweigert Änderungen an der Prüfsumme", async () => {
    await expect(
      d.db.query("update entries set hash = 'gefaelscht' where project_id = $1 and seq = 1", [projektA]),
    ).rejects.toThrow(/unveraenderlich/i);
  });

  it("verweigert das Löschen", async () => {
    await expect(
      d.db.query("delete from entries where project_id = $1 and seq = 1", [projektA]),
    ).rejects.toThrow(/nicht geloescht/i);
  });

  it("erlaubt Arbeitsfelder: Status, Wert, Wiedervorlage", async () => {
    await d.db.query(
      `update entries set status = 'erledigt', estimated_value = 12500, wiedervorlage_am = '2026-05-01'
        where project_id = $1 and seq = 1`,
      [projektA],
    );
    const { rows } = await d.db.query<{ status: string; estimated_value: string }>(
      "select status, estimated_value from entries where project_id = $1 and seq = 1",
      [projektA],
    );
    expect(rows[0].status).toBe("erledigt");
    expect(Number(rows[0].estimated_value)).toBe(12500);
  });
});

/* ------------------------------------------------------------------ */
describe("Protokoll", () => {
  it("hält Anlage, Statuswechsel und Wertänderung fest", async () => {
    const { rows } = await d.db.query<{ action: string }>(
      `select ev.action from entry_events ev
         join entries e on e.id = ev.entry_id
        where e.project_id = $1 and e.seq = 1 order by ev.created_at, ev.id`,
      [projektA],
    );
    const aktionen = rows.map((r) => r.action);
    expect(aktionen).toContain("angelegt");
    expect(aktionen).toContain("status");
    expect(aktionen).toContain("wert");
  });
});

/* ------------------------------------------------------------------ */
describe("Mandantentrennung", () => {
  it("zeigt Nutzer A nur die eigenen Projekte", async () => {
    const sichtbar = await d.alsNutzer(a.userId, async () => {
      const { rows } = await d.db.query<{ id: string }>("select id from projects");
      return rows.map((r) => r.id);
    });
    expect(sichtbar).toContain(projektA);
    expect(sichtbar).not.toContain(projektB);
  });

  it("zeigt Nutzer B keine fremden Vermerke", async () => {
    const anzahl = await d.alsNutzer(b.userId, async () => {
      const { rows } = await d.db.query<{ n: number }>(
        "select count(*)::int as n from entries where project_id = $1",
        [projektA],
      );
      return rows[0].n;
    });
    expect(anzahl).toBe(0);
  });

  it("lässt Nutzer B keinen Vermerk in ein fremdes Projekt schreiben", async () => {
    await expect(
      d.alsNutzer(b.userId, () =>
        d.db.query(
          `insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote, deviation)
           values ($1,'2026-03-14','x','x','x','x','x','nein')`,
          [projektA],
        ),
      ),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  it("lässt Nutzer B kein fremdes Projekt umbenennen", async () => {
    await d.alsNutzer(b.userId, () =>
      d.db.query("update projects set name = 'gekapert' where id = $1", [projektA]),
    );
    const { rows } = await d.db.query<{ name: string }>("select name from projects where id = $1", [projektA]);
    expect(rows[0].name).toBe("Förderanlage Werk 2");
  });

  it("trennt auch Sicherheiten und Kunden", async () => {
    await d.db.query(
      "insert into securities (project_id, kind, amount, release_due_on) values ($1,'gewaehrleistungsbuergschaft',92500,'2030-06-30')",
      [projektA],
    );
    const gesehen = await d.alsNutzer(b.userId, async () => {
      const { rows } = await d.db.query<{ n: number }>(
        "select count(*)::int as n from securities where project_id = $1", [projektA]);
      return rows[0].n;
    });
    expect(gesehen).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
describe("Sicherheiten", () => {
  it("leitet die Wiedervorlage 30 Tage vor Fristablauf ab", async () => {
    const { rows } = await d.db.query<{ reminder_on: string }>(
      "select to_char(reminder_on, 'YYYY-MM-DD') as reminder_on from securities where project_id = $1",
      [projektA],
    );
    expect(rows[0].reminder_on).toBe("2030-05-31");
  });

  it("weist einen Betrag von null zurück", async () => {
    await expect(
      d.db.query("insert into securities (project_id, kind, amount) values ($1,'einbehalt',0)", [projektA]),
    ).rejects.toThrow();
  });

  it("rechnet die Avalkosten im Portfolio zusammen", async () => {
    await d.db.query(
      "insert into securities (project_id, kind, amount, aval_rate) values ($1,'vertragserfuellungsbuergschaft',100000,1.5)",
      [projektA],
    );
    // Nur das eigene Projekt zaehlen — jeder Betrieb hat zusaetzlich ein
    // Beispielprojekt mit eigenen Sicherheiten.
    const { rows } = await d.db.query<{ summe: string; aval: string }>(
      `select coalesce(sum(amount),0) as summe,
              coalesce(sum(amount * coalesce(aval_rate,0) / 100),0) as aval
         from securities where project_id = $1`,
      [projektA],
    );
    expect(Number(rows[0].summe)).toBe(192_500);
    expect(Number(rows[0].aval)).toBe(1_500);
  });
});

/* ------------------------------------------------------------------ */
describe("Warnung vor der Schlusszahlung", () => {
  it("zählt offene Abweichungen und gebundene Sicherheiten", async () => {
    const { rows } = await d.db.query<{
      abweichungen_offen: number; sicherheiten_betrag: string; zahlung_ohne_vorbehalt: boolean;
    }>("select * from schlusszahlung_warnung where project_id = $1", [projektA]);
    expect(rows[0].abweichungen_offen).toBeGreaterThan(0);
    expect(Number(rows[0].sicherheiten_betrag)).toBe(192_500);
    expect(rows[0].zahlung_ohne_vorbehalt).toBe(false);
  });

  it("schlägt an, sobald eine Schlusszahlung ohne Vorbehalt eingeht", async () => {
    await d.db.query(
      "insert into final_invoices (project_id, amount, received_on, reservation_made) values ($1, 1850000, '2026-08-01', false)",
      [projektA],
    );
    const { rows } = await d.db.query<{ zahlung_ohne_vorbehalt: boolean }>(
      "select zahlung_ohne_vorbehalt from schlusszahlung_warnung where project_id = $1",
      [projektA],
    );
    expect(rows[0].zahlung_ohne_vorbehalt).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
describe("Freemail-Sperre", () => {
  it("lernt eine Firmendomain", async () => {
    const { rows: k } = await d.db.query<{ id: string }>(
      "insert into customers (org_id, name) values ($1,'Muster Werke GmbH') returning id",
      [a.orgId],
    );
    await d.db.query("update projects set customer_id = $1 where id = $2", [k[0].id, projektA]);
    await d.db.query("select domain_lernen($1, $2)", [projektA, "einkauf@muster-werke.de"]);
    const { rows } = await d.db.query<{ domains: string[] }>("select domains from customers where id = $1", [k[0].id]);
    expect(rows[0].domains).toContain("muster-werke.de");
  });

  it("nimmt keine Freemail-Domain auf", async () => {
    await d.db.query("select domain_lernen($1, $2)", [projektA, "hans.meier@gmx.de"]);
    const { rows } = await d.db.query<{ domains: string[] }>(
      "select c.domains from customers c join projects p on p.customer_id = c.id where p.id = $1",
      [projektA],
    );
    expect(rows[0].domains).not.toContain("gmx.de");
  });
});

/* ------------------------------------------------------------------ */
async function einfuegen(v: Record<string, unknown>) {
  const spalten = Object.keys(v);
  const platz = spalten.map((_, i) => `$${i + 1}`).join(",");
  return d.db.query(
    `insert into entries (${spalten.join(",")}) values (${platz})`,
    Object.values(v),
  );
}
