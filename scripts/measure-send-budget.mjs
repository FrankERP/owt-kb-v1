// Measure ms/send through the real SMTP transport, so the notification sweep's
// knob inequality is derived from a number rather than assumed.
//
// Design spec §1 ("Bounding the sweep") states the constraint:
//
//     measured_ms_per_send × NOTIFY_FLUSH_EMAIL_LIMIT  <  NOTIFY_SEND_BUDGET_MS
//
// and calls it a release gate, not a knob to tune later. It matters because
// consumption is unconditional: a sweep that overruns its send budget stops
// sending, deletes the batch anyway, and the unserved tail is lost permanently —
// on exactly the 12–20-seat services the limit of 40 exists to protect.
//
// This sends REAL email. Dry-run by default; pass --apply. Every message goes to
// the single address you name with --to, never to the team.
//
//   node --env-file=.env.local scripts/measure-send-budget.mjs --to=you@example.com
//   node --env-file=.env.local scripts/measure-send-budget.mjs --to=you@example.com --apply
//
// Requires SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / EMAIL_FROM.
//
// `vercel env pull` is NOT enough: SMTP_PASS is a Sensitive variable and pulls as
// an 11-character redaction marker, which fails with `535 Incorrect
// authentication data` — a message that reads like a wrong password rather than a
// missing one. Supply it yourself.
//
// WHAT "IT" IS HAS CHANGED. The sender is now Gmail SMTP as
// `dev.raccoon.labs@gmail.com`, and SMTP_PASS is a Google APP PASSWORD — not the
// cPanel/MailBaby mailbox password for `contacto@oasis.mx`, which this header used
// to name and which no longer sends anything. An app password is shown once at
// creation and is not recoverable afterwards; see docs/SECRETS.md. Everything else
// pulls cleanly.
//
// Also pull into a scratch file, never .env.local — `vercel env pull` rewrites its
// target wholesale and will discard your local NEXTAUTH_URL and friends.
//
// FIDELITY CAVEAT, and it is not small: this runs from wherever you run it. The
// sweep runs on Vercel, whose network round-trip to the SMTP host may differ from
// your laptop's. Treat this as the order-of-magnitude answer that tells you
// whether the defaults are viable. The authoritative number is the `msPerSend`
// field on the `notify_sweep_done` log line, emitted by every production sweep
// that actually sends — that one is measured on the real path.
//
// AND CATCH THAT LOG LINE WHILE IT EXISTS. Vercel's runtime log retention on this
// plan is short: a sweep at 17:43 UTC on 2026-08-27 sent 14 emails, and by 19:15
// the line was already unqueryable through the Vercel API. If you want the
// authoritative number, read it within the hour or set up a log drain — otherwise
// all that survives is the sweep's own report, from which ms/send can only be
// BOUNDED rather than read (see docs/NOTIFICATIONS.md).
import nodemailer from "nodemailer";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const apply = process.argv.includes("--apply");
const to = arg("to", "");
const count = Number(arg("count", "20"));

// Defaults mirror app/utils/outboxSweep.ts. Override to evaluate a proposed
// retune without editing code.
const EMAIL_LIMIT = Number(arg("limit", process.env.NOTIFY_FLUSH_EMAIL_LIMIT ?? "40"));
const SEND_BUDGET_MS = Number(arg("budget", process.env.NOTIFY_SEND_BUDGET_MS ?? "40000"));
// MUST MIRROR `SEND_CONCURRENCY` in app/utils/email.ts. Not imported, because
// this runs under plain `node` and that constant lives in TypeScript — so it is
// explicit and printed rather than defaulted silently. Measuring at a width the
// sweep does not use produces a number the sweep can never reproduce, which is
// exactly what this file did while it hardcoded 1 and production shipped 8.
const CONCURRENCY = Number(arg("concurrency", "1"));
// The per-send reserve (`SEND_TIMEOUT_MS`). The sweep admits a wave only while
// `elapsed + reserve <= budget`, so the spendable window is the budget MINUS
// this — not the budget.
const RESERVE_MS = Number(arg("reserve", "20000"));

if (!to || !to.includes("@")) {
  console.error("refusing to run without an explicit recipient: --to=you@example.com");
  process.exit(2);
}
if (!Number.isFinite(count) || count < 1 || count > 60) {
  console.error(`--count must be 1..60, got ${arg("count", "20")}`);
  process.exit(2);
}
if (!Number.isFinite(CONCURRENCY) || CONCURRENCY < 1 || CONCURRENCY > 16) {
  console.error(`--concurrency must be 1..16, got ${arg("concurrency", "1")}`);
  process.exit(2);
}

