-- 0011 — Probezeitraum und Betreibersicht
--
-- Zwei Dinge, die bisher fehlten und ohne die man ein Produkt nicht
-- betreiben kann:
--
--   1. Eine Probe, die auch wirklich endet. Bisher hatte jeder, der sich
--      registriert, unbegrenzt vollen Zugriff.
--   2. Ein Blick von außen auf den Betrieb: wer nutzt es, was kostet es,
--      trifft die Bewertung.
--
-- Beides wird in der Datenbank durchgesetzt, nicht in der Oberfläche.
-- Eine Sperre, die nur im Browser existiert, ist keine Sperre.

begin;

-- ---------------------------------------------------------------
-- 1) Zustand eines Betriebs
-- ---------------------------------------------------------------
alter table orgs add column if not exists plan          text not null default 'probe';
alter table orgs add column if not exists trial_ends_at timestamptz;
alter table orgs add column if not exists gesperrt_am   timestamptz;
alter table orgs add column if not exists notiz         text;

alter table orgs drop constraint if exists orgs_plan_check;
alter table orgs add constraint orgs_plan_check
  check (plan in ('probe', 'aktiv', 'gesperrt'));

comment on column orgs.plan          is 'probe = befristeter Test, aktiv = zahlender Kunde, gesperrt = kein Schreibzugriff.';
comment on column orgs.trial_ends_at is 'Ende der Probe. Nur bei plan = probe wirksam.';
comment on column orgs.notiz         is 'Interne Notiz des Betreibers. Für den Kunden nicht sichtbar.';

-- Bestandsbetriebe bekommen ihre Probe ab jetzt, nicht rückwirkend —
-- sonst wären alle sofort gesperrt.
update orgs set trial_ends_at = now() + interval '24 hours'
 where trial_ends_at is null and plan = 'probe';

-- Neue Betriebe: 24 Stunden ab Registrierung.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare neue_org uuid;
begin
  insert into orgs (name, plan, trial_ends_at)
    values (coalesce(split_part(new.email, '@', 2), 'Mein Betrieb'),
            'probe', now() + interval '24 hours')
    returning id into neue_org;
  insert into memberships (user_id, org_id, role) values (new.id, neue_org, 'owner');
  return new;
end $$;

-- ---------------------------------------------------------------
-- 2) Darf dieser Betrieb noch schreiben?
-- ---------------------------------------------------------------
create or replace function org_schreibrecht(p_org uuid) returns boolean
language sql stable security definer
set search_path = public
as $$
  select case o.plan
           when 'aktiv'    then true
           when 'gesperrt' then false
           else coalesce(o.trial_ends_at, now()) > now()
         end
    from orgs o where o.id = p_org
$$;

comment on function org_schreibrecht(uuid) is
  'Schreibrecht je Betrieb. Lesen bleibt immer erlaubt — niemand soll seine eigene Akte verlieren.';

-- ---------------------------------------------------------------
-- 3) Durchsetzung
--
--    Bewusst nur beim Anlegen neuer Vorgänge. Wer die Probe verstreichen
--    lässt, behält vollen Lesezugriff auf alles, was er erfasst hat, und
--    kann es weiterhin exportieren. Alles andere wäre Geiselnahme der
--    eigenen Projektakte.
-- ---------------------------------------------------------------
create or replace function schreibrecht_pruefen() returns trigger
language plpgsql
set search_path = public
as $$
declare v_org uuid;
begin
  select p.org_id into v_org from projects p where p.id = new.project_id;
  if v_org is not null and not org_schreibrecht(v_org) then
    raise exception 'Der Testzeitraum ist abgelaufen. Ihre Akte bleibt vollstaendig lesbar; zum Weiterarbeiten bitte freischalten.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_entries_schreibrecht on entries;
create trigger trg_entries_schreibrecht before insert on entries
  for each row execute function schreibrecht_pruefen();

create or replace function projekt_schreibrecht_pruefen() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not org_schreibrecht(new.org_id) then
    raise exception 'Der Testzeitraum ist abgelaufen. Zum Anlegen weiterer Projekte bitte freischalten.'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_projects_schreibrecht on projects;
create trigger trg_projects_schreibrecht before insert on projects
  for each row execute function projekt_schreibrecht_pruefen();

