import type { Metadata } from "next";
import { FinishLink } from "@/components/access/FinishLink";
import { PageHeader, Wrap } from "@/components/layout";

export const metadata: Metadata = {
  title: "Signing in",
  description: "Finishes a sign-in from an email link.",
  robots: { index: false, follow: false },
};

export default function FinishPage() {
  return (
    <main className="flex-1 pt-24 pb-28">
      <Wrap>
        <PageHeader
          eyebrow="Sign in"
          title={
            <>
              Finishing your <em className="text-brass italic">sign-in</em>.
            </>
          }
        />
        <div className="mt-[82px]">
          <FinishLink />
        </div>
      </Wrap>
    </main>
  );
}