const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM } = process.env;
const missing = Object.entries({ SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM })
  .filter(([, v]) => !v)
  .map(([k]) => k);
if (missing.length) {
  console.error(`missing env: ${missing.join(", ")}`);
  console.error("pull them from Vercel first — see docs/SECRETS.md");
  process.exit(2);
}

const port = Number(SMTP_PORT ?? 465);

console.log(`host       ${SMTP_HOST}:${port}`);
console.log(`from       ${EMAIL_FROM}`);
console.log(`to         ${to}  (every message; nothing reaches the team)`);
console.log(`count      ${count}`);
console.log(`width      ${CONCURRENCY}  (must mirror SEND_CONCURRENCY in app/utils/email.ts)`);
console.log(`evaluating ${EMAIL_LIMIT} recipients against a ${SEND_BUDGET_MS} ms budget`);
console.log("");

if (!apply) {
  console.log(`DRY RUN — would send ${count} messages to ${to}. Re-run with --apply to measure.`);
  process.exit(0);
}

// The production transport shape (app/utils/email.ts), with the width taken from
// --concurrency rather than hardcoded. It WAS hardcoded to 1, under a comment
// calling that "exactly the production transport shape" — true until 2026-08-27,
// when SEND_CONCURRENCY became 8. A measurement at the wrong width answers about
// a machine that does not exist.
const transport = nodemailer.createTransport({
  host: SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
  pool: true,
  maxConnections: CONCURRENCY,
  maxMessages: 100,
});

const timings = [];
const waveTimings = [];
let failures = 0;

const sendOne = async (i) => {
  const started = Date.now();
  try {
    await transport.sendMail({
      from: EMAIL_FROM,
      to,
      subject: `[medición w${CONCURRENCY}] envío ${i} de ${count}`,
      html: `<p>Medición del presupuesto de envío, ancho ${CONCURRENCY}. Mensaje ${i} de ${count}.</p>`,
    });
    return { i, ms: Date.now() - started };
  } catch (err) {
    return { i, error: err?.message ?? String(err) };
  }
};

// SENT IN WAVES OF `CONCURRENCY`, exactly as stage 7 does — and the WAVE is what
// the admission check charges, so wave duration is the number the inequality
// needs. The first wave pays connection setup and auth, so it is reported
// separately and excluded from the steady-state percentiles.
for (let i = 1; i <= count; i += CONCURRENCY) {
  const batch = [];
  for (let k = i; k < Math.min(i + CONCURRENCY, count + 1); k++) batch.push(k);
  const waveStarted = Date.now();
  const results = await Promise.all(batch.map(sendOne));
  const waveMs = Date.now() - waveStarted;
  waveTimings.push(waveMs);
  for (const r of results) {
    if (r.error) {
      failures++;
      process.stdout.write(`  ${String(r.i).padStart(2)}  FAILED  ${r.error}\n`);
    } else {
      timings.push(r.ms);
      process.stdout.write(`  ${String(r.i).padStart(2)} ${String(r.ms).padStart(6)} ms\n`);
    }
  }
  if (CONCURRENCY > 1) {
    process.stdout.write(`   └ oleada de ${batch.length}: ${waveMs} ms\n`);
  }
}

transport.close();

