/**
 * Everything this program prints, and which stream it goes to.
 *
 * ── THE ONE RULE THAT IS A PUBLIC CONTRACT ──────────────────────────────────
 * /en/cli promises: "With --wait it is downloaded into the directory you ran
 * the command in, and the path is the LAST LINE it prints, so a script can take
 * it straight from there."
 *
 * That sentence is the reason for the stdout/stderr split below. A script does
 *
 *     FILE=$(vidofy generate create … --wait | tail -1)
 *
 * and everything we print for a human — progress, spinners, "waiting for the
 * model" — would land in that variable if it went to stdout. So:
 *
 *     stdout  = the ANSWER. Machine-readable, nothing else.
 *     stderr  = everything a human reads: progress, warnings, errors.
 *
 * This is the same split `curl`, `git` and `gh` use, and it is what makes them
 * pipeable. Breaking it does not fail a test; it silently corrupts whatever the
 * caller does next with $FILE.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 * Off when stderr is not a TTY (a CI log full of escape codes is worse than a
 * plain one), off when NO_COLOR is set (no-color.org), and off when TERM=dumb.
 */

const useColour = ((): boolean => {
    if ((process.env['NO_COLOR'] ?? '') !== '') return false;
    if ((process.env['TERM'] ?? '') === 'dumb') return false;
    return process.stderr.isTTY === true;
})();

const paint = (code: string, s: string): string => (useColour ? `[${code}m${s}[0m` : s);

export const dim = (s: string): string => paint('2', s);
export const bold = (s: string): string => paint('1', s);
export const red = (s: string): string => paint('31', s);
export const green = (s: string): string => paint('32', s);
export const yellow = (s: string): string => paint('33', s);

/** The answer. One per command, and a script may read it. */
export function out(line: string): void {
    process.stdout.write(line + '\n');
}

/** For a human. Never parsed, never piped into anything. */
export function note(line = ''): void {
    process.stderr.write(line + '\n');
}

export function warn(line: string): void {
    note(`${yellow('!')} ${line}`);
}

export function fail(line: string): void {
    note(`${red('✗')} ${line}`);
}

export function ok(line: string): void {
    note(`${green('✓')} ${line}`);
}

/**
 * Right-pad every first column to the same width so a list reads as a table.
 * Written here rather than pulled in, because a table formatter is not worth a
 * dependency in a program whose whole point is that `npm i -g` is quick.
 */
export function table(rows: readonly (readonly [string, string])[]): string[] {
    const width = rows.reduce((w, r) => Math.max(w, r[0].length), 0);
    return rows.map(([a, b]) => `${a.padEnd(width)}  ${dim(b)}`);
}
