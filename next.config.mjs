import path from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Served from a subpath on safestorage.in (cPanel/Passenger), not the domain
  // root. basePath makes all routes, links, and static assets resolve under
  // /agentic-crm so e.g. /agentic-crm/dashboard works.
  basePath: "/agentic-crm",
  // Custom loader prepends basePath to every image src and skips the built-in
  // optimizer (no sharp on the cPanel host). `unoptimized` alone does NOT add
  // basePath to public-asset paths, so the loader is required. See image-loader.js.
  images: {
    loader: "custom",
    loaderFile: "./image-loader.js",
  },
  // Pin the workspace root to this project (a stray lockfile in the home dir
  // was otherwise being inferred as the root).
  turbopack: {
    root: path.resolve(),
  },
};

export default nextConfig;
