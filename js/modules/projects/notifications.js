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

import { countBlockingDeps, emailToParticipantId, readAssignees } from './data.js';

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
        if (t.status === 'done') continue;
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
