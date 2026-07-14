import * as Sentry from '@sentry/nextjs';

// Edge-runtime Sentry (middleware, edge routes). No-op until SENTRY_DSN is set.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 1,
});
