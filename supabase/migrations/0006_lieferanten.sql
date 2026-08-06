-- 0006 — Die Gegenseite kann auch unten liegen
--
-- Bisher kannte das System nur den Auftraggeber. In Wirklichkeit entsteht
-- die Hälfte der Verzögerungen beim Unterlieferanten — und wer sich beim
-- Auftraggeber auf eine Behinderung beruft, muss sie beim Verursacher
-- ebenso dokumentiert haben. Sonst bleibt er auf dem Schaden sitzen.
--
-- Deshalb: dieselbe Aktenlogik nach unten, mit demselben Beweischarakter.

begin;

-- ---------------------------------------------------------------
-- 1) Lieferanten
--    Bewusst spiegelbildlich zu customers aufgebaut — gleiche Felder,
--    gleiche Regeln, gleiche Domain-Zuordnung.
-- ---------------------------------------------------------------
create table if not exists suppliers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs on delete cascade,
  name        text not null,
  domains     text[] not null default '{}',
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists suppliers_org_idx on suppliers (org_id);
create unique index if not exists suppliers_org_name_idx on suppliers (org_id, lower(name));

comment on table suppliers is
  'Unterlieferanten und Nachunternehmer. Spiegelbild zu customers.';

-- ---------------------------------------------------------------
-- 2) Richtung am Vermerk
--
--    counterparty_kind sagt, gegen wen der Vorgang läuft. Das ist
--    beweisrelevant und deshalb Teil der unveränderlichen Inhalte.
-- ---------------------------------------------------------------
alter table entries add column if not exists counterparty_kind text not null default 'auftraggeber';
alter table entries add column if not exists supplier_id uuid references suppliers on delete set null;

alter table entries drop constraint if exists entries_counterparty_kind_check;
alter table entries add constraint entries_counterparty_kind_check
  check (counterparty_kind in ('auftraggeber','lieferant'));

-- Ein Vorgang gegen einen Lieferanten braucht keinen Lieferanten-Datensatz
-- (der kann nachgetragen werden), aber ein Lieferantenbezug ohne die
-- passende Richtung wäre widersprüchlich.
alter table entries drop constraint if exists entries_gegenseite_stimmig;
alter table entries add constraint entries_gegenseite_stimmig
  check (supplier_id is null or counterparty_kind = 'lieferant');

create index if not exists entries_supplier_idx on entries (supplier_id)
  where supplier_id is not null;

comment on column entries.counterparty_kind is
  'Gegen wen läuft der Vorgang. Beweisrelevant, deshalb unveränderlich.';

-- ---------------------------------------------------------------
-- 3) Terminwirkung
--
--    Nicht jede Abweichung kostet Zeit, und nicht jede Verzögerung ist
--    eine Abweichung vom Leistungsumfang. Das sind zwei Achsen, die
--    getrennt gehören — sonst geht die Verzugskette im Rauschen unter.
-- ---------------------------------------------------------------
alter table entries add column if not exists schedule_impact boolean not null default false;

comment on column entries.schedule_impact is
  'Der Vorgang wirkt sich auf den Terminplan aus. Getrennt von deviation.';

create index if not exists entries_termin_idx on entries (project_id)
  where schedule_impact;

-- ---------------------------------------------------------------
-- 4) Unveränderlichkeit auf die neuen Beweisfelder ausdehnen
--
--    Wichtig: die Hash-Kette aus 0003 deckt diese Felder nicht ab. Sie
--    bewusst nicht in den Hash aufzunehmen wäre ein Fehler — dann könnte
--    man die Richtung ändern, ohne dass die Prüfung anschlägt. Der
--    Trigger sperrt sie deshalb hart.
-- ---------------------------------------------------------------
create or replace function entries_immutable() returns trigger
language plpgsql as $$
begin
  if new.seq               is distinct from old.seq
     or new.project_id        is distinct from old.project_id
     or new.occurred_on       is distinct from old.occurred_on
     or new.raw_text          is distinct from old.raw_text
     or new.title             is distinct from old.title
     or new.facts             is distinct from old.facts
     or new.quote             is distinct from old.quote
     or new.deviation         is distinct from old.deviation
     or new.created_at        is distinct from old.created_at
     or new.prev_hash         is distinct from old.prev_hash
     or new.hash              is distinct from old.hash
     or new.source_kind       is distinct from old.source_kind
     or new.counterparty_kind is distinct from old.counterparty_kind
     or new.schedule_impact   is distinct from old.schedule_impact then
    raise exception 'Vermerkinhalte und Pruefsummen sind unveraenderlich. Aenderbar sind nur status, note, estimated_value, wiedervorlage_am und discard_reason.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------
-- 5) Terminkette
--
--    Zeigt je Projekt die Vorgänge mit Terminwirkung in der Reihenfolge,
--    in der sie passiert sind. Das ist die Grundlage jeder
--    Bauzeitverlängerung: eine lückenlose, datierte Ursachenkette.
-- ---------------------------------------------------------------
create or replace view terminkette
with (security_invoker = true) as
select
  e.project_id,
  p.org_id,
  e.id,
  e.seq,
  e.occurred_on,
  e.title,
  e.counterparty_kind,
  e.status,
  e.occurred_on - lag(e.occurred_on) over (
    partition by e.project_id order by e.occurred_on, e.seq
  ) as tage_seit_vorgaenger
from entries e
join projects p on p.id = e.project_id
where e.schedule_impact;

comment on view terminkette is
  'Vorgänge mit Terminwirkung je Projekt, chronologisch. Grundlage für Bauzeitverlängerung.';

-- ---------------------------------------------------------------
-- 6) Zeilensicherheit für Lieferanten
-- ---------------------------------------------------------------
alter table suppliers enable row level security;

drop policy if exists lieferant_lesen   on suppliers;
drop policy if exists lieferant_anlegen on suppliers;
drop policy if exists lieferant_aendern on suppliers;

create policy lieferant_lesen   on suppliers for select using (org_id in (select auth_org_ids()));
create policy lieferant_anlegen on suppliers for insert with check (org_id in (select auth_org_ids()));
create policy lieferant_aendern on suppliers for update using (org_id in (select auth_org_ids()));

commit;
