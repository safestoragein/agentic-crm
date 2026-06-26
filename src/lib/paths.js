// Prefix internal links with the app's basePath.
//
// Next.js auto-prefixes <Link> and router.push with basePath, but PLAIN <a>
// tags do NOT — so an `<a href="/customer/123">` navigates to /customer/123
// (404) instead of /agentic-crm/customer/123. Use appHref() on any raw anchor
// or custom button that renders an <a>.
//
// MUST match `basePath` in next.config.mjs. Idempotent (safe to apply twice)
// and leaves full URLs / mailto / tel / anchors untouched.
const BASE = "/agentic-crm";

export function appHref(href) {
  if (!href || typeof href !== "string") return href;
  if (/^(https?:|mailto:|tel:|#)/.test(href) || href.startsWith("//")) return href;
  if (href === BASE || href.startsWith(BASE + "/")) return href; // already prefixed
  if (href.startsWith("/")) return BASE + href;
  return href; // relative / other — leave as-is
}