-- ---------------------------------------------------------------
-- 4) Betreiber
--
--    Eigene Tabelle statt Flagge am Nutzer: so lässt sich Adminrecht
--    vergeben und entziehen, ohne die Nutzertabelle von Supabase
--    anzufassen, und es steht schwarz auf weiß, wer es hat.
-- ---------------------------------------------------------------
create table if not exists app_admins (
  user_id    uuid primary key references auth.users on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

comment on table app_admins is
  'Betreiberzugang. Wer hier steht, sieht betriebsübergreifende Kennzahlen — keine Vermerkinhalte.';

create or replace function ist_admin() returns boolean
language sql stable security definer
set search_path = public
as $$ select exists (select 1 from app_admins where user_id = auth.uid()) $$;

alter table app_admins enable row level security;
drop policy if exists admin_lesen on app_admins;
create policy admin_lesen on app_admins for select using (user_id = auth.uid());

-- ---------------------------------------------------------------
-- 5) Was der Betreiber sieht
--
--    Wichtig und bewusst: KEINE Vermerkinhalte. Kein raw_text, kein
--    Zitat, kein Sachverhalt. Nur Zahlen. Das ist keine Bequemlichkeit,
--    sondern die Zusage aus der Datenschutzerklärung — wer sie bricht,
--    verliert den ersten Kunden, der genau danach fragt.
-- ---------------------------------------------------------------
create or replace view admin_betriebe as
select
  o.id                                     as org_id,
  o.name                                   as betrieb,
  o.plan,
  o.trial_ends_at,
  org_schreibrecht(o.id)                   as schreibrecht,
  o.created_at                             as registriert_am,
  o.notiz,
  (select count(*) from memberships m where m.org_id = o.id)                          as nutzer,
  (select count(*) from projects  p where p.org_id = o.id)                            as projekte,
  (select count(*) from entries   e join projects p on p.id = e.project_id
     where p.org_id = o.id)                                                           as vermerke,
  (select count(*) from entries   e join projects p on p.id = e.project_id
     where p.org_id = o.id and e.deviation = 'ja')                                    as abweichungen,
  (select max(e.created_at) from entries e join projects p on p.id = e.project_id
     where p.org_id = o.id)                                                           as letzter_vermerk,
  (select coalesce(sum(s.amount), 0) from securities s join projects p on p.id = s.project_id
     where p.org_id = o.id and s.status in ('offen','angefordert'))                   as sicherheiten_gebunden
from orgs o
where ist_admin();

comment on view admin_betriebe is
  'Betreibersicht. Enthält bewusst keine Vermerkinhalte — nur Zahlen.';

create or replace view admin_ki_kosten as
select
  u.org_id,
  o.name                     as betrieb,
  u.fenster::date            as tag,
  sum(u.anzahl)              as aufrufe,
  sum(u.tokens_in)           as tokens_ein,
  sum(u.tokens_out)          as tokens_aus,
  -- Grobe Hochrechnung. Die Sätze stehen bewusst hier und nicht im Code,
  -- damit die Zahl neben den Rohwerten steht und niemand sie für exakt hält.
  round((sum(u.tokens_in) * 3.0 + sum(u.tokens_out) * 15.0) / 1000000.0, 4) as usd_geschaetzt
from ai_usage u
join orgs o on o.id = u.org_id
where u.art = 'tag' and ist_admin()
group by u.org_id, o.name, u.fenster::date;

comment on view admin_ki_kosten is
  'Verbrauch je Betrieb und Tag. usd_geschaetzt ist eine Hochrechnung, keine Abrechnung.';

create or replace view admin_qualitaet as
select
  p.org_id,
  count(*)                                                              as vermerke,
  count(*) filter (where e.status = 'verworfen')                        as verworfen,
  round(100.0 * count(*) filter (where e.status = 'verworfen')
        / nullif(count(*), 0), 1)                                       as verworfen_prozent,
  count(*) filter (where e.discard_reason = 'kein_vorgang')             as grund_kein_vorgang,
  count(*) filter (where e.discard_reason = 'war_beauftragt')           as grund_war_beauftragt,
  count(*) filter (where e.discard_reason = 'doppelung')                as grund_doppelung,
  count(*) filter (where e.discard_reason = 'sonstiges')                as grund_sonstiges,
  count(*) filter (where e.deviation = 'ja')                            as bewertet_ja,
  count(*) filter (where e.deviation = 'unklar')                        as bewertet_unklar,
  count(*) filter (where e.deviation = 'nein')                          as bewertet_nein,
  count(*) filter (where e.notified_on is not null)                     as angezeigt
from entries e
join projects p on p.id = e.project_id
where ist_admin()
group by p.org_id;

comment on view admin_qualitaet is
  'Wie oft wird verworfen und warum. Die einzige echte Rückmeldung zur Treffsicherheit.';

-- ---------------------------------------------------------------
-- 6) Der Betreiber muss Betriebe umstellen können
-- ---------------------------------------------------------------
drop policy if exists org_admin_lesen  on orgs;
drop policy if exists org_admin_setzen on orgs;

create policy org_admin_lesen  on orgs for select using (ist_admin());
create policy org_admin_setzen on orgs for update using (ist_admin());

commit;
