import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Belegkette", description: "Projektakte fuer Maschinen- und Anlagenbau", robots: { index: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
return <html lang="de"><body>{children}</body></html>;
}
