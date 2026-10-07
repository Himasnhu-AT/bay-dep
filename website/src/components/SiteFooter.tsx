import Link from "next/link";
import { Wrap } from "@/components/layout";
import { product } from "@/lib/product";

const LINK =
  "text-[13px] text-on-night-soft transition-colors duration-200 hover:text-on-night";

/** Night, like the nav: the other cover of the page. */
export function SiteFooter() {
  return (
    <footer className="bg-night py-10">
      <Wrap className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px] text-on-night-muted">
          © {product.year} {product.name}, a{" "}
          <a
            href={product.studio.url}
            className="text-on-night-soft underline decoration-on-night-muted/50 underline-offset-4 transition-colors hover:text-on-night"
          >
            {product.studio.name}
          </a>{" "}
          app
        </div>
        <div className="flex flex-wrap gap-x-7 gap-y-3">
          <Link href="/agents" className={LINK}>
            Agents
          </Link>
          <Link href="/status" className={LINK}>
            Status
          </Link>
          <Link href="/compare" className={LINK}>
            Compare
          </Link>
          {product.download ? (
            <a href={product.download} className={LINK}>
              Download
            </a>
          ) : null}
          <a href={`mailto:${product.email}`} className={LINK}>
            {product.email}
          </a>
        </div>
      </Wrap>
    </footer>
  );
}
