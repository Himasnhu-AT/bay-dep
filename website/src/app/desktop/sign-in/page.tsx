import type { Metadata } from "next";
import { DesktopSignIn } from "@/components/access/DesktopSignIn";
import { Block, PageHeader, Wrap } from "@/components/layout";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Sign in to the app",
  description: `Signs the ${product.name} app on this Mac in.`,
  robots: { index: false, follow: false },
};

export default function DesktopSignInPage() {
  return (
    <main className="flex-1 pb-28">
      <PageHeader
        eyebrow="Sign in"
        title={`Sign in to ${product.name}.`}
        lead="You do this once. After it, the app works offline and checks your access again whenever it is online."
      />
      <Wrap>
        <div className="mt-16">
          <DesktopSignIn />
        </div>

        <div className="mt-24">
          <Block title="What it will not do" delay={0.12}>
            This tab sends your sign-in to one place: the copy of{" "}
            {product.name} waiting on this Mac, at 127.0.0.1. The app then asks
            Google&rsquo;s sign-in service itself whether you have access. It
            does not send your projects, your media or anything about what you
            edit.
          </Block>
        </div>
      </Wrap>
    </main>
  );
}
