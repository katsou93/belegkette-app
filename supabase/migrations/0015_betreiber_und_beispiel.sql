-- 0015 — Betreiberkonto und ein Beispielprojekt zum Anschauen
--
-- ZWEI DINGE
--
-- 1) Wer das Produkt betreibt, soll sich anmelden und sofort Betreiber
--    sein — ohne dass jemand hinterher von Hand eine Zeile einfügt.
--
-- 2) Ein frisch angelegter Betrieb ist leer. Eine leere Akte zeigt nichts
--    von dem, was das Produkt kann: keine Befunde, keine Ampel, keine
--    Sicherheiten, keine Terminkette. Wer sie zum ersten Mal sieht, hält
--    das Produkt für unfertig.
--
--    Deshalb legt sich jeder neue Betrieb ein Beispielprojekt an. Es ist
--    als solches gekennzeichnet, lässt sich mit einem Klick archivieren
--    und enthält keine echten Daten.

begin;

-- ---------------------------------------------------------------
-- 1) Betreiberadressen
--
--    Als Tabelle und nicht als fest verdrahtete Adresse im Code: so
--    lässt sich ein zweiter Betreiber aufnehmen, ohne zu deployen.
-- ---------------------------------------------------------------
create table if not exists betreiber_adressen (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

comment on table betreiber_adressen is
  'Adressen, die beim ersten Login automatisch Betreiberrechte bekommen.';

-- Niemand ausser dem Dienstschluessel darf diese Liste sehen oder aendern.
-- Wer hier hineinschreiben koennte, macht sich selbst zum Betreiber.
alter table betreiber_adressen enable row level security;
revoke all on table betreiber_adressen from anon, authenticated;

insert into betreiber_adressen (email, note)
values ('adam.rupaszov@gmx.de', 'Gruender')
on conflict (email) do nothing;

-- Wer schon da ist, bekommt die Rechte sofort.
insert into app_admins (user_id, note)
select u.id, b.note
  from auth.users u join betreiber_adressen b on lower(b.email) = lower(u.email)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------
-- 2) Beispielprojekt
--
--    Bewusst so gebaut, dass alle Auswertungen etwas zu zeigen haben:
--    ein alter offener Vorgang (Befund „Anspruch verfällt"), eine
--    Behinderung ohne Anzeige, eine fällige Bürgschaft, ein erledigter
--    Nachtrag als Gegenbeispiel.
--
--    security definer, weil die Funktion beim Anlegen des Nutzers läuft,
--    also bevor eine Sitzung existiert.
-- ---------------------------------------------------------------
create or replace function beispielprojekt_anlegen(p_org uuid, p_user uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_kunde uuid;
  v_projekt uuid;
begin
  insert into customers (org_id, name, domains, note)
       values (p_org, 'Muster Werke GmbH (Beispiel)', array['muster-werke.example'],
               'Beispieldatensatz. Kann jederzeit gelöscht werden.')
    on conflict do nothing
    returning id into v_kunde;

  if v_kunde is null then
    select id into v_kunde from customers
     where org_id = p_org and lower(name) = lower('Muster Werke GmbH (Beispiel)');
  end if;

  insert into projects (org_id, name, contract_value, customer_id, scope_text,
                        contract_ref, contract_basis, warranty_months, retention_percent)
       values (p_org, 'BEISPIEL — A-2418 Abfüllanlage', 2400000, v_kunde,
               'Lieferung und Montage einer Abfuellanlage mit 12.000 Flaschen/h. '
               'Pumpen in Grauguss. Steuerung Siemens S7-1500. Inbetriebnahme '
               'einschliesslich Schulung von zwei Schichten.',
               'V-2026-118', 'vob_b', 24, 5.0)
    returning id into v_projekt;

  -- (1) Alte, offene, nie angezeigte Abweichung -> Befund "Anspruch verfaellt"
  insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote,
                       affected_scope, change_type, deviation, reasoning, open_questions,
                       suggestion, created_by, estimated_value)
  values (v_projekt, current_date - 62, 'E-Mail vom Kunden',
          'Von: einkauf@muster-werke.example' || chr(10) ||
          'Betreff: AW: Abfuellanlage A-2418' || chr(10) || chr(10) ||
          'Guten Tag, nach Ruecksprache mit unserer QS brauchen wir die '
          'produktberuehrten Pumpen in Edelstahl 1.4404 statt in Grauguss. '
          'Bitte so einplanen. Viele Gruesse, H. Meier',
          'Materialwechsel Pumpen auf Edelstahl 1.4404',
          'Der Auftraggeber fordert die produktberuehrten Pumpen in Edelstahl 1.4404 '
          'statt in dem vertraglich vereinbarten Grauguss auszufuehren.',
          'Bitte so einplanen.',
          'Pumpen, produktberuehrt', 'Materialänderung', 'ja',
          'Der Leistungsumfang nennt ausdruecklich Grauguss. Edelstahl 1.4404 ist '
          'dort nicht enthalten.',
          '["Kostentragung nicht angesprochen","Auswirkung auf den Liefertermin offen"]'::jsonb,
          'wir bestaetigen den Eingang Ihrer Anforderung. Die Ausfuehrung in Edelstahl '
          '1.4404 ist vom vereinbarten Umfang nicht erfasst. Wir stimmen das weitere '
          'Vorgehen gern mit Ihnen ab.',
          p_user, 34000);

  -- (2) Behinderung ohne Anzeige -> Befund "Verzug ohne Anzeige"
  insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote,
                       affected_scope, change_type, deviation, reasoning, open_questions,
                       suggestion, created_by, schedule_impact)
  values (v_projekt, current_date - 21, 'Besprechungsprotokoll',
          'Protokoll Baubesprechung Nr. 7' || chr(10) ||
          'TOP 4: Die bauseitige Elektroversorgung in Halle 3 ist noch nicht '
          'gestellt. Herr Krause: Wird voraussichtlich vier Wochen spaeter fertig.',
          'Bauseitige Elektroversorgung verzoegert sich',
          'Die bauseits zu stellende Elektroversorgung in Halle 3 steht nicht zur '
          'Verfuegung. Der Auftraggeber nennt eine Verzoegerung von etwa vier Wochen.',
          'Wird voraussichtlich vier Wochen spaeter fertig.',
          'Montage und Inbetriebnahme', 'Terminänderung', 'unklar',
          'Ohne Elektroversorgung ist die Inbetriebnahme nicht moeglich. Ob daraus '
          'eine Bauzeitverlaengerung folgt, haengt vom weiteren Ablauf ab.',
          '["Neuer Termin fuer die Bereitstellung nicht genannt","Auswirkung auf den Endtermin offen"]'::jsonb,
          'wir zeigen Ihnen hiermit an, dass die Ausfuehrung unserer Leistung behindert '
          'ist. Wir bitten um Mitteilung, sobald die Behinderung entfallen ist.',
          p_user, true);

  -- (3) Rueckfrage ohne Abweichung -> zeigt, dass das System nicht ueberreagiert
  insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote,
                       affected_scope, change_type, deviation, reasoning, open_questions,
                       suggestion, created_by, status)
  values (v_projekt, current_date - 9, 'E-Mail vom Kunden',
          'Koennen Sie uns kurz sagen, wann die Schulung stattfinden soll? '
          'Wir muessen die Schichten planen.',
          'Rueckfrage zum Schulungstermin',
          'Der Auftraggeber fragt nach dem Termin fuer die Schulung, um die '
          'Schichtplanung vorzunehmen.',
          'Koennen Sie uns kurz sagen, wann die Schulung stattfinden soll?',
          'Schulung', 'Sonstiges', 'nein',
          'Die Schulung von zwei Schichten ist im Leistungsumfang enthalten. Eine '
          'Terminabfrage ist keine Aenderung.',
          '[]'::jsonb, null, p_user, 'erledigt');

  -- (4) Erledigter Nachtrag -> zeigt, wie es aussieht, wenn es funktioniert hat
  insert into entries (project_id, occurred_on, source, raw_text, title, facts, quote,
                       affected_scope, change_type, deviation, reasoning, open_questions,
                       suggestion, created_by, estimated_value)
  values (v_projekt, current_date - 95, 'Telefonnotiz',
          'Telefonat mit Herrn Meier: Die Anlage soll zusaetzlich eine '
          'Etikettenkontrolle per Kamera bekommen.',
          'Zusaetzliche Etikettenkontrolle per Kamera',
          'Der Auftraggeber fordert eine Kamerakontrolle der Etiketten, die im '
          'Leistungsumfang nicht enthalten ist.',
          'Die Anlage soll zusaetzlich eine Etikettenkontrolle per Kamera bekommen.',
          'Steuerung und Sensorik', 'Funktionserweiterung', 'ja',
          'Eine Etikettenkontrolle ist im Leistungsumfang nicht genannt.',
          '[]'::jsonb,
          'wir moechten den Inhalt unserer Abstimmung festhalten.',
          p_user, 18500);

  update entries
     set status = 'erledigt',
         notified_on = current_date - 88,
         notified_kind = 'leistungsaenderung'
   where project_id = v_projekt and title like 'Zusaetzliche Etikettenkontrolle%';

  -- Sicherheiten: eine faellige, eine laufende
  insert into securities (project_id, kind, amount, percent, issued_on, release_due_on, aval_rate, bank)
  values (v_projekt, 'vertragserfuellungsbuergschaft', 120000, 5.0,
          current_date - 400, current_date - 12, 1.4, 'Kreissparkasse'),
         (v_projekt, 'gewaehrleistungsbuergschaft', 72000, 3.0,
          current_date - 30, current_date + 700, 1.2, 'Kreissparkasse');

  return v_projekt;
