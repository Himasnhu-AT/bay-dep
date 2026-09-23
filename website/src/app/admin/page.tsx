import type { Metadata } from "next";
import { Admin } from "@/components/access/Admin";
import { PageHeader, Wrap } from "@/components/layout";

export const metadata: Metadata = {
  title: "Access",
  description: "The waitlist and the grants.",
  robots: { index: false, follow: false },
};

/** Not linked from anywhere. The Firestore rules, not this page, decide who can use it. */
export default function AdminPage() {
  return (
    <main className="flex-1 pt-24 pb-28">
      <Wrap>
        <PageHeader
          eyebrow="Owner"
          title={
            <>
              Who gets <em className="text-brass italic">in</em>.
            </>
          }
        />
        <div className="mt-[82px]">
          <Admin />
        </div>
      </Wrap>
    </main>
  );
}
