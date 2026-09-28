/**
 * This site sells one thing. Everything nameable about it lives here: the name
 * itself, the domain, the honest status. A rename is one edit to one file.
 *
 * The name is a variable, not a literal. Never type it into a component, a class
 * name, or a metadata string.
 */

export type Product = {
  name: string;
  /** What it is, in the words you would use to a colleague. Sentence fragment. */
  kind: string;
  /** Kept honest: what the project is today, never what it will be. */
  status: "Shipping" | "In beta" | "In development" | "Early";
  /** One sentence. Used for search results and social cards. */
  description: string;
  domain: string;
  email: string;
  year: number;
  /**
   * Where the Download button goes: this site's own `/download`, which redirects
   * to the newest notarized disk image. Absent when there is no build, and the
   * UI then renders no button rather than a dead or coming-soon one.
   */
  download?: string;
  /** The studio that makes it. A credit in the footer, not a parent brand. */
  studio: { name: string; url: string };
};

export const product: Product = {
  name: "Bay",
  kind: "A video editor for the Mac",
  status: "In development",
  description:
    "Bay is a video editor for the Mac. The timeline you cut on is the one an agent edits over the Model Context Protocol, and every change it makes lands on your undo stack.",
  domain: "bay.himanshuat.com",
  email: "hello@himanshuat.com",
  year: 2026,
  download: "/download",
  studio: { name: "Himanshu", url: "https://himanshuat.com" },
};
