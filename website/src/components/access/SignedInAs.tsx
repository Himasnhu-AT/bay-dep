"use client";

import type { User } from "firebase/auth";
import { ActionButton } from "@/components/layout";

/** The signed-in line, with the way out. */
export function SignedInAs({
  user,
  onSignOut,
}: {
  user: User;
  onSignOut: () => void;
}) {
  return (
    <p className="mb-10 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm text-muted">
      <span>Signed in as {user.email}</span>
      <ActionButton quiet onClick={onSignOut}>
        Sign out
      </ActionButton>
    </p>
  );
}
