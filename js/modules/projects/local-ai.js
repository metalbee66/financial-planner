/**
 * Local AI helpers — pure heuristics, no external API calls (Task 7.2).
 *
 * Five small functions consumed by the Projects UI:
 *   - suggestTaskNames    — frequency-weighted autocomplete on the "+ Add task" input
 *   - suggestDueDate      — median past-task offset, projected from today
 *   - composeDashboardDigest — plain-text summary paragraph for the Dashboard tab
 *   - isProjectStale      — orange "stale" badge on Overview cards (>14 days idle)
 *   - smartSortTasks      — urgency-weighted sort for the list-view "Smart" option
 *
 * All functions are pure and depend on nothing from the DOM or Firebase, so the
 * unit suite in data.test.js can exercise them in the same harness as data.js.
 */

const ONE_DAY_MS = 86400000;

function trim(s) {
    return typeof s === 'string' ? s.trim() : '';
}

function isIsoDate(s) {
    return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}/.test(s);
}

function addDaysIso(iso, n) {
    if (!iso || typeof iso !== 'string') return iso;
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + n);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function isoDayDiff(aIso, bIso) {
    const [ay, am, ad] = aIso.split('-').map(Number);
    const [by, bm, bd] = bIso.split('-').map(Number);
    return Math.round((Date.UTC(ay, am - 1, ad) - Date.UTC(by, bm - 1, bd)) / ONE_DAY_MS);
}

/**
 * Frequency-weighted autocomplete for the "+ Add task" name input. Returns
 * `{ name, count }` records sorted by count desc then alpha asc. Matching is
 * case-insensitive (so "Mow lawn" / "mow lawn" / "MOW LAWN" collapse into one
 * suggestion) but the display string preserves the first-seen casing so users
 * see the spelling they typed before.
 *
 *   - prefix: optional starts-with filter (case-insensitive). Empty / null
 *     returns the global top-N regardless of input.
 *   - tasks: any iterable of `{ name }`-shaped records. Blank names are dropped.
 *   - opts.limit: cap on the number of suggestions returned (default 5).
 */
export function suggestTaskNames(prefix, tasks, opts = {}) {
    const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 5;
    const pfx = trim(prefix).toLowerCase();
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    const byKey = new Map(); // lowercased name → { name, count }
    for (const t of tasks) {
        const name = trim(t && t.name);
        if (!name) continue;
        const key = name.toLowerCase();
        if (pfx && !key.startsWith(pfx)) continue;
        const entry = byKey.get(key);
        if (entry) entry.count++;
        else byKey.set(key, { name, count: 1 });
    }
    const arr = Array.from(byKey.values());
    arr.sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    return arr.slice(0, limit);
}

/**
 * Median start→due offset (in days) from past tasks, applied to today. Used to
 * pre-fill a sensible default for the "+ Add task" due-date input so users
 * scheduling routine work don't have to compute the date themselves.
 *
 * Strategy:
 *   1. Take tasks in the same project that have BOTH startDate and dueDate.
 *   2. If none, fall back to tasks in other projects (global history).
 *   3. If still none, return today + fallbackDays.
 *   4. Compute the median offset (days) and return today + median (ISO).
 *   5. Clamp to project.endDate if the suggestion would overshoot it.
 *
 * Returns a YYYY-MM-DD string. Missing todayIso just returns null.
 */
export function suggestDueDate(project, tasks, opts = {}) {
    const today = opts.todayIso;
    const fallback = Number.isInteger(opts.fallbackDays) && opts.fallbackDays >= 0
        ? opts.fallbackDays
        : 7;
    if (!isIsoDate(today)) return null;
    const taskList = Array.isArray(tasks) ? tasks : [];
    const projectId = project && project.id;

    const eligible = (predicate) => {
        const offsets = [];
        for (const t of taskList) {
            if (!t || !isIsoDate(t.startDate) || !isIsoDate(t.dueDate)) continue;
            if (!predicate(t)) continue;
            offsets.push(isoDayDiff(t.dueDate, t.startDate));
        }
        return offsets;
    };

    let offsets = projectId ? eligible(t => t.projectId === projectId) : [];
    if (offsets.length === 0) offsets = eligible(t => !projectId || t.projectId !== projectId);
    if (offsets.length === 0) {
        const suggested = addDaysIso(today, fallback);
        return clampToEnd(suggested, project);
    }

    offsets.sort((a, b) => a - b);
    const mid = Math.floor(offsets.length / 2);
    const median = (offsets.length % 2 === 0)
        ? Math.round((offsets[mid - 1] + offsets[mid]) / 2)
        : offsets[mid];
    const suggested = addDaysIso(today, Math.max(0, median));
    return clampToEnd(suggested, project);
}

