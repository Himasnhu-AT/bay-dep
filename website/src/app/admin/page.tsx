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
    <main className="flex-1 pb-28">
      <PageHeader
        eyebrow="Owner"
        title="Who gets in."
      />
      <Wrap>
        <div className="mt-16">
          <Admin />
        </div>
      </Wrap>
    </main>
  );
}
