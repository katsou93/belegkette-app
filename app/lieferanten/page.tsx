import { sbServer } from "@/lib/server";
import { NeueGegenseite } from "@/components/stamm";
import { Seitenleiste } from "@/components/nav";
export const dynamic = "force-dynamic";

export default async function Lieferanten() {
  const sb = await sbServer();
  const { data: liste } = await sb.from("suppliers").select("id,name,domains").order("name");
  return (
    <div className="shell">
      <Seitenleiste aktiv="lieferanten" />
      <main className="main">
        <div className="head">
          <div><h1>Lieferanten</h1><div className="sub">{liste?.length ?? 0} angelegt</div></div>
          <NeueGegenseite tabelle="suppliers" titel="Lieferant anlegen" />
        </div>
        <div className="hinweis">
          Dieselbe Akte für die Einkaufsseite: unberechtigte Nachträge von Zulieferern mit Beleg zurückweisen — und Verzug weiterreichen, statt ihn zu tragen.
        </div>
        {!liste?.length ? (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: ".9rem" }}>Noch kein Lieferant angelegt.</div>
        ) : (
          <table>
            <thead><tr><th>Lieferant</th><th>Domains</th></tr></thead>
            <tbody>{liste.map((l) => (
              <tr key={l.id}><td style={{ fontWeight: 600 }}>{l.name}</td><td>{l.domains?.join(", ") || "-"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </main>
    </div>
  );
}
