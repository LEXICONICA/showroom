import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Showroom | Caja 01",
  description: "Caja atendida integrada con POS, impresión y SAP Business One",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
