/**
 * `vidofy generate create` and `vidofy generate get` — the commands that spend
 * money, and the ones /en/cli makes the most specific promises about.
 *
 * ── THE FOUR PROMISES, QUOTED, BECAUSE EACH ONE IS TESTABLE ────────────────
 *
 *  --dry-run  "prints the cost and exits without charging you or starting a
 *              job."  → prices through info/model-credits and RETURNS. It must
 *              never reach generate/submit; that is the whole promise.
 *
 *  --wait     "it is downloaded into the directory you ran the command in, and
 *              the full path is printed as the last line — so
 *              HERO=$(vidofy generate create … --wait) captures it."
 *              → the absolute path is the last thing on stdout, and nothing
 *              else human ever goes there. src/ui.ts holds that split.
 *
 *  --output   "Use --output to choose a different path."
 *
 *  no --wait  "drop --wait to get an id now and run vidofy generate get <id>
 *              later."  → stdout is the id, bare.
 *
 *  --image    "reads straight from your disk, and so does any file your agent
 *              has just written."  → a local path, sent as multipart. The page
 *              calls this the one thing a terminal does that a web assistant
 *              cannot, so it reads the file rather than requiring a URL.
 *
 * ── Why the polling loop lives here and not in @vidofy/mcp ─────────────────
 * The MCP tool polls too, but it reports progress back into a conversation and
 * is bounded by a host's patience. A terminal waits as long as the person is
 * willing to, prints progress to stderr, and must survive a blip without
 * turning it into a failure. Same endpoints, different stopping rules.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename, extname } from 'node:path';
import { request, contentIdempotencyKey, sleep, type FileField } from '@vidofy/mcp/backend';
import {
    mapStatus, mapResult, readCostCredits, stripProviderCost,
    type GenerationStatus, type GenerationResult,
} from '@vidofy/mcp/map';
import type { Config } from '@vidofy/mcp/config';
import { loadSession } from '../session.js';
import { out, note, ok, dim, bold, warn } from '../ui.js';

/** How often we ask, and for how long. Both are generous: a video can be minutes. */
const POLL_INTERVAL_MS = 3_000;
const POLL_CEILING_MS = 30 * 60 * 1000;

export async function generateCommand(argv: readonly string[]): Promise<number> {
    const sub = argv[0] ?? '';
    const rest = argv.slice(1);

    switch (sub) {
        case 'create': return createGeneration(rest);
        case 'get': return getGeneration(rest);
        default:
            note(`Unknown subcommand "${sub}".`);
            note();
            note('  vidofy generate create --model <slug> --prompt "…"');
            note('  vidofy generate get <id>');
            return 2;
    }
}

/* ── generate create ─────────────────────────────────────────────────────── */

