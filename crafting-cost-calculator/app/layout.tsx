import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "Forever Forge — Crafting intelligence", description: "Know the real cost of every craft in WoW: Forever.", applicationName: "Forever Forge" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
