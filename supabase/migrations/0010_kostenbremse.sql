-- 0010 — Harte Kostenbremse für die KI-Aufrufe
--
-- Jeder Aufruf der Vermerk-Route kostet Geld beim Modellanbieter. Ohne
-- Deckel kann ein einzelner angemeldeter Nutzer — oder ein Skript mit
-- seinen Zugangsdaten — die Rechnung in einer Nacht in vierstellige Höhen
-- treiben. Das ist kein theoretisches Risiko, es ist der übliche Weg, wie
-- kleine SaaS-Produkte an ihrer eigenen KI-Rechnung sterben.
--
-- Warum in der Datenbank und nicht im Prozessspeicher:
-- Auf Vercel läuft jede Anfrage potenziell in einer anderen Instanz. Ein
-- Zähler im Speicher zählt dann pro Instanz und bremst nichts. Die
-- Datenbank ist der einzige Ort, den alle Instanzen teilen — und sie
-- kostet hier nichts extra.
--
-- Zwei Deckel, weil sie verschiedene Dinge verhindern:
--   Betrieb je Tag  — schützt vor der Rechnung.
--   Nutzer je Stunde — schützt vor der Endlosschleife im Browser.

begin;

create table if not exists ai_usage (
  org_id     uuid not null references orgs on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  fenster    timestamptz not null,
  art        text not null check (art in ('tag', 'stunde')),
  anzahl     integer not null default 0,
  tokens_in  bigint  not null default 0,
  tokens_out bigint  not null default 0,
  primary key (org_id, user_id, art, fenster)
);

create index if not exists ai_usage_fenster_idx on ai_usage (fenster);

comment on table ai_usage is
  'Verbrauchszähler für KI-Aufrufe. Grundlage der Kostenbremse und der späteren Abrechnung.';

-- ---------------------------------------------------------------
-- Kontingent prüfen und verbrauchen — in einem Schritt
--
-- Prüfen und Hochzählen müssen atomar sein, sonst schlüpfen bei
-- gleichzeitigen Anfragen beliebig viele durch dieselbe Lücke.
-- Das insert ... on conflict do update erledigt das in einer Anweisung.
--
-- security definer, weil die Anwendung mit der Sitzung des Nutzers läuft
-- und dieser seinen eigenen Zähler sonst manipulieren könnte. Der
-- Betriebsbezug wird hier serverseitig aus der Mitgliedschaft gelesen und
-- nicht vom Aufrufer übernommen.
-- ---------------------------------------------------------------
create or replace function ki_kontingent_verbrauchen(
  p_limit_tag    integer default 200,
  p_limit_stunde integer default 30
)
returns table(erlaubt boolean, grund text, rest_heute integer)
language plpgsql security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_org    uuid;
  v_tag    integer;
  v_stunde integer;
begin
  if v_user is null then
    return query select false, 'nicht angemeldet'::text, 0;
    return;
  end if;

  select m.org_id into v_org from memberships m where m.user_id = v_user limit 1;
  if v_org is null then
    return query select false, 'kein Betrieb'::text, 0;
    return;
  end if;

  insert into ai_usage (org_id, user_id, art, fenster, anzahl)
       values (v_org, v_user, 'stunde', date_trunc('hour', now()), 1)
  on conflict (org_id, user_id, art, fenster)
    do update set anzahl = ai_usage.anzahl + 1
    returning anzahl into v_stunde;

  insert into ai_usage (org_id, user_id, art, fenster, anzahl)
       values (v_org, v_user, 'tag', date_trunc('day', now()), 1)
  on conflict (org_id, user_id, art, fenster)
    do update set anzahl = ai_usage.anzahl + 1
    returning anzahl into v_tag;

  if v_stunde > p_limit_stunde then
    return query select false, 'Stundenkontingent erreicht'::text, greatest(p_limit_tag - v_tag, 0);
    return;
  end if;

  if v_tag > p_limit_tag then
    return query select false, 'Tageskontingent erreicht'::text, 0;
    return;
  end if;

  return query select true, null::text, greatest(p_limit_tag - v_tag, 0);
end $$;

-- ---------------------------------------------------------------
-- Verbrauchte Token nachtragen
--
-- Getrennt vom Zählen, weil die Zahl erst nach der Antwort feststeht.
-- Rein informativ; die Bremse hängt an der Anzahl der Aufrufe, weil die
-- vor dem Aufruf bekannt ist.
-- ---------------------------------------------------------------
create or replace function ki_verbrauch_nachtragen(p_in bigint, p_out bigint)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_org  uuid;
begin
  if v_user is null then return; end if;
  select m.org_id into v_org from memberships m where m.user_id = v_user limit 1;
  if v_org is null then return; end if;

  update ai_usage
     set tokens_in  = tokens_in  + greatest(p_in, 0),
         tokens_out = tokens_out + greatest(p_out, 0)
   where org_id = v_org and user_id = v_user
     and art = 'tag' and fenster = date_trunc('day', now());
end $$;

-- ---------------------------------------------------------------
-- Zeilensicherheit
--
-- Lesen darf jeder seinen eigenen Betrieb. Schreiben ausschließlich über
-- die beiden Funktionen oben — deshalb gibt es bewusst keine
-- insert- oder update-Policy.
-- ---------------------------------------------------------------
alter table ai_usage enable row level security;

drop policy if exists verbrauch_lesen on ai_usage;
create policy verbrauch_lesen on ai_usage for select
  using (org_id in (select auth_org_ids()));

-- ---------------------------------------------------------------
-- Aufräumen
--
-- Ohne das wächst die Tabelle ewig. Wird vom Fristenwächter mitgerufen.
-- ---------------------------------------------------------------
create or replace function ki_verbrauch_aufraeumen()
returns integer
language plpgsql security definer
set search_path = public
as $$
declare n integer;
begin
  delete from ai_usage where fenster < now() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;

commit;
