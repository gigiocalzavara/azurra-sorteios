import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Azurra Sorteios",
  description: "Gestão inteligente de promoções, cotas e sorteios."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
