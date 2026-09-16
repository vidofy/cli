# @vidofy/cli

[![npm](https://img.shields.io/npm/v/@vidofy/cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/@vidofy/cli)
[![node](https://img.shields.io/badge/node-%E2%89%A518-5fa04e?logo=node.js&logoColor=white)](https://nodejs.org)
[![licence](https://img.shields.io/badge/licence-MIT-blue)](./LICENSE)

Generate AI **video, images, audio and speech from your terminal** — one command,
billed to your own [Vidofy](https://vidofy.ai) account. Scriptable, pipeable,
CI-ready.

Over 570 models, including **Veo 3.1**, **Kling 3.0**, **Flux 2**,
**Seedance 2.5**, **Wan 2.7**, **Hailuo 2.3**, **Runway**, **Luma Ray 2**,
**Qwen Image 3.0**, **Vidu Q3** and **LTX 2** — text-to-video, image-to-video,
text-to-image, image editing, video and photo effects, lipsync, text-to-speech
and voice cloning.

```bash
npm i -g @vidofy/cli
vidofy auth login
vidofy generate create --model nano-banana-2-t2i --prompt "a red bicycle" \
    --aspect_ratio 1:1 --wait
```

Needs Node 18 or newer. Works on macOS, Linux, Windows, and inside a container.

Most models require at least one option of their own — this one wants an aspect
ratio. You never have to guess which: leave it out and the error names it, or run
the command with `--dry-run` first, which prices it without spending anything.
See [*Model options*](#model-options).

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

Create a **personal token** at **vidofy.ai → Studio → Account → MCP Access**, and
give it to the runner:

```bash
export VIDOFY_TOKEN="vmt_..."
```

**Do not copy the token out of `~/.vidofy/`.** This page used to tell you to, and
it does not work: `vidofy auth login` obtains its token through the browser
sign-in, which binds it to that one client. Sent any other way it is refused —
with the unhelpfully general *"This MCP token is not valid. Create a new one"*,
which no new sign-in would fix. A token you create on the account page carries no
such binding, which is what makes it the one to put in an environment variable.

It is also the safer half of the trade. A CI token is a separate credential you
can revoke on its own; copying your workstation's means revoking one revokes both,
usually at the least convenient moment.

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

**The modes, and roughly what each holds:**

| Mode | `--mode` | What it does |
|---|---|---|
| Video Effects | `video-effects` | one-click effects applied to a clip |
| Image to Video | `i2v` | animate a still — Veo 3.1, Kling 3.0, Hailuo 2.3, Wan 2.7 |
| Text to Video | `t2v` | a clip from a prompt — Veo 3.1, Seedance 2.5, LTX 2, Vidu Q3 |
| Photo Effects | `photo-effects` | one-click effects applied to a photo |
| Text to Image | `t2i` | an image from a prompt — Flux 2, Qwen Image 3.0, Nano Banana |
| Image to Image | `i2i` | edit or restyle an existing image |
| First to Last Frame | `flf2v` | a clip that travels between two stills |
| Reference to Video | `r2v` | a clip that keeps a reference subject |
| Image Tools | `image-tools` | upscale, remove background, and similar |
| Video to Video | `v2v` | restyle or transform an existing clip |
| Text to Speech | `t2s` | speech from text |
| Lip Sync | `lipsync` | match a face to an audio track |
| Motion Control | `m2c` | drive motion from a reference |
| Voice Cloning | `v2c` | speech in a cloned voice |

The catalogue changes without a release of this package — `vidofy models list`
always answers from the server, never from a table baked in here.

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

**You do not have to look them up first.** A required option you left out, or a
value the model does not accept, comes back with the flag and the list:

```console
$ vidofy generate create --model flux-schnell-t2i --prompt "…" --aspect_ratio 7:3 --dry-run
✗ Please choose a valid value for: Aspect Ratio.
  --aspect_ratio  one of: 1:1, 3:4, 4:3, 9:16, 16:9   (you sent 7:3)
```

Put `--dry-run` on it and that costs nothing at all — it prices the request and
stops, so this is a free way to find out what a model wants.

To browse them instead, open the model on
[vidofy.ai/en/models](https://vidofy.ai/en/models) — the same options the page
shows are the flags this CLI takes, and the price it shows is in the same coins
this CLI spends.

One thing is NOT reported: a flag the model does not have is **ignored, not
rejected** — the field set is open-ended by design, so `--aspct_ratio` is dropped
in silence and the generation runs without it. A flag that seems to do nothing is
almost always spelled wrong.

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

## Troubleshooting

**`Not signed in. Run `vidofy auth login`…`** — exit `3`. No token on this
machine. On a server with no browser, set `VIDOFY_TOKEN` instead (see *On a
server, or in CI*).

**`All of 7421, 7422, 7423, 7424, 7425 are in use`** — `auth login` waits for the
browser on one of five loopback ports, and every one is taken. Free one and run
it again. The ports are fixed because the sign-in redirect must match a list the
server publishes; a random port cannot be on it.

**`That is an API key (vky_…)`** — this CLI signs in to a personal Vidofy account
and spends its coins. It does not take an API key. Run `vidofy auth login`.

**`--model is required`** — exit `2`. Find one with
`vidofy models list --mode t2i`.

**`Missing required fields: …`** / **`Please choose a valid value for: …`** — the
model wants an option you did not send, or one it does not accept. The line under
the error names the flag and lists what it takes, so there is nothing to look up:

```console
$ vidofy generate create --model flux-schnell-t2i --prompt "a red bicycle" --dry-run
✗ Missing required fields: Aspect Ratio
  --aspect_ratio  one of: 1:1, 3:4, 4:3, 9:16, 16:9
```

**A flag did nothing** — a field the model does not have is dropped by the server
rather than rejected, so a typo like `--aspct_ratio` is silent. Check the
spelling on the model's page.

**`Could not price this first`** — the estimate failed, not the generation. With
`--dry-run` nothing was charged; without it the job still ran and was billed at
the real price.

**`Finished, but the result carried no file URL`** — the generation reached a
final state with no output. Nothing to download; check it with
`vidofy generate get <id>`.

Set `VIDOFY_DEBUG=1` to print a stack trace on any failure.

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
