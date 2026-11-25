/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  distDir: process.env.TUBELOCK_BUILD_DIR || '.next',
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    const headers = [
      { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
    ];
    if (process.env.NODE_ENV === 'production') {
      headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
    }
    return [{ source: '/:path*', headers }];
  },
  async rewrites() {
    return [
      {
        source: '/@:handle',
        destination: '/channel/:handle',
      },
    ];
  },
};

export default nextConfig;
