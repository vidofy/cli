/**
 * Turning a stored token into the Config that @vidofy/mcp's backend expects.
 *
 * WHY THIS IMPORTS RATHER THAN REIMPLEMENTS
 * -----------------------------------------
 * `configForToken` carries the validation that stops the two most likely wrong
 * credentials from reaching the wire with a confusing error:
 *
 *   vky_…  → an API key. Different namespace (/api/v1), different wallet
 *            (the B2B credit wallet) and different prices. Sending it here
 *            would fail as a 401 with no explanation of why the user's
 *            perfectly valid key does not work.
 *   other  → not a personal token at all.
 *
 * Rewriting those checks in this package would be a second place for them to
 * drift, and the pair that drifted would be the pair that decides which wallet
 * a person's money comes out of.
 *
 * The one thing overridden is the User-Agent. `configForToken` stamps
 * `vidofy-mcp/…` because that is who normally calls it; a request made by this
 * program should say so, or the usage logs attribute terminal traffic to the
 * MCP connector and nobody can tell the two apart afterwards.
 */

import { configForToken, resolveBaseUrl, type Config } from '@vidofy/mcp/config';
import { readCredentials } from './credentials.js';
import { VERSION } from './version.js';

export class NotSignedInError extends Error {}

/**
 * Resolve the credential for this run, in the order a person expects:
 *
 *   1. VIDOFY_TOKEN in the environment — the CI path. /en/cli tells people to
 *      "sign in once on a machine that has a browser, then copy the token",
 *      and an environment variable is how a copied token is used on a server.
 *      It wins over the file so a CI job cannot accidentally pick up a
 *      developer token left in a mounted home directory.
 *   2. ~/.vidofy/credentials.json — the normal path after `vidofy auth login`.
 */
export async function loadSession(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
    const fromEnv = (env['VIDOFY_TOKEN'] ?? '').trim();
    if (fromEnv !== '') {
        return withCliAgent(configForToken(fromEnv, env, VERSION));
    }

    const stored = await readCredentials(env);
    if (stored === null) {
        throw new NotSignedInError(
            'Not signed in. Run `vidofy auth login` — it opens your browser and takes one approval.'
        );
    }

    const cfg = configForToken(stored.token, env, VERSION);

    // The stored origin wins over the environment default. A token issued by
    // one site must never be sent to another: that is how a credential leaks to
    // a host that had no business seeing it. VIDOFY_API_BASE still overrides,
    // because a person pointing the CLI at a staging origin on purpose has said
    // so explicitly — but then the token they stored for it is the one in use.
    const explicitBase = (env['VIDOFY_API_BASE'] ?? '').trim() !== '';
    return withCliAgent({
        ...cfg,
        baseUrl: explicitBase ? resolveBaseUrl(env) : stored.baseUrl,
    });
}

function withCliAgent(cfg: Config): Config {
    return { ...cfg, userAgent: `vidofy-cli/${VERSION}` };
}
