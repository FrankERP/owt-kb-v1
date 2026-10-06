// The CI layout's rules, as pure functions — and the `gates` verdict.
//
// `main`'s branch protection requires ONE check, `gates`, matched by check-run
// NAME. Since the CI split, `.github/workflows/ci.yml` runs three working jobs in
// parallel (`node`, `solver-v2`, `solver-v3`) and a fourth, `gates`, that only
// aggregates them. That shape has a fail-open edge GitHub does not warn about: a
// job skipped by an unmet `needs` (or a false `if:`) concludes `skipped`, and a
// skipped required check counts as PASSING. So the rules below pin the shape, and
// `scripts/__tests__/ciLayout.test.ts` asserts them on the real files plus a set
// of permanent negative cases. See docs/CI.md «Why `gates` is an aggregator».
//
// NODE BUILTINS ONLY. `scripts/ci/gates-verdict.mjs` imports `gatesVerdict` from
// here and runs on the runner's preinstalled Node with no `npm ci`. That is also
// why the workflows are read with the small YAML-subset reader below rather than a
// parser this repository does not depend on directly: it models exactly what the
// workflows use and THROWS on anything else, so a reformatted file fails red,
// never green.
//
// The Python half models unittest's default discovery (Python 3.12) instead of
// running it, so it holds on every `npm test` whichever solver job is broken. It
// refuses every construct the model does not follow: `load_tests`, a `-p`
// pattern, `-s` differing from `-t`, an unreachable `test*.py`, a `*_test.py`.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const CI_WORKFLOW = ".github/workflows/ci.yml";
export const REQUIRED_CHECK = "gates";
export const VERDICT_SCRIPT = "scripts/ci/gates-verdict.mjs";
/** The two solver start directories, one CI job each. */
export const SOLVER_TREES = Object.freeze(["gcf", "gcf_v3"]);
/** The one module that holds `GOLDEN_SCHEDULE` (Linux x86_64 only; fails, not skips, in Actions). */
export const GOLDEN_MODULE = "gcf/test_inertness.py";

const DISCOVER_RE = /^python -m unittest discover -s (\S+) -t (\S+) -v$/;
// What `python -m X` puts on sys.path[0] is the working directory — the repo root
// in CI — so `gcf` imports as a namespace package inside the v3 job and `gcf_v3`
// inside the v2 job. The start directory isolates nothing; this table does.
const BANNED_IMPORTS = Object.freeze({ gcf_v3: ["gcf"], gcf: ["gcf_v3", "owt_v3"] });

// ── Workflow reader (a YAML subset; fails closed) ──────────────────────────────

class WorkflowParseError extends Error {}

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isSeqItem = (content) => content === "-" || content.startsWith("- ");

/** Strip a trailing ` # comment`, ignoring `#` inside a quoted scalar. */
function stripComment(s) {
  let quote = null;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (quote) {
      if (quote === "'" && c === "'") {
        if (s[k + 1] === "'") k++;
        else quote = null;
      } else if (quote === '"' && c === "\\") k++;
      else if (quote === '"' && c === '"') quote = null;
      continue;
    }
    if (c === "'" || c === '"') {
      const before = s.slice(0, k);
      const trimmed = before.trimEnd();
      const startsToken =
        trimmed === "" ||
        /[[,{]$/.test(trimmed) ||
        (/[:-]$/.test(trimmed) && /\s$/.test(before));
      if (startsToken) quote = c;
      continue;
    }
    if (c === "#" && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k).trimEnd();
  }
  return s.trimEnd();
}

function splitFlowItems(inner, fail) {
  const items = [];
  let quote = null;
  let start = 0;
  for (let k = 0; k < inner.length; k++) {
    const c = inner[k];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === "[" || c === "]" || c === "{" || c === "}") fail("nested flow collections are not modelled");
    else if (c === ",") {
      items.push(inner.slice(start, k));
      start = k + 1;
    }
  }
  if (quote) fail("unterminated quoted scalar in a flow sequence");
  items.push(inner.slice(start));
  return items.map((s) => s.trim());
}

