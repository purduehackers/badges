"use client";

import { useEffect, useState } from "react";
import { cn } from "./cn";
import { Glider } from "./glider";
import { NavLink } from "./nav-link";
import "./navbar.css";

type NavItem = {
  label: string;
  href: string;
};

type NavbarProps = {
  links: NavItem[];
  homeHref?: string;
  tone?: "light" | "dark";
  current?: string;
  className?: string;
};

export function Navbar({ links, homeHref = "/", tone, current, className }: NavbarProps) {
  const [open, setOpen] = useState(false);
  const external = (href: string) => /^https?:\/\//.test(href);

  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      data-tone={tone}
      data-menu-open={open ? "" : undefined}
      className={cn("ph-navbar relative z-30", className)}
    >
      <div className="ph-navbar__bar relative z-30 flex items-center justify-between px-6 py-5 md:px-8 md:py-6">
        <a
          href={homeHref}
          aria-label="Purdue Hackers home"
          className="inline-flex text-current transition-opacity hover:opacity-70"
        >
          <Glider className="size-8" />
        </a>
        <nav className="hidden gap-8 md:flex">
          {links.map((l) => (
            <NavLink
              key={l.href}
              href={l.href}
              aria-current={current === l.href ? "page" : undefined}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
          className="ph-navbar__burger ml-auto flex size-10 cursor-pointer flex-col items-center justify-center gap-1.5 md:hidden"
        >
          <span className="ph-navbar__burger-line" aria-hidden="true" />
          <span className="ph-navbar__burger-line" aria-hidden="true" />
          <span className="ph-navbar__burger-line" aria-hidden="true" />
        </button>
      </div>
      <div
        data-open={open ? "" : undefined}
        aria-hidden={!open}
        inert={!open}
        className="ph-navbar__menu fixed inset-0 z-20 bg-ph-black md:hidden"
      >
        <nav className="flex min-h-full flex-col justify-center gap-6 px-8 py-24">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target={external(l.href) ? "_blank" : undefined}
              rel={external(l.href) ? "noopener noreferrer" : undefined}
              onClick={() => setOpen(false)}
              className="ph-navbar__menu-link"
            >
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
