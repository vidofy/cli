#!/usr/bin/env node
/**
 * vidofy — the command line for Vidofy.
 *
 * ── Exit codes, because scripts read them ───────────────────────────────────
 *   0  it worked
 *   1  the request failed (network, server, a refused generation)
 *   2  you asked for something that does not exist (bad flag, unknown mode)
 *   3  not signed in
 *
 * 2 and 3 are separated on purpose: a CI job that gets 3 should re-run
 * `auth login` or fix VIDOFY_TOKEN, while one that gets 2 has a typo in its own
 * command and retrying will never help. Collapsing both into 1 is what makes a
 * pipeline retry forever on a mistake it cannot fix.
 *
 * ── No argument-parsing dependency ──────────────────────────────────────────
 * The page sells `npm i -g @vidofy/cli` as quick, and the surface here is small
 * and fixed. A parser library would be more code to audit than the twenty lines
 * it replaces, and it is the kind of dependency that later pulls in six more.
 */

import { VERSION } from './version.js';
import { NotSignedInError } from './session.js';
import { fail, note, out, dim, bold } from './ui.js';
import { balanceCommand } from './commands/balance.js';
import { modelsCommand } from './commands/models.js';
import { authCommand } from './commands/auth.js';
import { generateCommand } from './commands/generate.js';

const USAGE = `${bold('vidofy')} — generate AI video, images and voice from your terminal

  vidofy auth login              browser sign-in, token in ~/.vidofy/
  vidofy auth status             who is signed in
  vidofy auth logout             forget the token on this machine

  vidofy balance                 credits left on your account
  vidofy models list             every mode
  vidofy models list --mode t2i  every model in one mode

  vidofy generate create --model <slug> --prompt "…"
      --dry-run                  print the price and stop, spending nothing
      --wait                     wait for it, download it, print the path last
      --output <path>            where to write it
      --image <path>             send a file from this machine
  vidofy generate get <id>       a generation you started earlier

  --help        this
  --version     ${VERSION}

Docs: https://vidofy.ai/cli`;

async function main(argv: readonly string[]): Promise<number> {
    const [command, ...rest] = argv;

    if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
        note(USAGE);
        return command === undefined ? 2 : 0;
    }
    if (command === '--version' || command === '-v') {
        out(VERSION);
        return 0;
    }

    switch (command) {
        case 'balance':
            return balanceCommand(rest);
        case 'models':
            return modelsCommand(rest);
        case 'auth':
            return authCommand(rest);
        case 'generate':
            return generateCommand(rest);
        default:
            note(`Unknown command "${command}".`);
            note();
            note(USAGE);
            return 2;
    }
}

main(process.argv.slice(2))
    .then((code) => { process.exitCode = code; })
    .catch((err: unknown) => {
        if (err instanceof NotSignedInError) {
            fail(err.message);
            process.exitCode = 3;
            return;
        }
        // Everything else: the message, and the stack only when asked for it.
        // A stack trace is the right thing for us and the wrong thing for
        // someone who mistyped a model slug.
        const message = err instanceof Error ? err.message : String(err);
        fail(message);
        if ((process.env['VIDOFY_DEBUG'] ?? '') !== '' && err instanceof Error && err.stack) {
            note(dim(err.stack));
        }
        process.exitCode = 1;
    });
