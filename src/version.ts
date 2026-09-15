/**
 * The package version, taken from package.json rather than kept by hand — a
 * hand-maintained constant is the one that eventually disagrees with what npm
 * actually installed, and `vidofy --version` is the first thing anyone reports
 * in a bug.
 *
 * WHY createRequire AND NOT `import pkg from '../package.json'`
 * ------------------------------------------------------------
 * Import attributes (`with { type: 'json' }`) need module ESNext/Node18+, and
 * this package is on Node16 to match @vidofy/mcp across the boundary — two
 * different module settings between packages that import each other produce
 * resolution failures that read as nonsense. tsc says so plainly (TS2823), so
 * this is a measured constraint rather than a preference.
 *
 * From dist/version.js, '../package.json' is the package root. npm always
 * includes package.json in a tarball regardless of the "files" list, so this
 * resolves for an installed copy exactly as it does here.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };

export const VERSION: string = pkg.version ?? '0.0.0';
