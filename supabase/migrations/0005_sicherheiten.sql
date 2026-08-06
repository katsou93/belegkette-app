-- 0005 — Sicherheiten: Einbehalte und Bürgschaften
--
-- Warum eine eigene Tabelle und kein Feld am Projekt: ein Projekt hat
-- typischerweise mehrere Sicherheiten mit unterschiedlichen Fristen — die
-- Vertragserfüllungsbürgschaft läuft bis zur Abnahme, die Gewährleistungs-
-- bürgschaft vier Jahre darüber hinaus. Jede braucht ihr eigenes Datum und
-- ihren eigenen Status.
--
-- Das ist Arbeitsstand, kein Beweismittel. Sicherheiten sind deshalb
-- bewusst voll änderbar und gehen nicht in die Hash-Kette ein.

begin;

create table if not exists securities (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references projects on delete cascade,
  kind            text not null,
  amount          numeric(14,2) not null check (amount > 0),
  percent         numeric(5,2),
  issued_on       date,
  release_due_on  date,
  reminder_on     date,
  status          text not null default 'offen',
  aval_rate       numeric(5,3),
  bank            text,
  reference       text,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table securities drop constraint if exists securities_kind_check;
alter table securities add constraint securities_kind_check
  check (kind in ('einbehalt','vertragserfuellungsbuergschaft',
                  'gewaehrleistungsbuergschaft','anzahlungsbuergschaft','sonstige'));

alter table securities drop constraint if exists securities_status_check;
alter table securities add constraint securities_status_check
  check (status in ('offen','angefordert','zurueck','verfallen'));

create index if not exists securities_project_idx on securities (project_id);
create index if not exists securities_faellig_idx on securities (reminder_on)
  where status in ('offen','angefordert');

comment on table  securities             is 'Einbehalte und Bürgschaften je Projekt. Arbeitsstand, kein Beweismittel.';
comment on column securities.aval_rate   is 'Avalprovision in Prozent pro Jahr — Grundlage für die Kostenrechnung.';
comment on column securities.reminder_on is 'Wiedervorlage. Wird aus release_due_on abgeleitet, falls leer.';

-- ---------------------------------------------------------------
-- Wiedervorlage automatisch setzen
--
-- Ohne Vorlauf ist die Erinnerung wertlos: Wer am Tag des Fristablaufs
-- erfährt, dass er etwas anfordern müsste, ist zu spät dran. 30 Tage
-- reichen, um ein Schreiben aufzusetzen und abzuschicken.
-- ---------------------------------------------------------------
create or replace function sicherheit_wiedervorlage() returns trigger
language plpgsql as $$
begin
  if new.reminder_on is null and new.release_due_on is not null then
    new.reminder_on := new.release_due_on - 30;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_sicherheit_wiedervorlage on securities;
create trigger trg_sicherheit_wiedervorlage before insert or update on securities
  for each row execute function sicherheit_wiedervorlage();

-- ---------------------------------------------------------------
-- Portfolio je Betrieb
--
-- Beantwortet die Frage, die im Verkaufsgespräch niemand aus dem Kopf
-- beantworten kann: wie viel liegt gerade draußen?
-- ---------------------------------------------------------------
create or replace view sicherheiten_portfolio
with (security_invoker = true) as
select
  p.org_id,
  count(*) filter (where s.status in ('offen','angefordert'))                   as posten_offen,
  coalesce(sum(s.amount) filter (where s.status in ('offen','angefordert')), 0) as summe_gebunden,
  coalesce(sum(s.amount) filter (where s.status = 'offen'
                                   and s.release_due_on <= current_date), 0)    as summe_rueckforderbar,
  coalesce(sum(s.amount * coalesce(s.aval_rate, 0) / 100)
           filter (where s.status in ('offen','angefordert')), 0)               as avalkosten_pro_jahr,
  min(s.reminder_on) filter (where s.status in ('offen','angefordert'))         as naechste_wiedervorlage
from securities s
join projects p on p.id = s.project_id
group by p.org_id;

comment on view sicherheiten_portfolio is
  'Summenblick über alle Sicherheiten eines Betriebs. security_invoker: es gilt die Zeilensicherheit des Aufrufers.';

-- ---------------------------------------------------------------
-- Zeilensicherheit
-- ---------------------------------------------------------------
alter table securities enable row level security;

drop policy if exists sicherheit_lesen    on securities;
drop policy if exists sicherheit_anlegen  on securities;
drop policy if exists sicherheit_aendern  on securities;
drop policy if exists sicherheit_loeschen on securities;

create policy sicherheit_lesen on securities for select
  using (project_id in (select id from projects where org_id in (select auth_org_ids())));
create policy sicherheit_anlegen on securities for insert
  with check (project_id in (select id from projects where org_id in (select auth_org_ids())));
create policy sicherheit_aendern on securities for update
  using (project_id in (select id from projects where org_id in (select auth_org_ids())));
create policy sicherheit_loeschen on securities for delete
  using (project_id in (select id from projects where org_id in (select auth_org_ids())));

commit;
