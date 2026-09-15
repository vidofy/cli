/**
 * `vidofy auth login` — the browser flow, from this machine.
 *
 * /en/cli: "Run `vidofy auth login` and it opens your browser, you approve
 * once, and the token is stored in ~/.vidofy/ on that machine. Nothing to copy
 * into a config file."
 *
 * ── The shape, and where each rule comes from ───────────────────────────────
 *
 *   1. Start a one-request HTTP server on 127.0.0.1, on the first free port of
 *      LOOPBACK_PORTS.
 *   2. Open the browser at {base}/mcp-app/authorize with client_id pointing at
 *      our own hosted metadata document, plus PKCE.
 *   3. The person approves on a page served by vidofy.ai, where their existing
 *      session cookie identifies them. This program never sees a password.
 *   4. The browser lands back on 127.0.0.1 with `code`; the little server takes
 *      it, answers the browser with a page saying "you can close this", and
 *      stops listening.
 *   5. POST the code + verifier to /mcp-app/token, receive `access_token`, and
 *      write it to ~/.vidofy/.
 *
 * Every parameter below was read off the server's own implementation rather
 * than a spec: authorize.ts requires code_challenge and refuses any
 * code_challenge_method other than S256; token.ts requires grant_type,
 * code, code_verifier, client_id and redirect_uri.
 *
 * ── Why the ports are a fixed list ─────────────────────────────────────────
 * The server matches redirect_uri EXACTLY against the list in the metadata
 * document (redirectUriAllowed → includes()), so a random OS-assigned port can
 * never be in it. Owner's decision 2026-09-14: publish five and take the first
 * free one. THIS LIST AND THE ONE THE SERVER PUBLISHES IN ITS CLIENT METADATA
 * DOCUMENT ARE ONE CONTRACT — a port here that is not there fails as
 * "redirect_uri is not listed in the client_id document", which names neither.
 *
 * ── 127.0.0.1, never "localhost" ───────────────────────────────────────────
 * The name can resolve to ::1, or be pointed elsewhere by a hosts entry, and
 * the exact-match would then refuse a URI that looks right. RFC 8252 §7.3 also
 * prefers the literal address for exactly this reason.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
/* NOT @vidofy/mcp's `request`, and that is deliberate: it prefixes every path
   with /app/v1 and attaches a bearer token. The OAuth endpoints live outside
   that prefix and this is the one call in the program made BEFORE a token
   exists, so it is the one place a bare fetch is correct. */
import { resolveBaseUrl } from '@vidofy/mcp/config';
import { writeCredentials } from '../credentials.js';
import { VERSION } from '../version.js';
import { note, ok, dim, bold } from '../ui.js';

/** Keep in step with the port list in the server's client metadata document. */
const LOOPBACK_PORTS = [7421, 7422, 7423, 7424, 7425] as const;

/** How long we wait for the person to finish in the browser. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

const b64url = (b: Buffer): string =>
    b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function loginCommand(): Promise<number> {
    const baseUrl = resolveBaseUrl(process.env);

    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(16));

    const { server, port } = await listenOnFirstFreePort();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authorizeUrl = new URL(`${baseUrl}/mcp-app/authorize`);
    authorizeUrl.searchParams.set('response_type', 'code');
    authorizeUrl.searchParams.set('client_id', `${baseUrl}/.well-known/vidofy-cli-client.json`);
    authorizeUrl.searchParams.set('redirect_uri', redirectUri);
    authorizeUrl.searchParams.set('state', state);
    authorizeUrl.searchParams.set('code_challenge', challenge);
    authorizeUrl.searchParams.set('code_challenge_method', 'S256');
    // Declared so the token is bound to this server as its audience. authorize.ts
    // tolerates its absence but checks it when present, and a token that names
    // its resource is the one shape a connector will accept later.
    authorizeUrl.searchParams.set('resource', `${baseUrl}/mcp-app`);

    note(`${bold('Opening your browser')} to approve this computer.`);
    note(dim(authorizeUrl.toString()));
    note();
    note(dim('If it did not open, paste that URL yourself. Waiting…'));

    openBrowser(authorizeUrl.toString());

    let code: string;
    try {
        code = await waitForCode(server, state);
    } finally {
        server.close();
    }

    // The token exchange. `request` is @vidofy/mcp's, so the retry and error
    // handling are the audited ones — but the OAuth endpoints are NOT under the
    // /app/v1 prefix it normally adds, so this one call goes out directly.
    const tokenUrl = `${baseUrl}/mcp-app/token`;
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        client_id: `${baseUrl}/.well-known/vidofy-cli-client.json`,
        redirect_uri: redirectUri,
    });

    const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            accept: 'application/json',
            'user-agent': `vidofy-cli/${VERSION}`,
        },
        body: body.toString(),
    });

    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        const err = typeof payload['error'] === 'string' ? payload['error'] : String(res.status);
        const desc = typeof payload['error_description'] === 'string'
            ? payload['error_description'] : 'the token exchange was refused.';
        throw new Error(`Sign-in failed (${err}): ${desc}`);
    }

    const token = typeof payload['access_token'] === 'string' ? payload['access_token'] : '';
    if (token === '') throw new Error('The server did not return an access token.');

    const file = await writeCredentials({
        token,
        baseUrl,
        signedInAt: new Date().toISOString(),
    });

    ok(`Signed in. Token written to ${file}`);
    note(dim('Try: vidofy balance'));
    return 0;
}

/**
 * Take the first port in the list that is free.
 *
 * EADDRINUSE is the only error worth stepping over — anything else (a sandbox
 * refusing to bind, for instance) would repeat five times and bury the real
 * message under four copies of itself.
 */
