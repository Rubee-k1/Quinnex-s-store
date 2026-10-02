/** Friendly messages for /login?error=<code>. Unknown codes get a generic message. */
const MESSAGES: Record<string, string> = {
  access_denied: "Google sign-in was cancelled. You can try again whenever you're ready.",
  oauth_start: "We couldn't start Google sign-in. Please try again in a moment.",
  callback: "We couldn't complete your sign-in. Please try again.",
  missing_code: "The sign-in link was incomplete or has expired. Please try again.",
  session: "Your session has expired. Please sign in again.",
};

export function authErrorMessage(code: string | undefined | null): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? "Something went wrong while signing in. Please try again.";
}