function parseScalar(text, fail) {
  const s = text.trim();
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) fail(`unterminated single-quoted scalar: ${s}`);
    const body = s.slice(1, -1);
    if (/(^|[^'])'([^']|$)/.test(body.replace(/''/g, ""))) fail(`stray quote in ${s}`);
    return body.replace(/''/g, "'");
  }
  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"') || s.endsWith('\\"')) fail(`unterminated double-quoted scalar: ${s}`);
    const escapes = { "\\": "\\", '"': '"', "/": "/", n: "\n", t: "\t" };
    return s.slice(1, -1).replace(/\\(.)/g, (_, ch) => {
      if (!(ch in escapes)) fail(`escape \\${ch} is not modelled`);
      return escapes[ch];
    });
  }
  if (s === "[]") return [];
  if (s.startsWith("[")) {
    if (!s.endsWith("]")) fail(`a flow sequence must close on its own line: ${s}`);
    return splitFlowItems(s.slice(1, -1), fail).map((item) => {
      if (item === "") fail(`empty item in ${s}`);
      return parseScalar(item, fail);
    });
  }
  if (s === "{}") return {};
  if (/^[{&*!%@`]/.test(s)) fail(`not modelled: ${s} (flow mapping, anchor, alias, tag or reserved indicator)`);
  return s;
}

/** Parse a workflow into plain objects; every scalar stays a string. Throws on anything unmodelled. */
export function parseWorkflow(text) {
  const lines = String(text).replace(/\r\n?/g, "\n").split("\n");
  const overrides = new Map();
  let i = 0;

  const fail = (msg, lineNo) => {
    throw new WorkflowParseError(lineNo ? `line ${lineNo}: ${msg}` : msg);
  };

  function peek() {
    for (let k = i; k < lines.length; k++) {
      const raw = lines[k];
      if (/^\s*(#.*)?$/.test(raw)) continue;
      if (overrides.has(k)) return { ...overrides.get(k), index: k, lineNo: k + 1 };
      const lead = raw.slice(0, raw.length - raw.trimStart().length);
      if (lead.includes("\t")) fail("tab in indentation", k + 1);
      if (/^(---|\.\.\.)(\s|$)/.test(raw) || raw.startsWith("%")) fail("document markers and directives are not modelled", k + 1);
      return { indent: lead.length, content: stripComment(raw.trimStart()), index: k, lineNo: k + 1 };
    }
    return null;
  }

  function splitKey(t) {
    const c = t.content;
    let keyEnd;
    let key;
    if (c.startsWith("'") || c.startsWith('"')) {
      const close = c.indexOf(c[0], 1);
      if (close < 0) fail("unterminated quoted key", t.lineNo);
      key = c.slice(1, close);
      keyEnd = close + 1;
      if (c[keyEnd] !== ":") return null;
    } else {
      const m = /:(\s|$)/.exec(c);
      if (!m) return null;
      keyEnd = m.index;
      key = c.slice(0, keyEnd).trim();
      if (key === "" || /^[?&*!|>%@`{[]/.test(key)) fail(`key not modelled: ${key}`, t.lineNo);
    }
    if (key === "__proto__") fail("key __proto__", t.lineNo);
    return { key, rest: c.slice(keyEnd + 1).trim() };
  }

  function blockScalar(header, parentIndent, lineNo) {
    const m = /^([|>])([+-]?)$/.exec(header);
    if (!m) fail(`block scalar header not modelled: ${header}`, lineNo);
    const body = [];
    let contentIndent = null;
    let k = i;
    for (; k < lines.length; k++) {
      const raw = lines[k];
      if (raw.trim() === "") {
        body.push("");
        continue;
      }
      const indent = raw.length - raw.trimStart().length;
      if (contentIndent === null) {
        if (indent <= parentIndent) break;
        contentIndent = indent;
      }
      if (indent < contentIndent) break;
      body.push(raw.slice(contentIndent));
    }
    let trailing = 0;
    while (body.length && body[body.length - 1] === "") {
      body.pop();
      trailing++;
    }
    // Rewind to the last content line, so trailing blank lines are not consumed twice.
    i = k - trailing;
    let value = m[1] === "|" ? body.join("\n") : body.join("\n").replace(/([^\n])\n(?=[^\n])/g, "$1 ");
    if (body.length) {
      if (m[2] === "") value += "\n";
      else if (m[2] === "+") value += "\n".repeat(trailing + 1);
    }
    return value;
  }

  function value(rest, parentIndent, t) {
    if (rest === "") {
      const n = peek();
      if (n && n.indent > parentIndent) return node(n.indent);
      if (n && n.indent === parentIndent && isSeqItem(n.content)) return seq(parentIndent);
      return null;
    }
    if (/^[|>]/.test(rest)) return blockScalar(rest, parentIndent, t.lineNo);
    const v = parseScalar(rest, (msg) => fail(msg, t.lineNo));
    const n = peek();
    if (n && n.indent > parentIndent) fail("unexpected indentation (a multi-line plain scalar is not modelled)", n.lineNo);
    return v;
  }

  function map(indent) {
    const out = {};
    for (;;) {
      const t = peek();
      if (!t || t.indent < indent) break;
      if (t.indent > indent) fail("unexpected indentation", t.lineNo);
      if (isSeqItem(t.content)) fail("a sequence item where a mapping key was expected", t.lineNo);
      const kv = splitKey(t);
      if (!kv) fail(`expected \`key: value\`, found: ${t.content}`, t.lineNo);
      if (Object.prototype.hasOwnProperty.call(out, kv.key)) fail(`duplicate key: ${kv.key}`, t.lineNo);
      i = t.index + 1;
      out[kv.key] = value(kv.rest, indent, t);
    }
    return out;
  }

  function seq(indent) {
    const out = [];
    for (;;) {
      const t = peek();
      if (!t || t.indent < indent) break;
      if (t.indent > indent) fail("unexpected indentation", t.lineNo);
      if (!isSeqItem(t.content)) break;
      const after = t.content === "-" ? "" : t.content.slice(2);
      const item = after.trimStart();
      if (item === "") {
        i = t.index + 1;
        const n = peek();
        out.push(n && n.indent > indent ? node(n.indent) : null);
        continue;
      }
      const itemIndent = indent + (t.content.length - item.length);
      if (isSeqItem(item) || splitKey({ ...t, content: item })) {
        overrides.set(t.index, { indent: itemIndent, content: item });
        out.push(node(itemIndent));
      } else {
        i = t.index + 1;
        if (/^[|>]/.test(item)) out.push(blockScalar(item, indent, t.lineNo));
        else {
          out.push(parseScalar(item, (msg) => fail(msg, t.lineNo)));
          const n = peek();
          if (n && n.indent > indent) fail("unexpected indentation after a sequence scalar", n.lineNo);
        }
      }
    }
    return out;
  }

  function node(indent) {
    const t = peek();
    return isSeqItem(t.content) ? seq(indent) : map(indent);
  }

  const first = peek();
  if (!first) fail("empty workflow");
  if (first.indent !== 0) fail("the document must start at column 0", first.lineNo);
  const doc = node(0);
  const left = peek();
  if (left) fail("content the reader could not place", left.lineNo);
  if (!isMap(doc)) fail("a workflow must be a mapping");
  if (!isMap(doc.jobs)) fail("a workflow must have a `jobs:` mapping");
  for (const [id, job] of Object.entries(doc.jobs)) if (!isMap(job)) fail(`job ${id} is not a mapping`);
  return doc;
}

/** Lines that are not whole-line comments — what a `unittest` mention or a banned key is counted in. */
function significantLines(text) {
  return String(text)
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l));
}

function tryParse(file, text, problems) {
  try {
    return parseWorkflow(text);
  } catch (e) {
    problems.push(
      `[parse] ${file}: ${e.message} — the CI-layout guard reads workflows as a YAML subset ` +
        "and fails closed on anything it does not model (scripts/lib/ci-layout.mjs)",
    );
    return null;
  }
}

const asList = (v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
const isPositiveInt = (v) => typeof v === "string" && /^[1-9]\d*$/.test(v);
const stepsOf = (job) => (Array.isArray(job.steps) ? job.steps.filter(isMap) : []);
const stepLabel = (step, n) => (typeof step.name === "string" ? `"${step.name}"` : typeof step.uses === "string" ? step.uses : `#${n + 1}`);
const oneLine = (s) => JSON.stringify(s);

// ── The required check ────────────────────────────────────────────────────────

/**
 * Exactly one job across all workflows reports as `gates` (its `name:`, or its id
 * when nameless); it is job `gates` in ci.yml; it needs every other ci.yml job,
 * always runs, and exits through the verdict runner fed `toJSON(needs)` by `env:`.
 * @param {{ file: string, text: string }[]} workflows
 * @returns {string[]} problems; empty means the rule holds
 */
export function checkRequiredCheck(workflows) {
  const problems = [];
  const hits = [];
  let ci = null;
  for (const w of workflows) {
    const doc = tryParse(w.file, w.text, problems);
    if (!doc) continue;
    if (w.file === CI_WORKFLOW) ci = doc;
    for (const [id, job] of Object.entries(doc.jobs)) {
      const displayName = typeof job.name === "string" ? job.name : id;
      if (displayName === REQUIRED_CHECK) hits.push(`${w.file} job ${id}`);
    }
  }
  if (hits.length !== 1 || hits[0] !== `${CI_WORKFLOW} job ${REQUIRED_CHECK}`) {
    problems.push(
      `[required-check] exactly one job may report as "${REQUIRED_CHECK}" — job id ${REQUIRED_CHECK} in ${CI_WORKFLOW} — ` +
        `found ${hits.length ? hits.join(", ") : "none"}. Branch protection matches the required check by NAME, ` +
        "so a second one could satisfy it on its own, and a renamed one leaves protection waiting for nothing",
    );
  }
  if (!ci) {
    problems.push(`[required-check] ${CI_WORKFLOW} is missing or unreadable`);
    return problems;
  }
  const gates = ci.jobs[REQUIRED_CHECK];
  if (!gates) return problems;

  const others = Object.keys(ci.jobs).filter((id) => id !== REQUIRED_CHECK).sort();
  const needs = [...asList(gates.needs)].sort();
  if (others.length === 0 || JSON.stringify(needs) !== JSON.stringify(others)) {
    problems.push(
      `[required-check] gates.needs must list every other job in ci.yml — expected [${others.join(", ")}], ` +
        `found [${needs.join(", ")}]. A job left out is a suite whose failure never reaches the required check`,
    );
  }
  const cond = typeof gates.if === "string" ? gates.if.trim() : null;
  if (cond !== "${{ always() }}" && cond !== "always()") {
    problems.push(
      `[required-check] gates must have \`if: \${{ always() }}\`, found ${cond === null ? "no if:" : `\`if: ${cond}\``}. ` +
        "Without it a red job SKIPS gates, and GitHub treats a skipped required check as passing; " +
        "`!cancelled()` still skips it when the run is cancelled",
    );
  }
  if ("strategy" in gates) problems.push("[required-check] gates may not have a strategy/matrix — one check run, one verdict");
  if ("continue-on-error" in gates) problems.push("[required-check] gates may not have continue-on-error");
  if (!isPositiveInt(gates["timeout-minutes"])) problems.push("[required-check] gates needs a timeout-minutes");

  const verdict = stepsOf(gates).filter((s) => typeof s.run === "string" && s.run.includes(VERDICT_SCRIPT));
  if (verdict.length !== 1) {
    problems.push(`[required-check] gates must have exactly one step that runs ${VERDICT_SCRIPT}, found ${verdict.length}`);
  } else {
    const [step] = verdict;
    if (step.run.trim() !== `node ${VERDICT_SCRIPT}`) {
      problems.push(
        `[required-check] the verdict step must run exactly \`node ${VERDICT_SCRIPT}\`, found ${oneLine(step.run)} — ` +
          "job data travels through env:, never interpolated into the shell source",
      );
    }
    const fed = isMap(step.env) && typeof step.env.NEEDS_JSON === "string" ? step.env.NEEDS_JSON.replace(/\s+/g, "") : null;
    if (fed !== "${{toJSON(needs)}}") {
      problems.push("[required-check] the verdict step must receive `NEEDS_JSON: ${{ toJSON(needs) }}` through env:");
    }
  }
  return problems;
}

