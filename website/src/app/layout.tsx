import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SiteNav } from "@/components/SiteNav";
import { SiteFooter } from "@/components/SiteFooter";
import { product } from "@/lib/product";
import "./globals.css";

/* One family, variable in weight and optical size: the text and display cuts
   of the face the app itself is drawn in. Self-hosted by next/font. */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: `${product.name} — ${product.kind.toLowerCase()}`,
    template: `%s — ${product.name}`,
  },
  description: product.description,
  metadataBase: new URL(`https://${product.domain}`),
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-paper text-ink">
        <SiteNav />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
