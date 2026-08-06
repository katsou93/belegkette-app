-- 0012 — Löschkonzept: Rohtext geht, Beweis bleibt
--
-- DAS PROBLEM
-- Der Rohtext einer weitergeleiteten Mail ist das personenbezogenste, was
-- das System speichert: Klarnamen, Signaturen, Durchwahlen, private
-- Bemerkungen. Nach Projektende gibt es keinen Grund mehr, ihn zu haben —
-- aber der Beweiswert der Akte hängt daran, dass sich nichts geändert hat.
--
-- Beides ging bisher nicht zusammen, weil der Rohtext direkt in die
-- Prüfsumme einfloss. Wer ihn löscht, zerstört die Kette.
--
-- DIE LÖSUNG
-- Ab hier fließt nicht der Rohtext in die Kette, sondern seine Prüfsumme.
--
--     hash = sha256( prev_hash | ... | sha256(raw_text) | ... )
--
-- Der Rohtext kann dann gelöscht werden, ohne dass die Kette bricht.
-- Und es bleibt sogar mehr übrig als vorher: Wer das Original noch in
-- seinem Postfach hat, kann durch Nachrechnen beweisen, dass es genau
-- dieser Text war. Ohne dass wir ihn aufbewahren mussten.
--
-- Das ist datenschutzrechtlich Datenminimierung nach Art. 5 Abs. 1 lit. c
-- DSGVO und gleichzeitig das bessere Beweismittel.
--
-- ACHTUNG: Diese Migration rechnet alle bestehenden Prüfsummen neu. Das
-- ist einmalig und beabsichtigt. Danach gilt die neue Formel.

begin;

-- ---------------------------------------------------------------
-- 1) Neue Felder
-- ---------------------------------------------------------------
alter table entries add column if not exists raw_text_hash        text;
alter table entries add column if not exists raw_text_geloescht_am timestamptz;
alter table entries add column if not exists spaet_erfasst        boolean not null default false;

comment on column entries.raw_text_hash is
  'SHA-256 des Rohtexts. Bleibt auch nach dessen Löschung erhalten und trägt die Kette.';
comment on column entries.raw_text_geloescht_am is
  'Wann der Rohtext nach Aufbewahrungsfrist entfernt wurde. Der Vermerk selbst bleibt.';
comment on column entries.spaet_erfasst is
  'Der Vorgang wurde deutlich später erfasst, als er stattgefunden hat. Beweisrechtlich relevant — deshalb sichtbar und unveränderlich.';

-- Der Rohtext darf künftig fehlen.
alter table entries alter column raw_text drop not null;

-- ---------------------------------------------------------------
-- 2) Projektabschluss und Aufbewahrung
-- ---------------------------------------------------------------
alter table projects add column if not exists abgeschlossen_am date;
alter table orgs     add column if not exists rohtext_tage integer not null default 90;

alter table orgs drop constraint if exists orgs_rohtext_tage_check;
alter table orgs add constraint orgs_rohtext_tage_check
  check (rohtext_tage between 0 and 3650);

comment on column projects.abgeschlossen_am is
  'Projektabschluss. Startet die Frist, nach der Rohtexte entfernt werden.';
comment on column orgs.rohtext_tage is
  'Tage nach Projektabschluss, bis Rohtexte gelöscht werden. 0 = sofort bei Abschluss.';

-- ---------------------------------------------------------------
-- 3) Prüfsumme neu: über den Hash des Rohtexts
-- ---------------------------------------------------------------
create or replace function entry_kette_bilden() returns trigger
language plpgsql
set search_path = public, extensions
as $$
declare vorheriger text;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.project_id::text, 0));

  -- Der Rohtext geht nur noch als Prüfsumme in die Kette ein.
  new.raw_text_hash := encode(digest(coalesce(new.raw_text, ''), 'sha256'), 'hex');

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
      new.raw_text_hash      || '|' ||
      new.title              || '|' ||
      new.facts              || '|' ||
      new.quote              || '|' ||
      new.deviation          || '|' ||
      new.created_at::text
    , 'sha256'), 'hex');

  -- Späterfassung erkennen. Wer eine Mail von vor sechs Monaten weiterleitet,
  -- soll das tun dürfen — aber die Akte muss zeigen, dass sie nicht am selben
  -- Tag entstanden ist. Alles andere wäre eine stille Unwahrheit.
  new.spaet_erfasst := new.occurred_on < ((new.created_at at time zone 'UTC')::date - 14);

  if new.deviation = 'ja' and new.wiedervorlage_am is null then
    new.wiedervorlage_am := (new.created_at at time zone 'UTC')::date + 7;
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------
-- 4) Bestand umrechnen
--
--    Trigger vorübergehend aus, Kette in seq-Reihenfolge neu bilden,
--    Trigger wieder an. Einmalig — danach greift die neue Formel.
-- ---------------------------------------------------------------
alter table entries disable trigger trg_entries_immutable;
alter table entries disable trigger trg_entry_log;

