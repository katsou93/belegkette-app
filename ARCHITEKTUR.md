# Architektur

Dieses Dokument erklärt, warum die Dinge so sind, wie sie sind. Mehrere
Stellen sehen umständlicher aus als nötig. Sie sind es aus einem Grund,
und der steht hier.

---

## Der eine Satz

**Die Beweiseigenschaften liegen in der Datenbank, nicht in der Anwendung.**

Alles andere folgt daraus. Die Anwendung kann neu geschrieben, ersetzt
oder umgangen werden — die Zusagen halten trotzdem, weil sie als Trigger,
Constraints und Policies in Postgres stehen. Wer eine dieser Zusagen in
die Anwendungsschicht verschiebt, hat das Produkt kaputtgemacht, auch
wenn alles weiterhin läuft.

---

## Warum ein Aktenvermerk unveränderlich sein muss

Ein Aktenvermerk ist kein Datensatz, sondern ein Beweismittel. Sein Wert
hängt daran, dass niemand ihn nachträglich verbessern konnte — auch nicht
derjenige, dem er nützt. Ein Vermerk, den man ändern kann, ist im Streit
nichts wert, weil die Gegenseite genau das behaupten wird.

Daraus folgt eine unbequeme Trennung, die sich durch das ganze Schema
zieht:

| Unveränderlich | Änderbar |
|---|---|
| `raw_text`, `title`, `facts`, `quote` | `status` |
| `occurred_on`, `seq`, `created_at` | `note` |
| `deviation` | `estimated_value` |
| `source_kind`, `counterparty_kind` | `wiedervorlage_am` |
| `schedule_impact` | `discard_reason` |
| `prev_hash`, `hash` | `notified_on`, `notified_kind` |

Die rechte Spalte ist Arbeitsstand: Einschätzungen, die sich mit dem
Projekt ändern dürfen. Die linke ist die Tatsachenbehauptung. `deviation`
steht links, obwohl es eine Bewertung ist — weil eine nachträglich
umgestellte Bewertung genau der Vorwurf wäre, den man vermeiden will.