// ── No silent skips ───────────────────────────────────────────────────────────

/**
 * Nothing in ci.yml may skip a job or a step, or let one fail green: no path or
 * branch-ignore filter, no `if:` (except gates' `always()`), no continue-on-error,
 * no sparse checkout, and every job has a timeout.
 * @param {string} ciText
 * @returns {string[]}
 */
export function checkNoSilentSkips(ciText) {
  const problems = [];
  const doc = tryParse(CI_WORKFLOW, ciText, problems);
  if (!doc) return problems;
  if (isMap(doc.on)) {
    for (const [event, cfg] of Object.entries(doc.on)) {
      if (!isMap(cfg)) continue;
      for (const key of ["paths", "paths-ignore", "branches-ignore"]) {
        if (key in cfg) {
          problems.push(
            `[no-silent-skips] on.${event}.${key}: a filter skips the WHOLE workflow, gates included, and a ` +
              "missing or skipped required check either blocks every PR or passes it. A frontend-only PR runs both solver suites",
          );
        }
      }
    }
  }
  for (const [id, job] of Object.entries(doc.jobs)) {
    if (id !== REQUIRED_CHECK && "if" in job) {
      problems.push(`[no-silent-skips] job ${id} has \`if:\` — a skipped job reports \`skipped\`, which gates would have to vouch for`);
    }
    if (!isPositiveInt(job["timeout-minutes"])) {
      problems.push(`[no-silent-skips] job ${id} needs a timeout-minutes (docs/CI.md «Timing» sets each one)`);
    }
    stepsOf(job).forEach((step, n) => {
      if ("if" in step) {
        problems.push(
          `[no-silent-skips] job ${id} step ${stepLabel(step, n)} has \`if:\` — a skipped step leaves its job green, ` +
            "so a skipped test step is a suite that never ran",
        );
      }
    });
  }
  const lines = significantLines(ciText);
  if (lines.some((l) => l.includes("continue-on-error"))) {
    problems.push("[no-silent-skips] ci.yml uses continue-on-error — a failing job or step would conclude success");
  }
  if (lines.some((l) => l.includes("sparse-checkout"))) {
    problems.push("[no-silent-skips] ci.yml uses sparse-checkout — every job needs the full tree (fixtures, both solver trees)");
  }
  return problems;
}

