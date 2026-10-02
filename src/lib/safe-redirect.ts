/**
 * Only allow same-origin relative paths as post-login destinations to prevent
 * open redirects (e.g. `?next=https://evil.example` or `?next=//evil.example`).
 */
export function safeRedirectPath(value: unknown, fallback = "/") {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;
  return value;
}
