import type { ReactNode } from "react";
import { cn } from "./cn";
import { Glider } from "./glider";
import { Link } from "./link";

type FooterProps = {
  links?: { label: string; href: string }[];
  children?: ReactNode;
  className?: string;
};

export function Footer({ links = [], children, className }: FooterProps) {
  return (
    <footer className={cn("flex flex-col gap-6 border-t border-foreground py-8", className)}>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-end gap-3">
          <Glider className="size-8" />
          <span className="ph-headline text-3xl">Purdue Hackers</span>
        </div>
        {links.length > 0 && (
          <nav className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-[13px] uppercase">
            {links.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {children && <div className="text-[13px] leading-[1.5]">{children}</div>}
    </footer>
  );
}
