/**
 * `vidofy balance` — /en/cli: "it turns 'the command exited 0' into a number".
 *
 * That is the whole design brief. The answer on stdout is the NUMBER and
 * nothing else, so a script can do
 *
 *     if [ "$(vidofy balance)" -lt 100 ]; then …
 *
 * The human-readable framing ("credits", the account label) goes to stderr
 * where it cannot get into that comparison. See src/ui.ts for why.
 */

import { request } from '@vidofy/mcp/backend';
import { stripProviderCost } from '@vidofy/mcp/map';
import { loadSession } from '../session.js';
import { out, note, dim, plural } from '../ui.js';

export async function balanceCommand(argv: readonly string[]): Promise<number> {
    const cfg = await loadSession();

    const payload = stripProviderCost(
        await request<Record<string, unknown>>(cfg, { method: 'GET', path: '/account/balance' })
    );

    const data = (payload['data'] ?? payload) as Record<string, unknown>;

    // The B2C balance endpoint calls it `u_coins`; be tolerant of the clean
    // name too rather than assume, because this same CLI will one day be
    // pointed at a staging build where the transform is mid-flight. A wrong
    // guess here prints "0" for a funded account, which reads as a bug in
    // billing rather than a bug in a field name.
    const raw = data['u_coins'] ?? data['coins'] ?? data['credits_balance'] ?? data['balance'];
    const credits = typeof raw === 'number' ? raw : Number(raw);

    if (!Number.isFinite(credits)) {
        throw new Error(
            'The balance response did not contain a number. '
            + 'Run with VIDOFY_DEBUG=1 to see what came back.'
        );
    }

    // stdout: the answer, bare.
    out(String(credits));

    // stderr: what a person wants to see next to it.
    const email = typeof data['u_email'] === 'string' ? data['u_email'] : '';
    note(dim(`${plural(credits, 'credit')}${email !== '' ? ` · ${email}` : ''}`));

    void argv;
    return 0;
}
