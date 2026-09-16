/**
 * Turning "that field is wrong" into "here is the flag, and here are its values".
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Vidofy already answers a refused request with everything a person needs:
 *
 *     { "error": "INVALID_FIELD_VALUES",
 *       "message": "Please choose a valid value for: Aspect Ratio.",
 *       "details": [ { "field": "m_aspect_ratio", "input": "7:3",
 *                      "allowed": ["1:1","3:4","4:3","9:16","16:9"] } ] }
 *
 * and this program printed the `message` and threw the rest away. The reader was
 * told a human label — "Aspect Ratio" — with no flag to type and no values to
 * choose from, for a catalogue of hundreds of models whose options differ one
 * from the next. Two of them can be recovered from that payload alone: the wire
 * name `m_aspect_ratio` IS the flag `--aspect_ratio`, and `allowed` IS the list.
 *
 * ── AND WHEN THE FIELD IS MISSING RATHER THAN WRONG ─────────────────────────
 * The server sends no `allowed` on that branch — it is answering "you left this
 * out", not "that value is not in the list" — and missing is the commoner case:
 * it is what the documented quick-start command hit (owner report, 2026-09-16).
 *
 * So the values come from the model itself, out of the `m_options` that
 * `resolveModel` has ALREADY fetched for this very command. No extra request, no
 * second source of truth: the same JSON the validator reads on the server.
 *
 * ── WHAT IS DELIBERATELY NOT DONE ───────────────────────────────────────────
 * Nothing is guessed and nothing is auto-filled. A flag the reader did not type
 * is a flag they did not choose, and quietly choosing an aspect ratio for someone
 * spends their credits on a shape they did not ask for. This module only ever
 * prints.
 */

/** Everything the API told us about one refused field. */
interface FieldProblem {
    /** Wire name, e.g. `m_aspect_ratio`. */
    field: string;
    /** What was sent, empty when the field was simply absent. */
    input: string;
    /** The values the server named, when it named any. */
    allowed: string[];
}

/** Allowed values per wire field, read from a model's own `m_options`. */
export type FieldChoices = Record<string, string[]>;

/**
 * The values each option of this model accepts.
 *
 * Mirrors the branches the shared validator runs, and the same ones /en/cli
 * reads to build its examples — a base key holding a non-empty list is a choice,
 * `m_duration` is a MAP whose keys are the durations and whose value is that
 * duration's resolution list, and a dynamic field's choices are its options.
 *
 * `form` matters for one field only: which resolutions are legal depends on the
 * duration in play. That is the request's own duration when it sent one, the
 * model's default when it did not, and otherwise the first the model lists —
 * the same order the server resolves it in.
 */
export function choicesFromOptions(
    options: Record<string, unknown> | null,
    form: Readonly<Record<string, string>> = {}
): FieldChoices {
    if (options === null) return {};
    const choices: FieldChoices = {};

    const asList = (v: unknown): string[] =>
        Array.isArray(v) ? v.map((x) => String(x).trim()).filter((x) => x !== '') : [];

    for (const key of ['m_aspect_ratio', 'm_resolution_quality', 'm_style',
                       'm_movement_amplitude', 'm_output_format']) {
        const list = asList(options[key]);
        if (list.length > 0) choices[key] = list;
    }

    const durations = options['m_duration'];
    if (durations !== null && typeof durations === 'object' && !Array.isArray(durations)) {
        const map = durations as Record<string, unknown>;
        const keys = Object.keys(map);
        if (keys.length > 0) {
            choices['m_duration'] = keys;

            const defaults = (options['m_defaults'] ?? {}) as Record<string, unknown>;
            const chosen = [form['m_duration'], defaults['m_duration'], keys[0]]
                .map((v) => (v === undefined ? '' : String(v).trim()))
                .find((v) => v !== '' && v in map);

            if (chosen !== undefined) {
                /* An EMPTY list for the chosen duration means the admin left
                   resolution open, and the validator skips it — so there is
                   nothing to offer and no key is written. */
                const list = asList(map[chosen]);
                if (list.length > 0) choices['m_resolution'] = list;
            }
        }
    }

    const dynamic = options['m_dynamic_fields'];
    if (Array.isArray(dynamic)) {
        for (const raw of dynamic) {
            if (raw === null || typeof raw !== 'object') continue;
            const field = raw as Record<string, unknown>;
            const name = String(field['name'] ?? '').trim();
            if (!name.startsWith('m_')) continue;

            const opts = field['options'];
            if (!Array.isArray(opts)) continue;
            const values = opts
                .filter((o): o is Record<string, unknown> => o !== null && typeof o === 'object')
                .filter((o) => o['is_label'] !== true)
                .map((o) => String(o['value'] ?? '').trim())
                .filter((v) => v !== '');
            if (values.length > 0) choices[name] = values;
        }
    }

    return choices;
}

