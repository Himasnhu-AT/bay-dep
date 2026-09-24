"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wrap } from "@/components/layout";
import { product } from "@/lib/product";

/**
 * One product, so the wordmark is the product and the links are its chapters.
 * The status sits beside the name rather than being discovered three pages in.
 *
 * The bar is night on every page: the site is bound between the app's dark,
 * with the nav above and the footer below, and paper inside. See DESIGN.md.
 */
const links = [
  { href: "/agents", label: "Agents" },
  { href: "/status", label: "Status" },
  { href: "/waitlist", label: "Request access" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-night-line bg-night">
      <Wrap className="flex h-14 items-center justify-between gap-6">
        <Link href="/" className="flex items-baseline gap-3">
          <span className="text-[19px] font-semibold tracking-[-0.02em] text-on-night">
            {product.name}
          </span>
          <span className="hidden text-xs text-on-night-muted sm:inline">
            {product.status}
          </span>
        </Link>
        <div className="flex gap-5 sm:gap-8">
          {links.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={`group relative text-[13px] transition-colors duration-200 hover:text-on-night ${
                  active ? "text-on-night" : "text-on-night-soft"
                }`}
              >
                {link.label}
                {/* A rule wipes in under the link, the way the page rules itself. */}
                <span
                  aria-hidden
                  className={`absolute -bottom-1.5 left-0 h-px w-full origin-left bg-accent transition-transform duration-300 ease-paper ${
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
