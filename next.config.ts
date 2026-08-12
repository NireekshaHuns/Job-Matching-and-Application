import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        /**
         * The LaTeX engine and its TeX Live subset are ~15 MB and pinned: the
         * format file and TeX Live 2019 packages never change, and the WASM
         * engine only changes when we vendor a new build. Without an explicit
         * header Next serves `public/` as must-revalidate, which would mean
         * re-fetching the lot on every visit that opens the Studio.
         */
        source: '/:dir(texlive|swiftlatex)/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ];
  },
};

// Source-map upload only runs in CI when SENTRY_AUTH_TOKEN/org/project are set;
// otherwise this is a harmless pass-through.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.CI,
  disableLogger: true,
});
