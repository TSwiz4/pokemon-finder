import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PokemonFinder - Restock Tracker",
  description: "Track Pokemon card restocks at local retail stores",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
