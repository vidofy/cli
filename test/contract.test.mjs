/**
 * The contract /en/cli publishes, asserted against the built program.
 *
 * WHY THESE ASSERTIONS AND NOT OTHERS
 * -----------------------------------
 * Every check here maps to a sentence on a page that is already live. A person
 * reading that page forms an expectation; this file is where that expectation
 * either holds or fails loudly. Anything the page does not promise is not
 * tested here — it would be a test of my opinion, and it would make the file
 * something people skip.
 *
 * NO NETWORK. Everything here runs against a token-less, base-less process, so
 * the gate is honest on a laptop with no dev server and in CI. The network half
 * was measured by hand against the live site and is written into the commit
 * message for generate; repeating it here would make this file green or red for
 * reasons that have nothing to do with the code.
 *
 * The one thing this CANNOT catch, and the reason the manual pass still
 * mattered: a field name that is wrong on the wire. `m_slug` vs `m_model_key`,
 * `success` vs `completed` — the program is internally consistent about all of
 * those and only the server disagrees. Tests that mock the server would have
 * agreed with the bug.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ENTRY = join(here, '..', 'dist', 'index.js');

let pass = 0;
let fail = 0;

function ok(condition, label, detail = '') {
    if (condition) { pass++; console.log(`  PASS ${label}`); }
    else { fail++; console.log(`  FAIL ${label}${detail ? '  — ' + detail : ''}`); }
}

/** Run the CLI with an empty credential world, so nothing on this machine leaks in. */
function run(args, extraEnv = {}) {
    const home = mkdtempSync(join(tmpdir(), 'vidofy-gate-'));
    try {
        const r = spawnSync(process.execPath, [ENTRY, ...args], {
            encoding: 'utf8',
            env: {
                PATH: process.env.PATH,
                HOME: home,
                VIDOFY_CONFIG_DIR: home,
                NO_COLOR: '1',
                ...extraEnv,
            },
        });
        return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
    } finally {
        rmSync(home, { recursive: true, force: true });
    }
}

console.log('=== A. exit codes, because pipelines branch on them ===');
{
    const v = run(['--version']);
    ok(v.code === 0, 'exit 0 on --version', `got ${v.code}`);
    ok(/^\d+\.\d+\.\d+$/.test(v.out.trim()), 'a bare semver on stdout', JSON.stringify(v.out));

    ok(run(['--help']).code === 0, 'exit 0 on --help');
    ok(run([]).code === 2, 'exit 2 on no command at all');
    ok(run(['nonsense']).code === 2, 'exit 2 on an unknown command');
    ok(run(['models', 'nonsense']).code === 2, 'exit 2 on an unknown subcommand');
    ok(run(['generate', 'nonsense']).code === 2, 'exit 2 on an unknown generate subcommand');

    /* 3, not 1. A CI job that gets 3 fixes its token; one that gets 1 retries.
       Collapsing them is what makes a pipeline retry forever on a fixable
       credential problem. */
    ok(run(['balance']).code === 3, 'exit 3 — not signed in, distinct from a failure');
    ok(run(['auth', 'status']).code === 3, 'exit 3 from auth status when signed out');
}

console.log('=== B. stdout is the ANSWER; everything human goes to stderr ===');
{
    /* This is the published promise "the path is the LAST LINE it prints, so a
       script can take it straight from there". It only holds if nothing else
       ever reaches stdout. */
    const h = run(['--help']);
    ok(h.out === '', 'help text is NOT on stdout', JSON.stringify(h.out.slice(0, 40)));
    ok(h.err.includes('vidofy generate create'), 'help text IS on stderr');

    const u = run(['nonsense']);
    ok(u.out === '', 'an unknown-command error is not on stdout');
    ok(u.err.includes('Unknown command'), 'and it is on stderr');

    const s = run(['balance']);
    ok(s.out === '', 'the not-signed-in error is not on stdout');
    ok(s.err.includes('auth login'), 'and it names the command that fixes it');
}

console.log('=== C. --model is required before anything is spent ===');
{
    const r = run(['generate', 'create', '--prompt', 'x']);
    ok(r.code === 2, 'exit 2 with no --model', `got ${r.code}`);
    ok(r.err.includes('--model'), 'and the message names the missing flag');
    ok(r.err.includes('models list'), 'and points at how to find one');
}

console.log('=== D. the help text matches what the page promises ===');
{
    /* The page is live and each of these is a sentence on it. A flag that
       disappears from --help is a flag someone will still type. */
    const h = run(['--help']).err;
    for (const promised of [
        'auth login', 'balance', 'models list',
        'generate create', 'generate get',
        '--dry-run', '--wait', '--output', '--image', '--model', '--prompt',
        '~/.vidofy/',
    ]) {
        ok(h.includes(promised), `--help mentions ${promised}`);
    }
}

