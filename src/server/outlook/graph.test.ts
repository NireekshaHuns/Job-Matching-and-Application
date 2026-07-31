import { describe, expect, it, vi } from 'vitest';
import {
  authorizeUrl,
  buildMessagesUrl,
  buildSendMailPayload,
  exchangeCodeForTokens,
  graphMailClient,
  graphMailSender,
  GRAPH_SCOPES,
  mapGraphMessage,
  refreshAccessToken,
  tokenEndpoint,
} from './graph';

const jsonResponse = (body: unknown, init: { ok?: boolean; status?: number } = {}) =>
  ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as Response;

describe('URL builders', () => {
  it('points the token endpoint at the given tenant', () => {
    expect(tokenEndpoint('consumers')).toBe(
      'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    );
  });

  it('requests Mail.Read, Mail.Send, and offline_access', () => {
    expect(GRAPH_SCOPES).toContain('Mail.Read');
    expect(GRAPH_SCOPES).toContain('Mail.Send');
    expect(GRAPH_SCOPES).toContain('offline_access');
  });

  it('builds an authorize URL with PKCE + offline scope', () => {
    const url = new URL(
      authorizeUrl({
        clientId: 'abc',
        tenant: 'consumers',
        redirectUri: 'http://localhost',
        codeChallenge: 'CHAL',
      }),
    );
    expect(url.pathname).toBe('/consumers/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('abc');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('code_challenge')).toBe('CHAL');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('offline_access');
  });

  it('builds a /me/messages URL filtered and sorted by received date', () => {
    const url = new URL(buildMessagesUrl({ sinceIso: '2026-07-01T00:00:00Z', top: 25 }));
    expect(url.pathname).toBe('/v1.0/me/messages');
    expect(url.searchParams.get('$filter')).toBe('receivedDateTime ge 2026-07-01T00:00:00Z');
    expect(url.searchParams.get('$orderby')).toBe('receivedDateTime desc');
    expect(url.searchParams.get('$top')).toBe('25');
    expect(url.searchParams.get('$select')).toContain('bodyPreview');
  });

  it('percent-encodes OData spaces as %20, never "+"', () => {
    // Graph rejects the `+`-for-space form that URLSearchParams emits by default.
    const raw = buildMessagesUrl({ sinceIso: '2026-07-01T00:00:00Z' });
    expect(raw).toContain('receivedDateTime%20ge%20');
    expect(raw).toContain('receivedDateTime%20desc');
    expect(raw).not.toContain('+');
  });
});

describe('mapGraphMessage', () => {
  it('flattens the nested from.emailAddress and defaults missing fields', () => {
    expect(
      mapGraphMessage({
        id: 'x',
        subject: 'Hi',
        bodyPreview: 'body',
        receivedDateTime: '2026-07-20T10:00:00Z',
        from: { emailAddress: { name: 'Greenhouse', address: 'a@greenhouse-mail.io' } },
      }),
    ).toEqual({
      id: 'x',
      from: { name: 'Greenhouse', address: 'a@greenhouse-mail.io' },
      subject: 'Hi',
      bodyPreview: 'body',
      receivedAt: '2026-07-20T10:00:00Z',
    });
  });

  it('tolerates a missing from block', () => {
    const m = mapGraphMessage({ id: 'y', receivedDateTime: '2026-07-20T10:00:00Z' });
    expect(m.from).toEqual({ name: '', address: '' });
    expect(m.subject).toBe('');
  });
});

describe('refreshAccessToken', () => {
  it('posts the refresh grant and returns the access token', async () => {
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({ access_token: 'AT', expires_in: 3600 }),
    );
    const token = await refreshAccessToken(fetchFn as unknown as typeof fetch, {
      clientId: 'abc',
      refreshToken: 'RT',
      tenant: 'consumers',
    });
    expect(token).toBe('AT');
    const [, init] = fetchFn.mock.calls[0];
    expect(String(init?.body)).toContain('grant_type=refresh_token');
    expect(String(init?.body)).toContain('refresh_token=RT');
  });

  it('throws with the status on a failed token request', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'bad' }, { ok: false, status: 401 }));
    await expect(
      refreshAccessToken(fetchFn as unknown as typeof fetch, {
        clientId: 'abc',
        refreshToken: 'RT',
        tenant: 'consumers',
      }),
    ).rejects.toThrow('401');
  });
});

describe('exchangeCodeForTokens', () => {
  it('returns both tokens on success', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    );
    const out = await exchangeCodeForTokens(fetchFn as unknown as typeof fetch, {
      clientId: 'abc',
      code: 'CODE',
      codeVerifier: 'VER',
      redirectUri: 'http://localhost',
      tenant: 'consumers',
    });
    expect(out).toEqual({ accessToken: 'AT', refreshToken: 'RT' });
  });

  it('fails when no refresh token comes back (missing offline_access)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ access_token: 'AT', expires_in: 3600 }));
    await expect(
      exchangeCodeForTokens(fetchFn as unknown as typeof fetch, {
        clientId: 'abc',
        code: 'CODE',
        codeVerifier: 'VER',
        redirectUri: 'http://localhost',
        tenant: 'consumers',
      }),
    ).rejects.toThrow('offline_access');
  });
});