async function createGeneration(argv: readonly string[]): Promise<number> {
    const flags = parseFlags(argv);
    const model = flags.value('--model');
    const prompt = flags.value('--prompt');

    if (model === undefined) { note('--model is required. See `vidofy models list`.'); return 2; }

    const cfg = await loadSession();

    /* ── THE TWO ENDPOINTS WANT DIFFERENT IDENTIFIERS. Both are sent. ────────
     *
     * One model row carries two distinct values:
     *
     *     m_slug       flux-schnell-t2i     ← what `models list` prints
     *     m_model_key  Flux_schnell_t2i
     *
     * and the endpoints do not agree on which they take:
     *
     *     info/model-credits   prefers m_slug — the unique per-mode identifier
     *     generate/submit      reads m_model_key ONLY
     *
     * Measured, one failure each: sending only m_model_key priced as "Model not
     * found or inactive"; sending only m_slug submitted as "Please select a
     * valid model to proceed."
     *
     * So --model takes the slug, because that is what `models list` prints and
     * what the page tells people to pipe into it, and the key is resolved from
     * it once via info/model-info. Both go on the form: each endpoint reads the
     * one it knows and ignores the other.
     *
     * Everything else the user passed rides along as m_*, so a model with its
     * own dynamic fields works without this CLI knowing their names — the
     * catalogue is open-ended by design — the field set is not a fixed schema —
     * and enumerating fields here would make a newly added field
     * unreachable until we shipped.
     */
    const form: Record<string, string> = { m_slug: model };
    const ident = await resolveModel(cfg, model);
    if (ident.modelKey !== '') form['m_model_key'] = ident.modelKey;
    if (ident.mode !== '') form['m_mode'] = ident.mode;
    if (ident.effectKey !== '') form['m_effect_key'] = ident.effectKey;
    if (prompt !== undefined) form['m_prompt'] = prompt;
    for (const [k, v] of flags.passthrough()) form[k] = v;

    const files: FileField[] = [];
    for (const [flag, field] of [['--image', 'm_image'], ['--video', 'm_video'], ['--audio', 'm_audio']] as const) {
        const path = flags.value(flag);
        if (path === undefined) continue;
        files.push({ field, path: resolve(path) });
    }

    /* ── The price, always. Not only for --dry-run ──────────────────────────
       A person who typed a model slug wrong, or asked for a duration the model
       charges ten times more for, should see the number before it is spent.
       This is the same endpoint --dry-run uses; --dry-run simply stops here. */
    let credits: number | null = null;
    try {
        const quote = stripProviderCost(
            await request(cfg, { method: 'POST', path: 'info/model-credits', form })
        );
        credits = readCostCredits(quote, 'coins');
    } catch (err) {
        if (flags.has('--dry-run')) throw err;   // the whole command was the quote
        // Otherwise: a quote we could not get is not a reason to refuse the
        // generation the person asked for. Say so and carry on.
        warn(`Could not price this first (${err instanceof Error ? err.message : 'unknown'}).`);
    }

    if (credits !== null) note(`${bold(String(credits))} credits`);

    if (flags.has('--dry-run')) {
        // stdout carries the number and nothing else, so `--dry-run` is usable
        // in a condition: [ "$(vidofy generate create … --dry-run)" -lt 50 ]
        if (credits === null) { note('No price returned.'); return 1; }
        out(String(credits));
        note(dim('Dry run — nothing was charged and no job was started.'));
        return 0;
    }

    const submitted = stripProviderCost(
        await request<Record<string, unknown>>(cfg, {
            method: 'POST',
            path: 'generate/submit',
            form,
            ...(files.length > 0 ? { files } : {}),
            /* Derived from the request's own content, so a retried command — the
               same prompt, the same model — cannot charge twice. This is the
               audited helper from @vidofy/mcp, not a fresh uuid. */
            idempotencyKey: contentIdempotencyKey(form, files.map((f) => f.path)),
        })
    );

    const id = readId(submitted);
    if (id === '') throw new Error('The server accepted the request but returned no media id.');

    if (!flags.has('--wait')) {
        out(id);                                   // the answer: an id a script can keep
        note(dim(`Started. Follow it with: vidofy generate get ${id}`));
        return 0;
    }

    note(dim(`Started ${id} — waiting…`));
    const result = await pollUntilDone(cfg, id);
    return await deliver(cfg, result, flags.value('--output'), id);
}

/* ── generate get ────────────────────────────────────────────────────────── */

async function getGeneration(argv: readonly string[]): Promise<number> {
    const flags = parseFlags(argv);
    const id = argv.find((a) => !a.startsWith('-')) ?? '';
    if (id === '') { note('Which generation? `vidofy generate get <id>`'); return 2; }

    const cfg = await loadSession();

    if (flags.has('--wait')) {
        const result = await pollUntilDone(cfg, id);
        return await deliver(cfg, result, flags.value('--output'), id);
    }

    const status = mapStatus(stripProviderCost(
        await request(cfg, { method: 'GET', path: `generate/status/${encodeURIComponent(id)}` })
    ));

    out(status.status ?? 'unknown');
    if (isTerminalSuccess(status)) {
        const result = mapResult(stripProviderCost(
            await request(cfg, { method: 'GET', path: `generate/result/${encodeURIComponent(id)}` })
        ));
        return await deliver(cfg, result, flags.value('--output'), id);
    }
    return 0;
}

/* ── the waiting ─────────────────────────────────────────────────────────── */