/**
 * Lines to print under a failure, or none at all.
 *
 * Reads the API's `details` array off a VidofyError. Duck-typed on purpose: the
 * error class lives in @vidofy/mcp and importing it here to run `instanceof`
 * would make an unrelated version mismatch swallow the hint in silence.
 */
export function fieldHints(err: unknown, choices: FieldChoices = {}): string[] {
    const problems = readProblems(err);
    if (problems.length === 0) return [];

    const rows = problems.map((p): [string, string] => {
        const flag = '--' + p.field.replace(/^m_/, '');
        /* The server's own list wins. It knows the constraints in play for THIS
           request — which resolutions the chosen duration allows, say — where
           the model row only describes the grid. */
        const allowed = p.allowed.length > 0 ? p.allowed : (choices[p.field] ?? []);

        const what = allowed.length > 0 ? `one of: ${allowed.join(', ')}` : 'required — it was not sent';
        const sent = p.input !== '' ? `   (you sent ${p.input})` : '';
        return [flag, what + sent];
    });

    const width = rows.reduce((w, [flag]) => Math.max(w, flag.length), 0);
    return rows.map(([flag, what]) => `  ${flag.padEnd(width)}  ${what}`);
}

function readProblems(err: unknown): FieldProblem[] {
    if (err === null || typeof err !== 'object') return [];
    const details = (err as { details?: unknown }).details;
    if (details === null || typeof details !== 'object') return [];

    const list = (details as Record<string, unknown>)['details'];
    if (!Array.isArray(list)) return [];

    const out: FieldProblem[] = [];
    for (const raw of list) {
        if (raw === null || typeof raw !== 'object') continue;
        const row = raw as Record<string, unknown>;
        const field = String(row['field'] ?? '').trim();
        if (!field.startsWith('m_')) continue;
        out.push({
            field,
            input: String(row['input'] ?? '').trim(),
            allowed: Array.isArray(row['allowed'])
                ? row['allowed'].map((x) => String(x).trim()).filter((x) => x !== '')
                : [],
        });
    }
    return out;
}

/* ── carrying the hints out to where errors are printed ───────────────────────
 *
 * The failure is printed by the top-level catch in index.ts, so the lines have
 * to survive the throw. A Symbol keeps them off every other view of the object —
 * JSON.stringify, console.log, a test's deepEqual — so an error still serialises
 * as an error.
 */
const HINTS = Symbol.for('vidofy.fieldHints');

/** Attach and return the same error, so it reads as `throw withHints(err, …)`. */
export function withHints(err: unknown, choices: FieldChoices): unknown {
    const lines = fieldHints(err, choices);
    if (lines.length > 0 && err !== null && typeof err === 'object') {
        (err as Record<symbol, unknown>)[HINTS] = lines;
    }
    return err;
}

export function hintsOf(err: unknown): string[] {
    if (err === null || typeof err !== 'object') return [];
    const v = (err as Record<symbol, unknown>)[HINTS];
    return Array.isArray(v) ? (v as string[]) : [];
}
