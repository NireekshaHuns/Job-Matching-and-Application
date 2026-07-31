/**
 * Microsoft Graph mail client for the confirmation poller. Plain OAuth2 over
 * `fetch` (no MSAL dependency) to stay in the repo's injected-client style: the
 * URL builders and the Graph-JSON → OutlookMessage mapper are pure and tested,
 * and every network call takes an injected `fetch` so the client is exercised
 * with a fake offline.
 *
 * Delegated flow on a PERSONAL Microsoft account (tenant `consumers`), scopes
 * `Mail.Read offline_access`. A one-time auth-code+PKCE bootstrap
 * (`scripts/outlook-auth.ts`) mints the refresh token stored in `.env`.
 */
import type { MailClient, OutlookMessage } from './types';

type FetchFn = typeof fetch;

/** Delegated scopes: read mail + get a refresh token. */
export const GRAPH_SCOPES = 'Mail.Read offline_access';
const GRAPH_MESSAGES_ENDPOINT = 'https://graph.microsoft.com/v1.0/me/messages';

/** OAuth2 token endpoint for the given tenant (`consumers` = personal accounts). */
export function tokenEndpoint(tenant: string): string {
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

/**
 * Authorize URL for the one-time interactive login (auth-code + PKCE). No CSRF
 * `state` param: this is a local manual-paste flow (redirect to http://localhost,
 * user copies the code by hand), so there's no cross-site callback to protect.
 */
export function authorizeUrl(opts: {
  clientId: string;
  tenant: string;
  redirectUri: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.clientId,
    response_type: 'code',
    redirect_uri: opts.redirectUri,
    response_mode: 'query',
    scope: GRAPH_SCOPES,
    code_challenge: opts.codeChallenge,
    code_challenge_method: 'S256',
  });
  return `https://login.microsoftonline.com/${opts.tenant}/oauth2/v2.0/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function postToken(
  fetchFn: FetchFn,
  tenant: string,
  form: Record<string, string>,
): Promise<TokenResponse> {
  const res = await fetchFn(tokenEndpoint(tenant), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    throw new Error(`Graph token request failed (${res.status}): ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange a fresh refresh token for a short-lived access token. */
export async function refreshAccessToken(
  fetchFn: FetchFn,
  opts: { clientId: string; refreshToken: string; tenant: string },
): Promise<string> {
  const token = await postToken(fetchFn, opts.tenant, {
    client_id: opts.clientId,
    grant_type: 'refresh_token',
    refresh_token: opts.refreshToken,
    scope: GRAPH_SCOPES,
  });
  return token.access_token;
}

/** Exchange the one-time auth code for tokens (used by the bootstrap script). */
export async function exchangeCodeForTokens(
  fetchFn: FetchFn,
  opts: {
    clientId: string;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    tenant: string;
  },
): Promise<{ accessToken: string; refreshToken: string }> {
  const token = await postToken(fetchFn, opts.tenant, {
    client_id: opts.clientId,
    grant_type: 'authorization_code',
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
    scope: GRAPH_SCOPES,
  });
  if (!token.refresh_token)
    throw new Error('No refresh_token returned — did you request offline_access?');
  return { accessToken: token.access_token, refreshToken: token.refresh_token };
}

/**
 * Build a `/me/messages` URL that asks only for the fields the detector needs,
 * OLDEST first, filtered to messages received on/after `sinceIso`.
 *
 * Oldest-first is deliberate (issue #43): the window is anchored at the earliest
 * pending application, and confirmations for the earliest-applied roles live at
 * the OLD end. If the mailbox is busy enough to hit the page cap, paging
 * oldest-first drops the newest tail — which is recoverable on a later run as
 * older apps get confirmed and the window advances — rather than stranding the
 * oldest confirmations indefinitely behind the cap.
 */
export function buildMessagesUrl(opts: { sinceIso: string; top?: number }): string {
  const params = new URLSearchParams({
    $select: 'id,subject,bodyPreview,from,receivedDateTime',
    $filter: `receivedDateTime ge ${opts.sinceIso}`,
    $orderby: 'receivedDateTime asc',
    $top: String(opts.top ?? 50),
  });
  // URLSearchParams encodes spaces as `+`, but OData ($filter/$orderby) requires
  // `%20` in the query component — Graph rejects the `+` form. Fix it here.
  return `${GRAPH_MESSAGES_ENDPOINT}?${params.toString().replace(/\+/g, '%20')}`;
}

/** Shape of a Graph message with the fields we `$select`. */
interface GraphMessage {
  id: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
}

/** Map a raw Graph message to the detector's `OutlookMessage`. Pure. */
export function mapGraphMessage(m: GraphMessage): OutlookMessage {
  const email = m.from?.emailAddress ?? {};
  return {
    id: m.id,
    from: { name: email.name ?? '', address: email.address ?? '' },
    subject: m.subject ?? '',
    bodyPreview: m.bodyPreview ?? '',
    receivedAt: m.receivedDateTime,
  };
}

interface MessagesPage {
  value: GraphMessage[];
  '@odata.nextLink'?: string;
}

/**
 * A `MailClient` backed by Graph. `getAccessToken` is injected (typically a
 * `refreshAccessToken` closure) so token handling is testable and the client
 * itself is stateless. Follows `@odata.nextLink` up to `maxPages`.
 */
export function graphMailClient(deps: {
  fetch: FetchFn;
  getAccessToken: () => Promise<string>;
  maxPages?: number;
}): MailClient {
  return {
    async listMessages({ sinceIso }) {
      let accessToken = await deps.getAccessToken();
      const maxPages = deps.maxPages ?? 10;
      const messages: OutlookMessage[] = [];
      let url: string | undefined = buildMessagesUrl({ sinceIso });

      const get = (u: string) =>
        deps.fetch(u, { headers: { authorization: `Bearer ${accessToken}` } });

      for (let page = 0; url && page < maxPages; page++) {
        let res: Response = await get(url);
        // The access token can expire mid-run on a large mailbox; refresh once
        // and retry the page. (Throttling — 429 with Retry-After — is left to
        // the caller/poller to handle by re-running later.)
        if (res.status === 401) {
          accessToken = await deps.getAccessToken();
          res = await get(url);
        }
        if (!res.ok) {
          throw new Error(`Graph messages request failed (${res.status}): ${await res.text()}`);
        }
        const body = (await res.json()) as MessagesPage;
        // Skip malformed items so a missing id/receivedDateTime never becomes a
        // bogus `confirmedAt` downstream.
        for (const m of body.value ?? []) {
          if (m.id && m.receivedDateTime) messages.push(mapGraphMessage(m));
        }
        url = body['@odata.nextLink'];
      }

      // A leftover nextLink means we stopped at the page cap with more mail
      // unread. We page OLDEST-first, so the dropped tail is the NEWEST in the
      // window — recoverable on a later run once older pending apps get confirmed
      // and the window advances. Surface it so truncation is observable in the
      // reconcile stats, not just a buried warn.
      const truncated = Boolean(url);
      if (truncated) {
        console.warn(
          `graphMailClient: hit maxPages=${maxPages}; newest messages since ${sinceIso} were not fetched this run`,
        );
      }
      return { messages, truncated };
    },
  };
}
