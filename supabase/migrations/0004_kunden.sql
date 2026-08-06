-- 0004 — Auftraggeber als eigene Akte
--
-- Ein Projekt gehoert zu einem Auftraggeber. Die Zuordnung entsteht beim
-- Anlegen und wird durch die Absenderdomains eingehender Nachrichten ergaenzt.
--
-- Grundsatz wie ueberall: Zeilensicherheit auf Betriebsebene, und die
-- KI-Zusammenfassung bleibt strikt getrennt von den Beweisinhalten.

begin;

-- ---------------------------------------------------------------
-- 1) Auftraggeber
-- ---------------------------------------------------------------
create table if not exists customers (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references orgs on delete cascade,
  name        text not null,
  -- E-Mail-Domains zur automatischen Zuordnung, z.B. {'kunde-gmbh.de'}
  domains     text[] not null default '{}',
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists customers_org_idx on customers (org_id);
create unique index if not exists customers_org_name_idx on customers (org_id, lower(name));

alter table projects add column if not exists customer_id uuid references customers on delete set null;
create index if not exists projects_customer_idx on projects (customer_id);

comment on column customers.domains is
  'E-Mail-Domains des Auftraggebers. Freemail-Domains werden nie aufgenommen.';

-- ---------------------------------------------------------------
-- 2) Freemail-Sperre
--    Ohne diese Liste entstehen Karteileichen wie "gmx.de" als Auftraggeber.
-- ---------------------------------------------------------------
create or replace function ist_freemail(d text) returns boolean
language sql immutable as $$
  select lower(coalesce(d,'')) = any (array[
    'gmail.com','googlemail.com','gmx.de','gmx.net','gmx.at','gmx.ch',
    'web.de','t-online.de','freenet.de','arcor.de','online.de',
    'outlook.com','outlook.de','hotmail.com','hotmail.de','live.com','live.de',
    'yahoo.com','yahoo.de','icloud.com','me.com','aol.com',
    'posteo.de','mailbox.org','protonmail.com','proton.me','mail.de'
  ])
$$;

-- ---------------------------------------------------------------
-- 3) Domain lernen
--    Wird vom Maileingang aufgerufen: ordnet die Absenderdomain dem
--    Auftraggeber des Projekts zu, sofern sinnvoll.
--    security definer, weil der Maileingang ohne Nutzersitzung laeuft --
--    dafuer streng auf genau diesen Zweck begrenzt.
-- ---------------------------------------------------------------
create or replace function domain_lernen(p_projekt uuid, p_absender text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  d text;
  k uuid;
begin
  d := lower(nullif(split_part(coalesce(p_absender,''), '@', 2), ''));
  if d is null or ist_freemail(d) then
    return;
  end if;

  select p.customer_id into k from projects p where p.id = p_projekt;
  if k is null then
    return;
  end if;

  update customers
     set domains = array_append(domains, d)
   where id = k
     and not (d = any (domains));
end $$;

revoke all on function domain_lernen(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 4) Kundenprofil — ausdruecklich KEIN Beweismittel
--    Eigene Tabelle, damit die Zusammenfassung niemals mit den
--    unveraenderlichen Vermerken verwechselt oder vermischt wird.
--    Sie geht nicht in die Hash-Kette ein.
-- ---------------------------------------------------------------
create table if not exists customer_profiles (
  customer_id     uuid primary key references customers on delete cascade,
  summary         jsonb not null default '{}'::jsonb,
  based_on_entries integer not null default 0,
  model           text,
  generated_at    timestamptz not null default now()
);

comment on table customer_profiles is
  'Von der KI erzeugte Arbeitshilfe. Interpretation, kein Beweismittel. Nicht Teil der Akte.';

-- ---------------------------------------------------------------
-- 5) Kennzahlen je Auftraggeber
--    Als Sicht, damit die Anwendung nicht jedes Mal selbst rechnet.
--    security_invoker: es gilt die Zeilensicherheit des Aufrufers.
-- ---------------------------------------------------------------
create or replace view kunden_kennzahlen
with (security_invoker = true) as
select
  c.id                                                          as customer_id,
  c.org_id,
  count(distinct p.id)                                          as projekte_gesamt,
  count(distinct p.id) filter (where p.status = 'aktiv')        as projekte_aktiv,
  count(distinct p.id) filter (where p.status = 'archiviert')   as projekte_abgeschlossen,
  count(e.id)                                                   as vermerke_gesamt,
  count(e.id) filter (where e.deviation = 'ja')                 as abweichungen,
  count(e.id) filter (where e.deviation = 'ja'
                        and e.status in ('offen','angezeigt'))  as abweichungen_offen,
  coalesce(sum(e.estimated_value) filter
          (where e.deviation = 'ja' and e.status in ('offen','angezeigt')), 0) as wert_offen,
  coalesce(sum(e.estimated_value) filter
          (where e.deviation = 'ja' and e.status = 'erledigt'), 0)             as wert_erledigt,
  max(e.created_at)                                             as letzter_vorgang
from customers c
left join projects p on p.customer_id = c.id
left join entries  e on e.project_id  = p.id
group by c.id, c.org_id;

-- ---------------------------------------------------------------
-- 6) Zeilensicherheit
-- ---------------------------------------------------------------
alter table customers         enable row level security;
alter table customer_profiles enable row level security;

drop policy if exists kunde_lesen   on customers;
drop policy if exists kunde_anlegen on customers;
drop policy if exists kunde_aendern on customers;

create policy kunde_lesen   on customers for select using (org_id in (select auth_org_ids()));
create policy kunde_anlegen on customers for insert with check (org_id in (select auth_org_ids()));
create policy kunde_aendern on customers for update using (org_id in (select auth_org_ids()));

drop policy if exists profil_lesen   on customer_profiles;
drop policy if exists profil_anlegen on customer_profiles;
drop policy if exists profil_aendern on customer_profiles;

create policy profil_lesen on customer_profiles for select
  using (customer_id in (select id from customers where org_id in (select auth_org_ids())));
create policy profil_anlegen on customer_profiles for insert
  with check (customer_id in (select id from customers where org_id in (select auth_org_ids())));
create policy profil_aendern on customer_profiles for update
  using (customer_id in (select id from customers where org_id in (select auth_org_ids())));

-- ---------------------------------------------------------------
-- 7) Quelle des Vermerks
--    Eine weitergeleitete Kundenmail enthaelt die Worte der Gegenseite.
--    Eine eigene Notiz ist eine Parteierklaerung. Der Beweiswert ist
--    verschieden, also muss die Herkunft am Vermerk stehen.
-- ---------------------------------------------------------------
alter table entries add column if not exists source_kind text not null default 'weitergeleitet';

alter table entries drop constraint if exists entries_source_kind_check;
alter table entries add constraint entries_source_kind_check
  check (source_kind in ('weitergeleitet','eigene_notiz','sprachnotiz'));

comment on column entries.source_kind is
  'weitergeleitet = Nachricht Dritter, eigene_notiz = Parteierklaerung, sprachnotiz = transkribiert.';

commit;
