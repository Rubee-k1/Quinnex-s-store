import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/alert";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { getUser } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth-errors";
import { safeRedirectPath } from "@/lib/safe-redirect";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeRedirectPath(typeof params.next === "string" ? params.next : undefined);
  if (await getUser()) redirect(next);
  const error = authErrorMessage(typeof params.error === "string" ? params.error : null);

  return (
    <div className="mx-auto w-full max-w-sm space-y-6 py-4 sm:py-10">
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Sign in</h1>
        <p className="mt-1 text-sm text-neutral-600">Sign in to see your orders on any device.</p>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="space-y-4 rounded-xl border border-neutral-200 bg-white p-5 sm:p-6">
        <GoogleSignInButton next={next} />
        <p className="text-center text-xs text-neutral-500">
          You can still shop and check out without an account.
        </p>
        <p className="text-center text-xs text-neutral-500">
          By continuing you agree to our{" "}
          <Link href="/terms" className="underline hover:text-neutral-900">Terms</Link> and{" "}
          <Link href="/privacy" className="underline hover:text-neutral-900">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}
