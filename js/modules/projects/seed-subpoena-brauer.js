/**
 * One-shot seed for the Brauer subpoena legal matter project
 * (court proceedings: debt collection via magistrate, hearing 2026-07-01).
 *
 * Dated checklist: Phase 1–6 with hard cutoffs (debtor served by 17 Jun,
 * hearing on 1 Jul). Tasks grouped by phase with a 6-phase structure:
 * file → serve → hearing prep → hear → if successful → collect.
 *
 * Pure function — accepts no input, returns `{ projects, tasks }`.
 * Idempotency is the runner's responsibility (flag: `subpoena_brauer_seeded`).
 */

function nowIso() { return new Date().toISOString(); }

function makeProjectId() {
    return 'p_sb_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function makeTaskId(slug = '') {
    const tag = slug ? `_${slug}` : '';
    return 't_sb' + tag + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function trim(s) { return typeof s === 'string' ? s.trim() : ''; }

function buildProject() {
    const at = nowIso();
    return {
        id: makeProjectId(),
        name: 'Subpoena — Barry Brauer (Hearing 1 Jul)',
        status: 'active',
        statusOverride: false,
        startDate: null,
        endDate: '2026-07-01',
        participants: ['brad', 'diana'],
        description: 'Court proceedings: debt collection via magistrate. Judgment: $4,659.75 AUD (principal $2,317.90 + interest $2,341.85). Hearing: Wed 1 July 9:30am Melbourne Magistrates\'. Two hard cutoffs: debtor served by 17 Jun, attendance mandatory on 1 Jul.',
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
    };
}

function buildTask(name, description = '', parentTaskId = null) {
    const at = nowIso();
    return {
        id: makeTaskId(),
        projectId: null, // set by caller
        parentTaskId,
        name: trim(name),
        description: trim(description),
        status: 'not-started',
        assignees: ['brad'],
        startDate: null,
        dueDate: null,
        priority: 'normal',
        dependsOn: [],
        comments: [],
        events: [],
        attachments: [],
        isMilestone: false,
        createdAt: at,
        updatedAt: at,
        completedAt: null,
    };
}

export function seedSubpoenaBrauerProject() {
    const out = { projects: [], tasks: [] };
    const at = nowIso();

    const project = buildProject();
    out.projects.push(project);

    // Phase 1 — File the subpoena (do first, this week)
    const phase1 = buildTask(
        'Phase 1 — File the subpoena (do first, this week)',
        'Target: by Fri 6 Jun'
    );
    phase1.projectId = project.id;
    out.tasks.push(phase1);

    const phase1Tasks = [
        'Confirm the legal entity behind "Greenspec Events" (company name + registered office). Target: by Tue 2 Jun',
        'Fill Form 42B requiring production of Brauer\'s pay/earnings records (payslips, employment status, gross/net, deduction capacity)',
        'Insert a "last date for service" and a production date that falls before 1 July so the Registrar has the records on the day',
        'File 42B (original + 2 copies) at Melbourne Magistrates\', pay fee, court issues it. Target: by Fri 6 Jun',
    ];
    for (const taskName of phase1Tasks) {
        const task = buildTask(taskName);
        task.projectId = project.id;
        task.parentTaskId = phase1.id;
        out.tasks.push(task);
    }

    // Phase 2 — Serve the debtor (HARD DEADLINE)
    const phase2 = buildTask(
        'Phase 2 — Serve the debtor (HARD DEADLINE)',
        'At least 14 days before hearing (by Wed 17 Jun). Target service by Wed 10 Jun for buffer'
    );
    phase2.projectId = project.id;
    out.tasks.push(phase2);

    const phase2Tasks = [
        'Serve 72A + 72B + blank 72C on Barry Brauer. Use a process server for clean, provable personal service',
        'Complete + swear/witness Form 6A (affidavit of service), file with court — no fee',
    ];
    for (const taskName of phase2Tasks) {
        const task = buildTask(taskName);
        task.projectId = project.id;
        task.parentTaskId = phase2.id;
        out.tasks.push(task);
    }

    // Phase 3 — Serve the subpoena on the employer
    const phase3 = buildTask(
        'Phase 3 — Serve the subpoena on the employer',
        'Serve issued 42B with conduct money. Respect minimum lead time before production date'
    );
    phase3.projectId = project.id;
    out.tasks.push(phase3);

    const phase3Tasks = [
        'Serve the issued 42B on the employer, with conduct money (reasonable expenses entitlement). Confirm exact Magistrates\' minimum lead time, build in at least a week',
        'Complete + swear Form 6A for the subpoena, file with court',
    ];
    for (const taskName of phase3Tasks) {
        const task = buildTask(taskName);
        task.projectId = project.id;
        task.parentTaskId = phase3.id;
        out.tasks.push(task);
    }

    // Phase 4 — Pre-hearing prep (week of 22 Jun)
    const phase4 = buildTask(
        'Phase 4 — Pre-hearing prep (week of 22 Jun)',
        ''
    );
    phase4.projectId = project.id;
    out.tasks.push(phase4);

    const phase4Tasks = [
        'Check whether Brauer returned his 72C to the court',
        'Chase the subpoenaed records from the employer',
        'Re-verify interest figure ($2,341.85) and total ($4,659.75). Be ready to justify interest if challenged',
        'Build hearing bundle: issued 72A, 72B, both affidavits of service, subpoenaed wage records, original judgment details',
    ];
    for (const taskName of phase4Tasks) {
        const task = buildTask(taskName);
        task.projectId = project.id;
        task.parentTaskId = phase4.id;
        out.tasks.push(task);
    }

    // Phase 5 — Hearing
    const phase5 = buildTask(
        'Phase 5 — Hearing',
        'Wed 1 July, 9:30am, Melbourne Magistrates\'. Attendance mandatory; non-attendance = struck out. Plan for the full day. Bring the bundle.'
    );
    phase5.projectId = project.id;
    phase5.dueDate = '2026-07-01';
    out.tasks.push(phase5);

    // Phase 6 — If the order is made
    const phase6 = buildTask(
        'Phase 6 — If the order is made',
        'Formal attachment of earnings order and enforcement'
    );
    phase6.projectId = project.id;
    out.tasks.push(phase6);

    const phase6Tasks = [
        'Fill Form 72F (formal attachment of earnings order)',
        'File 72F (original + 2 copies), pay fee',
        'Serve 72F on Brauer and the employer. Complete Form 6A for each',
        'Employer should begin deducting/paying ~7 days after being served',
    ];
    for (const taskName of phase6Tasks) {
        const task = buildTask(taskName);
        task.projectId = project.id;
        task.parentTaskId = phase6.id;
        out.tasks.push(task);
    }

    return out;
}