// ── Solver commands ───────────────────────────────────────────────────────────

/**
 * Every `unittest` run is exactly `python -m unittest discover -s <dir> -t <dir> -v`;
 * one per job, two in total, over {gcf, gcf_v3}; each such job installs that
 * tree's requirements, sets up Python 3.12, runs on ubuntu-latest, and has no
 * matrix and no container.
 * @param {string} ciText
 * @returns {{ problems: string[], commands: { job: string, dir: string }[] }}
 */
export function checkSolverCommands(ciText) {
  const problems = [];
  const commands = [];
  const doc = tryParse(CI_WORKFLOW, ciText, problems);
  if (!doc) return { problems, commands };

  for (const [id, job] of Object.entries(doc.jobs)) {
    for (const step of stepsOf(job)) {
      if (typeof step.run !== "string" || !step.run.includes("unittest")) continue;
      const m = DISCOVER_RE.exec(step.run);
      if (!m || m[1] !== m[2]) {
        problems.push(
          `[commands] job ${id} runs ${oneLine(step.run)} — every unittest run must be exactly ` +
            "`python -m unittest discover -s <dir> -t <dir> -v`: one line, -s equal to -t, no -p. " +
            "That is the only form the partition model follows",
        );
        continue;
      }
      commands.push({ job: id, dir: m[1] });
    }
  }

  const mentions = significantLines(ciText).filter((l) => l.includes("unittest")).length;
  if (mentions !== commands.length) {
    problems.push(
      `[commands] ${mentions} non-comment line(s) of ci.yml mention unittest but ${commands.length} are the exact ` +
        "discover command — a reformatted run block (e.g. `run: |`) or an extra invocation is not modelled",
    );
  }

  const perJob = new Map();
  for (const c of commands) perJob.set(c.job, (perJob.get(c.job) ?? 0) + 1);
  for (const [job, n] of perJob) {
    if (n > 1) problems.push(`[commands] job ${job} runs ${n} discover commands — one suite per job`);
  }
  const dirs = commands.map((c) => c.dir).sort();
  if (JSON.stringify(dirs) !== JSON.stringify([...SOLVER_TREES].sort())) {
    problems.push(
      `[commands] expected exactly two discover commands, over ${SOLVER_TREES.join(" and ")}; found [${dirs.join(", ")}]`,
    );
  }
  for (const a of dirs) {
    for (const b of dirs) {
      if (a !== b && (a === "." || b.startsWith(`${a}/`))) {
        problems.push(`[commands] start directory ${a} contains ${b} — a module there would run in two jobs`);
      }
    }
  }

  for (const { job: id, dir } of commands) {
    const job = doc.jobs[id];
    if (job["runs-on"] !== "ubuntu-latest") {
      problems.push(`[commands] job ${id} must run on ubuntu-latest (x86_64), found ${oneLine(job["runs-on"])}`);
    }
    if ("strategy" in job) {
      problems.push(`[commands] job ${id} may not have a strategy/matrix — the suite (and GOLDEN_SCHEDULE) runs once per run`);
    }
    if ("container" in job) problems.push(`[commands] job ${id} may not run in a container`);
    const steps = stepsOf(job);
    const python = steps.some(
      (s) =>
        typeof s.uses === "string" &&
        s.uses.startsWith("actions/setup-python@") &&
        isMap(s.with) &&
        s.with["python-version"] === "3.12",
    );
    if (!python) problems.push(`[commands] job ${id} must set up Python 3.12 with actions/setup-python (the function's runtime)`);
    if (!steps.some((s) => s.run === `pip install -r ${dir}/requirements.txt`)) {
      problems.push(`[commands] job ${id} must install ${dir}/requirements.txt (\`pip install -r ${dir}/requirements.txt\`)`);
    }
  }
  return { problems, commands };
}

