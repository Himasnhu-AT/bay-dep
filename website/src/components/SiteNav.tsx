"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wrap } from "@/components/layout";
import { product } from "@/lib/product";

/**
 * One product, so the wordmark is the product and the links are its chapters.
 * The status sits beside the name rather than being discovered three pages in.
 */
const links = [
  { href: "/agents", label: "Agents" },
  { href: "/status", label: "Status" },
  { href: "/waitlist", label: "Request access" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-line">
      <Wrap className="flex h-[68px] items-center justify-between">
        <Link href="/" className="flex items-baseline gap-3.5">
          <span className="font-serif text-[24px] font-normal tracking-[0.12em] text-ink">
            {product.name}
          </span>
          <span className="hidden text-eyebrow font-medium text-muted uppercase sm:inline">
            {product.status}
          </span>
        </Link>
        <div className="flex gap-5 sm:gap-[38px]">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`group relative text-[13px] tracking-[0.06em] transition-colors duration-200 hover:text-brass-deep ${
                  active ? "text-brass-deep" : "text-ink-soft"
                }`}
              >
                {link.label}
                {/* A rule wipes in under the link, the way the page rules itself. */}
                <span
                  aria-hidden
                  className={`absolute -bottom-1.5 left-0 h-px w-full origin-left bg-brass-deep transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    active ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                  }`}
                />
              </Link>
            );
          })}
        </div>
      </Wrap>
    </nav>
  );
}
