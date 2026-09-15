/**
 * Turning what a person types after `--mode` into what the endpoint wants.
 *
 * ── The gap this closes, and why it is not optional ─────────────────────────
 * /en/cli promises, in its own code block:
 *
 *     vidofy models list --mode text-to-image
 *     vidofy models list --mode text-to-video
 *
 * `/app/v1/info/models-flat/{mode}` wants the CODE — `t2i`, `t2v`. Measured
 * against the live endpoint, every mode row carries all three spellings:
 *
 *     m_key  text-to-video      the long slug, and what the page promises
 *     m_code t2v                the short code, and what the URL wants
 *     m_name Text to Video      the human label
 *
 * So the page is not wrong and the endpoint is not wrong; the translation had
 * to live somewhere, and a CLI that only accepted `t2i` would contradict a
 * published page on its first command.
 *
 * All three are accepted, case-insensitively. Nobody should have to remember
 * which of the three they saw last.
 *
 * ── Why one network call and not a hard-coded table ────────────────────────
 * A table baked in here goes stale the day a mode is added — and modes ARE
 * added server-side with no deploy, which is the whole design of the mode
 * catalogue. The list comes from the server, and an unknown value is
 * answered with the real list rather than a guess.
 */

import { request } from '@vidofy/mcp/backend';
import type { Config } from '@vidofy/mcp/config';

export interface ModeRow {
    key: string;
    code: string;
    name: string;
    models: number;
}

interface ModesResponse {
    modes?: Array<Record<string, unknown>>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

export async function fetchModes(cfg: Config): Promise<ModeRow[]> {
    const res = await request<ModesResponse>(cfg, { method: 'GET', path: 'info/modes' });
    return (res.modes ?? []).map((m) => ({
        key: str(m['m_key']),
        code: str(m['m_code']),
        name: str(m['m_name']),
        models: typeof m['models_count'] === 'number' ? m['models_count'] : 0,
    }));
}

export class UnknownModeError extends Error {
    constructor(given: string, public readonly known: readonly ModeRow[]) {
        super(`Unknown mode "${given}".`);
    }
}

/**
 * Resolve any of the three spellings to the code the URL needs.
 * Throws with the full list attached so the caller can print something useful.
 */
export function resolveMode(given: string, modes: readonly ModeRow[]): string {
    const wanted = given.trim().toLowerCase();
    if (wanted === '') throw new UnknownModeError(given, modes);

    for (const m of modes) {
        if (m.code.toLowerCase() === wanted) return m.code;
    }
    for (const m of modes) {
        if (m.key.toLowerCase() === wanted) return m.code;
    }
    // The label last: it is the loosest match, and matching it before the two
    // identifiers would let "Text to Image" shadow a future code of the same
    // spelling. Unlikely, but the order costs nothing to get right.
    for (const m of modes) {
        if (m.name.toLowerCase() === wanted) return m.code;
    }
    throw new UnknownModeError(given, modes);
}
