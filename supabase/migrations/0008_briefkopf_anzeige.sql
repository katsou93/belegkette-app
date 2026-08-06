-- 0008 — Briefkopf und die Tatsache der Anzeige
--
-- Zwei Dinge, die das sendefertige Schreiben braucht:
--   1. Woher der Briefkopf kommt (sonst sieht das Dokument nach Fremdsoftware
--      aus und niemand verschickt es).
--   2. Ob es tatsächlich rausgegangen ist. Eine Behinderungsanzeige, die im
--      Entwurfsordner liegt, ist keine Anzeige.

begin;

-- ---------------------------------------------------------------
-- 1) Absenderangaben am Betrieb
-- ---------------------------------------------------------------
alter table orgs add column if not exists letterhead  text;
alter table orgs add column if not exists sender_name text;
alter table orgs add column if not exists sender_role text;

comment on column orgs.letterhead  is 'Mehrzeiliger Briefkopf für erzeugte Schreiben. Frei editierbar.';
comment on column orgs.sender_name is 'Name unter der Grußformel.';

-- Betriebsdaten darf nur ändern, wer Inhaber ist. Ohne das könnte jedes
-- Teammitglied den Briefkopf aller anderen umschreiben.
drop policy if exists org_aendern on orgs;
create policy org_aendern on orgs for update
  using (id in (select org_id from memberships
                 where user_id = auth.uid() and role = 'owner'));

-- ---------------------------------------------------------------
-- 2) Die Anzeige selbst
--
--    notified_on ist eine Tatsachenbehauptung des Nutzers ("ich habe das
--    an dem Tag rausgeschickt"), kein vom System erzeugter Beweis.
--    Deshalb ist es NICHT unveränderlich — ein Tippfehler im Datum muss
--    korrigierbar bleiben. Protokolliert wird die Änderung trotzdem.
-- ---------------------------------------------------------------
alter table entries add column if not exists notified_on   date;
alter table entries add column if not exists notified_kind text;

alter table entries drop constraint if exists entries_notified_kind_check;
alter table entries add constraint entries_notified_kind_check
  check (notified_kind is null or notified_kind in
        ('bestaetigung','leistungsaenderung','behinderungsanzeige','bedenkenanmeldung'));

alter table entries drop constraint if exists entries_notified_stimmig;
alter table entries add constraint entries_notified_stimmig
  check ((notified_on is null) = (notified_kind is null));

create index if not exists entries_unangezeigt_idx on entries (project_id)
  where schedule_impact and notified_on is null;

comment on column entries.notified_on is
  'Tag, an dem der Nutzer das Schreiben verschickt hat. Selbstauskunft, korrigierbar.';

-- ---------------------------------------------------------------
-- 3) Anzeige mitprotokollieren
--
--    Der Trigger aus 0001 kannte nur Statuswechsel. Die Anzeige ist der
--    beweisrelevanteste Vorgang nach dem Anlegen und gehört ins Protokoll.
-- ---------------------------------------------------------------
create or replace function log_entry_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into entry_events(entry_id, actor, action, payload)
      values (new.id, new.created_by, 'angelegt',
              jsonb_build_object('seq', new.seq, 'deviation', new.deviation,
                                 'hash', new.hash));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into entry_events(entry_id, actor, action, payload)
      values (new.id, auth.uid(), 'status',
              jsonb_build_object('von', old.status, 'nach', new.status));
  end if;

  if new.notified_on is distinct from old.notified_on
     or new.notified_kind is distinct from old.notified_kind then
    insert into entry_events(entry_id, actor, action, payload)
      values (new.id, auth.uid(), 'angezeigt',
              jsonb_build_object('am', new.notified_on, 'art', new.notified_kind));
  end if;

  if new.estimated_value is distinct from old.estimated_value then
    insert into entry_events(entry_id, actor, action, payload)
      values (new.id, auth.uid(), 'wert',
              jsonb_build_object('von', old.estimated_value, 'nach', new.estimated_value));
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------
-- 4) Terminkette um die Anzeige ergänzen
--
--    Eine Verzögerung ohne Anzeige ist beweisrechtlich fast wertlos.
--    Die Sicht macht diese Lücke sichtbar, statt sie zu verschweigen.
-- ---------------------------------------------------------------
drop view if exists terminkette;
create view terminkette
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
  e.notified_on,
  e.notified_kind,
  e.notified_on is null as ohne_anzeige,
  e.occurred_on - lag(e.occurred_on) over (
    partition by e.project_id order by e.occurred_on, e.seq
  ) as tage_seit_vorgaenger
from entries e
join projects p on p.id = e.project_id
where e.schedule_impact;

comment on view terminkette is
  'Vorgänge mit Terminwirkung je Projekt, chronologisch, mit Hinweis auf fehlende Anzeigen.';

commit;
