/**
 * n8n Code node — Family Planner: queue-stuck check
 * =================================================
 *
 * PASTE THE BODY OF `check()` INTO AN n8n "Code" NODE (mode: "Run Once for All
 * Items"). This file is the source of truth for the node logic, kept in-repo so
 * it is versioned and testable (`node app/n8n/queue-stuck-check.code-node.js`
 * runs the self-check at the bottom).
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The InstantDrainer reports `status=success` even when every Send Email fails
 * (only the Send node errors; the workflow completes). So a dead Gmail SMTP
 * credential silently parks rows at `failed:true` while the UI looks green and
 * inboxes stay empty — exactly the 2026-06-25 BadCredentials outage. This hourly
 * check watches the queue itself and alerts via healthchecks.io (NOT email — the
 * alert must not depend on the same SMTP that breaks).
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Given the `email_queue` map (the Firebase value, an object keyed by row id)
 * from the upstream HTTP GET, it counts rows with `failed === true` and emits
 * EXACTLY ONE item describing queue health:
 *   { clean: true,  stuck: 0, total: N, ids: [] }                 → healthy
 *   { clean: false, stuck: K, total: N, ids: [first up to 20] }   → stuck
 * Always one item (never []), so the empty-items heartbeat trap can't bite — the
 * downstream IF routes the single item to the up-ping or the /fail-ping.
 *
 * ── n8n output contract ──────────────────────────────────────────────────────
 * Downstream IF node branches on `{{ $json.clean }}`:
 *   clean === true  → Heartbeat (GET hc-ping.com/<uuid>)        → check stays up
 *   clean === false → Heartbeat fail (GET hc-ping.com/<uuid>/fail) → emails Brad
 * The /fail ping forces healthchecks.io DOWN immediately rather than waiting for
 * the period+grace window to lapse.
 */

/**
 * Core, testable. `queueMap` is the Firebase `email_queue` value: an object
 * `{ <rowId>: <entry>, ... }`, or null/empty when the queue is empty.
 * Returns the single status object the Code node emits (wrapped in n8n's
 * { json } shape by `check()`).
 */
function evaluateQueue(queueMap) {
    const map = (queueMap && typeof queueMap === 'object' && !Array.isArray(queueMap)) ? queueMap : {};
    const ids = Object.keys(map);
    const stuckIds = [];
    for (const id of ids) {
        const e = map[id];
        // A row is "stuck" iff it exhausted retries: failed === true AND not later
        // re-sent. `sent` winning over `failed` mirrors classifyQueueEntry() in the
        // app (a retry could PATCH sent:true without clearing the historical flag).
        if (e && e.failed === true && e.sent !== true) stuckIds.push(id);
    }
    return {
        clean: stuckIds.length === 0,
        stuck: stuckIds.length,
        total: ids.length,
        ids: stuckIds.slice(0, 20), // cap so a mass-failure payload stays small
    };
}

/**
 * ── n8n entry point ──────────────────────────────────────────────────────────
 * The upstream HTTP GET of `/household/family/email_queue.json` returns the
 * queue map as the first item's json (an object, or `null`/empty when the queue
 * is empty). Set the Code node to "Run Once for All Items".
 *
 * In n8n the final line is simply:  return check($input.all());
 */
function check(allItems) {
    const map = allItems && allItems[0] && allItems[0].json ? allItems[0].json : {};
    return [{ json: evaluateQueue(map) }];
}

// ── Self-check (runs only under Node, never in n8n) ──────────────────────────
if (typeof process !== 'undefined' && Array.isArray(process.argv)
    && /queue-stuck-check\.code-node\.js$/.test(process.argv[1] || '')) {
    runSelfCheck();
}

function runSelfCheck() {
    let pass = 0, fail = 0;
    const eq = (got, want, msg) => {
        const a = JSON.stringify(got), b = JSON.stringify(want);
        if (a === b) { pass++; } else { fail++; console.error(`FAIL: ${msg}\n  got:  ${a}\n  want: ${b}`); }
    };

    // 1. All-clean queue (sent + pending, no failed) → clean.
    eq(evaluateQueue({
        a: { sent: true }, b: { sent: false, failed: false },
    }), { clean: true, stuck: 0, total: 2, ids: [] }, '1: no failed rows → clean');

    // 2. One failed row → stuck.
    eq(evaluateQueue({
        a: { sent: true }, bad: { failed: true, sent: false },
    }), { clean: false, stuck: 1, total: 2, ids: ['bad'] }, '2: one failed → stuck');

    // 3. A row that failed then later re-sent (sent wins) → not stuck.
    eq(evaluateQueue({
        x: { failed: true, sent: true },
    }), { clean: true, stuck: 0, total: 1, ids: [] }, '3: failed-then-sent not counted');

    // 4. Empty / null queue → clean (nothing to send, nothing stuck).
    eq(evaluateQueue({}), { clean: true, stuck: 0, total: 0, ids: [] }, '4a: empty map');
    eq(evaluateQueue(null), { clean: true, stuck: 0, total: 0, ids: [] }, '4b: null queue');

    // 5. Firebase quirk: an array value is treated as no-map → clean (defensive).
    eq(evaluateQueue([]), { clean: true, stuck: 0, total: 0, ids: [] }, '5: array value defensive');

    // 6. Many failed rows → ids capped at 20, stuck count is the true total.
    const big = {};
    for (let i = 0; i < 25; i++) big['f' + i] = { failed: true, sent: false };
    const r = evaluateQueue(big);
    eq([r.clean, r.stuck, r.total, r.ids.length], [false, 25, 25, 20], '6: 25 failed → stuck=25, ids capped at 20');

    // 7. Malformed entries (null / non-object) are ignored, not crashed on.
    eq(evaluateQueue({
        a: null, b: 'oops', c: { failed: true, sent: false },
    }), { clean: false, stuck: 1, total: 3, ids: ['c'] }, '7: malformed entries skipped');

    console.log(`\nqueue-stuck-check self-check: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}
