import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Badges · Purdue Hackers", template: "%s · Purdue Hackers" },
  icons: { icon: "/ph.svg" },
  description: "Design, check, and make Hack Night badges and stamps.",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: "dark" }}>
      <body>
        <SiteShell>{children}</SiteShell>
      </body>
    </html>
  );
}
