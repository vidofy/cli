/**
 * Where the token lives on disk, and who is allowed to read it.
 *
 * `~/.vidofy/credentials.json`. The directory is a PUBLIC PROMISE — /en/cli
 * names it in three places, including the answer to "can I use this in CI?"
 * ("sign in once on a machine that has a browser, then copy the token from
 * ~/.vidofy/"). Moving it breaks that answer, so it moves only with the page.
 *
 * ── Permissions are load-bearing, not hygiene ───────────────────────────────
 * The file holds a bearer token for the user's own Vidofy account: anything
 * that can read it can spend their balance. It is written 0600 and the
 * directory 0700, and on a shared machine that is the whole of the protection.
 *
 * Node's `mode` argument is masked by the process umask on creation, so a umask
 * of 0022 would silently turn 0600 into 0600 (fine) but 0700 into 0700 (also
 * fine) — while a umask of 0 would leave a fresh file exactly as asked. The
 * risk runs the other way: an EXISTING file keeps its old permissions, because
 * open() does not re-apply mode to a file that already exists. So we chmod
 * after writing rather than trusting the create mode, which is the only form
 * that is correct for both the first write and every later one.
 *
 * ── Windows ────────────────────────────────────────────────────────────────
 * chmod is a no-op there and Node does not pretend otherwise. The page promises
 * Windows support, so a failure to chmod must not be fatal — the call is
 * wrapped and its failure ignored deliberately, not by omission.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile, chmod, unlink } from 'node:fs/promises';

/** The directory /en/cli tells people to look in. */
export function credentialsDir(env: NodeJS.ProcessEnv = process.env): string {
    // VIDOFY_CONFIG_DIR exists for tests and for a CI runner with no real home
    // directory. The default stays ~/.vidofy/, which is what the README promises
    // and what an unconfigured run uses.
    const override = (env['VIDOFY_CONFIG_DIR'] ?? '').trim();
    return override !== '' ? override : join(homedir(), '.vidofy');
}

export function credentialsPath(env: NodeJS.ProcessEnv = process.env): string {
    return join(credentialsDir(env), 'credentials.json');
}

/** What we keep between runs. Deliberately small — see the note on `account`. */
export interface StoredCredentials {
    /** The bearer token. Starts with `vmt_`. */
    token: string;
    /** Origin the token was issued by, so a token from one site cannot be sent to another. */
    baseUrl: string;
    /**
     * Shown by `vidofy auth status` so a person can tell WHICH account is
     * signed in without a network call. It is a display label and nothing
     * reads it for a decision — the server decides who the token belongs to.
     */
    account?: string;
    /** ISO 8601, for `auth status`. Never used to decide whether the token is valid. */
    signedInAt?: string;
}

export async function readCredentials(
    env: NodeJS.ProcessEnv = process.env
): Promise<StoredCredentials | null> {
    let raw: string;
    try {
        raw = await readFile(credentialsPath(env), 'utf8');
    } catch {
        // Missing file is the normal "not signed in yet" state, not an error.
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // A corrupt file is reported rather than silently treated as "signed
        // out": telling someone to run `auth login` when the real problem is a
        // truncated file sends them round a loop that cannot end.
        throw new Error(
            `${credentialsPath(env)} is not valid JSON. Delete it and run \`vidofy auth login\` again.`
        );
    }

    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    const token = typeof o['token'] === 'string' ? o['token'] : '';
    const baseUrl = typeof o['baseUrl'] === 'string' ? o['baseUrl'] : '';
    if (token === '' || baseUrl === '') return null;

    const account = typeof o['account'] === 'string' ? o['account'] : undefined;
    const signedInAt = typeof o['signedInAt'] === 'string' ? o['signedInAt'] : undefined;
    return {
        token,
        baseUrl,
        ...(account !== undefined ? { account } : {}),
        ...(signedInAt !== undefined ? { signedInAt } : {}),
    };
}

export async function writeCredentials(
    creds: StoredCredentials,
    env: NodeJS.ProcessEnv = process.env
): Promise<string> {
    const dir = credentialsDir(env);
    const file = credentialsPath(env);

    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify(creds, null, 2) + '\n', 'utf8');

    // After the write, never instead of it — see the header note on why the
    // create mode is not enough for a file that already existed.
    for (const [target, mode] of [[dir, 0o700], [file, 0o600]] as const) {
        try {
            await chmod(target, mode);
        } catch {
            /* Windows: chmod is a no-op. Not fatal — the page promises Windows. */
        }
    }
    return file;
}

export async function clearCredentials(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
    try {
        await unlink(credentialsPath(env));
        return true;
    } catch {
        return false;
    }
}