// ── The Python partition ──────────────────────────────────────────────────────

const basename = (p) => p.slice(p.lastIndexOf("/") + 1);
const dirname = (p) => p.slice(0, Math.max(0, p.lastIndexOf("/")));
const inTree = (tree, entries) => entries.filter((e) => e.path.startsWith(`${tree}/`));

/**
 * Model `python -m unittest discover -s <tree> -t <tree>` (default pattern
 * `test*.py`) over a file listing: a module is reachable iff its basename matches
 * `test*.py`, is a valid module name, and every directory between the tree and it
 * has an `__init__.py` (3.12 skips the rest silently).
 * @param {string} tree
 * @param {{ path: string, text?: string }[]} entries
 */
export function discoverTests(tree, entries) {
  const files = inTree(tree, entries).map((e) => e.path);
  const packages = new Set(files.filter((p) => basename(p) === "__init__.py").map(dirname));
  const reachable = [];
  const unreachable = [];
  const misnamed = [];
  for (const path of files) {
    const base = basename(path);
    if (!base.endsWith(".py")) continue;
    if (base.endsWith("_test.py")) misnamed.push(path);
    if (!/^test.*\.py$/.test(base)) continue;
    let ok = /^[_a-z]\w*\.py$/i.test(base);
    let dir = tree;
    for (const part of dirname(path).slice(tree.length + 1).split("/").filter(Boolean)) {
      dir = `${dir}/${part}`;
      if (!packages.has(dir)) ok = false;
    }
    (ok ? reachable : unreachable).push(path);
  }
  return { reachable: reachable.sort(), unreachable: unreachable.sort(), misnamed: misnamed.sort() };
}

