-- 0003 — Leistungsumfang, Wertfeld, Wiedervorlage und Hash-Kette
--
-- Grundsätze wie bisher:
--   Beweisinhalte bleiben unveränderlich. Neu hinzu kommen ausschließlich
--   Arbeitsfelder (Wert, Wiedervorlage) und Prüfdaten (prev_hash, hash),
--   wobei die Prüfdaten selbst ebenfalls gesperrt werden.

begin;

-- ---------------------------------------------------------------
-- 1) Vereinbarter Leistungsumfang je Projekt
--    Damit prüft die KI gegen den Auftrag, statt zu raten, was "üblich" ist.
-- ---------------------------------------------------------------
alter table projects add column if not exists scope_text text;

comment on column projects.scope_text is
  'Vereinbarter Leistungsumfang in Stichworten. Fliesst in die Bewertung ein.';

-- ---------------------------------------------------------------
-- 2) Arbeitsfelder am Vermerk
-- ---------------------------------------------------------------
alter table entries add column if not exists estimated_value numeric(14,2);
alter table entries add column if not exists wiedervorlage_am date;
alter table entries add column if not exists discard_reason text;

alter table entries drop constraint if exists entries_discard_reason_check;
alter table entries add constraint entries_discard_reason_check
  check (discard_reason is null or discard_reason in
        ('kein_vorgang','war_beauftragt','doppelung','sonstiges'));

comment on column entries.estimated_value is 'Geschaetzter Wert der Abweichung in Euro. Jederzeit korrigierbar.';
comment on column entries.wiedervorlage_am is 'Erinnerung, solange der Vorgang offen ist.';
comment on column entries.discard_reason is 'Warum verworfen — einzige Rueckmeldung zur Treffsicherheit.';

-- ---------------------------------------------------------------
-- 3) Hash-Kette
--    Jeder Vermerk bindet die Pruefsumme seines Vorgaengers ein.
--    Damit ist nachtraegliche Manipulation nicht nur verboten,
--    sondern nachweisbar.
-- ---------------------------------------------------------------
alter table entries add column if not exists prev_hash text;
alter table entries add column if not exists hash text;

create or replace function entry_kette_bilden() returns trigger
language plpgsql as $$
declare vorheriger text;
begin
  -- gleiche Sperre wie bei der Nummernvergabe, damit die Kette
  -- auch bei gleichzeitigen Eintraegen luecken- und kollisionsfrei bleibt
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

  -- Abweichungen bekommen automatisch eine Wiedervorlage
  if new.deviation = 'ja' and new.wiedervorlage_am is null then
    new.wiedervorlage_am := (new.created_at at time zone 'UTC')::date + 7;
  end if;

  return new;
end $$;

-- Name bewusst mit "v": Postgres feuert BEFORE-Trigger alphabetisch,
-- trg_entry_seq muss vorher laufen, sonst ist new.seq noch leer.
drop trigger if exists trg_entry_verkettung on entries;
create trigger trg_entry_verkettung before insert on entries
  for each row execute function entry_kette_bilden();

-- ---------------------------------------------------------------
-- 4) Unveraenderlichkeit erweitern
--    Neu gesperrt: prev_hash und hash. Weiterhin aenderbar bleiben
--    status, note, estimated_value, wiedervorlage_am, discard_reason.
-- ---------------------------------------------------------------
create or replace function entries_immutable() returns trigger
language plpgsql as $$
begin
  if new.seq         is distinct from old.seq
     or new.project_id  is distinct from old.project_id
     or new.occurred_on is distinct from old.occurred_on
     or new.raw_text    is distinct from old.raw_text
     or new.title       is distinct from old.title
     or new.facts       is distinct from old.facts
     or new.quote       is distinct from old.quote
     or new.deviation   is distinct from old.deviation
     or new.created_at  is distinct from old.created_at
     or new.prev_hash   is distinct from old.prev_hash
     or new.hash        is distinct from old.hash then
    raise exception 'Vermerkinhalte und Pruefsummen sind unveraenderlich. Aenderbar sind nur status, note, estimated_value, wiedervorlage_am und discard_reason.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------
-- 5) Ketten-Pruefung
--    Bewusst OHNE security definer: es gilt die normale Zeilensicherheit,
--    ein Nutzer kann also nur seine eigenen Projekte pruefen.
-- ---------------------------------------------------------------
create or replace function kette_pruefen(p_projekt uuid)
returns table(seq integer, inhalt_unveraendert boolean, kette_intakt boolean)
language sql stable
set search_path = public
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
-- 6) Index fuer den Fristenwaechter
-- ---------------------------------------------------------------
create index if not exists entries_wiedervorlage_idx
  on entries (wiedervorlage_am)
  where status in ('offen','angezeigt');

commit;
