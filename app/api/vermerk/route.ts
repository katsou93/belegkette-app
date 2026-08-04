import { NextRequest, NextResponse } from "next/server";
import { sbServer, erstelleVermerke, MODEL } from "@/lib/server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req: NextRequest) {
const sb = await sbServer();
const { data: { user } } = await sb.auth.getUser();
if (!user) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
const body = await req.json().catch(() => null);
const projectId = body?.projectId as string | undefined;
const text = (body?.text as string | undefined)?.trim();
const quelle = (body?.quelle as string) || "E-Mail vom Kunden";
const datum = (body?.datum as string) || new Date().toISOString().slice(0, 10);
if (!projectId || !text || text.length < 20) return NextResponse.json({ error: "Projekt und Wortlaut erforderlich." }, { status: 400 });
const { data: p } = await sb.from("projects").select("id,name,contract_value").eq("id", projectId).single();
if (!p) return NextResponse.json({ error: "Projekt nicht gefunden." }, { status: 404 });
let drafts;
try { drafts = await erstelleVermerke({ projekt: p.name, auftragswert: p.contract_value, quelle, datum, text }); }
catch (e) { console.error(e); return NextResponse.json({ error: "Vermerk konnte nicht erstellt werden." }, { status: 502 }); }
if (!drafts.length) return NextResponse.json({ vermerke: [], hinweis: "Kein dokumentationswuerdiger Vorgang erkannt." });
const rows = drafts.map((d) => ({
project_id: projectId, occurred_on: datum, source: quelle, raw_text: text,
title: d.titel, facts: d.sachverhalt, quote: d.zitat, affected_scope: d.betroffene_leistung,
change_type: d.art, deviation: d.abweichung, reasoning: d.begruendung,
open_questions: d.offene_punkte, suggestion: d.vorschlag, model: MODEL, created_by: user.id,
}));
const { data, error } = await sb.from("entries").insert(rows).select();
if (error) { console.error(error); return NextResponse.json({ error: "Speichern fehlgeschlagen." }, { status: 500 }); }
return NextResponse.json({ vermerke: data });
}