async function pollUntilDone(cfg: Config, id: string): Promise<GenerationResult> {
    const startedAt = Date.now();
    let lastSaid = '';

    for (;;) {
        if (Date.now() - startedAt > POLL_CEILING_MS) {
            throw new Error(
                `Still not finished after 30 minutes. It may yet complete — `
                + `check with \`vidofy generate get ${id}\`.`
            );
        }

        let status: GenerationStatus;
        try {
            status = mapStatus(stripProviderCost(
                await request(cfg, { method: 'GET', path: `generate/status/${encodeURIComponent(id)}` })
            ));
        } catch (err) {
            /* A blip is not a failure. The job is running on our servers whether
               or not this laptop's wifi held, and killing the wait would leave
               the person with a charge and no file. The 30-minute ceiling is
               what eventually stops us, not one bad response. */
            note(dim(`  (transient: ${err instanceof Error ? err.message : 'network'})`));
            await sleep(POLL_INTERVAL_MS);
            continue;
        }

        const state = status.status ?? 'unknown';
        if (state !== lastSaid) { note(dim(`  ${state}`)); lastSaid = state; }

        if (isTerminalSuccess(status)) {
            return mapResult(stripProviderCost(
                await request(cfg, { method: 'GET', path: `generate/result/${encodeURIComponent(id)}` })
            ));
        }
        if (isTerminalFailure(status)) {
            const msg = status.error ?? state;
            throw new Error(`Generation ${state}: ${msg}`);
        }

        await sleep(POLL_INTERVAL_MS);
    }
}

/* ── THE SUCCESS STATE IS `success`. THERE IS NO `completed`. ──────────────
 *
 * Measured against the live endpoint, which answers {"m_status":"success"},
 * and against the mapper's own list (map/b2c.ts:119):
 *
 *     TERMINAL = success · error · failed · blocked · deleted_media
 *
 * The first version of this file waited for 'completed', a value I invented.
 * The generation finished in seconds, the row said `success`, and the CLI kept
 * polling it for as long as it was allowed to — the worst shape of bug this
 * command can have, because the person has already been charged and the tool
 * says nothing is ready.
 *
 * `done` is the mapper's own flag over that list, so these read it rather than
 * comparing strings a second time: two opinions on one question disagree the
 * day a state is renamed, and the mapper is the one that gets updated. */
const FAILURE_STATES = new Set(['error', 'failed', 'blocked', 'deleted_media']);

const isTerminalSuccess = (s: GenerationStatus): boolean =>
    s.done === true && !FAILURE_STATES.has(s.status ?? '');

const isTerminalFailure = (s: GenerationStatus): boolean =>
    s.done === true && FAILURE_STATES.has(s.status ?? '');

/* ── the file ────────────────────────────────────────────────────────────── */

/**
 * Download the output and print its absolute path LAST.
 *
 * The ordering in this function is the published contract: every note() goes to
 * stderr, and the single out() is the final thing written to stdout. Anything
 * added after that out() breaks `HERO=$(vidofy generate create … --wait)` for
 * every script already written against it.
 */
async function deliver(
    cfg: Config,
    result: GenerationResult,
    outputFlag: string | undefined,
    id: string
): Promise<number> {
    const url = readOutputUrl(result);
    if (url === '') {
        note('Finished, but the result carried no file URL.');
        return 1;
    }

    const target = resolve(outputFlag ?? defaultFilename(url, id));
    await mkdir(dirname(target), { recursive: true });

    const res = await fetch(url, { headers: { 'user-agent': cfg.userAgent } });
    if (!res.ok) throw new Error(`Downloading the result failed with HTTP ${res.status}.`);
    await writeFile(target, Buffer.from(await res.arrayBuffer()));

    ok(`Saved ${basename(target)}`);
    out(target);            // ← LAST LINE ON STDOUT. Nothing may follow it.
    return 0;
}

/** `vidofy-<id>.<ext>` — the id so two runs in one directory cannot collide. */
function defaultFilename(url: string, id: string): string {
    let ext = '';
    try { ext = extname(new URL(url).pathname); } catch { /* not a parseable URL */ }
    if (ext === '' || ext.length > 6) ext = '.bin';
    return `vidofy-${id}${ext}`;
}

/* The mapper already normalised the two response shapes into `url`, so there is
   one field to read and no guessing between output_public_url / output_url. */
function readOutputUrl(result: GenerationResult): string {
    const u = result.url;
    return typeof u === 'string' && u.startsWith('http') ? u : '';
}