/**
 * Every test module in each solver tree is reachable by that tree's job, and
 * nothing the model cannot follow is present.
 * @param {Record<string, { path: string, text?: string }[]>} trees
 * @returns {string[]}
 */
export function checkPartition(trees) {
  const problems = [];
  for (const tree of SOLVER_TREES) {
    const entries = trees[tree] ?? [];
    const { reachable, unreachable, misnamed } = discoverTests(tree, entries);
    for (const path of unreachable) {
      problems.push(
        `[partition] ${path} is a test module discovery cannot reach — every directory between ${tree}/ and it ` +
          "needs an __init__.py and its name must be a valid module name. It would run in no job, and nobody is told",
      );
    }
    for (const path of misnamed) {
      problems.push(`[partition] ${path}: unittest's pattern is test*.py, so a *_test.py file never runs — rename it test_*.py`);
    }
    for (const e of inTree(tree, entries)) {
      if (e.path.endsWith(".py") && typeof e.text === "string" && /^[^#\n]*\bload_tests\b/m.test(e.text)) {
        problems.push(`[partition] ${e.path} defines load_tests, which overrides discovery where the guard cannot follow it`);
      }
    }
    if (reachable.length === 0) {
      problems.push(
        `[partition] ${tree}/ has no reachable test module — its job would exit 5 (NO TESTS RAN), or 1 if the directory is missing`,
      );
    }
  }
  return problems;
}

/** `import a, b.c as d` / `from x.y import z` statements, with 1-based line numbers. */
export function pythonImports(text) {
  const out = [];
  const lines = String(text).split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const lineNo = n + 1;
    let logical = lines[n];
    while (logical.endsWith("\\") && n + 1 < lines.length) logical = `${logical.slice(0, -1)} ${lines[++n]}`;
    for (const segment of logical.split(";")) {
      const s = segment.trim();
      let m = /^from\s+([\w.]+)\s+import\b/.exec(s);
      if (m) {
        out.push({ line: lineNo, module: m[1] });
        continue;
      }
      m = /^import\s+(.+)$/.exec(s);
      if (!m) continue;
      for (const item of m[1].split("#")[0].split(",")) {
        const name = item.replace(/[()]/g, " ").trim().split(/\s+/)[0];
        if (name) out.push({ line: lineNo, module: name });
      }
    }
  }
  return out;
}

