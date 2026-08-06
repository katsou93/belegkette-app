-- 0014 — Befunde: was gerade verfällt
--
-- DIE ÜBERLEGUNG DAHINTER
-- Alles bisher Gebaute richtet sich an den Projektleiter. Der Geschäfts-
-- führer, der die Rechnung unterschreibt, hat davon nichts — er müsste sich
-- einloggen und Vermerke lesen. Das tut kein Geschäftsführer.
--
-- Sein Problem ist ein anderes. Seine Nachkalkulation blickt zurück: Er
-- erfährt im Februar, dass Projekt A-2418 im September Geld verloren hat.
-- Da kann er nichts mehr tun. Es gibt in seinem Betrieb keine einzige
-- Auswertung, die nach vorne schaut.
--
-- Aus den Daten dieser Akte lässt sich genau das bauen — und zwar ohne
-- Schätzung, Modell oder Bauchgefühl. Jeder Befund hier ist eine gezählte
-- Tatsache mit einem Betrag daneben.
--
-- KEIN RISIKOSCORE
-- Bewusst keine Punktzahl. „Risikoscore 72" glaubt niemand. „Drei Vorgänge
-- über 45 Tage offen, nie angezeigt, geschätzt 60.000 Euro" glaubt jeder,
-- weil er es nachzählen kann. Deshalb Befunde statt Bewertung.
--
-- Die Ampel ergibt sich anschließend aus der Art der Befunde, nicht aus
-- einer gewichteten Summe.

begin;

-- ---------------------------------------------------------------
-- 1) Schwellen am Betrieb
--
--    Was „alt" heißt, unterscheidet sich zwischen einem Betrieb mit
--    Zweimonatsprojekten und einem mit Zweijahresprojekten.
-- ---------------------------------------------------------------
alter table orgs add column if not exists befund_tage_offen  integer not null default 30;
alter table orgs add column if not exists befund_margen_proz numeric(5,2) not null default 3.0;

comment on column orgs.befund_tage_offen is
  'Ab wie vielen Tagen ein offener, nicht angezeigter Vorgang als gefährdet gilt.';
comment on column orgs.befund_margen_proz is
  'Ab welchem Anteil am Auftragswert offene Abweichungen als Margenrisiko gelten.';

-- ---------------------------------------------------------------
-- 2) Die Befunde
--
--    Jede Zeile ist ein Satz, den man einem Geschäftsführer vorlesen kann,
--    ohne etwas zu erklären. Reihenfolge nach Dringlichkeit.
-- ---------------------------------------------------------------
create or replace view projekt_befunde
with (security_invoker = true) as

-- (a) Anspruch verfällt: dokumentiert, aber nie angezeigt, und alt.
--     Der häufigste Weg, wie Geld verloren geht — nicht durch Ablehnung,
--     sondern durch Schweigen.
select
  p.id as project_id, p.org_id, p.name as projekt,
  'anspruch_verfaellt'::text as art,
  'rot'::text                as dringlichkeit,
  count(*)::int              as anzahl,
  coalesce(sum(e.estimated_value), 0) as betrag,
  count(*) || ' Abweichung' || case when count(*) = 1 then '' else 'en' end ||
  ' seit über ' || o.befund_tage_offen || ' Tagen offen und nie angezeigt' as befund
from entries e
join projects p on p.id = e.project_id
join orgs o     on o.id = p.org_id
where e.deviation = 'ja'
  and e.status = 'offen'
  and e.notified_on is null
  and e.occurred_on < current_date - o.befund_tage_offen
group by p.id, p.org_id, p.name, o.befund_tage_offen

union all

-- (b) Verzug ohne Anzeige. Ist die VOB/B vereinbart, verlangt § 6 Abs. 1
--     die unverzügliche Anzeige. Eine Behinderung im Entwurfsordner ist
--     keine Behinderungsanzeige.
select
  p.id, p.org_id, p.name,
  'verzug_ohne_anzeige', 'rot',
  count(*)::int, 0::numeric,
  count(*) || ' Vorgang' || case when count(*) = 1 then '' else 'gänge' end ||
  ' mit Terminwirkung, ohne Anzeige an die Gegenseite'
from entries e
join projects p on p.id = e.project_id
where e.schedule_impact
  and e.notified_on is null
  and e.status <> 'verworfen'
group by p.id, p.org_id, p.name

union all

