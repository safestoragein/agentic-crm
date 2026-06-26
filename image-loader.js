// Custom next/image loader.
//
// The app is served from a subpath (/agentic-crm) via cPanel/Passenger, and the
// host has no sharp, so the built-in optimizer is unusable. This loader skips
// optimization and points each image straight at its real file under basePath,
// which the default `unoptimized` path fails to do for public assets.
export default function basePathImageLoader({ src }) {
  // Leave absolute/external URLs alone.
  if (/^https?:\/\//i.test(src)) return src;
  // Already prefixed? don't double up.
  if (src.startsWith("/agentic-crm/")) return src;
  return `/agentic-crm${src.startsWith("/") ? "" : "/"}${src}`;
}
