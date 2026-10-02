import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Quinnex Store", template: "%s · Quinnex Store" },
  description: "Thoughtfully made everyday goods.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">{children}</main>
        <footer className="border-t border-neutral-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-neutral-500 sm:px-6">
            © {new Date().getFullYear()} Quinnex Store
          </div>
        </footer>
      </body>
    </html>
  );
}
