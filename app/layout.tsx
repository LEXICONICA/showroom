import type { Metadata } from "next";
import "./globals.css";

export function generateMetadata(): Metadata {
  const caja = (process.env.CAJA_ID || "CAJA01").trim().toUpperCase().replace(/^CAJA(\d+)$/, "Caja $1");
  return {
    title: `Showroom | ${caja}`,
    description: "Caja atendida integrada con POS, impresión y SAP Business One",
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
