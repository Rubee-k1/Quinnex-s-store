import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportContact } from "@/components/legal-page";
import { getSupportEmail } from "@/lib/env.server";
import { STORE_NAME } from "@/lib/store";

export const metadata: Metadata = { title: "Terms of Service" };

export default function TermsPage() {
  const support = getSupportEmail();
  return (
    <LegalPage title="Terms of Service" updated="3 October 2026">
      <p>By using {STORE_NAME} you agree to these terms.</p>

      <h2>Orders</h2>
      <ul>
        <li>Prices are shown on each product and confirmed at checkout. The order total is calculated by us.</li>
        <li>An order is subject to availability. If we cannot fulfil it, we will contact you.</li>
        <li>You will receive an order confirmation email after placing an order.</li>
      </ul>

      <h2>Your account</h2>
      <p>
        Signing in is optional. If you sign in with Google, you are responsible for the security of your Google
        account. You can sign out at any time.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not misuse the site, place fraudulent orders, or try to access other people&rsquo;s information.</p>

      <h2>Your information</h2>
      <p>
        How we handle personal information is described in our <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. The date above shows when they last changed.</p>

      <h2>Contact</h2>
      <p>
        Questions? Email <SupportContact email={support} />.
      </p>
    </LegalPage>
  );
}
