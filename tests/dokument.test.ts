/**
 * Reine Funktionen aus lib/dokument.ts.
 *
 * winAnsi() sieht harmlos aus und hat pdf-lib in Produktion zum Absturz
 * gebracht: die Standardschriften koennen nur WinAnsi, und das Modell
 * liefert typografische Anfuehrungszeichen und Gedankenstriche.
 */
import { describe, it, expect } from "vitest";
import { winAnsi, umbrechen, alsText, DOKUMENT_TYP, type DokumentDaten } from "../lib/dokument";

describe("winAnsi", () => {
  it("ersetzt typografische Zeichen statt sie zu verlieren", () => {
    expect(winAnsi("„Zitat“ – und …")).toBe('"Zitat" - und ...');
  });

  it("behaelt deutsche Umlaute", () => {
    expect(winAnsi("Behinderungsanzeige gemäß § 6 — Prüfung")).toBe("Behinderungsanzeige gemäß § 6 - Prüfung");
  });

  it("entfernt, was WinAnsi nicht darstellen kann", () => {
    expect(winAnsi("Ablauf → fertig ✅")).toBe("Ablauf -> fertig ");
  });

  it("laesst gewoehnlichen Text unveraendert", () => {
    const t = "Die Pumpe ist in Edelstahl auszufuehren.";
    expect(winAnsi(t)).toBe(t);
  });
});

describe("umbrechen", () => {
  it("haelt die Zeilenlaenge ein", () => {
    const lang = "Wort ".repeat(60).trim();
    for (const z of umbrechen(lang, 40)) expect(z.length).toBeLessThanOrEqual(40);
  });

  it("erhaelt Absaetze", () => {
    expect(umbrechen("eins\nzwei\ndrei", 80)).toEqual(["eins", "zwei", "drei"]);
  });

  it("bricht ein ueberlanges Wort hart, statt in eine Endlosschleife zu laufen", () => {
    const z = umbrechen("A".repeat(100), 30);
    expect(z.length).toBe(4);
    expect(z[0].length).toBe(30);
  });

  it("verliert keine leeren Zeilen", () => {
    expect(umbrechen("eins\n\nzwei", 80)).toEqual(["eins", "", "zwei"]);
  });
});

const daten: DokumentDaten = {
  typ: "leistungsaenderung",
  projekt: "A-2418 Abfuellanlage",
  vertragsnummer: "V-2025-118",
  empfaenger: "Muster Werke GmbH",
  vermerkNr: 7,
  vorgangsdatum: "2026-03-14",
  titel: "Materialwechsel Pumpe",
  sachverhalt: "Der Auftraggeber fordert Edelstahl statt Guss.",
  zitat: "Bitte die Pumpe in Edelstahl statt Guss ausfuehren.",
  offenePunkte: ["Termin noch offen", "Werkstoffguete unklar"],
  vorschlag: null,
  briefkopf: "Mueller Anlagenbau GmbH",
  unterzeichner: "K. Tsou",
  funktion: "Projektleitung",
};

describe("alsText", () => {
  const t = alsText(daten);

  it("enthaelt Briefkopf, Empfaenger und Unterschrift", () => {
    expect(t).toContain("Mueller Anlagenbau GmbH");
    expect(t).toContain("Muster Werke GmbH");
    expect(t).toContain("K. Tsou");
    expect(t).toContain("Projektleitung");
  });

  it("nummeriert den Vermerk dreistellig", () => {
    expect(t).toContain("Vermerk Nr. 007");
  });

  it("gibt das Zitat woertlich wieder", () => {
    expect(t).toContain(daten.zitat);
  });

  it("listet die offenen Punkte", () => {
    expect(t).toContain("- Termin noch offen");
  });

  it("nennt keine Betraege und setzt keine Fristen", () => {
    // Der Kern der Zusage: das Schreiben ist eine Mitteilung, kein
    // Forderungsschreiben. Sonst wird es nie verschickt.
    expect(t).not.toMatch(/EUR|Euro|€/);
    expect(t).not.toMatch(/Frist von|binnen \d|bis zum \d/i);
    expect(t).not.toMatch(/Schadensersatz|Verzug|unverzueglich zu zahlen/i);
  });

  it("kommt fuer jeden Dokumenttyp ohne Absturz durch", () => {
    for (const typ of Object.keys(DOKUMENT_TYP) as (keyof typeof DOKUMENT_TYP)[]) {
      const s = alsText({ ...daten, typ });
      expect(s.length).toBeGreaterThan(200);
      expect(s).toContain(DOKUMENT_TYP[typ].titel);
    }
  });

  it("kommt ohne Briefkopf und ohne Zitat aus", () => {
    const s = alsText({ ...daten, briefkopf: null, unterzeichner: null, funktion: null, zitat: "", offenePunkte: [] });
    expect(s).toContain("Sehr geehrte Damen und Herren");
    expect(s).toContain("Mit freundlichen");
  });

  it("erzeugt ausschliesslich darstellbare Zeichen nach winAnsi", () => {
    for (const typ of Object.keys(DOKUMENT_TYP) as (keyof typeof DOKUMENT_TYP)[]) {
      expect(winAnsi(alsText({ ...daten, typ }))).not.toMatch(/[^ -ÿ\n]/);
    }
  });
});
