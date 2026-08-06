/**
 * Testgerüst: ein echtes Postgres im Prozess.
 *
 * Warum nicht gegen die Supabase-Instanz testen? Weil Tests, die eine
 * Netzverbindung und einen Schlüssel brauchen, in der Übergabe als Erstes
 * kaputtgehen. PGlite ist Postgres 18 als WASM — dieselbe Engine, dieselben
 * Trigger, dieselbe Zeilensicherheit, nur ohne Server.
 *
 * Was Supabase mitbringt und hier nachgebaut werden muss:
 *   - das Schema auth mit auth.users
 *   - auth.uid(), das die angemeldete Person zurückgibt
 *   - die Rollen anon / authenticated / service_role
 *
 * auth.uid() liest bei Supabase einen JWT-Claim. Hier liest es eine
 * Sitzungsvariable. Für die Policies ist das identisch: beide liefern eine
 * uuid oder null.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const MIGRATIONEN = join(process.cwd(), "supabase", "migrations");

/** Supabase-Umgebung, die die Migrationen voraussetzen. */
const VORLAUF = `
create schema if not exists auth;

create table auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text unique,
  created_at timestamptz not null default now()
);

-- Bei Supabase kommt die Kennung aus dem JWT. Hier aus einer
-- Sitzungsvariablen, die der Test setzt. Rückgabetyp und Verhalten
-- bei fehlender Anmeldung sind gleich.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon;          end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
`;

export interface Datenbank {
  db: PGlite;
  /** Führt etwas als angemeldete Person aus — mit greifender Zeilensicherheit. */
  alsNutzer<T>(userId: string, fn: () => Promise<T>): Promise<T>;
  /** Führt etwas ohne Zeilensicherheit aus, wie der Dienstschlüssel. */
  alsDienst<T>(fn: () => Promise<T>): Promise<T>;
  schliessen(): Promise<void>;
}

export async function frischeDatenbank(): Promise<Datenbank> {
  const db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(VORLAUF);

  const dateien = (await readdir(MIGRATIONEN)).filter((d) => d.endsWith(".sql")).sort();
  if (dateien.length === 0) throw new Error("Keine Migrationen gefunden.");

  for (const datei of dateien) {
    const sql = await readFile(join(MIGRATIONEN, datei), "utf8");
    try {
      await db.exec(sql);
    } catch (fehler) {
      throw new Error(`Migration ${datei} fehlgeschlagen: ${(fehler as Error).message}`);
    }
  }

  // Nach den Migrationen die Rechte nachziehen — die default privileges
  // oben greifen nur für danach angelegte Objekte.
  await db.exec(`
    grant all on all tables    in schema public to anon, authenticated, service_role;
    grant all on all functions in schema public to anon, authenticated, service_role;
    grant all on all sequences in schema public to anon, authenticated, service_role;
  `);

  async function alsNutzer<T>(userId: string, fn: () => Promise<T>): Promise<T> {
    await db.exec(`set role authenticated;
                   select set_config('request.jwt.claim.sub', '${userId}', false);`);
    try {
      return await fn();
    } finally {
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    }
  }

  async function alsDienst<T>(fn: () => Promise<T>): Promise<T> {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
    return fn();
  }

  return { db, alsNutzer, alsDienst, schliessen: () => db.close() };
}

/** Legt einen Nutzer an. Der Trigger aus 0002 erzeugt Betrieb und Mitgliedschaft. */
export async function nutzerAnlegen(d: Datenbank, email: string) {
  const { rows } = await d.db.query<{ id: string }>(
    "insert into auth.users (email) values ($1) returning id",
    [email],
  );
  const userId = rows[0].id;
  const { rows: m } = await d.db.query<{ org_id: string }>(
    "select org_id from memberships where user_id = $1",
    [userId],
  );
  if (!m[0]) throw new Error("Kein Betrieb angelegt — Trigger handle_new_user greift nicht.");
  return { userId, orgId: m[0].org_id };
}

/** Ein Vermerk mit sinnvollen Vorgabewerten. */
export function vermerk(projectId: string, ueber: Partial<Record<string, unknown>> = {}) {
  return {
    project_id: projectId,
    occurred_on: "2026-03-14",
    source: "E-Mail vom Kunden",
    raw_text: "Bitte die Pumpe in Edelstahl statt Guss ausfuehren.",
    title: "Materialwechsel Pumpe",
    facts: "Der Auftraggeber fordert Edelstahl statt Guss.",
    quote: "Bitte die Pumpe in Edelstahl statt Guss ausfuehren.",
    deviation: "ja",
    ...ueber,
  };
}
