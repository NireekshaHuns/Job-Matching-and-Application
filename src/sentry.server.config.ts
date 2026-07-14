import * as Sentry from '@sentry/nextjs';

// Server-side Sentry. No-op until SENTRY_DSN is set, so local dev stays quiet.
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: !!process.env.SENTRY_DSN,
  tracesSampleRate: 1,
});