`notified_on` steht rechts, obwohl es beweisrelevant klingt. Es ist eine
Selbstauskunft des Nutzers („das habe ich am 14. rausgeschickt"), kein vom
System erzeugter Beweis. Ein Tippfehler im Datum muss korrigierbar
bleiben. Protokolliert wird die Änderung trotzdem.

Durchgesetzt in `entries_immutable()`, zuletzt geändert in Migration 0009.

---

## Warum eine Hash-Kette, wenn Änderungen ohnehin verboten sind

Der Trigger verhindert Änderungen über die Anwendung. Er verhindert
nichts, wenn jemand direkten Datenbankzugriff hat — der Betreiber zum
Beispiel. Genau das würde eine Gegenseite im Streit einwenden: *„Der
Anbieter hätte das nachträglich einfügen können."*

Die Kette beantwortet diesen Einwand. Jeder Vermerk enthält die Prüfsumme
seines Vorgängers:

```
hash = sha256(prev_hash | project_id | seq | occurred_on |
              raw_text | title | facts | quote | deviation | created_at)
```

Wer einen Vermerk in der Mitte ändert, müsste jeden folgenden neu rechnen.
`kette_pruefen(projekt)` weist die Lücke punktgenau aus. Die Funktion läuft
bewusst **ohne** `security definer` — es gilt die normale Zeilensicherheit,
also kann jeder nur seine eigenen Projekte prüfen.

Was die Kette nicht kann: sie beweist nicht, *wann* etwas entstanden ist,
nur dass die Reihenfolge stimmt. Für einen Zeitbeweis bräuchte es einen
externen Zeitstempeldienst. Das ist bewusst nicht eingebaut — es wäre eine
Zusage, die wir noch nicht halten können, und eine halbe Zusage ist hier
schlimmer als keine.

---

## Warum ein Advisory Lock für die Nummernvergabe

Eine Sequenz in Postgres reißt Lücken, sobald eine Transaktion
zurückgerollt wird. Eine Akte mit Vermerk 14 und 16, aber ohne 15, wirft
im Streit genau die Frage auf, die man nicht haben will.

Deshalb `max(seq) + 1` unter `pg_advisory_xact_lock(project_id)`. Das
serialisiert das Einfügen **je Projekt** — zwei Projekte blockieren sich
nicht gegenseitig. Bei einer Handvoll Vermerken pro Tag und Projekt ist
das folgenlos.

Die Sperre wird zweimal genommen, in `set_entry_seq` und in
`entry_kette_bilden`. Advisory Locks sind wiedereintrittsfähig, das kostet
nichts.

**Reihenfolge der Trigger:** Postgres feuert BEFORE-Trigger alphabetisch.
`trg_entry_seq` muss vor `trg_entry_verkettung` laufen, sonst ist `seq`
beim Hashen noch leer. Daher das „v" im Namen. Das ist fragil und sollte
beim nächsten größeren Umbau durch einen einzigen Trigger ersetzt werden.

---

## Warum Zeilensicherheit und nicht `where org_id = ?`

Ein vergessenes `where` in einer von fünfzig Abfragen zeigt einem Betrieb
die Daten eines anderen. Bei diesem Produkt — Verträge, Nachträge,
Streitstände zwischen Firmen, die sich im Zweifel gegenseitig verklagen —
ist das kein Fehler, das ist das Ende.

Deshalb: jede Tabelle hat RLS, jede Abfrage läuft mit der Sitzung des
Nutzers, und `auth_org_ids()` liefert die Betriebe. Ein vergessenes
`where` liefert dann zu wenig, nie zu viel.

`auth_org_ids()` ist `security definer`, damit die Policy auf `memberships`
sich nicht selbst aufruft und in eine Endlosschleife läuft.

Getestet wird das nicht als Behauptung, sondern als Angriff: In
`akte.test.ts` versucht Nutzer B, ein fremdes Projekt zu lesen, zu
beschreiben und umzubenennen. Alle drei müssen scheitern.

---

## Warum die Kostenbremse in der Datenbank sitzt

Ein Zähler im Prozessspeicher zählt auf Vercel pro Instanz. Bei drei
gleichzeitigen Instanzen bremst ein Limit von 30 erst bei 90. Die
Datenbank ist der einzige Ort, den alle Instanzen teilen.

`ki_kontingent_verbrauchen()` prüft und zählt in **einer** Anweisung
(`insert ... on conflict do update ... returning`). Getrennt geprüft und
gezählt schlüpfen bei gleichzeitigen Anfragen beliebig viele durch
dieselbe Lücke.

Der Aufruf steht in der Route **vor** dem Modellaufruf. Wer erst fragt und
danach zählt, hat schon bezahlt.

Zwei Fenster, weil sie Verschiedenes verhindern: der Stundendeckel fängt
die Endlosschleife im Browser ab, der Tagesdeckel die Rechnung.

---

## Warum das Modell mit `tool_use` arbeitet und nicht mit JSON im Text

Freies JSON aus einem Sprachmodell kommt gelegentlich mit Vorwort,
Codeblock-Zaun oder abgeschnitten. Jeder dieser Fälle braucht eine
Sonderbehandlung, und man findet sie erst in Produktion.

`tool_choice: { type: "tool" }` erzwingt strukturierte Ausgabe gegen ein
Schema. Trotzdem prüft `istDraft()` das Ergebnis nach — ein fehlendes
Pflichtfeld soll als verständliche Meldung auffallen und nicht als
Constraint-Verletzung beim Einfügen.

Die Systemanweisung ist lang und bei jedem Aufruf gleich, deshalb
`cache_control: ephemeral`. Das senkt die Kosten je Aufruf spürbar.

**Jede Regel in der Systemanweisung steht dort wegen eines konkreten
Fehlers in der Erprobung**, nicht weil sie gut klingt. Die Begründungen
stehen im Kommentar über `SYSTEM` in `lib/server.ts`. Wer eine Regel
streicht, sollte den Fall vorher nachstellen.

---

## Warum das System nichts verschickt

`/api/dokument` erzeugt ein PDF und eine Textfassung. Verschickt wird
nichts. Drei Gründe:

1. **Beweisrechtlich besser.** Eine Mail aus dem eigenen Postfach des
   Kunden an seinen Auftraggeber ist unstreitig. Eine Mail von einem
   Dienstleister wirft Zustellungs- und Vollmachtsfragen auf.
2. **Zustellbarkeit.** Fremdversand landet im Spam. Das merkt man erst,
   wenn eine Behinderungsanzeige nicht angekommen ist.
3. **Kontrolle.** Der Nutzer sieht jedes Schreiben, bevor es rausgeht. Bei
   Texten, die eine Geschäftsbeziehung belasten können, ist das keine
   Bequemlichkeitsfrage.

Aus demselben Grund enthält der erzeugte Text nie Beträge und nie
Fristsetzungen. Ein Schreiben, das den Kunden verärgert, wird nicht
verschickt — und ein nicht verschicktes Schreiben nützt niemandem.

---

## Warum Kunden- und Lieferantenakte spiegelbildlich sind

`customers` und `suppliers` haben dasselbe Schema, dieselben Policies,
dieselbe Domain-Zuordnung. Das ist keine Bequemlichkeit.

Wer sich beim Auftraggeber auf eine Behinderung beruft, muss sie beim
Verursacher ebenso dokumentiert haben — sonst bleibt er auf dem Schaden
sitzen. Die Verzugskette braucht beide Richtungen, oder sie ist
unvollständig.

Deshalb auch `counterparty_kind` unter den unveränderlichen Feldern: die
Richtung nachträglich zu drehen wäre eine inhaltliche Änderung.

---

## Warum das Kundenprofil in einer eigenen Tabelle liegt

`customer_profiles` enthält eine von der KI erzeugte Zusammenfassung.
Das ist Interpretation, kein Beweismittel.

Läge sie als Spalte an `customers`, würde sie früher oder später neben
Vermerkinhalten in einem Export landen und dort wie Tatsache aussehen.
Getrennte Tabelle, eigener Kommentar im Schema, nicht Teil der Hash-Kette.

---

## Warum die Betreibersicht keine Vermerkinhalte kennt

`admin_betriebe`, `admin_ki_kosten` und `admin_qualitaet` enthalten
Zahlen, Zeitpunkte und Zustände. Kein `raw_text`, kein `quote`, kein
`facts`.

Das ist nicht Zurückhaltung, sondern die Zusage aus der
Datenschutzerklärung. Die Spalten existieren in den Sichten gar nicht
erst — durchgesetzt, nicht versprochen. Ein Test in `probe.test.ts` prüft
genau das.

---

## Warum die Probe nur das Schreiben sperrt

Nach 24 Stunden lassen sich keine neuen Vorgänge anlegen. Lesen und
Exportieren bleiben unbegrenzt möglich.

Ein Produkt, das die Projektakte seines Nutzers als Druckmittel benutzt,
verkauft sich einmal. Der Trigger `schreibrecht_pruefen()` hängt deshalb
nur an `insert`, nicht an `select`.

---

## Die Middleware ist keine Sicherheitsgrenze

Sie frischt die Sitzung auf und leitet Unangemeldete weiter. Das ist
Bequemlichkeit. Die Absicherung liegt in der Zeilensicherheit und in der
Prüfung in jeder Route. Wer die Middleware umgeht, sieht trotzdem nichts.

Zwei Fallen, die dort schon zugeschlagen haben:

- `/api/fristen` muss freigegeben sein. Vercel Cron schickt einen
  Bearer-Token, aber kein Sitzungscookie — ohne Freigabe wird der Cron auf
  `/login` umgeleitet und läuft nie. Das merkt man erst, wenn eine
  Bürgschaft verfallen ist.
- Der `matcher` darf nicht über statische Dateien laufen. Jeder Treffer
  war ein Netzaufruf zu Supabase.

---

## Warum die Tests gegen PGlite laufen und nicht gegen Supabase

Tests, die eine Netzverbindung und einen Schlüssel brauchen, gehen bei
einer Übergabe als Erstes kaputt. PGlite ist Postgres 18 als WASM:
dieselben Trigger, dieselben Policies, dieselbe Nebenläufigkeit, kein
Server.

Was nachgebaut werden muss, steht in `tests/db/harness.ts`: das Schema
`auth`, `auth.uid()` über eine Sitzungsvariable statt über einen
JWT-Claim, und die drei Supabase-Rollen.

**Bekannter Unterschied:** Supabase installiert `pgcrypto` in das Schema
`extensions`, ein frisches Postgres nach `public`. Migration 0009 legt
deshalb `search_path = public, extensions` auf allen betroffenen
Funktionen fest, damit `digest()` auf beiden Systemen gefunden wird. Das
war ein echter Fehler bei der ersten Anwendung und ist der Grund, warum
Instanz und Migrationsdateien eine Zeit lang auseinanderliefen.

---

## Bekannte Schwachstellen

Ehrlich aufgelistet, damit niemand sie für Absicht hält:

1. **`'unsafe-inline'` in `script-src`.** Der App Router bettet
   Hydrations-Code inline ein. Sauber wird das erst mit einer Nonce aus
   der Middleware. Begründet in `next.config.ts`.
2. **Triggerreihenfolge über Namen.** `trg_entry_seq` vor
   `trg_entry_verkettung`, sichergestellt durch alphabetische Sortierung.
   Fragil. Ein einziger Trigger wäre besser.
3. **Kein Zeitstempeldienst.** Die Kette beweist Reihenfolge, nicht
   Zeitpunkt.
4. **`ki_verbrauch_nachtragen` wird ohne `await` aufgerufen.** Wenn die
   Serverless-Funktion sofort beendet wird, geht die Tokenzahl verloren.
   Die Bremse hängt an der Anzahl der Aufrufe, nicht an Token — deshalb
   nur eine Ungenauigkeit in der Statistik, kein Loch in der Bremse.
5. **Keine Paginierung.** Projekte mit vielen hundert Vermerken laden
   alles auf einmal.
