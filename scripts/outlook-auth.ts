/**
 * One-time Microsoft Graph auth bootstrap (auth-code + PKCE) for the Outlook
 * confirmation poller. Prints a login URL; you sign in with your PERSONAL
 * Microsoft account, get redirected to http://localhost/?code=..., and paste
 * that `code` back here. The script exchanges it and prints the refresh token
 * to store as MS_REFRESH_TOKEN in .env.
 *
 * Prereq: register a free Azure app (App registrations → personal Microsoft
 * accounts; redirect URI http://localhost as a Mobile/desktop public client;
 * delegated Mail.Read + offline_access) and set MS_CLIENT_ID (+ optional
 * MS_TENANT, default `consumers`) in .env.
 *
 * Usage: pnpm outlook:auth
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { authorizeUrl, exchangeCodeForTokens } from '@/server/outlook/graph';

const REDIRECT_URI = 'http://localhost';

const base64url = (buf: Buffer) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const clientId = process.env.MS_CLIENT_ID;
  const tenant = process.env.MS_TENANT || 'consumers';
  if (!clientId) throw new Error('Set MS_CLIENT_ID in .env first (see the header comment).');

  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());

  console.log('\n1) Open this URL, sign in, and approve access:\n');
  console.log(authorizeUrl({ clientId, tenant, redirectUri: REDIRECT_URI, codeChallenge }));
  console.log(
    '\n2) Your browser will redirect to http://localhost/?code=...  (the page itself will not load — that is fine).',
  );
  console.log('   Copy the value of the `code` query parameter from the address bar.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question('Paste the code here: ')).trim();
  rl.close();
  if (!code) throw new Error('No code provided.');

  const { refreshToken } = await exchangeCodeForTokens(fetch, {
    clientId,
    code,
    codeVerifier,
    redirectUri: REDIRECT_URI,
    tenant,
  });

  console.log('\n✅ Success. Add this line to your .env:\n');
  console.log(`MS_REFRESH_TOKEN=${refreshToken}\n`);
}

main().catch((err) => {
  console.error(`\n❌ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
