"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "./ph/navbar";
import { Footer } from "./ph/footer";

export function SiteShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <div className="site-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Navbar
        homeHref="/"
        current={path}
        tone="dark"
        links={[
          { label: "Design badges", href: "/" },
          { label: "Produce", href: "/admin" },
          { label: "3D viewer", href: "/viewer" },
        ]}
      />
      <div id="main">{children}</div>
      <Footer links={[{ label: "Source", href: "https://github.com/purduehackers/badges" }]}>
        Made for Hack Night. Pixel icons by{" "}
        <a href="https://pixeliconlibrary.com/" className="underline">
          HackerNoon
        </a>{" "}
        (CC BY 4.0).
      </Footer>
    </div>
  );
}
