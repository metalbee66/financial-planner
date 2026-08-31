/**
 * n8n Code node — FamilyPlanner: overdue/due-soon scan (v2.2.1)
 * ============================================================
 *
 * PASTE THE BODY OF `scan()` INTO AN n8n "Code" NODE (mode: "Run Once for All
 * Items"). This file is NOT imported by the app — it is the source of truth for
 * the logic that lives inside the n8n node, kept in-repo so it is versioned,
 * reviewable, and testable (`node app/n8n/overdue-scan.code-node.js` runs the
 * self-check at the bottom).
 *
 * ── What it does ────────────────────────────────────────────────────────────
 * Given the `projects` blob (tasks + prefs + digest_pending) read from Firebase
 * by the upstream HTTP node, it:
 *   1. finds non-done, assigned, dated tasks that are overdue (dueDate < today)
 *      or due-soon (today ≤ dueDate ≤ today+1) — overdue wins,
 *   2. resolves each assignee's notification prefs (master + per-kind + mode),
 *   3. for instant-mode recipients → emits an `email_queue` row,
 *      for digest-mode recipients → emits a `digest_pending` append,
 *   4. returns BOTH sets so the workflow can fan them to two Firebase writers.
 *
 * Cadence (decided 2026-06-23): re-notify EVERY DAY, no cap, NO dedupe state.
 * The scan is stateless — it re-emits for every still-overdue task each run.
 * That is intentional "keep nagging" behaviour for overdue items.
 *
 * ── Mirrors these app helpers (keep in sync if the app changes) ──────────────
 *   readAssignees / EMAIL_TO_USER (USER_TO_EMAIL) / shouldNotifyUser /
 *   shouldEnqueueInstantEmail / shouldAccumulateDigest / computeTimeBasedTriggers /
 *   buildEmailQueueEntry / buildDigestEntry / escapeHtmlForEmail
 *   — all in app/js/modules/projects/{data.js,notifications.js}.
 *
 * ── n8n output contract ──────────────────────────────────────────────────────
 * Returns one array of n8n items. Each item's json has a `_target` discriminator:
 *   { _target: 'email_queue', id, ...entry }      → write to email_queue/{id}
 *   { _target: 'digest',      user, entry }        → append to projects/digest_pending/{user}
 * Downstream IF/Switch on `_target` routes to the two Firebase PATCH/POST nodes.
 * If nothing qualifies, returns [] (the Merge→Set heartbeat tail still fires once).
 */

// ── Constants mirrored from the app (single source of truth = the app) ──
const EMAIL_TO_USER = {
    'metalbee66@gmail.com': 'brad',
    'dianaleshcheva@gmail.com': 'diana',
};
const USER_TO_EMAIL = Object.fromEntries(
    Object.entries(EMAIL_TO_USER).map(([email, id]) => [id, email])
);

const DEFAULT_APP_BASE_URL = 'https://metalbee66.github.io/financial-planner/';

const KIND_SUBJECT_PREFIX = {
    task_due_soon: 'Due soon',
    task_overdue: 'Overdue',
};

// ── Pure helpers mirrored from data.js / notifications.js ──

function readAssignees(task) {
    if (!task) return [];
    if (Array.isArray(task.assignees) && task.assignees.length > 0) return task.assignees;
    if (typeof task.assignee === 'string' && task.assignee) return [task.assignee];
    return [];
}

function participantEmail(participantId) {
    if (!participantId) return null;
    return USER_TO_EMAIL[participantId] || null;
}

