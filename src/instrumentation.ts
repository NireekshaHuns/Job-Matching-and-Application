import * as Sentry from '@sentry/nextjs';

/**
 * Next.js instrumentation hook. Loads the right Sentry config per runtime and
 * wires request-error capture. Sentry brings its own OpenTelemetry tracing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
