"use client";
import { useState } from "react";
import { sbBrowser } from "@/lib/browser";
export default function Login() {
const [mail, setMail] = useState("");
const [st, setSt] = useState<"idle"|"send"|"ok"|"err">("idle");
const [msg, setMsg] = useState("");
async function go(e: React.FormEvent) {
e.preventDefault(); setSt("send");
const { error } = await sbBrowser().auth.signInWithOtp({ email: mail.trim(), options: { emailRedirectTo: `${window.location.origin}/auth/callback` } });
if (error) { setSt("err"); setMsg(error.message); } else setSt("ok");
}
return (
<main className="mitte">
<div style={{ width: "100%", maxWidth: 380 }}>
<div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 26, fontWeight: 700, fontSize: "1.1rem" }}>
<svg width="26" height="26" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#0b1b2b"/><path d="M16 6 L26 26 H6 Z" fill="none" stroke="#ff9e2c" strokeWidth="2.5" strokeLinejoin="round"/><circle cx="16" cy="20" r="2.5" fill="#ff9e2c"/></svg>
Belegkette
</div>
{st === "ok" ? (
<div className="card">
<h1 style={{ fontSize: "1rem", marginBottom: 8 }}>Link verschickt</h1>
<p style={{ fontSize: ".9rem", color: "var(--muted)" }}>Wir haben Ihnen einen Anmeldelink an <b>{mail}</b> geschickt.</p>
</div>
) : (
<form onSubmit={go} className="card">
<h1 style={{ fontSize: "1rem", marginBottom: 4 }}>Anmelden</h1>
<p style={{ fontSize: ".88rem", color: "var(--muted)", marginBottom: 18 }}>Sie bekommen einen Link per E-Mail. Kein Passwort nötig.</p>
<label htmlFor="m">E-Mail</label>
<input id="m" type="email" required className="inp" value={mail} onChange={(e) => setMail(e.target.value)} placeholder="name@unternehmen.de" />
{st === "err" && <div className="err">{msg}</div>}
<button className="btn acc" style={{ width: "100%", marginTop: 16 }} disabled={st === "send"}>{st === "send" ? "Wird gesendet ..." : "Anmeldelink anfordern"}</button>
</form>
)}
</div>
</main>
);
}
