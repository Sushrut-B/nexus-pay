import type { Metadata } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/manrope";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: {
    default: "Nexus Pay — A clearer home for your money",
    template: "%s · Nexus Pay",
  },
  description:
    "Nexus Pay is a secure personal wallet for everyday money, with a clear balance and a calm, considered experience.",
  applicationName: "Nexus Pay",
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