describe('graphMailClient', () => {
  it('maps a page of messages and sends the bearer token', async () => {
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({
        value: [
          {
            id: 'm1',
            subject: 'Thank you for applying',
            bodyPreview: 'received',
            receivedDateTime: '2026-07-20T10:00:00Z',
            from: { emailAddress: { name: 'GH', address: 'a@greenhouse-mail.io' } },
          },
        ],
      }),
    );
    const client = graphMailClient({
      fetch: fetchFn as unknown as typeof fetch,
      getAccessToken: async () => 'AT',
    });
    const msgs = await client.listMessages({ sinceIso: '2026-07-01T00:00:00Z' });
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('m1');
    const [, init] = fetchFn.mock.calls[0];
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer AT');
  });

  it('follows @odata.nextLink and stops at maxPages', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          value: [{ id: 'a', receivedDateTime: '2026-07-20T10:00:00Z' }],
          '@odata.nextLink': 'https://graph.microsoft.com/next',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ value: [{ id: 'b', receivedDateTime: '2026-07-19T10:00:00Z' }] }),
      );
    const client = graphMailClient({
      fetch: fetchFn as unknown as typeof fetch,
      getAccessToken: async () => 'AT',
      maxPages: 5,
    });
    const msgs = await client.listMessages({ sinceIso: '2026-07-01T00:00:00Z' });
    expect(msgs.map((m) => m.id)).toEqual(['a', 'b']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('refreshes the token and retries once on a 401', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse({ value: [{ id: 'a', receivedDateTime: '2026-07-20T10:00:00Z' }] }),
      );
    const getAccessToken = vi.fn(async () => 'AT');
    const client = graphMailClient({
      fetch: fetchFn as unknown as typeof fetch,
      getAccessToken,
      maxPages: 5,
    });
    const msgs = await client.listMessages({ sinceIso: '2026-07-01T00:00:00Z' });
    expect(msgs.map((m) => m.id)).toEqual(['a']);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('skips items missing id or receivedDateTime', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        value: [
          { id: 'a', receivedDateTime: '2026-07-20T10:00:00Z' },
          { receivedDateTime: '2026-07-19T10:00:00Z' }, // no id
          { id: 'c' }, // no receivedDateTime
        ],
      }),
    );
    const client = graphMailClient({
      fetch: fetchFn as unknown as typeof fetch,
      getAccessToken: async () => 'AT',
    });
    const msgs = await client.listMessages({ sinceIso: '2026-07-01T00:00:00Z' });
    expect(msgs.map((m) => m.id)).toEqual(['a']);
  });
});

describe('buildSendMailPayload', () => {
  it('wraps a plain-text email in the Graph sendMail shape', () => {
    expect(
      buildSendMailPayload({ to: 'jane@acme.com', subject: 'Hi', body: 'Hello there' }),
    ).toEqual({
      message: {
        subject: 'Hi',
        body: { contentType: 'Text', content: 'Hello there' },
        toRecipients: [{ emailAddress: { address: 'jane@acme.com' } }],
      },
      saveToSentItems: true,
    });
  });
});

describe('graphMailSender', () => {
  const email = { to: 'jane@acme.com', subject: 'Hi', body: 'Hello' };

  it('POSTs the payload with a bearer token and resolves on 202', async () => {
    // Graph sendMail returns 202 Accepted with an empty body.
    const fetchFn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () =>
      jsonResponse({}, { status: 202 }),
    );
    const sender = graphMailSender({
      fetch: fetchFn as unknown as typeof fetch,
      getAccessToken: async () => 'AT',
    });
    await expect(sender.sendMail(email)).resolves.toBeUndefined();

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://graph.microsoft.com/v1.0/me/sendMail');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer AT');
    expect((init?.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      message: { toRecipients: [{ emailAddress: { address: 'jane@acme.com' } }] },
    });
  });

  it('refreshes the token and retries once on a 401', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'expired' }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 202 }));
    const getAccessToken = vi.fn(async () => 'AT');
    const sender = graphMailSender({
      fetch: fetchFn as unknown as typeof fetch,
      getAccessToken,
    });
    await expect(sender.sendMail(email)).resolves.toBeUndefined();
    expect(getAccessToken).toHaveBeenCalledTimes(2);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('throws with the status on a non-401 failure', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: 'bad recipient' }, { ok: false, status: 400 }),
    );
    const sender = graphMailSender({
      fetch: fetchFn as unknown as typeof fetch,
      getAccessToken: async () => 'AT',
    });
    await expect(sender.sendMail(email)).rejects.toThrow('400');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
