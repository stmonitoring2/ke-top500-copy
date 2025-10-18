/** @type {import('next').NextConfig} */
const nextConfig = {
  // IMPORTANT: Do NOT set `output: "export"` for apps using Supabase auth.
  reactStrictMode: true,
  experimental: {
    // keep defaults
  },
}

module.exports = nextConfig
