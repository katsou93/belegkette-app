-- 0007 — Vertragsrahmen und die Warnung vor der Schlusszahlung
--
-- Der einzige Fehler im Projekt, der sich nicht mehr reparieren lässt:
-- die vorbehaltlose Annahme der Schlusszahlung. Ist die VOB/B vereinbart,
-- kann § 16 Abs. 3 Nr. 2 Nachforderungen ausschließen; § 640 Abs. 2 BGB
-- kennt eine vergleichbare Wirkung bei der Abnahme trotz bekannter Mängel.
--
-- Das System kann diesen Moment erkennen, weil es weiß, was noch offen
-- ist. Es warnt — und entscheidet nichts.

begin;

-- ---------------------------------------------------------------
-- 1) Vertragsrahmen am Projekt
--
--    Ohne diese Felder kann das System nicht wissen, ob überhaupt VOB/B
--    gilt — und würde Fristen behaupten, die gar nicht anwendbar sind.
--    Lieber leer lassen als raten.
-- ---------------------------------------------------------------
alter table projects add column if not exists contract_ref      text;
alter table projects add column if not exists contract_basis    text;
alter table projects add column if not exists accepted_on       date;
alter table projects add column if not exists warranty_months   integer;
alter table projects add column if not exists retention_percent numeric(5,2);
alter table projects add column if not exists acceptance_rule   text;

alter table projects drop constraint if exists projects_contract_basis_check;
alter table projects add constraint projects_contract_basis_check
  check (contract_basis is null or contract_basis in ('bgb','vob_b','unbekannt'));

alter table projects drop constraint if exists projects_warranty_check;
alter table projects add constraint projects_warranty_check
  check (warranty_months is null or (warranty_months between 0 and 240));

comment on column projects.contract_basis  is 'bgb, vob_b oder unbekannt. Steuert, welche Hinweise das System überhaupt geben darf.';
comment on column projects.accepted_on     is 'Datum der Abnahme. Startpunkt aller Gewährleistungsfristen.';
comment on column projects.warranty_months is 'Gewährleistungsfrist in Monaten laut Vertrag — nicht laut Faustregel.';

-- ---------------------------------------------------------------
-- 2) Schlussrechnung
--
--    Eigene Tabelle statt Feld am Projekt: es gibt Abschlagsrechnungen,
--    korrigierte Schlussrechnungen und Teilschlussrechnungen. Der
--    Vorbehalt hängt an der einzelnen Rechnung, nicht am Projekt.
-- ---------------------------------------------------------------
create table if not exists final_invoices (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects on delete cascade,
  invoice_no        text,
  issued_on         date,
  amount            numeric(14,2),
  received_on       date,
  reservation_made  boolean not null default false,
  reservation_text  text,
  note              text,
  created_at        timestamptz not null default now()
);
create index if not exists final_invoices_project_idx on final_invoices (project_id);

comment on table  final_invoices                  is 'Schlussrechnungen je Projekt. Der Vorbehalt hängt an der Rechnung, nicht am Projekt.';
comment on column final_invoices.reservation_made is 'Wurde der Vorbehalt schriftlich erklärt? Das ist der Punkt, an dem Ansprüche verloren gehen.';

-- ---------------------------------------------------------------
-- 3) Die Warnung als Sicht
--
--    Bewusst als Sicht und nicht im Anwendungscode: die Zahlen müssen
--    aus derselben Quelle kommen wie der Rest der Akte, sonst weicht
--    die Warnung irgendwann von der Liste darunter ab.
-- ---------------------------------------------------------------
create or replace view schlusszahlung_warnung
with (security_invoker = true) as
select
  p.id   as project_id,
  p.org_id,
  p.name as projekt,
  count(e.id) filter (where e.deviation = 'ja'
                        and e.status in ('offen','angezeigt'))                  as abweichungen_offen,
  coalesce(sum(e.estimated_value) filter (where e.deviation = 'ja'
                        and e.status in ('offen','angezeigt')), 0)              as wert_offen,
  coalesce((select count(*) from securities s
             where s.project_id = p.id and s.status in ('offen','angefordert')), 0)   as sicherheiten_offen,
  coalesce((select sum(s.amount) from securities s
             where s.project_id = p.id and s.status in ('offen','angefordert')), 0)   as sicherheiten_betrag,
  exists (select 1 from final_invoices f
           where f.project_id = p.id and f.received_on is not null
             and not f.reservation_made)                                        as zahlung_ohne_vorbehalt
from projects p
left join entries e on e.project_id = p.id
group by p.id, p.org_id, p.name;

comment on view schlusszahlung_warnung is
  'Was vor Annahme der Schlusszahlung noch offen ist. Hinweis, keine Rechtsberatung.';

-- ---------------------------------------------------------------
-- 4) Zeilensicherheit
-- ---------------------------------------------------------------
alter table final_invoices enable row level security;

drop policy if exists rechnung_lesen   on final_invoices;
drop policy if exists rechnung_anlegen on final_invoices;
drop policy if exists rechnung_aendern on final_invoices;

create policy rechnung_lesen on final_invoices for select
  using (project_id in (select id from projects where org_id in (select auth_org_ids())));
create policy rechnung_anlegen on final_invoices for insert
  with check (project_id in (select id from projects where org_id in (select auth_org_ids())));
create policy rechnung_aendern on final_invoices for update
  using (project_id in (select id from projects where org_id in (select auth_org_ids())));

commit;
