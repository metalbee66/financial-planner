/**
 * Notifications — audit-event → notification trigger map (Task 6.1).
 *
 * One pure mapper turns a "trigger event" plus task/project context into a
 * notification record for one candidate recipient (or null if that user
 * shouldn't be notified). Trigger events include Phase 3.3 audit events
 * (status_changed, assignee_changed) plus four synthetic kinds that don't
 * have a counterpart in the audit feed:
 *
 *   - comment_added      — fired by the comment-submit site
 *   - dependency_unblocked — derived here from status_changed → done
 *   - project_completed  — fired by the project-save site
 *   - task_due_soon / task_overdue — synthesized by a scan helper
 *
 * Phase 6.2 will wire the in-app bell on top of these notification records;
 * Phase 6.3 will mirror the "instant" subset into the email queue.
 */

import { countBlockingDeps, emailToParticipantId, participantEmail, readAssignees } from './data.js';

/** All notification kinds this module knows how to produce. */
export const NOTIFICATION_KINDS = [
    'task_assigned',
    'comment_added',
    'dependency_unblocked',
    'task_due_soon',
    'task_overdue',
    'milestone_completed',
    'project_completed',
];

/** Per §6.2 the bell shows last 30 — cap each user's bucket at that size. */
export const MAX_NOTIFICATIONS_PER_USER = 30;

/** Delivery modes — `instant` enqueues each event; `digest` accumulates for the daily 8am roll-up (Phase 6.4). */
export const NOTIFICATION_MODES = ['instant', 'digest'];
const NOTIFICATION_MODES_SET = new Set(NOTIFICATION_MODES);

/** Reusable shape for "all kinds on" — callers should clone, never mutate. */
function freshKindsOn() {
    const out = {};
    for (const k of NOTIFICATION_KINDS) out[k] = true;
    return out;
}

/** Build a fresh, fully-enabled prefs record. */
export function createDefaultPrefs() {
    return { master: true, mode: 'instant', kinds: freshKindsOn() };
}

/**
 * Normalise a prefs record loaded from storage / a form submit. Missing or
 * malformed fields fall back to enabled-everything defaults, which keeps the
 * "no prefs saved yet" case behaving the same as "all opted in".
 *
 * Unknown kinds in the input are dropped — the prefs surface only exposes
 * the kinds advertised by `NOTIFICATION_KINDS`.
 */
export function sanitiseNotificationPrefs(input) {
    const src = (input && typeof input === 'object') ? input : {};
    const kinds = freshKindsOn();
    if (src.kinds && typeof src.kinds === 'object') {
        for (const k of NOTIFICATION_KINDS) {
            if (Object.prototype.hasOwnProperty.call(src.kinds, k) && typeof src.kinds[k] === 'boolean') {
                kinds[k] = src.kinds[k];
            }
        }
    }
    return {
        master: typeof src.master === 'boolean' ? src.master : true,
        mode: NOTIFICATION_MODES_SET.has(src.mode) ? src.mode : 'instant',
        kinds,
    };
}

/**
 * Should this user receive a notification of `kind`? Null prefs default to
 * fully enabled so users without saved prefs still get the bell. Unknown
 * kinds default-allow when master is on so adding a new kind in a future
 * phase doesn't silently mute existing users.
 */
export function shouldNotifyUser(prefs, kind) {
    if (!prefs) return true;
    if (prefs.master === false) return false;
    if (prefs.kinds && Object.prototype.hasOwnProperty.call(prefs.kinds, kind)) {
        return prefs.kinds[kind] !== false;
    }
    return true;
}

