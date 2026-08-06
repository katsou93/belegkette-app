-- 0009 — Suchpfade festnageln und die Instanz auf den Stand der Dateien bringen
--
-- Zwei Probleme werden hier gelöst.
--
-- 1) SUCHPFAD-ANGRIFF
--    Eine Funktion ohne festgelegten search_path löst Namen mit dem Pfad
--    des Aufrufers auf. Wer eine Tabelle namens entries in ein Schema legt,
--    das im Pfad vor public steht, kann damit das Verhalten einer
--    security-definer-Funktion umbiegen. Alle Funktionen bekommen deshalb
--    einen expliziten, unveränderlichen Pfad.
--
-- 2) pgcrypto LIEGT BEI SUPABASE WOANDERS
--    Supabase installiert pgcrypto ins Schema extensions, nicht public.
--    Deshalb schlug digest() beim ersten Anwenden fehl und wurde von Hand
--    qualifiziert. Damit wichen Instanz und Migrationsdateien voneinander
--    ab — der schlimmste Zustand für eine Übergabe.
--
--    Ab hier gilt: die Dateien sind die Wahrheit. search_path enthält
--    public und extensions, digest wird wieder unqualifiziert geschrieben
--    und findet sich auf beiden Systemen.
--
-- Diese Migration ist bewusst vollständig idempotent.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------
-- Nummernvergabe
-- ---------------------------------------------------------------
create or replace function set_entry_seq() returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));
  select coalesce(max(seq), 0) + 1 into new.seq from entries where project_id = new.project_id;
  return new;
end $$;

-- ---------------------------------------------------------------
-- Hash-Kette
-- ---------------------------------------------------------------
create or replace function entry_kette_bilden() returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare vorheriger text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));

  select e.hash into vorheriger
    from entries e
   where e.project_id = new.project_id
   order by e.seq desc
   limit 1;

  new.prev_hash := coalesce(vorheriger, 'genesis:' || new.project_id::text);

  new.hash := encode(digest(
      new.prev_hash          || '|' ||
      new.project_id::text   || '|' ||
      new.seq::text          || '|' ||
      new.occurred_on::text  || '|' ||
      new.raw_text           || '|' ||
      new.title              || '|' ||
      new.facts              || '|' ||
      new.quote              || '|' ||
      new.deviation          || '|' ||
      new.created_at::text
    , 'sha256'), 'hex');

  if new.deviation = 'ja' and new.wiedervorlage_am is null then
    new.wiedervorlage_am := (new.created_at at time zone 'UTC')::date + 7;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------
-- Kettenprüfung
-- ---------------------------------------------------------------
create or replace function kette_pruefen(p_projekt uuid)
returns table(seq integer, inhalt_unveraendert boolean, kette_intakt boolean)
language sql stable
set search_path = public, extensions
as $$
  with k as (
    select e.seq, e.hash, e.prev_hash, e.project_id,
           lag(e.hash) over (order by e.seq) as vorgaenger_hash,
           encode(digest(
             e.prev_hash || '|' || e.project_id::text || '|' || e.seq::text || '|' ||
             e.occurred_on::text || '|' || e.raw_text || '|' || e.title || '|' ||
             e.facts || '|' || e.quote || '|' || e.deviation || '|' || e.created_at::text
           , 'sha256'), 'hex') as neu_berechnet
      from entries e
     where e.project_id = p_projekt
  )
  select k.seq,
         k.hash = k.neu_berechnet,
         k.prev_hash = coalesce(k.vorgaenger_hash, 'genesis:' || k.project_id::text)
    from k
   order by k.seq
$$;

-- ---------------------------------------------------------------
-- Unveränderlichkeit und Löschsperre
-- ---------------------------------------------------------------
create or replace function entries_immutable() returns trigger
language plpgsql
set search_path = public
as $$
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
    raise exception 'Vermerkinhalte und Pruefsummen sind unveraenderlich. Aenderbar sind nur status, note, estimated_value, wiedervorlage_am, discard_reason, notified_on und notified_kind.';
  end if;
  return new;
end $$;

create or replace function entries_no_delete() returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'Vermerke koennen nicht geloescht werden. Status auf verworfen setzen.';
end $$;

create or replace function sicherheit_wiedervorlage() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reminder_on is null and new.release_due_on is not null then
    new.reminder_on := new.release_due_on - 30;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function ist_freemail(d text) returns boolean
language sql immutable
set search_path = public
as $$
  select lower(coalesce(d, '')) = any (array[
    'gmail.com','googlemail.com','gmx.de','gmx.net','gmx.at','gmx.ch',
    'web.de','t-online.de','freenet.de','arcor.de','online.de',
    'outlook.com','outlook.de','hotmail.com','hotmail.de','live.com','live.de',
    'yahoo.com','yahoo.de','icloud.com','me.com','aol.com',
    'posteo.de','mailbox.org','protonmail.com','proton.me','mail.de'
  ])
$$;

-- ---------------------------------------------------------------
-- Rechte auf den heiklen Funktionen
--
-- domain_lernen läuft mit erhöhten Rechten und darf deshalb nicht von
-- der Anwendung aus aufrufbar sein — nur vom Dienstschlüssel.
-- ---------------------------------------------------------------
do $$ begin
  execute 'revoke all on function domain_lernen(uuid, text) from public';
exception when undefined_object or undefined_function then null; end $$;

do $$ begin
  execute 'revoke all on function domain_lernen(uuid, text) from anon, authenticated';
exception when undefined_object or undefined_function then null; end $$;

commit;
