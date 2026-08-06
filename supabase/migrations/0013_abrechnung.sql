-- 0013 — Abrechnungsphase je Projekt
--
-- Preismodell: 290 € je aktivem Projekt und Monat, 39 € nach der Abnahme
-- solange die Gewährleistung läuft, danach kostenfreies Archiv.
--
-- WARUM DIE PHASE ABGELEITET UND NICHT GESETZT WIRD
-- Ein Feld, das jemand von Hand pflegen muss, ist nach drei Monaten falsch.
-- Die Phase ergibt sich vollständig aus Daten, die ohnehin gepflegt werden:
-- Abnahmedatum und Gewährleistungsfrist stehen bereits am Projekt, weil das
-- Produkt sie für die Fristenüberwachung braucht.
--
-- Damit kann die Abrechnung nie von der Akte abweichen — es gibt nur eine
-- Quelle.
--
-- Bewusst NICHT enthalten: Rechnungsstellung, Zahlungsanbieter, Mahnwesen.
-- Bei den ersten Kunden wird von Hand fakturiert. Ein Abrechnungssystem für
-- null Kunden zu bauen wäre die teuerste Art, sich zu beschäftigen.

begin;

-- ---------------------------------------------------------------
-- 1) Preise am Betrieb
--
--    Am Betrieb und nicht global, damit ein ausgehandelter Preis
--    hinterlegt werden kann, ohne den Code anzufassen.
-- ---------------------------------------------------------------
alter table orgs add column if not exists preis_aktiv          numeric(10,2) not null default 290;
alter table orgs add column if not exists preis_gewaehrleistung numeric(10,2) not null default 39;

comment on column orgs.preis_aktiv is
  'Monatspreis je aktivem Projekt in Euro, netto. Verhandelbar je Betrieb.';
comment on column orgs.preis_gewaehrleistung is
  'Monatspreis je Projekt in der Gewährleistungsphase, netto.';

-- ---------------------------------------------------------------
-- 2) Ende der Gewährleistung
--
--    warranty_months steht seit 0007 am Projekt. Fehlt es, greift eine
--    zurückhaltende Annahme von 24 Monaten — der kürzeste in der VOB/B
--    genannte Regelfall für maschinelle Anlagen. Lieber zu früh aus der
--    Abrechnung fallen als dem Kunden zu lange etwas berechnen.
-- ---------------------------------------------------------------
create or replace function gewaehrleistung_bis(p_abnahme date, p_monate integer)
returns date
language sql immutable
set search_path = public
as $$
  select case when p_abnahme is null then null
              else p_abnahme + make_interval(months => coalesce(p_monate, 24))
         end::date
$$;

comment on function gewaehrleistung_bis(date, integer) is
  'Ende der Gewährleistung. Ohne Angabe im Vertrag zurückhaltend 24 Monate.';

-- ---------------------------------------------------------------
-- 3) Die Phase
--
--    aktiv          — läuft, keine Abnahme
--    gewaehrleistung— abgenommen, Frist läuft noch
--    archiv         — Frist abgelaufen, kostenfrei
-- ---------------------------------------------------------------
create or replace function projekt_phase(p_projekt uuid)
returns text
language sql stable
set search_path = public
as $$
  select case
           when p.accepted_on is null and p.abgeschlossen_am is null then 'aktiv'
           when gewaehrleistung_bis(coalesce(p.accepted_on, p.abgeschlossen_am),
                                    p.warranty_months) >= current_date then 'gewaehrleistung'
           else 'archiv'
         end
    from projects p where p.id = p_projekt
$$;

-- ---------------------------------------------------------------
-- 4) Was ein Betrieb diesen Monat kostet
--
--    Für die Rechnung und für das Verkaufsgespräch. Der Kunde soll die
--    Zahl jederzeit selbst sehen können — Überraschungen auf der Rechnung
--    sind der schnellste Weg zur Kündigung.
-- ---------------------------------------------------------------
create or replace view abrechnung
with (security_invoker = true) as
select
  p.id      as project_id,
  p.org_id,
  p.name    as projekt,
  p.accepted_on,
  p.warranty_months,
  gewaehrleistung_bis(coalesce(p.accepted_on, p.abgeschlossen_am), p.warranty_months) as gewaehrleistung_bis,
  case
    when p.accepted_on is null and p.abgeschlossen_am is null then 'aktiv'
    when gewaehrleistung_bis(coalesce(p.accepted_on, p.abgeschlossen_am),
                             p.warranty_months) >= current_date then 'gewaehrleistung'
    else 'archiv'
  end as phase,
  case
    when p.accepted_on is null and p.abgeschlossen_am is null then o.preis_aktiv
    when gewaehrleistung_bis(coalesce(p.accepted_on, p.abgeschlossen_am),
                             p.warranty_months) >= current_date then o.preis_gewaehrleistung
    else 0
  end as monatspreis
from projects p
join orgs o on o.id = p.org_id;

comment on view abrechnung is
  'Phase und Monatspreis je Projekt. Einzige Quelle für die Rechnung — leitet sich vollständig aus der Akte ab.';

-- ---------------------------------------------------------------
-- 5) Summe je Betrieb
-- ---------------------------------------------------------------
create or replace view abrechnung_betrieb
with (security_invoker = true) as
select
  a.org_id,
  count(*) filter (where a.phase = 'aktiv')           as projekte_aktiv,
  count(*) filter (where a.phase = 'gewaehrleistung') as projekte_gewaehrleistung,
  count(*) filter (where a.phase = 'archiv')          as projekte_archiv,
  coalesce(sum(a.monatspreis), 0)                     as monatlich_netto,
  coalesce(sum(a.monatspreis) * 12, 0)                as jaehrlich_netto
from abrechnung a
group by a.org_id;

comment on view abrechnung_betrieb is
  'Monats- und Jahressumme je Betrieb, netto. Grundlage der Rechnung.';

-- ---------------------------------------------------------------
-- 6) Betreibersicht ergänzen
--
--    Damit im Dashboard steht, was tatsächlich abzurechnen ist — nicht,
--    wie viele Projekte irgendwann einmal angelegt wurden.
-- ---------------------------------------------------------------
create or replace view admin_umsatz as
select
  o.id   as org_id,
  o.name as betrieb,
  o.plan,
  o.preis_aktiv,
  o.preis_gewaehrleistung,
  coalesce(b.projekte_aktiv, 0)            as projekte_aktiv,
  coalesce(b.projekte_gewaehrleistung, 0)  as projekte_gewaehrleistung,
  coalesce(b.projekte_archiv, 0)           as projekte_archiv,
  coalesce(b.monatlich_netto, 0)           as monatlich_netto,
  coalesce(b.jaehrlich_netto, 0)           as jaehrlich_netto
from orgs o
left join abrechnung_betrieb b on b.org_id = o.id
where ist_admin();

comment on view admin_umsatz is
  'Wiederkehrender Umsatz je Betrieb. Nur für den Betreiber, keine Vermerkinhalte.';

commit;