update entries set raw_text_hash = encode(digest(coalesce(raw_text, ''), 'sha256'), 'hex')
 where raw_text_hash is null;

do $$
declare r record; vorheriger text; letztes uuid;
begin
  for r in select * from entries order by project_id, seq loop
    if letztes is distinct from r.project_id then
      vorheriger := null; letztes := r.project_id;
    end if;
    update entries e set
      prev_hash = coalesce(vorheriger, 'genesis:' || r.project_id::text),
      hash = encode(digest(
        coalesce(vorheriger, 'genesis:' || r.project_id::text) || '|' ||
        r.project_id::text || '|' || r.seq::text || '|' || r.occurred_on::text || '|' ||
        r.raw_text_hash || '|' || r.title || '|' || r.facts || '|' || r.quote || '|' ||
        r.deviation || '|' || r.created_at::text, 'sha256'), 'hex'),
      spaet_erfasst = r.occurred_on < ((r.created_at at time zone 'UTC')::date - 14)
     where e.id = r.id
     returning e.hash into vorheriger;
  end loop;
end $$;

alter table entries enable trigger trg_entries_immutable;
alter table entries enable trigger trg_entry_log;

alter table entries alter column raw_text_hash set not null;

-- ---------------------------------------------------------------
-- 5) Prüfung anpassen
-- ---------------------------------------------------------------
-- Rückgabetyp ändert sich (rohtext_vorhanden kommt dazu), deshalb erst weg.
drop function if exists kette_pruefen(uuid);
create function kette_pruefen(p_projekt uuid)
returns table(seq integer, inhalt_unveraendert boolean, kette_intakt boolean, rohtext_vorhanden boolean)
language sql stable
set search_path = public, extensions
as $$
  with k as (
    select e.seq, e.hash, e.prev_hash, e.project_id, e.raw_text is not null as roh,
           lag(e.hash) over (order by e.seq) as vorgaenger_hash,
           encode(digest(
             e.prev_hash || '|' || e.project_id::text || '|' || e.seq::text || '|' ||
             e.occurred_on::text || '|' || e.raw_text_hash || '|' || e.title || '|' ||
             e.facts || '|' || e.quote || '|' || e.deviation || '|' || e.created_at::text
           , 'sha256'), 'hex') as neu_berechnet
      from entries e
     where e.project_id = p_projekt
  )
  select k.seq,
         k.hash = k.neu_berechnet,
         k.prev_hash = coalesce(k.vorgaenger_hash, 'genesis:' || k.project_id::text),
         k.roh
    from k
   order by k.seq
$$;

comment on function kette_pruefen(uuid) is
  'Prüft Inhalt und Verkettung. Funktioniert auch nach Löschung der Rohtexte.';

-- ---------------------------------------------------------------
-- 6) Nachweis für einen einzelnen Rohtext
--
--    Der Kunde hat die Originalmail noch in seinem Postfach und will
--    zeigen, dass genau sie zu diesem Vermerk gehört. Er fügt sie hier
--    ein — wir haben sie längst gelöscht und können es trotzdem bestätigen.
-- ---------------------------------------------------------------
create or replace function rohtext_nachweisen(p_entry uuid, p_text text)
returns boolean
language sql stable
set search_path = public, extensions
as $$
  select e.raw_text_hash = encode(digest(coalesce(p_text, ''), 'sha256'), 'hex')
    from entries e where e.id = p_entry
$$;

