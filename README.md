# @vidofy/cli

Generate AI video, images and voice from your terminal — one command, billed to
your own [Vidofy](https://vidofy.ai) account. Scriptable, pipeable, CI-ready.

```bash
npm i -g @vidofy/cli
vidofy auth login
vidofy generate create --model nano-banana-2-t2i --prompt "a red bicycle" --wait
```

Needs Node 18 or newer. Works on macOS, Linux, Windows, and inside a container.

---

## Signing in

```bash
vidofy auth login
```

Opens your browser, you approve once, and the token is written to
`~/.vidofy/credentials.json`. **No API key to copy into a config file.**

The approval happens on vidofy.ai, where your existing session identifies you —
this program never sees your password.

```bash
vidofy auth status     # which account, without a network call
vidofy auth logout     # forget the token on this machine
```

### On a server, or in CI

Sign in once on a machine that has a browser, then copy the token:

```bash
export VIDOFY_TOKEN="$(node -p "require('$HOME/.vidofy/credentials.json').token")"
```

`VIDOFY_TOKEN` takes precedence over the file, so a CI runner cannot pick up a
developer's token from a mounted home directory.

---

## Commands

### `vidofy balance`

```console
$ vidofy balance
494
credits · you@example.com
```

The number is on **stdout**; the label is on stderr. So this works:

```bash
if [ "$(vidofy balance)" -lt 100 ]; then echo "top up"; fi
```

### `vidofy models list [--mode <mode>]`

```console
$ vidofy models list --mode text-to-image
gpt-image-2-5-t2i
nano-banana-2-t2i
…
```

`--mode` accepts any of the three spellings a mode has — `text-to-image`, `t2i`,
or `Text to Image`. With no `--mode` it lists the modes instead.

One slug per line on stdout, so:

```bash
MODEL=$(vidofy models list --mode t2i | head -1)
```

### `vidofy generate create`

```bash
vidofy generate create --model <slug> --prompt "…" [options]
```

| Option | What it does |
|---|---|
| `--dry-run` | Prints the cost and exits. **Nothing is charged and no job starts.** |
| `--wait` | Waits, downloads the result, prints its absolute path as the last line. |
| `--output <path>` | Write it somewhere specific. Missing directories are created. |
| `--image <path>` | Send a file from this machine. Same for `--video`, `--audio`. |
| `--<anything>` | Any other flag is sent as a model field — see *Model options* below. |

**Price it first:**

```console
$ vidofy generate create --model nano-banana-2-t2i --prompt "…" --aspect_ratio 1:1 --dry-run
12 credits
12
Dry run — nothing was charged and no job was started.
```

**Wait for it, and capture the file:**

```bash
HERO=$(vidofy generate create --model nano-banana-2-t2i --prompt "a red bicycle" \
        --aspect_ratio 1:1 --wait)
open "$HERO"
```

The path is the **last line on stdout**, and it is the only thing on stdout —
progress goes to stderr. That is what makes `$( )` work.

**Or don't wait:**

```console
$ vidofy generate create --model nano-banana-2-t2i --prompt "…" --aspect_ratio 1:1
8446935260421334812574237
Started. Follow it with: vidofy generate get 8446935260421334812574237
```

### `vidofy generate get <id>`

```bash
vidofy generate get <id>            # prints the status
vidofy generate get <id> --wait     # waits, downloads, prints the path
```

---

## Model options

Every model has its own fields — aspect ratio, duration, resolution, quality,
voice, and others that differ per model. Pass them as flags and they are sent
through untouched:

```bash
vidofy generate create --model veo-3-1-fast-t2v --prompt "…" \
    --aspect_ratio 16:9 --duration 8 --resolution 1080p --wait
```

The CLI does not keep a list of these. New fields added to a model work the day
they are added, without updating this package.

To see what a model accepts, open it on
[vidofy.ai/en/models](https://vidofy.ai/en/models) — the same options the page
shows are the flags this CLI takes, and the price it shows is in the same coins
this CLI spends.

`--dry-run` prices a request without spending anything, and a **required** field
you left out comes back named. But a flag the model does not have is **ignored,
not rejected** — the field set is open-ended by design, so `--aspct_ratio` is
dropped in silence and the generation runs without it. Check the spelling
against the model's page.

---

## Exit codes

| | |
|---|---|
| `0` | It worked |
| `1` | The request failed — network, server, or a refused generation |
| `2` | You asked for something that does not exist — a bad flag, an unknown mode |
| `3` | Not signed in |

`2` and `3` are separate on purpose: a job that gets `3` should refresh its
token, while one that gets `2` has a mistake in its own command and retrying
will never help.

---

## Environment

| Variable | Effect |
|---|---|
| `VIDOFY_TOKEN` | Use this token instead of `~/.vidofy/`. The CI path. |
| `VIDOFY_API_BASE` | Point at a different origin. Defaults to `https://vidofy.ai`. |
| `VIDOFY_CONFIG_DIR` | Store credentials somewhere other than `~/.vidofy/`. |
| `VIDOFY_DEBUG` | Print a stack trace on failure. |
| `NO_COLOR` | Turn off colour. Also off automatically when stderr is not a terminal. |

---

## How this relates to the MCP connector

Same account, same balance, same models. The difference is who is typing.

- **This CLI** — you, or a script, or a coding agent that already lives in your
  shell. It can read files straight off your disk.
- **[The MCP connector](https://vidofy.ai/mcp)** — Claude or ChatGPT, in a
  conversation. Nothing to install: you paste one URL.

A generation started in either shows up in the same studio history.

---

## Development

```bash
npm install
npm run build
node test/contract.test.mjs
```

The tests assert the contract published at
[vidofy.ai/cli](https://vidofy.ai/cli) and run with no network and no
credentials.

This package depends on [`@vidofy/mcp`](https://github.com/vidofy/mcp) for its
HTTP layer — request signing, retries, and the idempotency that stops a repeated
command charging twice — so there is one audited path to the API rather than
two that drift.

## Licence

MIT
