/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The lead engine and CRM write to a JSON store on the local disk by default,
  // so these routes must run on the Node.js runtime (not the Edge runtime).
  experimental: {},
};

export default nextConfig;