async function listenOnFirstFreePort(): Promise<{ server: ReturnType<typeof createServer>; port: number }> {
    const busy: number[] = [];
    for (const port of LOOPBACK_PORTS) {
        const server = createServer();
        try {
            await new Promise<void>((resolve, reject) => {
                server.once('error', reject);
                server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
            });
            if (busy.length > 0) note(dim(`Port ${busy.join(', ')} busy — using ${port}.`));
            return { server, port };
        } catch (err) {
            server.close();
            if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
            busy.push(port);
        }
    }
    throw new Error(
        `All of ${LOOPBACK_PORTS.join(', ')} are in use. Free one and run \`vidofy auth login\` again — `
        + 'these five are the only ports the sign-in page will redirect to.'
    );
}

function waitForCode(server: ReturnType<typeof createServer>, expectedState: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('Timed out waiting for approval in the browser.'));
        }, APPROVAL_TIMEOUT_MS);

        server.on('request', (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url ?? '/', 'http://127.0.0.1');
            if (url.pathname !== '/callback') { reply(res, 404, 'Not found.'); return; }

            const err = url.searchParams.get('error');
            if (err !== null) {
                const desc = url.searchParams.get('error_description') ?? '';
                reply(res, 400, 'Sign-in was refused. You can close this tab.');
                clearTimeout(timer);
                reject(new Error(`Sign-in refused (${err})${desc !== '' ? ': ' + desc : ''}`));
                return;
            }

            /* The state check. Without it, anything that can reach this port
               during the window — any page in any browser on this machine — can
               feed us a code, and we would exchange it and store the resulting
               token as the user's own. */
            if (url.searchParams.get('state') !== expectedState) {
                reply(res, 400, 'This response did not come from the sign-in you started.');
                clearTimeout(timer);
                reject(new Error('State mismatch — the callback did not match this sign-in attempt.'));
                return;
            }

            const code = url.searchParams.get('code');
            if (code === null || code === '') {
                reply(res, 400, 'No authorization code in the response.');
                clearTimeout(timer);
                reject(new Error('The redirect carried no authorization code.'));
                return;
            }

            reply(res, 200, 'Signed in. You can close this tab and go back to your terminal.');
            clearTimeout(timer);
            resolve(code);
        });
    });
}

function reply(res: ServerResponse, status: number, message: string): void {
    const html = `<!doctype html><meta charset="utf-8"><title>Vidofy CLI</title>`
        + `<body style="font:16px/1.6 system-ui,sans-serif;display:grid;place-items:center;height:90vh;margin:0">`
        + `<p>${message}</p>`;
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
}

/**
 * Open the default browser, and do not care whether it worked.
 *
 * The URL is printed above this call, so a failure here costs a copy and paste
 * rather than the sign-in. `detached` + `unref` so the CLI is not held open by
 * a browser process that outlives it.
 */
function openBrowser(url: string): void {
    const cmd = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'cmd'
            : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
    try {
        spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    } catch {
        /* Printed above; nothing to add. */
    }
}