-- (c) Schlusszahlung angenommen, während noch etwas offen ist.
--     Der einzige Fehler im Projekt, der sich nicht reparieren lässt.
select
  p.id, p.org_id, p.name,
  'schlusszahlung_ohne_vorbehalt', 'rot',
  1,
  coalesce((select sum(e.estimated_value) from entries e
             where e.project_id = p.id and e.deviation = 'ja'
               and e.status in ('offen','angezeigt')), 0),
  'Schlusszahlung ohne Vorbehalt eingegangen, obwohl Vorgänge offen sind'
from projects p
where exists (select 1 from final_invoices f
               where f.project_id = p.id and f.received_on is not null
                 and not f.reservation_made)
  and exists (select 1 from entries e
               where e.project_id = p.id and e.deviation = 'ja'
                 and e.status in ('offen','angezeigt'))

union all

-- (d) Sicherheit rückforderbar. Das Geld gehört bereits Ihnen.
select
  p.id, p.org_id, p.name,
  'sicherheit_rueckforderbar', 'rot',
  count(*)::int, coalesce(sum(s.amount), 0),
  'Sicherheiten über ' || to_char(coalesce(sum(s.amount), 0), 'FM999G999G999') ||
  ' Euro sind rückforderbar'
from securities s
join projects p on p.id = s.project_id
where s.status = 'offen' and s.release_due_on is not null
  and s.release_due_on <= current_date
group by p.id, p.org_id, p.name

union all

-- (e) Margenrisiko. Offene Abweichungen im Verhältnis zum Auftragswert.
select
  p.id, p.org_id, p.name,
  'margenrisiko', 'gelb',
  count(*)::int, coalesce(sum(e.estimated_value), 0),
  'Offene Abweichungen entsprechen ' ||
  round(100 * coalesce(sum(e.estimated_value), 0) / nullif(p.contract_value, 0), 1) ||
  ' Prozent des Auftragswerts'
from entries e
join projects p on p.id = e.project_id
join orgs o     on o.id = p.org_id
where e.deviation = 'ja' and e.status in ('offen','angezeigt')
  and p.contract_value is not null and p.contract_value > 0
group by p.id, p.org_id, p.name, p.contract_value, o.befund_margen_proz
having coalesce(sum(e.estimated_value), 0)
       > p.contract_value * o.befund_margen_proz / 100

union all

-- (f) Das Projekt kippt gerade. Mehr Abweichungen in den letzten 30 Tagen
--     als in den drei Monaten davor pro Monat. Das ist das früheste
--     Signal, das aus diesen Daten überhaupt zu holen ist.
select
  p.id, p.org_id, p.name,
  'beschleunigung', 'gelb',
  count(*) filter (where e.occurred_on >= current_date - 30)::int,
  coalesce(sum(e.estimated_value) filter (where e.occurred_on >= current_date - 30), 0),
  count(*) filter (where e.occurred_on >= current_date - 30) ||
  ' Abweichungen im letzten Monat, davor im Schnitt ' ||
  round(count(*) filter (where e.occurred_on between current_date - 120
                                                 and current_date - 31) / 3.0, 1) ||
  ' je Monat'
from entries e
join projects p on p.id = e.project_id
where e.deviation = 'ja' and e.status <> 'verworfen'
  and e.occurred_on >= current_date - 120
group by p.id, p.org_id, p.name
having count(*) filter (where e.occurred_on >= current_date - 30) >= 3
   and count(*) filter (where e.occurred_on >= current_date - 30)
       > 2 * count(*) filter (where e.occurred_on between current_date - 120
                                                      and current_date - 31) / 3.0

union all

-- (g) Gewährleistung läuft bald ab und es liegt noch Geld draußen.
select
  p.id, p.org_id, p.name,
  'gewaehrleistung_endet', 'gelb',
  count(*)::int, coalesce(sum(s.amount), 0),
  'Gewährleistung endet am ' ||
  to_char(gewaehrleistung_bis(coalesce(p.accepted_on, p.abgeschlossen_am), p.warranty_months), 'DD.MM.YYYY') ||
  ', Sicherheiten noch nicht zurück'
from securities s
join projects p on p.id = s.project_id
where s.status in ('offen','angefordert')
  and gewaehrleistung_bis(coalesce(p.accepted_on, p.abgeschlossen_am), p.warranty_months)
      between current_date and current_date + 90
group by p.id, p.org_id, p.name, p.accepted_on, p.abgeschlossen_am, p.warranty_months;

