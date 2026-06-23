/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The browser only ever talks to same-origin /api/* routes; those proxy to the
  // Python backend (PRINTO_API_URL) server-side. Allow larger uploads through the
  // Next.js server actions / route handlers.
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