/**
 * Neither tree imports the other (plan C0, I2): nothing under gcf_v3/ imports
 * `gcf`; nothing under gcf/ imports `gcf_v3` or `owt_v3`. Statement forms only —
 * a dynamic `importlib`/`__import__` is a code-review matter.
 * @param {Record<string, { path: string, text?: string }[]>} trees
 * @returns {string[]}
 */
export function checkCrossTreeImports(trees) {
  const problems = [];
  for (const tree of SOLVER_TREES) {
    const banned = BANNED_IMPORTS[tree];
    for (const e of inTree(tree, trees[tree] ?? [])) {
      if (!e.path.endsWith(".py") || typeof e.text !== "string") continue;
      for (const { line, module } of pythonImports(e.text)) {
        const top = module.split(".")[0];
        if (banned.includes(top)) {
          problems.push(
            `[cross-tree-import] ${e.path}:${line} imports ${module} — ${tree}/ may not import ${banned.join(" or ")}. ` +
              "`python -m unittest` puts the repository root on sys.path, so the start directory does not isolate the trees",
          );
        }
      }
    }
  }
  return problems;
}

/**
 * `GOLDEN_SCHEDULE` runs exactly once per run, on Linux x86_64: its module is a
 * reachable `gcf` module, and the one job that discovers `gcf` is ubuntu-latest
 * with no matrix.
 * @param {string} ciText
 * @param {Record<string, { path: string, text?: string }[]>} trees
 * @returns {string[]}
 */
