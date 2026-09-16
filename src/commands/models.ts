/**
 * `vidofy models list [--mode <mode>]`
 *
 * /en/cli: "Run `vidofy models list --mode text-to-image` (or any other mode)
 * to see what is available." With no --mode it lists the MODES instead, because
 * the honest answer to "what can I use?" from a standing start is the catalogue
 * of modes, not several hundred models with no way to narrow them.
 *
 * stdout carries one model slug per line and nothing else, so
 *
 *     vidofy models list --mode t2i | head -1
 *
 * yields something you can hand straight to `--model`. Names, prices and
 * counts go to stderr — see src/ui.ts for why that split is a contract.
 */

import { request } from '@vidofy/mcp/backend';
import { stripProviderCost } from '@vidofy/mcp/map';
import { loadSession } from '../session.js';
import { fetchModes, resolveMode, UnknownModeError } from '../modes.js';
import { out, note, dim, bold, table, plural } from '../ui.js';

interface ModelsFlatResponse {
    /* NOT `models`. The list key is `models_flat`, which is the same trap the
       MCP tool documents at src/tools/info.ts:59 — reading `models` here would
       print an empty list for a mode that has dozens. */
    models_flat?: Array<Record<string, unknown>>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function modelsCommand(argv: readonly string[]): Promise<number> {
    const sub = argv[0] ?? 'list';
    if (sub !== 'list') {
        note(`Unknown subcommand "${sub}". The only one is: vidofy models list`);
        return 2;
    }

    const cfg = await loadSession();
    const modeArg = flagValue(argv, '--mode');

    if (modeArg === undefined) {
        const modes = await fetchModes(cfg);
        for (const m of modes) out(m.key);
        note();
        note(bold(`${modes.length} modes`));
        for (const line of table(modes.map((m) => [m.key, `${m.name} · ${m.models} models`]))) {
            note('  ' + line);
        }
        note();
        note(dim('Then: vidofy models list --mode <mode>'));
        return 0;
    }

    let code: string;
    try {
        code = resolveMode(modeArg, await fetchModes(cfg));
    } catch (e) {
        if (e instanceof UnknownModeError) {
            note(`Unknown mode "${modeArg}". Available:`);
            for (const line of table(e.known.map((m) => [m.key, m.name]))) note('  ' + line);
            return 2;
        }
        throw e;
    }

    const res = stripProviderCost(
        await request<ModelsFlatResponse>(cfg, {
            method: 'GET',
            path: `info/models-flat/${encodeURIComponent(code)}`,
        })
    );

    const rows = res.models_flat ?? [];
    for (const m of rows) out(str(m['m_slug']));

    note();
    note(bold(`${rows.length} ${plural(rows.length, 'model')} in ${code}`));
    for (const line of table(
        rows.map((m) => {
            const coins = m['m_coins'];
            const price = typeof coins === 'number' ? `from ${coins} ${plural(coins, 'credit')}` : '';
            return [str(m['m_slug']), [str(m['m_name']), price].filter((s) => s !== '').join(' · ')];
        })
    )) {
        note('  ' + line);
    }
    return 0;
}

/** `--mode t2i` and `--mode=t2i` both, because both are typed. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] ?? '';
        if (a === flag) return argv[i + 1];
        if (a.startsWith(flag + '=')) return a.slice(flag.length + 1);
    }
    return undefined;
}