function escapeHtmlForEmail(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/** Mirror of shouldNotifyUser: null prefs default-allow; master off mutes all. */
function shouldNotifyUser(prefs, kind) {
    if (!prefs) return true;
    if (prefs.master === false) return false;
    if (prefs.kinds && Object.prototype.hasOwnProperty.call(prefs.kinds, kind)) {
        return prefs.kinds[kind] !== false;
    }
    return true;
}

function shouldEnqueueInstantEmail(prefs, kind) {
    if (!shouldNotifyUser(prefs, kind)) return false;
    const mode = (prefs && prefs.mode) || 'instant';
    return mode === 'instant';
}

function shouldAccumulateDigest(prefs, kind) {
    if (!shouldNotifyUser(prefs, kind)) return false;
    return !!(prefs && prefs.mode === 'digest');
}

/**
 * Mirror of computeTimeBasedTriggers — returns one synthetic event per affected
 * task. overdue (dueDate < today) wins over due-soon (today ≤ due ≤ today+1).
 * Skips done / unassigned / dateless / unparseable-date tasks.
 */
function computeTimeBasedTriggers(tasks, todayIso, mutedProjects) {
    if (!Array.isArray(tasks) || !todayIso) return [];
    const todayMs = Date.parse(todayIso);
    if (Number.isNaN(todayMs)) return [];
    const tomorrowMs = todayMs + 24 * 60 * 60 * 1000;
    const out = [];
    for (const t of tasks) {
        if (!t || !t.dueDate || readAssignees(t).length === 0) continue;
        // Mirror of the client gate: a task muted via `notificationsOff`
        // produces no triggers at all (no email, no digest).
        if (t.status === 'done' || t.notificationsOff === true) continue;
        if (mutedProjects && mutedProjects.has(t.projectId)) continue;
        const dueMs = Date.parse(t.dueDate);
        if (Number.isNaN(dueMs)) continue;
        if (dueMs < todayMs) {
            out.push({ kind: 'task_overdue', task: t });
        } else if (dueMs <= tomorrowMs) {
            out.push({ kind: 'task_due_soon', task: t });
        }
    }
    return out;
}

/**
 * Mirror of projectNotificationsMuted: `on-hold` / `cancelled` projects are
 * silent. Live gate only — task `notificationsOff` flags are left untouched.
 * Projects live at `blob.items` in the same Firebase blob as the tasks.
 */
function mutedProjectIds(blob) {
    const items = (blob && Array.isArray(blob.items)) ? blob.items : [];
    const out = new Set();
    for (const p of items) {
        if (p && p.id && (p.status === 'on-hold' || p.status === 'cancelled')) out.add(p.id);
    }
    return out;
}

/** Stable-enough id without Date.now collisions across a single run. */
function makeQueueId(seq) {
    return 'eq_scan_' + seq;
}
function makeDigestId(seq) {
    return 'd_scan_' + seq;
}

/**
 * Build the deep link + summary the same way the app does, then the email row.
 * Mirrors buildEmailQueueEntry minus the notification wrapper (we synthesise the
 * summary text here since there's no bell notification object in the scan path).
 */
function buildOverdueSummary(kind, task) {
    if (kind === 'task_overdue') return `"${task.name}" is past its due date.`;
    return `"${task.name}" is due within 24 hours.`;
}

function sourceUrlFor(base, task) {
    if (task.projectId && task.id) return `${base}#/projects/${task.projectId}/tasks/${task.id}`;
    if (task.projectId) return `${base}#/projects/${task.projectId}`;
    return base;
}

function buildEmailRow(kind, task, recipientEmail, baseUrl, seq) {
    const base = (typeof baseUrl === 'string' && baseUrl) ? baseUrl : DEFAULT_APP_BASE_URL;
    const prefix = KIND_SUBJECT_PREFIX[kind] || 'Notification';
    const subject = `[Family Planner] ${prefix}${task.name ? ': ' + task.name : ''}`;
    const summary = buildOverdueSummary(kind, task);
    const sourceUrl = sourceUrlFor(base, task);
    const bodyHtml = `<p>${escapeHtmlForEmail(summary)}</p>`
        + `<p><a href="${escapeHtmlForEmail(sourceUrl)}">Open in Family Planner</a></p>`;
    const id = makeQueueId(seq);
    return {
        id,
        to: recipientEmail,
        subject,
        bodyHtml,
        kind,
        notificationId: null,
        taskId: task.id || null,
        projectId: task.projectId || null,
        sourceUrl,
        queuedAt: new Date().toISOString(),
        sent: false,
        sentAt: null,
        attempts: 0,
        failed: false,
    };
}

function buildDigestEntryForTask(kind, task, seq) {
    const prefix = KIND_SUBJECT_PREFIX[kind] || 'Notification';
    return {
        id: makeDigestId(seq),
        kind,
        title: `${prefix}: ${task.name}`,
        summary: buildOverdueSummary(kind, task),
        taskId: task.id || null,
        projectId: task.projectId || null,
        at: new Date().toISOString(),
    };
}

/**
 * Core, testable. `blob` is the `projects` Firebase value. `todayIso` is a
 * 'YYYY-MM-DD' (or full ISO) string for "today". `baseUrl` optional.
 * Returns { emailRows: [...], digestAppends: [{user, entry}], stats }.
 */
function scanBlob(blob, todayIso, baseUrl) {
    const tasks = (blob && Array.isArray(blob.tasks)) ? blob.tasks : [];
    const prefsMap = (blob && blob.prefs && typeof blob.prefs === 'object') ? blob.prefs : {};
    const triggers = computeTimeBasedTriggers(tasks, todayIso, mutedProjectIds(blob));

    const emailRows = [];
    const digestAppends = [];
    let seq = 0;

    for (const trig of triggers) {
        const recipients = readAssignees(trig.task);
        for (const user of recipients) {
            const prefs = prefsMap[user];
            if (!shouldNotifyUser(prefs, trig.kind)) continue;

            if (shouldEnqueueInstantEmail(prefs, trig.kind)) {
                const email = participantEmail(user);
                if (!email) continue; // external assignee with no address on file
                emailRows.push(buildEmailRow(trig.kind, trig.task, email, baseUrl, seq++));
            } else if (shouldAccumulateDigest(prefs, trig.kind)) {
                digestAppends.push({ user, entry: buildDigestEntryForTask(trig.kind, trig.task, seq++) });
            }
        }
    }

    return {
        emailRows,
        digestAppends,
        stats: {
            triggers: triggers.length,
            emails: emailRows.length,
            digests: digestAppends.length,
        },
    };
}

/**
 * ── n8n entry point ─────────────────────────────────────────────────────────
 * Paste FROM HERE down (the body) into the Code node. The upstream HTTP node
 * must return the `projects` blob as the first item's json (set the node to
 * "Run Once for All Items"). Adjust `todayIso` if your container TZ needs it —
 * n8n's GENERIC_TIMEZONE is Australia/Melbourne so `new Date()` is already local.
 */
function scan(allItems) {
    const blob = allItems && allItems[0] && allItems[0].json ? allItems[0].json : {};
    const now = new Date();
    const todayIso = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const { emailRows, digestAppends } = scanBlob(blob, todayIso);

    const out = [];
    for (const row of emailRows) {
        out.push({ json: { _target: 'email_queue', ...row } });
    }
    for (const d of digestAppends) {
        out.push({ json: { _target: 'digest', user: d.user, entry: d.entry } });
    }
    return out;
}

// In n8n the final line is simply:  return scan($input.all());

// ── Self-check (runs only under Node, never in n8n) ──────────────────────────
// The app is ESM ("type":"module"), so this file is loaded as an ES module:
// `process.argv[1]` is the run path when executed directly. n8n's sandbox has
// no `process.argv` shaped like this, so the block is skipped there.
if (typeof process !== 'undefined' && Array.isArray(process.argv)
    && /overdue-scan\.code-node\.js$/.test(process.argv[1] || '')) {
    runSelfCheck();
}

function runSelfCheck() {
    let pass = 0, fail = 0;
    const eq = (got, want, msg) => {
        const a = JSON.stringify(got), b = JSON.stringify(want);
        if (a === b) { pass++; }
        else { fail++; console.error(`FAIL: ${msg}\n  got:  ${a}\n  want: ${b}`); }
    };
    const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

    const TODAY = '2026-06-23';

    // 1. Overdue task, brad (instant by default / no prefs) → one email row.
    {
        const blob = {
            tasks: [{ id: 't1', projectId: 'p1', name: 'File subpoena', status: 'not-started',
                      assignees: ['brad'], dueDate: '2026-06-20' }],
            prefs: {},
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 1, digests: 0 }, '1: overdue brad → 1 email');
        const e = r.emailRows[0];
        eq(e.to, 'metalbee66@gmail.com', '1: recipient resolved to brad email');
        eq(e.subject, '[Family Planner] Overdue: File subpoena', '1: subject');
        eq(e.kind, 'task_overdue', '1: kind');
        ok(e.sourceUrl.endsWith('#/projects/p1/tasks/t1'), '1: deep link');
        eq([e.sent, e.failed, e.attempts], [false, false, 0], '1: fresh queue flags');
    }

    // 2. Due-soon (tomorrow) task, diana instant → one email, kind due_soon.
    {
        const blob = {
            tasks: [{ id: 't2', projectId: 'p1', name: 'Call accountant', status: 'in-progress',
                      assignees: ['diana'], dueDate: '2026-06-24' }],
            prefs: { diana: { master: true, mode: 'instant', kinds: {} } },
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 1, digests: 0 }, '2: due-soon diana → 1 email');
        eq(r.emailRows[0].kind, 'task_due_soon', '2: kind due_soon');
        eq(r.emailRows[0].to, 'dianaleshcheva@gmail.com', '2: diana email');
    }

    // 3. Overdue but digest-mode → goes to digestAppends, not emailRows.
    {
        const blob = {
            tasks: [{ id: 't3', projectId: 'p1', name: 'Renew rego', status: 'not-started',
                      assignees: ['brad'], dueDate: '2026-06-01' }],
            prefs: { brad: { master: true, mode: 'digest', kinds: {} } },
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 0, digests: 1 }, '3: digest-mode → digest append');
        eq(r.digestAppends[0].user, 'brad', '3: digest user');
        eq(r.digestAppends[0].entry.kind, 'task_overdue', '3: digest entry kind');
    }

    // 4. master:false → fully muted (no email, no digest).
    {
        const blob = {
            tasks: [{ id: 't4', name: 'X', status: 'not-started', assignees: ['brad'], dueDate: '2026-06-01' }],
            prefs: { brad: { master: false, mode: 'instant', kinds: {} } },
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 0, digests: 0 }, '4: master off mutes all');
    }

    // 5. per-kind off → task_overdue muted for that user.
    {
        const blob = {
            tasks: [{ id: 't5', name: 'Y', status: 'not-started', assignees: ['brad'], dueDate: '2026-06-01' }],
            prefs: { brad: { master: true, mode: 'instant', kinds: { task_overdue: false } } },
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 0, digests: 0 }, '5: per-kind off mutes overdue');
    }

    // 5b. task-level notificationsOff → no trigger at all (mute at source,
    // so unlike the prefs cases above this yields triggers: 0).
    {
        const blob = {
            tasks: [{ id: 't5b', name: 'Z', status: 'not-started', assignees: ['brad'],
                      dueDate: '2026-06-01', notificationsOff: true }],
            prefs: {},
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 0, emails: 0, digests: 0 }, '5b: task mute suppresses trigger');
    }

    // 5c. on-hold / cancelled project → its tasks are silent; an active
    // project in the same blob still notifies.
    {
        const blob = {
            items: [
                { id: 'ph', name: 'Held', status: 'on-hold' },
                { id: 'pc', name: 'Cancelled', status: 'cancelled' },
                { id: 'pa', name: 'Active', status: 'active' },
            ],
            tasks: [
                { id: 'h1', name: 'H', status: 'not-started', assignees: ['brad'], dueDate: '2026-06-01', projectId: 'ph' },
                { id: 'c1', name: 'C', status: 'not-started', assignees: ['brad'], dueDate: '2026-06-01', projectId: 'pc' },
                { id: 'a1', name: 'A', status: 'not-started', assignees: ['brad'], dueDate: '2026-06-01', projectId: 'pa' },
            ],
            prefs: {},
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 1, digests: 0 }, '5c: only the active project notifies');
        eq(r.emailRows[0].taskId, 'a1', '5c: the surviving trigger is the active-project task');
    }

    // 5d. Un-holding restores the previous state: the same blob with the
    // project flipped to active notifies again, and a task the user muted by
    // hand STAYS muted (the hold is a live gate, not a rewrite).
    {
        const mk = (projStatus) => ({
            items: [{ id: 'p9', name: 'P', status: projStatus }],
            tasks: [
                { id: 'k1', name: 'kept', status: 'not-started', assignees: ['brad'], dueDate: '2026-06-01', projectId: 'p9' },
                { id: 'k2', name: 'user-muted', status: 'not-started', assignees: ['brad'], dueDate: '2026-06-01', projectId: 'p9', notificationsOff: true },
            ],
            prefs: {},
        });
        const held = scanBlob(mk('on-hold'), TODAY);
        eq(held.stats, { triggers: 0, emails: 0, digests: 0 }, '5d: on hold → fully silent');
        const active = scanBlob(mk('active'), TODAY);
        eq(active.stats, { triggers: 1, emails: 1, digests: 0 }, '5d: un-held → notifies again');
        eq(active.emailRows[0].taskId, 'k1', '5d: hand-muted task stays muted after un-hold');
    }

    // 6. done / unassigned / dateless / due-later → no triggers.
    {
        const blob = {
            tasks: [
                { id: 'd1', name: 'done', status: 'done', assignees: ['brad'], dueDate: '2026-06-01' },
                { id: 'd2', name: 'unassigned', status: 'not-started', assignees: [], dueDate: '2026-06-01' },
                { id: 'd3', name: 'dateless', status: 'not-started', assignees: ['brad'], dueDate: null },
                { id: 'd4', name: 'future', status: 'not-started', assignees: ['brad'], dueDate: '2026-07-30' },
            ],
            prefs: {},
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 0, emails: 0, digests: 0 }, '6: skips done/unassigned/dateless/future');
    }

    // 7. External assignee with no email on file, instant → dropped silently.
    {
        const blob = {
            tasks: [{ id: 't7', name: 'Z', status: 'not-started', assignees: ['lawyer@external'], dueDate: '2026-06-01' }],
            prefs: {},
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 0, digests: 0 }, '7: external no-email dropped');
    }

    // 8. Joint task (two assignees, mixed modes) → one email + one digest.
    {
        const blob = {
            tasks: [{ id: 't8', projectId: 'p2', name: 'Joint task', status: 'not-started',
                      assignees: ['brad', 'diana'], dueDate: '2026-06-10' }],
            prefs: {
                brad: { master: true, mode: 'instant', kinds: {} },
                diana: { master: true, mode: 'digest', kinds: {} },
            },
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats, { triggers: 1, emails: 1, digests: 1 }, '8: joint mixed-mode → 1 email + 1 digest');
        eq(r.emailRows[0].to, 'metalbee66@gmail.com', '8: brad emailed');
        eq(r.digestAppends[0].user, 'diana', '8: diana digested');
    }

    // 9. HTML-escaping: a task name with markup cannot break the email body.
    {
        const blob = {
            tasks: [{ id: 't9', projectId: 'p1', name: '<script>x</script>', status: 'not-started',
                      assignees: ['brad'], dueDate: '2026-06-01' }],
            prefs: {},
        };
        const r = scanBlob(blob, TODAY);
        ok(!r.emailRows[0].bodyHtml.includes('<script>'), '9: summary html-escaped in body');
    }

    // 10. legacy single `assignee` string (not array) still resolves.
    {
        const blob = {
            tasks: [{ id: 't10', name: 'legacy', status: 'not-started', assignee: 'brad', dueDate: '2026-06-01' }],
            prefs: {},
        };
        const r = scanBlob(blob, TODAY);
        eq(r.stats.emails, 1, '10: legacy assignee string resolves');
    }

    // 11. empty / malformed blob → empty result, no throw.
    {
        eq(scanBlob(null, TODAY).stats, { triggers: 0, emails: 0, digests: 0 }, '11a: null blob');
        eq(scanBlob({}, TODAY).stats, { triggers: 0, emails: 0, digests: 0 }, '11b: no tasks');
        eq(scanBlob({ tasks: [] }, 'not-a-date').stats, { triggers: 0, emails: 0, digests: 0 }, '11c: bad date');
    }

    console.log(`\noverdue-scan self-check: ${pass} passed, ${fail} failed`);
    if (fail > 0) process.exit(1);
}
