import type { AnchorHTMLAttributes } from "react";
import { cn } from "./cn";
import "./nav-link.css";

type NavLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  tone?: "light" | "dark";
};

export function NavLink({ href, tone, className, children, ...rest }: NavLinkProps) {
  const external = /^https?:\/\//.test(href);
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noopener noreferrer" : undefined}
      data-tone={tone}
      className={cn("ph-nav-link", className)}
      {...rest}
    >
      {children}
    </a>
  );
}