/**
 * One slug in, every identifier submit needs out.
 *
 * `--model` takes a slug because that is what `models list` prints and what the
 * page tells people to pipe into it. submit needs more than that, and each
 * missing piece failed differently — which is why they are gathered here rather
 * than discovered one at a time by whoever runs the command:
 *
 *   m_model_key  missing → "Please select a valid model to proceed."
 *   m_mode       missing → HTTP 500. The server derives m_media_type from the
 *                          mode, so without it the INSERT hits
 *                          "Data truncated for column 'm_media_type'" — a
 *                          database error the caller sees as a blank 500.
 *   m_effect_key on an effect model, missing → priced at a default (0.56
 *                          against real effect prices of 0.14-0.98) and the
 *                          worker dispatches an empty scene. Billed the wrong
 *                          amount for the wrong output, with no error at all.
 *
 * The same four @vidofy/mcp's toWire sends (src/tools/generation.ts:42-53).
 * They are read from the catalogue, never derived: `flux-schnell-t2i` against
 * `Flux_schnell_t2i` looks like a transformation until a model breaks it.
 *
 * A failure here is not fatal — the form still carries m_slug, pricing works on
 * that alone, so `--dry-run` still answers. Only submit needs the rest, and it
 * says so itself.
 */
interface ModelIdent { modelKey: string; mode: string; effectKey: string; }

async function resolveModel(cfg: Config, slug: string): Promise<ModelIdent> {
    try {
        const info = stripProviderCost(
            await request<Record<string, unknown>>(cfg, {
                method: 'GET',
                path: `info/model-info/${encodeURIComponent(slug)}`,
            })
        );
        /* The row is under `model`, NOT `data`. Measured shape:
               { success, by, slug, mode, mode_code, model: { m_model_key, … } }
           I assumed `data` first — the envelope most of /app/v1 uses — and it
           silently returned '', so submit failed with the same "select a valid
           model" as before and the fix looked like it had not worked. */
        const row = (info['model'] ?? info['data'] ?? info) as Record<string, unknown>;

        /* `mode`, the LONG key (text-to-image) — never `mode_code` (t2i). Both
           are in this response, and @vidofy/mcp's schema.ts says which is
           which: the LONG key is what `m_mode` means on submit and on
           model-credits, and what the media row stores. Never post the
           other one. */
        return {
            modelKey: str(row['m_model_key']),
            mode: str(info['mode']),
            effectKey: str(row['m_effect_key']),
        };
    } catch {
        return { modelKey: '', mode: '', effectKey: '' };
    }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function readId(payload: Record<string, unknown>): string {
    const d = (payload['data'] ?? payload) as Record<string, unknown>;
    for (const key of ['media_id', 'm_id', 'id']) {
        const v = d[key];
        if (typeof v === 'string' && v !== '') return v;
    }
    return '';
}

/* ── flags ───────────────────────────────────────────────────────────────── */

interface Flags {
    has(flag: string): boolean;
    value(flag: string): string | undefined;
    /** Every unrecognised `--m_*` so admin-added model fields work untouched. */
    passthrough(): Array<[string, string]>;
}

const KNOWN = new Set([
    '--model', '--prompt', '--output', '--image', '--video', '--audio', '--wait', '--dry-run',
]);

function parseFlags(argv: readonly string[]): Flags {
    const pairs = new Map<string, string>();
    const bare = new Set<string>();

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i] ?? '';
        if (!a.startsWith('--')) continue;
        const eq = a.indexOf('=');
        if (eq > 0) { pairs.set(a.slice(0, eq), a.slice(eq + 1)); continue; }
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith('--')) { pairs.set(a, next); i++; }
        else bare.add(a);
    }

    return {
        has: (f) => bare.has(f) || pairs.has(f),
        value: (f) => pairs.get(f),
        passthrough: () =>
            [...pairs.entries()]
                .filter(([k]) => !KNOWN.has(k))
                // `--aspect_ratio 16:9` → m_aspect_ratio, matching the wire names
                // the validator and the pricing calculator both read.
                .map(([k, v]): [string, string] => {
                    const name = k.replace(/^--/, '');
                    return [name.startsWith('m_') ? name : `m_${name}`, v];
                }),
    };
}
