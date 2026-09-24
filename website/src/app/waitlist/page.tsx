import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";
import { Waitlist } from "@/components/access/Waitlist";
import { Block, PageHeader, Wrap } from "@/components/layout";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Request access",
  description: `${product.name} is by invitation. Join the waitlist with your email address, or sign in with Google to see whether you already have access.`,
};

export default function WaitlistPage() {
  return (
    <main className="flex-1 pb-28">
      <PageHeader
        eyebrow="Request access"
        title="By invitation, for now."
        lead={`${product.name} is ${product.status.toLowerCase()}, and you need an invitation to use it. Put your address on the waitlist; no account is needed.`}
      />
      <Wrap>
        <Reveal delay={0.3} className="mt-16">
          <Waitlist />
        </Reveal>

        <div className="mt-24">
          <Block title="What it will not do" delay={0.12}>
            Nothing on this page talks to anyone until you press a button.
            Joining sends your address to the access list, kept in
            Google&rsquo;s Firestore, and signing in uses Google&rsquo;s
            sign-in service. The list is read by one person. Your address is
            not added to a newsletter, it is not shared, no email is sent to
            it, and nothing on this site counts your visit. In the app, signing
            in with Google checks your access and does nothing else: your
            projects, media and renders stay on your Mac.
          </Block>
        </div>
      </Wrap>
    </main>
  );
}