export function checkGoldenPlacement(ciText, trees) {
  const problems = [];
  const gcf = trees.gcf ?? [];
  if (!discoverTests("gcf", gcf).reachable.includes(GOLDEN_MODULE)) {
    problems.push(`[golden] ${GOLDEN_MODULE} is not a reachable module of the gcf tree — GOLDEN_SCHEDULE would run nowhere`);
  }
  const entry = gcf.find((e) => e.path === GOLDEN_MODULE);
  if (entry && typeof entry.text === "string" && !entry.text.includes("GOLDEN_SCHEDULE")) {
    problems.push(`[golden] ${GOLDEN_MODULE} no longer holds GOLDEN_SCHEDULE — update GOLDEN_MODULE in scripts/lib/ci-layout.mjs`);
  }
  const doc = tryParse(CI_WORKFLOW, ciText, problems);
  if (!doc) return problems;
  const jobs = checkSolverCommands(ciText).commands.filter((c) => c.dir === "gcf");
  if (jobs.length !== 1) {
    problems.push(`[golden] exactly one job must discover gcf, found ${jobs.length}`);
    return problems;
  }
  const job = doc.jobs[jobs[0].job];
  if (job["runs-on"] !== "ubuntu-latest" || "strategy" in job || "container" in job) {
    problems.push(
      `[golden] job ${jobs[0].job} runs GOLDEN_SCHEDULE, so it must be ubuntu-latest with no matrix and no container — ` +
        "inside Actions an off-platform golden FAILS instead of skipping, and a matrix runs it N times",
    );
  }
  return problems;
}

/**
 * Every rule, over all workflows and both solver trees.
 * @param {{ workflows: { file: string, text: string }[], trees: Record<string, { path: string, text?: string }[]> }} input
 * @returns {string[]}
 */
export function checkCiLayout({ workflows, trees }) {
  const problems = [...checkRequiredCheck(workflows)];
  const ci = workflows.find((w) => w.file === CI_WORKFLOW);
  if (ci) {
    problems.push(
      ...checkNoSilentSkips(ci.text),
      ...checkSolverCommands(ci.text).problems,
      ...checkGoldenPlacement(ci.text, trees),
    );
  }
  problems.push(...checkPartition(trees), ...checkCrossTreeImports(trees));
  return [...new Set(problems)];
}

/**
 * Every file under `<root>/<tree>`, as repo-relative POSIX paths; `.py` files carry
 * their text. Skips `__pycache__`. A missing tree is an empty listing (which
 * `checkPartition` reports).
 */
export function walkTree(root, tree) {
  const out = [];
  if (!existsSync(join(root, tree))) return out;
  const walk = (rel) => {
    const names = readdirSync(join(root, rel)).sort();
    for (const name of names) {
      if (name === "__pycache__") continue;
      const path = `${rel}/${name}`;
      const stat = statSync(join(root, path));
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) {
        out.push(path.endsWith(".py") ? { path, text: readFileSync(join(root, path), "utf8") } : { path });
      }
    }
  };
  walk(tree);
  return out;
}

// ── The verdict ───────────────────────────────────────────────────────────────

/**
 * The `gates` job's verdict over `toJSON(needs)`: ok only for a non-empty object
 * whose every entry's `result` is exactly "success". `skipped`, `cancelled`,
 * `failure` and a missing result are all red.
 * @param {string | undefined} raw
 * @returns {{ ok: boolean, lines: string[] }}
 */
export function gatesVerdict(raw) {
  const refuse = (why) => ({ ok: false, lines: [`::error::gates: ${why}`] });
  if (typeof raw !== "string" || raw.trim() === "") {
    return refuse("NEEDS_JSON is missing or empty — the job must pass ${{ toJSON(needs) }} through env:");
  }
  let needs;
  try {
    needs = JSON.parse(raw);
  } catch (e) {
    return refuse(`NEEDS_JSON is not valid JSON (${e.message})`);
  }
  if (!isMap(needs)) return refuse("NEEDS_JSON must be an object keyed by job id");
  const ids = Object.keys(needs);
  if (ids.length === 0) return refuse("NEEDS_JSON lists no jobs, so there is nothing to vouch for");

  const lines = [];
  const failed = [];
  for (const id of ids) {
    const result = isMap(needs[id]) && typeof needs[id].result === "string" ? needs[id].result : "missing";
    lines.push(`${id}: ${result}`);
    if (result !== "success") failed.push(`${id} (${result})`);
  }
  if (failed.length) {
    lines.push(`::error::gates: not every CI job succeeded — ${failed.join(", ")}`);
    return { ok: false, lines };
  }
  lines.push(`gates: all ${ids.length} jobs succeeded`);
  return { ok: true, lines };
}
