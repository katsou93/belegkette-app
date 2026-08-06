import type { NextConfig } from "next";

/**
 * Sicherheits-Header.
 *
 * Der Inhalt dieser Anwendung ist Beweismaterial aus laufenden Projekten.
 * Ein einziger eingeschleuster Skriptaufruf könnte ihn abziehen, und ein
 * Rahmenfenster auf einer fremden Seite könnte Klicks abfangen. Beides
 * kostet hier nichts zu verhindern.
 *
 * Zur CSP: 'unsafe-inline' für Skripte ist bei Next.js im App Router ohne
 * Nonce-Middleware leider nötig — der Hydrations-Code wird inline
 * eingebettet. Wer das schließen will, braucht eine Nonce in der
 * Middleware. Das ist der einzige bewusst offene Punkt, und er steht
 * hier, damit ihn niemand übersieht.
 */
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase} ${supabase.replace("https://", "wss://")}`.trim(),
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const header = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Ein fehlgeschlagener Übersetzer- oder Lint-Lauf muss den Build stoppen.
  // Next.js lässt sich hier weichspülen; das wollen wir ausdrücklich nicht.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  async headers() {
    return [{ source: "/:path*", headers: header }];
  },
};

export default nextConfig;