function clampToEnd(dateIso, project) {
    const end = project && project.endDate;
    if (!isIsoDate(end)) return dateIso;
    return dateIso > end ? end : dateIso;
}

/**
 * Plain-English digest paragraph for the Dashboard. Mirrors the wording in
 * plan §7.2 ("You have 3 tasks due today, 1 overdue, 2 milestones next week")
 * but only includes non-zero buckets so quiet days read cleanly. Returns the
 * "all clear" sentence when nothing is pressing.
 */
export function composeDashboardDigest(tasks, todayIso) {
    if (!isIsoDate(todayIso)) return 'All clear — nothing pressing right now.';
    const weekEnd = addDaysIso(todayIso, 6);
    const fortEnd = addDaysIso(todayIso, 13);
    let dueToday = 0, overdue = 0, dueLater = 0, milestonesNext = 0;
    const list = Array.isArray(tasks) ? tasks : [];
    for (const t of list) {
        if (!t || t.status === 'done') continue;
        if (isIsoDate(t.dueDate)) {
            if (t.dueDate === todayIso) dueToday++;
            else if (t.dueDate < todayIso) overdue++;
            else if (t.dueDate <= weekEnd) dueLater++;
        }
        if (t.isMilestone === true && isIsoDate(t.dueDate)
            && t.dueDate >= todayIso && t.dueDate <= fortEnd) {
            milestonesNext++;
        }
    }
    if (dueToday + overdue + dueLater + milestonesNext === 0) {
        return 'All clear — nothing pressing right now.';
    }
    const parts = [];
    if (dueToday) parts.push(`${dueToday} task${dueToday === 1 ? '' : 's'} due today`);
    if (overdue) parts.push(`${overdue} overdue`);
    if (dueLater) parts.push(`${dueLater} due later this week`);
    if (milestonesNext) parts.push(`${milestonesNext} milestone${milestonesNext === 1 ? '' : 's'} in the next fortnight`);
    return `You have ${joinList(parts)}.`;
}

function joinList(parts) {
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
    return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
}

/**
 * Returns true when a project has had no activity (project or any task update)
 * within `thresholdDays` of today. Completed / cancelled / archived projects
 * are never stale — they're just done.
 */
export function isProjectStale(project, allTasks, todayIso, thresholdDays = 14) {
    if (!project || !isIsoDate(todayIso)) return false;
    if (project.status === 'completed' || project.status === 'cancelled') return false;
    if (project.archivedAt) return false;
    let mostRecent = project.updatedAt || project.createdAt || '';
    if (Array.isArray(allTasks)) {
        for (const t of allTasks) {
            if (!t || t.projectId !== project.id) continue;
            const tu = t.updatedAt || t.createdAt || '';
            if (tu > mostRecent) mostRecent = tu;
        }
    }
    if (!mostRecent) return false;
    const day = mostRecent.slice(0, 10);
    if (!isIsoDate(day)) return false;
    return isoDayDiff(todayIso, day) > thresholdDays;
}

const PRIORITY_SCORE = { high: 3, normal: 2, low: 1 };

/**
 * Sort tasks by an urgency score (plan §7.2):
 *   overdue × 3  +  due-soon × 2  +  priority × 1  +  blocks-others × 2
 *
 *   - overdue:        status !== 'done' AND dueDate < today
 *   - due-soon:       status !== 'done' AND today <= dueDate <= today + 6
 *   - priority:       high=3, normal=2, low=1
 *   - blocks-others:  any *not-done* task in the full graph depends on this one
 *
 * Returns a new array; never mutates. Original input order is the tiebreak
 * (stable sort) so equal-score tasks stay in display order.
 */
export function smartSortTasks(tasks, allTasks, todayIso) {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    const today = isIsoDate(todayIso) ? todayIso : null;
    const weekEnd = today ? addDaysIso(today, 6) : null;

    const reach = Array.isArray(allTasks) ? allTasks : tasks;
    const blockingIds = new Set();
    for (const t of reach) {
        if (!t || t.status === 'done' || !Array.isArray(t.dependsOn)) continue;
        for (const dep of t.dependsOn) blockingIds.add(dep);
    }

    const scored = tasks.map((t, idx) => {
        let s = 0;
        if (t && t.status !== 'done' && isIsoDate(t.dueDate) && today) {
            if (t.dueDate < today) s += 3;
            else if (t.dueDate <= weekEnd) s += 2;
        }
        s += PRIORITY_SCORE[t && t.priority] || 0;
        if (t && blockingIds.has(t.id)) s += 2;
        return { t, s, idx };
    });
    scored.sort((a, b) => (b.s - a.s) || (a.idx - b.idx));
    return scored.map(x => x.t);
}
