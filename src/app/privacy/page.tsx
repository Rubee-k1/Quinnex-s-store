import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, SupportContact } from "@/components/legal-page";
import { getSupportEmail } from "@/lib/env.server";
import { STORE_NAME } from "@/lib/store";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const support = getSupportEmail();
  return (
    <LegalPage title="Privacy Policy" updated="3 October 2026">
      <p>
        This policy explains what personal information {STORE_NAME} collects, why, and what you can do about it.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>When you place an order:</strong> your name, email address, phone number (if you give one) and
          shipping address, plus the products, quantities and prices of your order.
        </li>
        <li>
          <strong>When you sign in with Google:</strong> your name, email address and profile picture, as shared by
          Google. We do not receive your Google password, and we do not access your Gmail, contacts, files or any
          other Google data.
        </li>
        <li>
          <strong>Your cart:</strong> the products you add to your cart.
        </li>
      </ul>

      <h2>How we use it</h2>
      <ul>
        <li>To process and deliver your order and to send you an order confirmation email.</li>
        <li>To let you sign in and see your orders on any device.</li>
        <li>To answer your questions when you contact us.</li>
      </ul>
      <p>We do not sell your personal information, and we do not use it for advertising.</p>

      <h2>Cookies</h2>
      <ul>
        <li>A cart cookie that remembers your cart in this browser for 30 days.</li>
        <li>Sign-in cookies that keep you signed in until you sign out.</li>
      </ul>
      <p>We do not use advertising or tracking cookies.</p>

      <h2>Services we use</h2>
      <p>Your information is stored and processed by these providers on our behalf:</p>
      <ul>
        <li>Supabase: database and sign-in</li>
        <li>Vercel: website hosting</li>
        <li>Mailgun: sending order emails</li>
        <li>Google: &ldquo;Continue with Google&rdquo; sign-in</li>
      </ul>

      <h2>Who can see your orders</h2>
      <p>
        Your orders are visible only to you (in the browser you ordered from, or when signed in to your account)
        and to the store team.
      </p>

      <h2>Keeping and deleting your data</h2>
      <p>
        We keep order records for as long as needed to fulfil orders and meet our legal and accounting
        obligations. You can ask us to access, correct or delete your personal information, or to delete your
        account, by emailing <SupportContact email={support} />.
      </p>

      <h2>Changes</h2>
      <p>If we change this policy, we will update this page and the date above.</p>

      <p>
        See also our <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
