import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { DesktopSignIn } from "@/components/access/DesktopSignIn";
import { Eyebrow, PageHeader, Wrap } from "@/components/layout";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Sign in to the app",
  description: `Signs the ${product.name} app on this Mac in.`,
  robots: { index: false, follow: false },
};

export default function DesktopSignInPage() {
  return (
    <main className="flex-1 pt-24 pb-28">
      <Wrap>
        <PageHeader
          eyebrow="Sign in"
          title={
            <>
              Sign in to <em className="text-brass italic">{product.name}</em>.
            </>
          }
          lead="You do this once. After it, the app works offline and checks your access again whenever it is online."
        />
        <div className="mt-[82px]">
          <DesktopSignIn />
        </div>

        <Reveal delay={0.12} className="mt-24 max-w-[60ch]">
          <Eyebrow>What it will not do</Eyebrow>
          <p className="mt-6 text-base text-ink-soft">
            This tab sends your sign-in to one place: the copy of{" "}
            {product.name} waiting on this Mac, at 127.0.0.1. The app then asks
            Google&rsquo;s sign-in service itself whether you have access. It
            does not send your projects, your media or anything about what you
            edit.
          </p>
        </Reveal>
      </Wrap>
    </main>
  );
}
