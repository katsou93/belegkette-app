import Link from "next/link";
import { sbServer } from "@/lib/server";
import { euro } from "@/lib/browser";
import { NeueGegenseite } from "@/components/stamm";
import { Seitenleiste } from "@/components/nav";
export const dynamic = "force-dynamic";

type Kennzahl = {
  customer_id: string; projekte_gesamt: number; projekte_aktiv: number;
  projekte_abgeschlossen: number; vermerke_gesamt: number; abweichungen: number;
  abweichungen_offen: number; wert_offen: number; wert_erledigt: number;
};

export default async function Kunden() {
  const sb = await sbServer();
  const { data: kunden } = await sb.from("customers").select("id,name,domains").order("name");
  const { data: kz } = await sb.from("kunden_kennzahlen").select("*");
  const zahl = (id: string) => (kz ?? []).find((k) => (k as Kennzahl).customer_id === id) as Kennzahl | undefined;

  return (
    <div className="shell">
      <Seitenleiste aktiv="kunden" />
      <main className="main">
        <div className="head">
          <div><h1>Auftraggeber</h1><div className="sub">{kunden?.length ?? 0} angelegt</div></div>
          <NeueGegenseite tabelle="customers" titel="Auftraggeber anlegen" />
        </div>
        {!kunden?.length ? (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)", fontSize: ".9rem" }}>
            Noch kein Auftraggeber angelegt. Sobald einer hinterlegt ist, sammeln sich seine Projekte hier.
          </div>
        ) : (
          <table>
            <thead><tr><th>Auftraggeber</th><th className="num">Projekte</th><th className="num">Vermerke</th><th className="num">Abweichungen offen</th><th className="num">Wert offen</th></tr></thead>
            <tbody>
              {kunden.map((k) => {
                const z = zahl(k.id);
                return (
                  <tr key={k.id}>
                    <td style={{ fontWeight: 600 }}><Link href={`/kunden/${k.id}`}>{k.name}</Link></td>
                    <td className="num">{z?.projekte_gesamt ?? 0}</td>
                    <td className="num">{z?.vermerke_gesamt ?? 0}</td>
                    <td className="num">{z?.abweichungen_offen ? <span className="tag t-ja">{z.abweichungen_offen}</span> : <span style={{ color: "var(--muted)" }}>-</span>}</td>
                    <td className="num">{z?.wert_offen ? euro(Number(z.wert_offen)) : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
