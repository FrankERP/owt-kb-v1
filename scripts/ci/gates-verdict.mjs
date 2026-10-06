#!/usr/bin/env node
// The `gates` job's only verdict — wired from .github/workflows/ci.yml, which
// passes `toJSON(needs)` in NEEDS_JSON through `env:`.
//
// Exit 0 only if every job `gates` needs concluded `success`; anything else —
// `failure`, `cancelled`, `skipped`, a missing result, an empty or unreadable
// NEEDS_JSON — exits 1 and names the jobs that did not succeed. A crash here also
// exits non-zero, so a broken runner fails closed.
//
// Runs on the runner's preinstalled Node, with no `npm ci`: Node builtins only.
// See docs/CI.md «Why `gates` is an aggregator».

import { gatesVerdict } from "../lib/ci-layout.mjs";

const { ok, lines } = gatesVerdict(process.env.NEEDS_JSON);
for (const line of lines) console.log(line);
process.exit(ok ? 0 : 1);