console.log('=== E. a token is never printed back ===');
{
    /* auth status is pasted into issue reports and chat logs. It prints enough
       of the token to tell two apart and not enough to use one. */
    const secret = 'vmt_ABCDEFGHIJKL_THISPARTISSECRETANDMUSTNOTAPPEAR';
    const r = run(['auth', 'status'], { VIDOFY_TOKEN: secret });
    ok(r.code === 0, 'auth status succeeds with VIDOFY_TOKEN set', `got ${r.code}`);
    const all = r.out + r.err;
    ok(!all.includes('THISPARTISSECRET'), 'the secret half is absent from all output');
    ok(all.includes('vmt_ABCDEFGH'), 'a short prefix IS shown, so two tokens are distinguishable');
    ok(r.err.includes('VIDOFY_TOKEN'), 'and it says where the credential came from');
}

console.log('=== F. a wrong credential is refused before the wire ===');
{
    /* vky_ is an API KEY: a different namespace (/api/v1), a different wallet
       (B2B credits) and different prices. Sending it would 401 with nothing
       explaining why a perfectly valid key does not work here. The check comes
       from @vidofy/mcp's configForToken, which is the point of importing it. */
    const r = run(['balance'], { VIDOFY_TOKEN: 'vky_looks_like_a_real_api_key' });
    ok(r.code !== 0, 'an API key is refused', `got ${r.code}`);
    ok(/api key|api\/v1|partners/i.test(r.err), 'and the message explains which door it belongs to');

    const j = run(['balance'], { VIDOFY_TOKEN: 'total-nonsense' });
    ok(j.code !== 0, 'a junk token is refused');
    ok(j.err.includes('vmt_'), 'and the message names the shape a real one has');
}

console.log('=== G. a refused field names its flag and its values ===');
{
    /* The page's whole promise is that a command runs. When one does not, the
       server already says which field and often which values — and this program
       used to print the human label alone ("Aspect Ratio"), which is neither a
       flag anyone can type nor a value anyone can choose.
     *
     * Asserted against the real payload shapes, both measured on the live API:
     *   missing → details[{field, input:""}]           and NO `allowed`
     *   invalid → details[{field, input, allowed:[…]}]
     * The values for the first come from the model's own m_options, which
     * generate.ts already holds for the command in flight. */
    const { choicesFromOptions, fieldHints } = await import(join(here, '..', 'dist', 'fields.js'));

    const options = {
        m_aspect_ratio: ['1:1', '3:4', '16:9'],
        m_duration: { 3: ['360', '540'], 8: ['720', '1080'] },
        m_defaults: { m_duration: '8' },
        m_dynamic_fields: [
            { name: 'm_voice_id', required: true, options: [
                { value: 'Wise_Woman' }, { is_label: true, value: '—' }, { value: 'Calm_Woman' },
            ] },
        ],
    };

    const choices = choicesFromOptions(options, {});
    ok(choices.m_aspect_ratio.join() === '1:1,3:4,16:9', 'a base list becomes choices');
    ok(choices.m_duration.join() === '3,8', 'the duration MAP contributes its keys');
    ok(choices.m_resolution.join() === '720,1080',
        'and the resolutions of the DEFAULTED duration, not the first one', choices.m_resolution?.join());
    ok(choicesFromOptions(options, { m_duration: '3' }).m_resolution.join() === '360,540',
        'the request\'s own duration wins over the default');
    ok(choices.m_voice_id.join() === 'Wise_Woman,Calm_Woman',
        'a dynamic field offers its options, with the label row dropped');

    const missing = { details: { details: [{ field: 'm_aspect_ratio', input: '' }] } };
    const mLines = fieldHints(missing, choices).join('\n');
    ok(mLines.includes('--aspect_ratio'), 'a MISSING field names the flag to type');
    ok(mLines.includes('1:1, 3:4, 16:9'), 'and lists the values, which the server did not send');

    const invalid = {
        details: { details: [{ field: 'm_aspect_ratio', input: '7:3', allowed: ['1:1', '9:16'] }] },
    };
    const iLines = fieldHints(invalid, choices).join('\n');
    ok(iLines.includes('1:1, 9:16'), 'the server\'s own list wins over the model row');
    ok(!iLines.includes('3:4'), 'so a stale model row cannot contradict the live answer');
    ok(iLines.includes('you sent 7:3'), 'and the rejected value is quoted back');

    ok(fieldHints(new Error('plain'), choices).length === 0, 'an ordinary error produces no hints');
    ok(fieldHints({ details: { details: 'not-an-array' } }).length === 0, 'and neither does a shape we cannot read');
}

console.log('=== H. one credit is not "1 credits" ===');
{
    const { plural } = await import(join(here, '..', 'dist', 'ui.js'));
    ok(plural(1, 'credit') === 'credit', 'exactly one is singular');
    ok(plural(0, 'credit') === 'credits', 'zero is plural, as English has it');
    ok(plural(2, 'credit') === 'credits', 'and so is more than one');
}

console.log('========================================');
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
