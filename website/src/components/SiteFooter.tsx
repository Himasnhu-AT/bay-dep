import Link from "next/link";
import { Wrap } from "@/components/layout";
import { product } from "@/lib/product";

export function SiteFooter() {
  return (
    <footer className="border-t border-line py-[30px]">
      <Wrap className="flex flex-wrap items-center justify-between gap-5">
        <div className="text-xs tracking-[0.04em] text-muted">
          © {product.year} {product.name}, a{" "}
          <a
            href={product.studio.url}
            className="transition-colors hover:text-brass-deep"
          >
            {product.studio.name}
          </a>{" "}
          app
        </div>
        <div className="flex gap-8">
          <Link
            href="/status"
            className="text-[13px] tracking-[0.06em] text-ink-soft transition-colors hover:text-brass-deep"
          >
            Status
          </Link>
          <a
            href={`mailto:${product.email}`}
            className="text-[13px] tracking-[0.06em] text-ink-soft transition-colors hover:text-brass-deep"
          >
            {product.email}
          </a>
        </div>
      </Wrap>
    </footer>
  );
}