end $$;

comment on function beispielprojekt_anlegen(uuid, uuid) is
  'Legt ein gekennzeichnetes Beispielprojekt an, damit ein neuer Betrieb nicht leer startet.';

-- ---------------------------------------------------------------
-- 3) Beim Anlegen eines Nutzers alles zusammenführen
-- ---------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  neue_org uuid;
  ist_betreiber boolean;
begin
  select exists (select 1 from betreiber_adressen b
                  where lower(b.email) = lower(new.email))
    into ist_betreiber;

  insert into orgs (name, plan, trial_ends_at)
    values (coalesce(split_part(new.email, '@', 2), 'Mein Betrieb'),
            case when ist_betreiber then 'aktiv' else 'probe' end,
            now() + interval '24 hours')
    returning id into neue_org;

  insert into memberships (user_id, org_id, role) values (new.id, neue_org, 'owner');

  if ist_betreiber then
    insert into app_admins (user_id, note)
    select new.id, b.note from betreiber_adressen b
     where lower(b.email) = lower(new.email)
    on conflict (user_id) do nothing;
  end if;

  -- Damit die Akte nicht leer ist. Fehler hier dürfen die Anmeldung
  -- niemals verhindern.
  begin
    perform beispielprojekt_anlegen(neue_org, new.id);
  exception when others then
    null;
  end;

  return new;
end $$;

-- ---------------------------------------------------------------
-- 4) Für bestehende Betriebe ohne Projekt nachziehen
-- ---------------------------------------------------------------
do $$
declare o record;
begin
  for o in select id from orgs where not exists (select 1 from projects p where p.org_id = orgs.id) loop
    begin
      perform beispielprojekt_anlegen(o.id, null);
    exception when others then null;
    end;
  end loop;
end $$;

commit;

-- ---------------------------------------------------------------
-- 5) Rechte auf den Funktionen mit erhöhten Rechten
--
--    beispielprojekt_anlegen läuft als security definer und nimmt eine
--    beliebige Betriebs-ID entgegen. Wäre sie aufrufbar, könnte ein
--    angemeldeter Nutzer Daten in einen fremden Betrieb schreiben.
--    Sie wird ausschließlich vom Trigger und vom Dienstschlüssel gerufen.
-- ---------------------------------------------------------------
revoke all on function beispielprojekt_anlegen(uuid, uuid) from public, anon, authenticated;
revoke all on function rohtexte_bereinigen()                from public, anon, authenticated;
revoke all on function ki_verbrauch_aufraeumen()            from public, anon, authenticated;
