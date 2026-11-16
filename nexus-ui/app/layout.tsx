import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { Shell } from "@/components/layout/Shell";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Nexus Clearing — Autonomous Real-Time Settlement Network",
  description:
    "Enterprise-grade instant settlement platform backed by Raftline distributed consensus with strictly-once execution across FedNow, SEPA Instant, and UPI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} dark`}>
      <body className="bg-[#080C14] text-[#F1F5F9] antialiased selection:bg-[#10B981]/30 selection:text-white">
        <QueryProvider>
          <Shell>{children}</Shell>
        </QueryProvider>
      </body>
    </html>
  );
}

