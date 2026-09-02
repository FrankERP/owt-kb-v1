// scripts/lib/requeueArgs.mjs
//
// Pure argv parsing for `requeue-role-notices.mjs`. Kept out of the script so
// it can be unit-tested without a Sanity client or a token.
//
// `--before <memberId>=<label>[,<label>]`, repeatable. The labels are the seat
// names `rolesForMember` produces ("Líder", "BGV", "Coro", an instrument name,
// an FOH role) — exactly what the real writer snapshots into
// `before.beforeRoles`. Whitespace around labels is trimmed; empty labels are
// dropped, and a pair left with none is rejected so `--before m1=` cannot pass
// as "m1 held no seat" — omit the flag for that.
//
// `--only <memberId>[,<memberId>]`, repeatable. Restricts the members queued to
// the ones named (plus every `--before` member, who is always queued). Without
// it every member currently stored on the service is queued, which is right for
// a lost publish and wrong for a lost edit: the members the edit did not touch
// would be re-introduced as newly assigned.

/**
 * @param {string[]} argv process.argv.slice(2)
 * @returns {{ before: Map<string, string[]>, only: Set<string> | null, rest: string[] }}
 *   `before`: memberId → labels held before the write.
 *   `only`: the members to queue, or null when every stored member is meant.
 *   `rest`: argv with every `--before` and `--only` removed.
 * @throws {Error} on a malformed flag, so a typo cannot silently queue a
 *   "newly assigned" line for someone who was in fact removed.
 */
export function parseRequeueArgs(argv) {
  const before = new Map();
  let only = null;
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const flag = arg === "--before" || arg === "--only" ? arg : arg.startsWith("--before=") ? "--before" : arg.startsWith("--only=") ? "--only" : null;
    if (!flag) {
      rest.push(arg);
      continue;
    }
    let value;
    if (arg === flag) {
      value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    } else {
      value = arg.slice(flag.length + 1);
    }

    if (flag === "--only") {
      const ids = value.split(",").map((s) => s.trim()).filter(Boolean);
      if (!ids.length) throw new Error(`--only: no member ids in "${value}"`);
      only ??= new Set();
      for (const id of ids) only.add(id);
      continue;
    }

    const eq = value.indexOf("=");
    if (eq <= 0) throw new Error(`--before: expected <memberId>=<label>, got "${value}"`);
    const memberId = value.slice(0, eq).trim();
    const labels = value.slice(eq + 1).split(",").map((s) => s.trim()).filter(Boolean);
    if (!memberId) throw new Error(`--before: empty member id in "${value}"`);
    if (!labels.length) throw new Error(`--before: no labels for ${memberId} — omit the flag instead`);
    // A repeated member merges, preserving order and dropping duplicates, so
    // `--before m1=Líder --before m1=BGV` reads the same as `--before m1=Líder,BGV`.
    const merged = [...(before.get(memberId) ?? [])];
    for (const label of labels) if (!merged.includes(label)) merged.push(label);
    before.set(memberId, merged);
  }
  return { before, only, rest };
}

/**
 * The `--` tokens left in `rest` that the script does not understand. A
 * misspelt flag (`--befor m1=Líder`) would otherwise fall through the
 * `!a.startsWith("--")` role-id filter, leave `before` empty, and queue every
 * stored member with an EMPTY snapshot — the exact outcome `--before` exists to
 * prevent, on a dry run that looks plausible. The script refuses the invocation
 * instead.
 *
 * @param {string[]} rest      argv after `parseRequeueArgs`
 * @param {string[]} allowed   the boolean flags the script accepts
 * @returns {string[]}
 */
export function unknownFlags(rest, allowed) {
  return rest.filter((a) => a.startsWith("--") && !allowed.includes(a));
}

/**
 * The members one invocation queues, in a stable order: the stored assignees
 * (or the `--only` set), then every `--before` member not already named. A
 * member removed by the edit is in `before` only, and is exactly who a plain
 * enumeration of stored seats would drop.
 *
 * An `--only` member who is neither stored nor in `--before` is queued with an
 * empty snapshot against a live state that does not hold them; the classifier
 * reads that as `[] → []` and stays silent. Harmless, and not worth a guard
 * that would have to re-read the role here.
 *
 * @param {string[]} stored   `seatAssignees(normalizeStoredSeats(role))`
 * @param {Set<string> | null} only
 * @param {Map<string, string[]>} before
 * @returns {string[]}
 */
export function membersToQueue(stored, only, before) {
  return [...new Set([...(only ?? stored), ...before.keys()])];
}