-- ---------------------------------------------------------------
-- 7) Unveränderlichkeit erweitern
--
--    raw_text darf sich ändern — aber nur in eine Richtung: von
--    vorhanden nach NULL. Das ist die Löschung, alles andere wäre
--    Manipulation. raw_text_hash bleibt gesperrt.
-- ---------------------------------------------------------------
create or replace function entries_immutable() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.raw_text is distinct from old.raw_text and new.raw_text is not null then
    raise exception 'Der Rohtext kann nur geloescht, nicht geaendert werden.';
  end if;

  if new.seq               is distinct from old.seq
     or new.project_id        is distinct from old.project_id
     or new.occurred_on       is distinct from old.occurred_on
     or new.raw_text_hash     is distinct from old.raw_text_hash
     or new.title             is distinct from old.title
     or new.facts             is distinct from old.facts
     or new.quote             is distinct from old.quote
     or new.deviation         is distinct from old.deviation
     or new.created_at        is distinct from old.created_at
     or new.prev_hash         is distinct from old.prev_hash
     or new.hash              is distinct from old.hash
     or new.source_kind       is distinct from old.source_kind
     or new.counterparty_kind is distinct from old.counterparty_kind
     or new.schedule_impact   is distinct from old.schedule_impact
     or new.spaet_erfasst     is distinct from old.spaet_erfasst then
    raise exception 'Vermerkinhalte und Pruefsummen sind unveraenderlich.';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------
-- 8) Die Löschung selbst
--
--    Läuft im Fristenwächter mit. security definer, weil sie über alle
--    Betriebe geht — aber sie fasst ausschließlich raw_text an.
-- ---------------------------------------------------------------
create or replace function rohtexte_bereinigen()
returns table(betroffene integer, projekte integer)
language plpgsql security definer
set search_path = public
as $$
declare v_zeilen integer; v_projekte integer;
begin
  with faellig as (
    select e.id
      from entries e
      join projects p on p.id = e.project_id
      join orgs o     on o.id = p.org_id
     where e.raw_text is not null
       and p.abgeschlossen_am is not null
       and p.abgeschlossen_am + o.rohtext_tage < current_date
  )
  update entries e
     set raw_text = null, raw_text_geloescht_am = now()
   where e.id in (select id from faellig);
  get diagnostics v_zeilen = row_count;

  select count(distinct p.id) into v_projekte
    from projects p join orgs o on o.id = p.org_id
   where p.abgeschlossen_am is not null
     and p.abgeschlossen_am + o.rohtext_tage < current_date;

  return query select v_zeilen, v_projekte;
end $$;

comment on function rohtexte_bereinigen() is
  'Entfernt Rohtexte abgeschlossener Projekte nach Ablauf der Aufbewahrungsfrist. Vermerke und Prüfsummen bleiben.';

-- ---------------------------------------------------------------
-- 9) Sofortlöschung auf Wunsch
--
--    Ein Kunde, der jetzt löschen will, soll nicht auf den Cron warten.
--    Läuft mit den Rechten des Aufrufers — die Zeilensicherheit
--    entscheidet, welche Projekte er überhaupt sieht.
-- ---------------------------------------------------------------
create or replace function rohtexte_loeschen(p_projekt uuid)
returns integer
language plpgsql
set search_path = public
as $$
declare n integer;
begin
  update entries set raw_text = null, raw_text_geloescht_am = now()
   where project_id = p_projekt and raw_text is not null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------
-- 10) Was steht wo — für die Datenschutzauskunft
-- ---------------------------------------------------------------
create or replace view aufbewahrung
with (security_invoker = true) as
select
  p.id   as project_id,
  p.org_id,
  p.name as projekt,
  p.abgeschlossen_am,
  o.rohtext_tage,
  p.abgeschlossen_am + o.rohtext_tage             as rohtext_loeschung_ab,
  count(e.id)                                     as vermerke,
  count(e.id) filter (where e.raw_text is not null)      as mit_rohtext,
  count(e.id) filter (where e.raw_text_geloescht_am is not null) as bereits_bereinigt
from projects p
join orgs o on o.id = p.org_id
left join entries e on e.project_id = p.id
group by p.id, p.org_id, p.name, p.abgeschlossen_am, o.rohtext_tage;

comment on view aufbewahrung is
  'Auskunft für den Datenschutzbeauftragten: welches Projekt hält wie lange welche Rohtexte.';

commit;
