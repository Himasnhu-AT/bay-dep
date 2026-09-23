import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { Waitlist } from "@/components/access/Waitlist";
import { Eyebrow, PageHeader, Wrap } from "@/components/layout";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Request access",
  description: `${product.name} is by invitation. Sign in with your email and ask for access, or see whether you already have it.`,
};

export default function WaitlistPage() {
  return (
    <main className="flex-1 pt-24 pb-28">
      <Wrap>
        <PageHeader
          eyebrow="Request access"
          title={
            <>
              By <em className="text-brass italic">invitation</em>, for now.
            </>
          }
          lead={`${product.name} is ${product.status.toLowerCase()}, and you need an invitation to use it. Sign in with your email to ask for one, or to see where your request stands.`}
        />

        <Reveal delay={0.3} className="mt-[82px]">
          <Waitlist />
        </Reveal>

        <Reveal delay={0.12} className="mt-24 max-w-[60ch]">
          <Eyebrow>What it will not do</Eyebrow>
          <p className="mt-6 text-base text-ink-soft">
            Signing in here uses Google&rsquo;s sign-in service, and this is the
            only page on the site that talks to it, and only after you press a
            button. Your address goes on a list that one person reads. It is not
            added to a newsletter, it is not shared, and nothing on this site
            counts your visit. In the app, the same sign-in checks your access
            and does nothing else: your projects, media and renders stay on your
            Mac.
          </p>
        </Reveal>
      </Wrap>
    </main>
  );
}
