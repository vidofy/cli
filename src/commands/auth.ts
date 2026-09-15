/**
 * `vidofy auth login | status | logout`
 *
 * login  → src/auth/login.ts, the browser flow.
 * status → who is signed in, WITHOUT a network call. A person running this has
 *          usually just had something refused and wants to know which account
 *          they are on; making that answer depend on the network turns a
 *          one-line question into a second failure.
 * logout → forget the token on this machine.
 */

import { readCredentials, clearCredentials, credentialsPath } from '../credentials.js';
import { loginCommand } from '../auth/login.js';
import { note, ok, dim, bold, warn } from '../ui.js';

export async function authCommand(argv: readonly string[]): Promise<number> {
    const sub = argv[0] ?? '';

    switch (sub) {
        case 'login':
            return loginCommand();

        case 'status': {
            const fromEnv = (process.env['VIDOFY_TOKEN'] ?? '').trim();
            if (fromEnv !== '') {
                // Never the token itself — a status line gets pasted into chat
                // logs and issue reports. The prefix is enough to tell two
                // tokens apart, and is not enough to use.
                note(`${bold('VIDOFY_TOKEN')} is set in this environment (${mask(fromEnv)}).`);
                note(dim('It takes precedence over ~/.vidofy/ for every command.'));
                return 0;
            }
            const creds = await readCredentials();
            if (creds === null) {
                warn('Not signed in.');
                note(dim('Run `vidofy auth login`.'));
                return 3;
            }
            note(`${bold('Signed in')} to ${creds.baseUrl}`);
            note(dim(`token   ${mask(creds.token)}`));
            if (creds.signedInAt !== undefined) note(dim(`since   ${creds.signedInAt}`));
            note(dim(`file    ${credentialsPath()}`));
            return 0;
        }

        case 'logout': {
            const removed = await clearCredentials();
            if (removed) {
                ok('Signed out on this machine.');
                /* Said plainly because it is the difference between "nobody can
                   use this" and "this file cannot". Revoking is a different act,
                   on a different machine's list. */
                note(dim('The token still exists on your account — revoke it at '
                    + 'https://vidofy.ai/en/studio/account/mcp-tokens if it may '
                    + 'have been copied.'));
            } else {
                note('Nothing to sign out of.');
            }
            return 0;
        }

        default:
            note(`Unknown subcommand "${sub}".`);
            note();
            note('  vidofy auth login     browser sign-in');
            note('  vidofy auth status    who is signed in');
            note('  vidofy auth logout    forget the token here');
            return 2;
    }
}

/** vmt_abcdefgh… — enough to tell two apart, not enough to use. */
function mask(token: string): string {
    return token.length <= 12 ? 'vmt_…' : `${token.slice(0, 12)}…`;
}