comment on view projekt_befunde is
  'Was in einem Projekt gerade verfällt oder kippt. Jeder Befund ist eine gezählte Tatsache, kein Score.';

-- ---------------------------------------------------------------
-- 3) Die Ampel
--
--    Leitet sich aus der Art der Befunde ab, nicht aus einer Summe.
--    Ein einziger roter Befund macht das Projekt rot — weil dort in
--    jedem einzelnen Fall Geld verfällt.
-- ---------------------------------------------------------------
create or replace view projekt_ampel
with (security_invoker = true) as
select
  p.id     as project_id,
  p.org_id,
  p.name   as projekt,
  p.contract_value,
  case when count(b.art) filter (where b.dringlichkeit = 'rot') > 0 then 'rot'
       when count(b.art) > 0                                        then 'gelb'
       else 'gruen' end                                as ampel,
  count(b.art)::int                                    as befunde,
  count(b.art) filter (where b.dringlichkeit = 'rot')::int as befunde_rot,
  coalesce(sum(b.betrag), 0)                           as betrag_betroffen,
  coalesce(
    (select string_agg(x.befund, ' · ' order by x.dringlichkeit, x.art)
       from projekt_befunde x where x.project_id = p.id), 'Keine Auffälligkeiten'
  )                                                    as zusammenfassung
from projects p
left join projekt_befunde b on b.project_id = p.id
where p.status = 'aktiv'
group by p.id, p.org_id, p.name, p.contract_value;

comment on view projekt_ampel is
  'Eine Zeile je aktivem Projekt. Rot heißt: hier verfällt gerade etwas.';

-- ---------------------------------------------------------------
-- 4) Der Wochenbericht
--
--    Die Zahl, die ein Geschäftsführer montags in einer Mail sehen will,
--    ohne sich anzumelden. Alles andere ist Beiwerk.
-- ---------------------------------------------------------------
create or replace view wochenbericht
with (security_invoker = true) as
select
  a.org_id,
  count(*)::int                                             as projekte,
  count(*) filter (where a.ampel = 'rot')::int              as rot,
  count(*) filter (where a.ampel = 'gelb')::int             as gelb,
  count(*) filter (where a.ampel = 'gruen')::int            as gruen,
  coalesce(sum(a.betrag_betroffen) filter (where a.ampel = 'rot'), 0) as betrag_rot,
  coalesce(sum(a.betrag_betroffen), 0)                      as betrag_gesamt,
  (select coalesce(sum(s.amount), 0) from securities s
     join projects p on p.id = s.project_id
    where p.org_id = a.org_id and s.status in ('offen','angefordert')) as sicherheiten_gebunden
from projekt_ampel a
group by a.org_id;

comment on view wochenbericht is
  'Eine Zeile je Betrieb: wie viele Projekte auf Rot stehen und um wie viel Geld es geht.';

-- ---------------------------------------------------------------
-- 5) Jahresbilanz
--
--    Die unangenehmste und wirksamste Zahl im ganzen Produkt: Was wurde
--    dokumentiert, und was davon ist nie geltend gemacht worden?
--
--    Sie beantwortet die Frage, die ein Geschäftsführer beim zweiten
--    Rechnungslauf stellt: „Was hat mir das eigentlich gebracht?"
-- ---------------------------------------------------------------
create or replace view jahresbilanz
with (security_invoker = true) as
select
  p.org_id,
  extract(year from e.occurred_on)::int                     as jahr,
  count(*) filter (where e.deviation = 'ja')::int           as abweichungen,
  count(*) filter (where e.deviation = 'ja'
                     and e.notified_on is not null)::int    as angezeigt,
  count(*) filter (where e.deviation = 'ja'
                     and e.status = 'erledigt')::int        as erledigt,
  count(*) filter (where e.deviation = 'ja'
                     and e.notified_on is null
                     and e.status <> 'verworfen')::int      as nie_angezeigt,
  coalesce(sum(e.estimated_value) filter (where e.deviation = 'ja'
                     and e.status = 'erledigt'), 0)         as wert_erledigt,
  coalesce(sum(e.estimated_value) filter (where e.deviation = 'ja'
                     and e.notified_on is null
                     and e.status <> 'verworfen'), 0)       as wert_nie_angezeigt
from entries e
join projects p on p.id = e.project_id
group by p.org_id, extract(year from e.occurred_on);

comment on view jahresbilanz is
  'Was wurde dokumentiert, was davon geltend gemacht, was liegen gelassen. Die Antwort auf „was hat mir das gebracht".';

commit;