function generateNotificationId() {
    return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function nowIso() { return new Date().toISOString(); }

function makeNotification(input) {
    return {
        id: generateNotificationId(),
        kind: input.kind,
        to: input.to,
        by: input.by == null ? null : input.by,
        taskId: input.taskId == null ? null : input.taskId,
        projectId: input.projectId == null ? null : input.projectId,
        title: input.title,
        summary: input.summary,
        at: input.at || nowIso(),
        read: false,
    };
}

/**
 * Self-action check that bridges the email/participant-id namespace gap:
 * `event.by` is currently an email (currentUserEmail()) but recipients are
 * participant ids (brad/diana/external string). Treat as self if either
 * side already matches OR the resolved participant id matches.
 */
function isSelfAction(event, user) {
    if (!event || !event.by || !user) return false;
    if (event.by === user) return true;
    const id = emailToParticipantId(event.by);
    return id === user;
}

/** Resolve a display name for the actor in a notification summary. */
function actorLabel(by) {
    if (!by) return 'Someone';
    const id = emailToParticipantId(by);
    if (id === 'brad') return 'Brad';
    if (id === 'diana') return 'Diana';
    // External / unresolved — fall back to the raw value (email or name).
    return by;
}

/**
 * Project-level mute. `on-hold` / `cancelled` are the two non-derivable
 * statuses (see isNonDerivableStatus) — they only ever appear because a user
 * explicitly set them, so they're a reliable "not being worked on" signal.
 *
 * This is a LIVE GATE, deliberately not a rewrite of each task's
 * `notificationsOff`: putting a project on hold and taking it off again must
 * not clobber per-task mutes the user set by hand.
 */
export function projectNotificationsMuted(project) {
    if (!project) return false;
    return project.status === 'on-hold' || project.status === 'cancelled';
}

/**
 * Map one trigger event + context to a notification for `user`, or null.
 *
 * - event: { kind, by, at, before?, after? }
 *     kind ∈ audit-event kinds + the synthetic kinds listed above.
 * - task: the task the event is about (for dep-unblock, the dependent task).
 * - project: the project containing task.
 * - user: candidate recipient (participant id like 'brad', or external string).
 *
 * Self-actions never notify the actor. Recipients without a stake in the
 * event (e.g. someone who isn't the new assignee, the task's assignee, or a
 * project participant — depending on the trigger) get null.
 */
export function eventToNotification(event, task, project, user) {
    if (!event || !task || !project || !user) return null;
    // Per-task mute: `notificationsOff` silences every kind for this task,
    // bell and email alike. Absent/false means notify as normal, so existing
    // tasks need no migration.
    if (task.notificationsOff === true) return null;
    if (projectNotificationsMuted(project)) return null;
    if (isSelfAction(event, user)) return null;

    const participants = Array.isArray(project.participants) ? project.participants : [];

    switch (event.kind) {
        case 'assignee_changed': {
            // PB.9: event.after is an array of new assignees (legacy: string).
            const after = Array.isArray(event.after)
                ? event.after
                : (event.after ? [event.after] : []);
            if (!after.includes(user)) return null;
            return makeNotification({
                kind: 'task_assigned',
                to: user,
                by: event.by,
                taskId: task.id,
                projectId: project.id,
                title: `Task assigned: ${task.name}`,
                summary: `${actorLabel(event.by)} assigned "${task.name}" to you in ${project.name}.`,
                at: event.at,
            });
        }

        case 'comment_added': {
            if (!readAssignees(task).includes(user)) return null;
            return makeNotification({
                kind: 'comment_added',
                to: user,
                by: event.by,
                taskId: task.id,
                projectId: project.id,
                title: `New comment: ${task.name}`,
                summary: `${actorLabel(event.by)} commented on "${task.name}" in ${project.name}.`,
                at: event.at,
            });
        }

        case 'dependency_unblocked': {
            if (!readAssignees(task).includes(user)) return null;
            return makeNotification({
                kind: 'dependency_unblocked',
                to: user,
                by: event.by,
                taskId: task.id,
                projectId: project.id,
                title: `Unblocked: ${task.name}`,
                summary: `"${task.name}" is now unblocked — all dependencies are done.`,
                at: event.at,
            });
        }

        case 'status_changed': {
            // Only milestone completions fan out as notifications. Regular
            // status changes are tracked in the audit feed but don't notify.
            if (event.after !== 'done' || event.before === 'done') return null;
            if (!task.isMilestone) return null;
            if (!participants.includes(user)) return null;
            return makeNotification({
                kind: 'milestone_completed',
                to: user,
                by: event.by,
                taskId: task.id,
                projectId: project.id,
                title: `Milestone reached: ${task.name}`,
                summary: `${actorLabel(event.by)} completed milestone "${task.name}" in ${project.name}.`,
                at: event.at,
            });
        }

        case 'task_due_soon': {
            if (!readAssignees(task).includes(user)) return null;
            return makeNotification({
                kind: 'task_due_soon',
                to: user,
                by: null,
                taskId: task.id,
                projectId: project.id,
                title: `Due soon: ${task.name}`,
                summary: `"${task.name}" is due within 24 hours.`,
                at: event.at,
            });
        }

        case 'task_overdue': {
            if (!readAssignees(task).includes(user)) return null;
            return makeNotification({
                kind: 'task_overdue',
                to: user,
                by: null,
                taskId: task.id,
                projectId: project.id,
                title: `Overdue: ${task.name}`,
                summary: `"${task.name}" is past its due date.`,
                at: event.at,
            });
        }

        case 'project_completed': {
            if (!participants.includes(user)) return null;
            return makeNotification({
                kind: 'project_completed',
                to: user,
                by: event.by,
                taskId: null,
                projectId: project.id,
                title: `Project completed: ${project.name}`,
                summary: `${actorLabel(event.by)} marked ${project.name} as completed.`,
                at: event.at,
            });
        }

        default:
            return null;
    }
}

/**
 * Fan one trigger event out across `recipients`. Each recipient gets its own
 * notification or is skipped (null). Returns an array of notification objects
 * in input order.
 */
export function eventToNotificationsForRecipients(event, task, project, recipients) {
    if (!Array.isArray(recipients)) return [];
    const out = [];
    for (const r of recipients) {
        const n = eventToNotification(event, task, project, r);
        if (n) out.push(n);
    }
    return out;
}

/**
 * Derive the recipient set for a trigger event from task + project context.
 * Most kinds notify a single user (assignee / new assignee); milestone-done
 * and project-complete fan out to every project participant.
 *
 * Returns an array of participant ids (or external assignee strings),
 * deduped and order-preserving. The caller still goes through
 * eventToNotification per recipient so the self-action / membership checks
 * stay centralised there.
 */
export function candidateRecipientsForEvent(event, task, project) {
    if (!event || !task || !project) return [];
    const participants = Array.isArray(project.participants) ? project.participants : [];
    switch (event.kind) {
        case 'assignee_changed': {
            // PB.9: event.after is now an array. Legacy single-string events
            // (recorded before T6) still resolve via the fallback.
            if (Array.isArray(event.after)) return event.after.slice();
            return event.after ? [event.after] : [];
        }
        case 'comment_added':
        case 'dependency_unblocked':
        case 'task_due_soon':
        case 'task_overdue':
            return readAssignees(task);
        case 'status_changed':
            if (!task.isMilestone || event.after !== 'done' || event.before === 'done') return [];
            return participants.slice();
        case 'project_completed':
            return participants.slice();
        default:
            return [];
    }
}

/**
 * Detect dependency-unblocked synthetic triggers caused by a task going to
 * done. Pass the *post-update* task list so `countBlockingDeps` reflects the
 * new world. Returns `[{event, task}]` pairs ready for eventToNotification.
 *
 * A dependent is "unblocked" iff (a) it directly depends on `task`, (b) it
 * isn't already done, and (c) after the update it has zero blocking deps.
 */
export function deriveDependencyUnblockedTriggers(event, task, allTasks) {
    if (!event || event.kind !== 'status_changed') return [];
    if (event.after !== 'done' || event.before === 'done') return [];
    if (!task || !Array.isArray(allTasks)) return [];
    const triggered = [];
    for (const dep of allTasks) {
        if (!dep || dep.id === task.id) continue;
        if (!Array.isArray(dep.dependsOn) || !dep.dependsOn.includes(task.id)) continue;
        if (dep.status === 'done') continue;
        if (countBlockingDeps(allTasks, dep) > 0) continue;
        triggered.push({
            event: {
                kind: 'dependency_unblocked',
                by: event.by,
                at: event.at,
                before: null,
                after: task.id,
            },
            task: dep,
        });
    }
    return triggered;
}

/**
 * Scan tasks for time-based notification triggers. Returns one synthetic
 * event per affected task, ready for eventToNotification.
 *
 * - kind 'task_due_soon': not-done tasks whose dueDate falls between today
 *   and (today + 1 day) inclusive on the start side, exclusive on the end —
 *   "within 24 hours" reads as same-day-or-tomorrow in plain UI.
 * - kind 'task_overdue': not-done tasks whose dueDate is strictly before
 *   today.
 *
 * A task can only generate one of the two — overdue wins if dueDate < today.
 * Tasks with no dueDate, no assignee, or status 'done' are skipped.
 */
export function computeTimeBasedTriggers(tasks, todayIso) {
    if (!Array.isArray(tasks) || !todayIso) return [];
    const todayMs = Date.parse(todayIso);
    if (Number.isNaN(todayMs)) return [];
    const tomorrowMs = todayMs + 24 * 60 * 60 * 1000;
    const out = [];
    for (const t of tasks) {
        if (!t || !t.dueDate || readAssignees(t).length === 0) continue;
        if (t.status === 'done' || t.notificationsOff === true) continue;
        const dueMs = Date.parse(t.dueDate);
        if (Number.isNaN(dueMs)) continue;
        if (dueMs < todayMs) {
            out.push({ event: { kind: 'task_overdue', by: null, at: todayIso, before: null, after: t.dueDate }, task: t });
        } else if (dueMs <= tomorrowMs) {
            out.push({ event: { kind: 'task_due_soon', by: null, at: todayIso, before: null, after: t.dueDate }, task: t });
        }
    }
    return out;
}

/**
 * Immutably append a notification to a user's bucket inside the
 * `{ <user>: [...] }` map, trimming oldest entries past
 * MAX_NOTIFICATIONS_PER_USER. Same-ref no-op when `notif` is falsy.
 */
export function addNotificationToBucket(bucketMap, notif) {
    if (!notif || !notif.to) return bucketMap;
    const map = (bucketMap && typeof bucketMap === 'object') ? bucketMap : {};
    const existing = Array.isArray(map[notif.to]) ? map[notif.to] : [];
    const next = existing.concat([notif]);
    const trimmed = next.length > MAX_NOTIFICATIONS_PER_USER
        ? next.slice(next.length - MAX_NOTIFICATIONS_PER_USER)
        : next;
    return { ...map, [notif.to]: trimmed };
}

/**
 * Convenience: process one trigger event end-to-end. Resolves recipients,
 * runs eventToNotification per recipient, and folds non-null results into
 * `bucketMap`. Returns `{ bucketMap, notifications }` where notifications is
 * the array of records produced (useful for tests / queue handoff).
 */
export function processTrigger(event, task, project, bucketMap) {
    const recipients = candidateRecipientsForEvent(event, task, project);
    const notifications = eventToNotificationsForRecipients(event, task, project, recipients);
    let map = bucketMap;
    for (const n of notifications) map = addNotificationToBucket(map, n);
    return { bucketMap: map, notifications };
}

/**
 * Immutably flip one notification's `read` flag to true. Same-ref no-op
 * when the user/id isn't present or the entry was already read — callers
 * use the identity check to skip a redundant save.
 */
export function markNotificationRead(bucketMap, user, id) {
    if (!bucketMap || !user || !id) return bucketMap;
    const list = bucketMap[user];
    if (!Array.isArray(list)) return bucketMap;
    const idx = list.findIndex(n => n && n.id === id);
    if (idx < 0) return bucketMap;
    if (list[idx].read) return bucketMap;
    const nextList = list.slice();
    nextList[idx] = { ...list[idx], read: true };
    return { ...bucketMap, [user]: nextList };
}

/** Mark every entry for one user read. Same-ref no-op when nothing is unread. */
export function markAllNotificationsRead(bucketMap, user) {
    if (!bucketMap || !user) return bucketMap;
    const list = bucketMap[user];
    if (!Array.isArray(list) || list.length === 0) return bucketMap;
    if (list.every(n => n && n.read)) return bucketMap;
    const nextList = list.map(n => (n && !n.read) ? { ...n, read: true } : n);
    return { ...bucketMap, [user]: nextList };
}

/** Number of unread notifications for one user; 0 for missing buckets. */
export function unreadCount(bucketMap, user) {
    if (!bucketMap || !user) return 0;
    const list = bucketMap[user];
    if (!Array.isArray(list)) return 0;
    let n = 0;
    for (const entry of list) if (entry && !entry.read) n++;
    return n;
}

/**
 * Newest-first slice (up to MAX_NOTIFICATIONS_PER_USER) for the bell dropdown.
 * Storage order is oldest → newest (append-only), so we reverse for display.
 * The cap is defensive — addNotificationToBucket already trims at write time.
 */
export function getUserNotifications(bucketMap, user) {
    if (!bucketMap || !user) return [];
    const list = bucketMap[user];
    if (!Array.isArray(list) || list.length === 0) return [];
    const reversed = list.slice().reverse();
    return reversed.length > MAX_NOTIFICATIONS_PER_USER
        ? reversed.slice(0, MAX_NOTIFICATIONS_PER_USER)
        : reversed;
}

// ── Email queue (Task 6.3) ──

/**
 * Root-level Firebase key for the n8n-drained email queue. Sibling to
 * `projects`, not a child — matches the schema in plan §6.3 and the n8n
 * REST workflow that reads `/household/family/email_queue/`.
 */
export const EMAIL_QUEUE_KEY = 'email_queue';

/** Default deployed-app base URL for source links in email bodies. */
const DEFAULT_APP_BASE_URL = 'https://metalbee66.github.io/financial-planner/';

const KIND_SUBJECT_PREFIX = {
    task_assigned: 'Task assigned',
    comment_added: 'New comment',
    dependency_unblocked: 'Unblocked',
    task_due_soon: 'Due soon',
    task_overdue: 'Overdue',
    milestone_completed: 'Milestone reached',
    project_completed: 'Project completed',
};

function escapeHtmlForEmail(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

function generateEmailQueueId() {
    return 'eq_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/**
 * Should the bell entry also enqueue an instant email? Requires master + per-kind
 * toggles on AND `mode === 'instant'`. Digest-mode users defer to the Phase 6.4
 * daily roll-up — those notifications still surface in the bell, just not in
 * the immediate email queue. Null/missing prefs fall through to enabled.
 */
export function shouldEnqueueInstantEmail(prefs, kind) {
    if (!shouldNotifyUser(prefs, kind)) return false;
    const mode = (prefs && prefs.mode) || 'instant';
    return mode === 'instant';
}

/**
 * Materialise an email-queue entry from one bell notification plus its
 * project / task context. Returns null when:
 *   - notification / kind / recipient are missing
 *   - recipient is an external assignee with no email on file
 *
 * The n8n drainer reads this object as-is, sends the email via the Microsoft
 * Outlook node, then PATCHes `sent: true / sentAt` (or increments `attempts`
 * up to 3 and sets `failed: true`). `baseUrl` controls the deep-link prefix;
 * defaults to the deployed GitHub Pages URL.
 */
export function buildEmailQueueEntry(notification, project, task, baseUrl) {
    if (!notification || !notification.kind || !notification.to) return null;
    const recipient = participantEmail(notification.to);
    if (!recipient) return null;
    const prefix = KIND_SUBJECT_PREFIX[notification.kind] || 'Notification';
    const focusName = (notification.kind === 'project_completed')
        ? (project && project.name)
        : (task && task.name);
    const subject = `[Family Planner] ${prefix}${focusName ? ': ' + focusName : ''}`;
    const base = (typeof baseUrl === 'string' && baseUrl) ? baseUrl : DEFAULT_APP_BASE_URL;
    let sourceUrl = base;
    if (notification.projectId && notification.taskId) {
        sourceUrl = `${base}#/projects/${notification.projectId}/tasks/${notification.taskId}`;
    } else if (notification.projectId) {
        sourceUrl = `${base}#/projects/${notification.projectId}`;
    }
    const summary = notification.summary || '';
    const bodyHtml = `<p>${escapeHtmlForEmail(summary)}</p>`
        + `<p><a href="${escapeHtmlForEmail(sourceUrl)}">Open in Family Planner</a></p>`;
    return {
        id: generateEmailQueueId(),
        to: recipient,
        subject,
        bodyHtml,
        kind: notification.kind,
        notificationId: notification.id || null,
        taskId: notification.taskId || null,
        projectId: notification.projectId || null,
        sourceUrl,
        queuedAt: notification.at || nowIso(),
        sent: false,
        sentAt: null,
        attempts: 0,
        failed: false,
    };
}

// ── Digest mode (Task 6.4) ──

/**
 * Human-readable noun for each NOTIFICATION_KINDS entry. The daily summary
 * email composes one comma-joined phrase per kind: "3 tasks assigned, 2
 * tasks overdue". Kept here (next to the kinds list) so adding a new kind
 * in a future phase only touches one file.
 */
const DIGEST_KIND_LABELS = {
    task_assigned: { one: 'task assigned', many: 'tasks assigned' },
    comment_added: { one: 'new comment', many: 'new comments' },
    dependency_unblocked: { one: 'task unblocked', many: 'tasks unblocked' },
    task_due_soon: { one: 'task due soon', many: 'tasks due soon' },
    task_overdue: { one: 'task overdue', many: 'tasks overdue' },
    milestone_completed: { one: 'milestone completed', many: 'milestones completed' },
    project_completed: { one: 'project completed', many: 'projects completed' },
};

/**
 * Should this notification accumulate into the daily digest bucket? Inverse
 * partner to shouldEnqueueInstantEmail — requires master + per-kind on AND
 * `mode === 'digest'`. Null/missing prefs default to instant, so they don't
 * accumulate (digest is opt-in).
 */
export function shouldAccumulateDigest(prefs, kind) {
    if (!shouldNotifyUser(prefs, kind)) return false;
    return !!(prefs && prefs.mode === 'digest');
}

/**
 * Immutably append a digest entry to one user's bucket. Same-ref no-op for
 * missing recipient or null entry. No size cap here — the daily n8n workflow
 * drains the bucket and clears it; in normal use it never grows past a day.
 */
export function appendDigestEntry(digestMap, user, entry) {
    if (!entry || !user) return digestMap;
    const map = (digestMap && typeof digestMap === 'object') ? digestMap : {};
    const existing = Array.isArray(map[user]) ? map[user] : [];
    return { ...map, [user]: existing.concat([entry]) };
}

/**
 * Empty one user's digest bucket. The n8n daily-8am workflow calls this
 * shape (via REST PATCH) after sending the summary email. Same-ref no-op
 * when the user has no bucket or it's already empty.
 */
export function clearDigestForUser(digestMap, user) {
    if (!digestMap || !user) return digestMap;
    const existing = digestMap[user];
    if (!Array.isArray(existing) || existing.length === 0) return digestMap;
    return { ...digestMap, [user]: [] };
}

/**
 * Group digest entries by kind and produce a comma-joined phrase. Ordering
 * follows the canonical NOTIFICATION_KINDS sequence, not input order, so the
 * subject reads predictably (e.g. assignments before overdue). Empty entries
 * / unknown kinds are dropped.
 */
export function composeDigestSummary(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return '';
    const counts = new Map();
    for (const e of entries) {
        if (!e || !e.kind) continue;
        if (!DIGEST_KIND_LABELS[e.kind]) continue;
        counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
    }
    const parts = [];
    for (const k of NOTIFICATION_KINDS) {
        const n = counts.get(k);
        if (!n) continue;
        const label = DIGEST_KIND_LABELS[k];
        parts.push(`${n} ${n === 1 ? label.one : label.many}`);
    }
    return parts.join(', ');
}

/**
 * Compose the one summary email a user gets per day. Returns `{to, subject,
 * bodyHtml}` ready for the n8n daily workflow to hand to the Outlook node,
 * or null when there's nothing to send (empty bucket or unknown recipient).
 *
 * Subject leads with the grouped counts ("Daily digest — 3 tasks assigned, 2
 * tasks overdue"); body lists each entry's title + summary as a bullet so
 * the recipient can scan without opening the app.
 */
export function buildDigestEmail(user, entries, baseUrl) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    const recipient = participantEmail(user);
    if (!recipient) return null;
    const summary = composeDigestSummary(entries);
    if (!summary) return null;
    const base = (typeof baseUrl === 'string' && baseUrl) ? baseUrl : DEFAULT_APP_BASE_URL;
    const subject = `[Family Planner] Daily digest — ${summary}`;
    const bullets = entries.map(e =>
        `<li><strong>${escapeHtmlForEmail(e.title || '')}</strong> — ${escapeHtmlForEmail(e.summary || '')}</li>`
    ).join('');
    const bodyHtml = `<p>${escapeHtmlForEmail(summary)}.</p>`
        + `<ul>${bullets}</ul>`
        + `<p><a href="${escapeHtmlForEmail(base)}">Open Family Planner</a></p>`;
    return { to: recipient, subject, bodyHtml };
}

// ── Email-queue admin (Task 6.5) ──

/** Statuses surfaced by the admin panel filter pills. Order matters: it drives the chip render. */
export const EMAIL_QUEUE_STATUSES = ['pending', 'sent', 'failed'];

/** Per plan §6.5 — last 50 queue items visible to the admin. */
export const ADMIN_QUEUE_PAGE_SIZE = 50;

/**
 * Classify one queue entry. `sent` wins over `failed` so a previously-failed
 * entry that eventually delivered renders as sent (n8n could PATCH sent=true
 * on a retry without resetting the historical `failed` flag).
 */
export function classifyQueueEntry(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (entry.sent) return 'sent';
    if (entry.failed) return 'failed';
    return 'pending';
}

/**
 * Single-pass tally of `{pending, sent, failed, total}` across the queue map.
 * The admin panel uses this for the filter-pill counts.
 */
export function countQueueByStatus(map) {
    const out = { pending: 0, sent: 0, failed: 0, total: 0 };
    if (!map || typeof map !== 'object' || Array.isArray(map)) return out;
    for (const id in map) {
        const status = classifyQueueEntry(map[id]);
        if (!status) continue;
        out[status]++;
        out.total++;
    }
    return out;
}

/**
 * Build the admin-table row list. Newest-queued-first, optionally filtered by
 * status, capped at ADMIN_QUEUE_PAGE_SIZE. Entries with no `queuedAt` sort to
 * the end so a malformed write doesn't bubble to the top.
 */
export function getQueueEntriesForAdmin(map, opts) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
    const status = opts && opts.status ? opts.status : null;
    const arr = [];
    for (const id in map) {
        const entry = map[id];
        if (!entry || typeof entry !== 'object') continue;
        if (status && classifyQueueEntry(entry) !== status) continue;
        arr.push(entry);
    }
    arr.sort((a, b) => {
        const aq = a.queuedAt || '';
        const bq = b.queuedAt || '';
        if (!aq && bq) return 1;
        if (aq && !bq) return -1;
        return bq.localeCompare(aq);
    });
    return arr.length > ADMIN_QUEUE_PAGE_SIZE ? arr.slice(0, ADMIN_QUEUE_PAGE_SIZE) : arr;
}

/**
 * Reset one entry so the n8n drainer picks it up again on its next cycle.
 * Wipes `sent` / `sentAt` / `failed` / `attempts`. Same-ref no-op for null
 * input — callers use the identity check to skip a redundant Firebase write.
 */
export function retryQueueEntry(entry) {
    if (!entry || typeof entry !== 'object') return entry;
    return { ...entry, sent: false, sentAt: null, attempts: 0, failed: false };
}

/**
 * Strip sent entries with `sentAt < threshold` from the map. Pending + failed
 * entries are untouched regardless of age. Same-ref no-op when nothing
 * qualifies so callers can skip a redundant save. The admin panel's
 * "Clear sent older than 7 days" button calls this with a 7-day-ago threshold.
 */
export function clearSentOlderThan(map, thresholdIso) {
    if (!map || typeof map !== 'object' || Array.isArray(map)) return map;
    if (!thresholdIso) return map;
    const removed = [];
    for (const id in map) {
        const entry = map[id];
        if (entry && entry.sent && entry.sentAt && entry.sentAt < thresholdIso) {
            removed.push(id);
        }
    }
    if (removed.length === 0) return map;
    const next = { ...map };
    for (const id of removed) delete next[id];
    return next;
}

/**
 * Build a compact record for the digest bucket from one bell notification.
 * The bucket only needs enough context for composeDigestSummary +
 * buildDigestEmail; we deliberately exclude `read` etc. so the n8n PATCH
 * payload stays small.
 */
export function buildDigestEntry(notification) {
    if (!notification || !notification.kind) return null;
    return {
        id: notification.id || ('d_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)),
        kind: notification.kind,
        title: notification.title || '',
        summary: notification.summary || '',
        taskId: notification.taskId || null,
        projectId: notification.projectId || null,
        at: notification.at || nowIso(),
    };
}