if (!timings.length) {
  console.error("\nevery send failed — nothing to measure");
  process.exit(1);
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const first = timings[0];
const steady = timings.slice(1);
const sorted = [...(steady.length ? steady : timings)].sort((a, b) => a - b);
const mean = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
const median = pct(sorted, 50);
const p95 = pct(sorted, 95);
const max = sorted[sorted.length - 1];

console.log("");
console.log(`sends        ${timings.length} ok, ${failures} failed`);
console.log(`first send   ${first} ms  (connection + auth)`);
console.log(`steady mean  ${mean} ms`);
console.log(`median       ${median} ms`);
console.log(`p95          ${p95} ms`);
console.log(`max          ${max} ms`);
console.log("");

// Evaluate against p95 rather than the mean. The budget is a wall-clock cliff
// with permanent data loss on the far side, so the question is not "how fast is
// a typical send" but "how slow can a batch plausibly be and still fit".
// IN THE RUNTIME'S FORM. The spec writes `ms_per_send × limit < budget`, which
// charges the reserve to nothing and ignores width. The loop admits a WAVE while
// `elapsed + reserve <= budget`, so what must fit is (waves − 1) wave durations
// against the SPENDABLE part. Layer 2's budget is derated above the reserve, not
// halved outright — this file asserted `SEND_BUDGET_MS / 2` until 2026-08-27,
// which is the expression production stopped using.
const waveSorted = [...(waveTimings.length > 1 ? waveTimings.slice(1) : waveTimings)].sort((a, b) => a - b);
const waveP95 = pct(waveSorted, 95);
const derate = (full) => Math.min(full, RESERVE_MS + Math.max(0, full - RESERVE_MS) / 2);
const layers = [
  ["layer 1", EMAIL_LIMIT, SEND_BUDGET_MS],
  ["layer 2", Math.floor(EMAIL_LIMIT / 2), derate(SEND_BUDGET_MS)],
];

console.log(`wave p95     ${waveP95} ms  (${CONCURRENCY} in flight)`);
console.log("");

let allHold = true;
for (const [name, limit, budget] of layers) {
  const waves = Math.ceil(limit / CONCURRENCY);
  const spendable = budget - RESERVE_MS;
  const needed = (waves - 1) * waveP95;
  const holds = needed <= spendable;
  if (!holds) allHold = false;
  console.log(
    `${name}: ${limit} recipients = ${waves} waves; (${waves} − 1) × ${waveP95} ms = ${needed} ms ` +
      `${holds ? "<=" : ">"} ${spendable} ms spendable  ${holds ? "HOLDS" : "DOES NOT HOLD"}`,
  );
}
console.log("");
console.log(
  `At this width the clock allows ${(Math.floor((SEND_BUDGET_MS - RESERVE_MS) / waveP95) + 1) * CONCURRENCY} ` +
    `recipients per layer-1 sweep, before NOTIFY_FLUSH_EMAIL_LIMIT caps it at ${EMAIL_LIMIT}.`,
);

console.log("");
if (allHold) {
  // The HEADROOM IS PER WAVE, not per send. Reporting `budget / limit` against a
  // per-send p95 mixes the two forms and can print a negative headroom under a
  // line that says HOLDS — which it did, because at width 8 an individual send is
  // slower (contention) while the WAVE is what the clock charges.
  const wavesAtLimit = Math.ceil(EMAIL_LIMIT / CONCURRENCY);
  const spendable = SEND_BUDGET_MS - RESERVE_MS;
  const used = (wavesAtLimit - 1) * waveP95;
  console.log(`Inequality holds at width ${CONCURRENCY}.`);
  console.log(`${wavesAtLimit} waves for ${EMAIL_LIMIT} recipients, ${used} ms of ${spendable} ms spendable,`);
  console.log(`leaving ${spendable - used} ms of margin.`);
  console.log("");
  console.log("DO NOT copy a measured number into MEASURED_MS_PER_SEND. That constant");
  console.log("guards the consistency of the SHIPPED DEFAULTS and is deliberately not the");
  console.log("real figure; raising it to keep a test green is the one forbidden move");
  console.log("(CLAUDE.md, docs/NOTIFICATIONS.md). Record the measurement in the docs.");
} else {
  console.log("Inequality DOES NOT hold. Per spec §1, derive rather than guess:");
  console.log(`  · raise NOTIFY_SEND_BUDGET_MS toward — but not past — maxDuration = 60 s, or`);
  console.log(`  · lower NOTIFY_FLUSH_EMAIL_LIMIT.`);
  console.log("");
  console.log("If lowering the limit would take it below the largest per-service seat");
  console.log("count (routinely 12–20 for a Sunday), STOP. Splitting one notice's");
  console.log("recipients across sweeps reintroduces per-recipient progress, which is a");
  console.log("different outbox model and must be designed deliberately.");
}

// Also note the read-phase caveat the final review surfaced: the sweep's budget
// clock now starts at the send loop (commit 18b602b), so this comparison is the
// right one — but the route's total maxDuration = 60 s still has to cover the
// read phase on top of the send budget.
console.log("");
console.log(`Remember the route's own ceiling: maxDuration = 60 s must cover the read`);
console.log(`phase plus this send budget, not just the sends.`);
