# BUILD_NOTES — free-model-aggregator-01

## What this entry is

An agent/v1 server competition entry (`main.ts`, Node 22, standard library only — nothing is
installed in the sandbox). It aggregates the brief's ten simulated free-tier providers behind
the OpenAI and Anthropic APIs. The graded artifact is the server; `dashboard/` is a bundled,
fully static human-facing catalog of the real free models (below).

## Data sources

- **Trial data** comes only from the trial brief (`$MAKEFUN_PROMPT_FILE`): the provider
  directory, the sealed quality table and the workload manifest, plus each provider's live
  catalog route at trial time. Nothing is hardcoded from a practice instance.
- **Dashboard snapshot**: `GET https://openrouter.ai/api/v1/models` (public, no key), fetched
  **2026-11-15T10:09:52Z**. 470 models in the catalog; **17 priced exactly $0** for prompt and
  completion; **15 are chat-usable** and listed in `dashboard/data.js` (the other two $0 entries
  are Google Lyria audio-generation models, excluded and noted on the page).

## The trial catalog (practice brief)

10 providers probed OK; 27 models listed; **26 free** (the one paid listing — OpenRouter's
Claude Opus — is in the catalog as not-free and is never routed to). `--list` prints the same
document the server registers; outside a trial it prints `{"providers":[]}`.

## Features

Server: three provider wires (OpenAI, Anthropic, Gemini) in both directions over one canonical
request form; rating-ordered routing against the manifest's requirements; JSON and SSE answers
on both client wires; usage and stop reasons carried from the serving provider; failover with
one same-model retry, then down the rating order, with a spent-provider heuristic that stops a
dead provider taxing later requests twice; deterministic by construction (no clock, no
randomness in anything sent).

Dashboard: instant search; provider, vision-input and minimum-context filters; sort by context,
name or newest; task helper (chat / coding / long documents / vision / Indonesian) with honest
heuristic shortlists; compare up to 3 models side by side; per-model detail (modalities,
tokenizer, listing date, best-for notes). Zero network requests — the snapshot is bundled.

## Verification (all local, with the official kit)

Practice trials run end-to-end (kit env standalone + this server + kit scorer):

| Trial | Score | Quality | Served | Wire | Failover | Catalog | Valid | Upstream calls |
|---|---|---|---|---|---|---|---|---|
| 0 | 99 | 99 | 100 | 100 | 100 | 100 | 20/20 | 34 |
| 1 | 99 | 99 | 100 | 100 | 100 | 100 | 20/20 | 37 |
| 2 | 99 | 99 | 100 | 100 | 100 | 100 | 20/20 | 43 |

Quality 99 is the structural ceiling on these instances: the top model's per-trial budget is
smaller than the number of requests it is best for, so a few late requests are necessarily
served by the 1470-rated runner-up instead of the 1475 leader. A repeated trial-0 run left a
**byte-for-byte identical state export** (replay determinism). The spent-provider heuristic cut
upstream calls from 40/45/55 to 34/37/43 at identical scores.

Dashboard (headless Chromium over CDP, both packages share the design): 15 cards render, count
line correct, **zero console errors**; search “gemma” → 2; vision task → 9; long-documents task
→ 8; coding task ranks Cohere North Mini Code first; compare holds 3 models in 3 columns and
disables a 4th. `dashboard/screenshot.png` is a real render from that check.

## Differences from the -02 package

- **-01 (this one)** routes across ten simulated providers on three wires, keyed by the brief's
  own per-provider keys; quality comes from the sealed ratings table.
- **-02** is the live variant: one real provider (OpenRouter) reached through the grader's
  gateway with the entrant's own key; quality is proven against the gateway's call record.
- The dashboards are the same design; only -02's page carries the live panel (catalog re-check
  + test chat with the visitor's own key). The -01 server's “live” surface is the API itself.

## Unresolved / entrant-side

- **Submission is the entrant's**: create the public GitHub repo (suggested name
  `free-model-aggregator`), commit these files, and submit from the make.fun web UI with the
  session transcripts. This package was built, not submitted.
- **Transcript gate**: this competition's requirements set `handed_over_places: "none"` — an
  entry whose transcripts are a handed-over export is ranked but takes no paid place. That is
  a property of how the entry is submitted, not of this code; the first real submission is
  what settles it.
- `.makefun/owner.json` is omitted: it is only needed if the repo owner differs from the
  account's GitHub login, and no wallet value was available to put in it (none was invented).
- The kit's agent SDK (`sdk/makefun-agent.ts`) is not vendored: this entry never calls it
  (the starter does not either); the deliverables are `main.ts` + `LICENSE` at the root.
- Repo-creation timing: this competition's `repo_created_after_open` opened 2026-11-14T02:30Z,
  already past — a repo created now is within the window.
