# Prooftrail

Projektakte für den Maschinen- und Anlagenbau. Eine weitergeleitete Nachricht
wird zu einem datierten, unveränderlichen Aktenvermerk mit wörtlichem Zitat.

---

## In fünf Minuten laufen lassen

```bash
git clone https://github.com/katsou93/belegkette-app.git prooftrail
cd prooftrail
npm ci
cp .env.example .env.local     # Werte eintragen, siehe unten
npm test                       # läuft ohne jede Konfiguration
npm run dev
```

`npm test` braucht weder Netz noch Zugangsdaten. Die Tests fahren die
Migrationen gegen ein echtes Postgres, das im Prozess läuft. Wer wissen
will, ob das Schema hält, muss nichts einrichten.

Für `npm run dev` braucht es ein Supabase-Projekt:

1. Projekt anlegen, Region Frankfurt.
2. Die Dateien in `supabase/migrations/` **in Reihenfolge** ausführen —
   entweder mit `supabase db push` oder von Hand im SQL-Editor.
3. `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` aus
   Project Settings → API in `.env.local` eintragen.
4. `ANTHROPIC_API_KEY` eintragen, sonst antwortet die Vermerk-Route mit 502.

### Sich selbst zum Betreiber machen

```sql
insert into app_admins (user_id, note)
select id, 'Gründer' from auth.users where email = 'ihre@adresse.de';
```

Danach erscheint „Kennzahlen" in der Seitenleiste.

---

## Aufbau

```
app/
  api/vermerk/     Nachricht → Vermerke. Prüft Kontingent VOR dem Modellaufruf.
  api/dokument/    Vermerk → sendefertiges PDF oder Textfassung.
  api/fristen/     Vercel Cron. Fällige Wiedervorlagen und Sicherheiten.
  admin/           Betreibersicht. Enthält bewusst keine Vermerkinhalte.
  projekte/        Die Akte.
  kunden/          Auftraggeber mit Kennzahlen und Historie.
  lieferanten/     Dieselbe Logik nach unten.
components/        Nur Darstellung. Keine Geschäftslogik.
lib/
  env.ts           Umgebungsvariablen, geprüft statt erhofft.
  http.ts          Fehlerantworten, Körpergrenze, Vergleich in konstanter Zeit.
  server.ts        Supabase serverseitig, Systemanweisung, Modellaufruf.
  browser.ts       Supabase im Browser, Typen, Formatierung.
  dokument.ts      Schreiben erzeugen. Rein, ohne Seiteneffekte, getestet.
supabase/migrations/  Das Schema. Reihenfolge zählt.
tests/db/          Migrationen gegen echtes Postgres.
```

Die ausführliche Begründung der Entwurfsentscheidungen steht in
[ARCHITEKTUR.md](ARCHITEKTUR.md). Wer hier etwas ändern will, sollte sie
vorher gelesen haben — mehrere Stellen sehen umständlich aus und sind es
aus einem Grund.

---

## Was das Produkt zusagt

Diese vier Eigenschaften sind der Grund, warum jemand dafür bezahlt. Sie
werden alle in der Datenbank durchgesetzt, nicht in der Oberfläche, und
jede hat einen Test, der sie zu brechen versucht:

| Zusage | Wo durchgesetzt | Test |
|---|---|---|
| Nummern sind lückenlos, auch bei gleichzeitigen Einträgen | `set_entry_seq`, Advisory Lock | `akte.test.ts` |
| Inhalte sind nach dem Anlegen unveränderlich | `entries_immutable`, `entries_no_delete` | `akte.test.ts` |
| Manipulation am Datenbestand vorbei ist nachweisbar | SHA-256-Kette, `kette_pruefen` | `akte.test.ts` |
| Kein Betrieb sieht die Daten eines anderen | Zeilensicherheit auf jeder Tabelle | `akte.test.ts` |

```bash
npm test    # 39 Tests, rund zwei Sekunden
```

---

## Umgebungsvariablen

Alle in `.env.example` mit Erklärung. Kurz:

| Variable | Pflicht | Wofür |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ja | Datenbank |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ja | öffentlich, Absicherung liegt in der Zeilensicherheit |
| `ANTHROPIC_API_KEY` | für die KI | ohne diesen antwortet `/api/vermerk` mit 502 |
| `SUPABASE_SERVICE_ROLE_KEY` | für den Cron | umgeht die Zeilensicherheit |
| `CRON_SECRET` | für den Cron | `openssl rand -hex 32` |
| `RESEND_API_KEY`, `FRISTEN_EMPFAENGER` | nein | ohne sie gibt der Cron den Bericht als JSON zurück |
| `KI_LIMIT_TAG`, `KI_LIMIT_STUNDE` | nein | Kostenbremse, Vorgabe 200 und 30 je Nutzer |

---

## Betrieb

Vercel, Region `fra1`. Der Cron in `vercel.json` läuft werktags morgens
und ist über `CRON_SECRET` geschützt — er hängt an einem Pfad, den die
Middleware ausdrücklich freigibt, weil Vercel kein Sitzungscookie schickt.

**Probezeitraum:** 24 Stunden ab Registrierung. Danach bleibt die Akte
vollständig lesbar und exportierbar, nur neue Vorgänge sind gesperrt. Das
ist Absicht: die eigene Projektakte als Geisel zu nehmen wäre bei diesem
Produkt besonders unanständig.

**Kostenbremse:** je Nutzer 30 Aufrufe pro Stunde und 200 pro Tag,
gezählt in der Datenbank (nicht im Prozessspeicher — auf Vercel liefe
jede Instanz sonst gegen ihren eigenen Zähler). Das Kontingent wird
geprüft, *bevor* das Modell gefragt wird.

---

## Was noch fehlt

Ehrlich, damit niemand danach sucht:

- **Maileingang.** `/api/inbound` ist in der Middleware freigegeben, aber
  die Route existiert noch nicht. Braucht eine Domain und einen
  Eingangsanbieter.
- **Bezahlung.** Kein Anbieter angebunden. Freischalten geht von Hand über
  die Betreibersicht.
- **Nonce in der CSP.** `script-src` enthält `'unsafe-inline'`, weil der
  App Router seinen Hydrations-Code inline einbettet. Sauber wird das erst
  mit einer Nonce aus der Middleware. Begründet in `next.config.ts`.
- **Audio.** Sprachnotizen sind im Schema vorgesehen (`source_kind =
  'sprachnotiz'`), es gibt aber weder Aufnahme noch Transkription.
