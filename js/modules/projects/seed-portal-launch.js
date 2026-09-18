/**
 * One-shot seed for the SenseAi client-portal launch to the existing
 * clientbase (portal.dlbooks.com.au).
 *
 * Ten phases: domain hardening → invoicing → reporting → marketing
 * surfaces → live-tab close-out → Business Solutions scoping → backfill
 * for existing clients → practice readiness → pilot → staged launch.
 *
 * Pure function — accepts no input, returns `{ projects, tasks }`.
 * Idempotency is the runner's responsibility (flag: `portal_launch_v3_seeded`).
 */

function nowIso() { return new Date().toISOString(); }

function makeProjectId() {
    return 'p_pl_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function makeTaskId(slug = '') {
    const tag = slug ? `_${slug}` : '';
    return 't_pl' + tag + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function trim(s) { return typeof s === 'string' ? s.trim() : ''; }

function buildProject() {
    const at = nowIso();
    return {
        id: makeProjectId(),
        name: 'Client portal — live, pilot and launch',
        status: 'active',
        statusOverride: false,
        startDate: null,
        endDate: null,
        participants: ['brad', 'diana'],
        description: 'Get portal.dlbooks.com.au live across the existing clientbase. Announcement draft: docs/templates/client-portal-announcement.md.',
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

export function seedPortalLaunchProject() {
    const out = { projects: [], tasks: [] };

    const project = buildProject();
    out.projects.push(project);

    // Helper: push a phase parent plus its children.
    function addPhase(phaseName, phaseDescription, children) {
        const phase = buildTask(phaseName, phaseDescription);
        phase.projectId = project.id;
        out.tasks.push(phase);
        for (const child of children) {
            const task = buildTask(child.name, child.description || '');
            task.projectId = project.id;
            task.parentTaskId = phase.id;
            if (child.milestone) task.isMilestone = true;
            if (child.priority) task.priority = child.priority;
            if (child.assignees) task.assignees = child.assignees;
            out.tasks.push(task);
        }
        return phase;
    }

    // ── Phase 0 ───────────────────────────────────────────────────────────
    addPhase(
        'Phase 0 — Harden the domain against another Safe Browsing flag',
        'Flagged twice (July, cleared 30 Jul; September, cleared by appeal week of 8 Sep).',
        [
            {
                name: 'Add legitimacy cues to the portal sign-in page',
                description: 'Firm name, ABN, phone number, link to the main site.',
                priority: 'high',
            },
            {
                name: 'Check the flag in a fresh browser before each batch',
                description: 'No history on the domain, or a phone on mobile data. HTTP 200 does not show an interstitial.',
            },
            {
                name: 'Write down the Search Console review steps',
                description: 'Search Console → dlbooks.com.au → Security issues → sample URLs → Request Review.',
            },
        ]
    );

    // ── Phase 1 ────────────────────────────────────────────────────────
    addPhase(
        'Phase 1 — Build the invoicing engine',
        'DL Books fee invoicing does not exist yet: no CRM invoice model, no portal_invoices migration, no publisher. The warehouse invoices table is the client\'s own Xero AR/AP and is not this.',
        [
            {
                name: 'Decide where fee invoices are raised and which system owns the number',
                description: 'Raise them in the DL BOOKKEEPING Xero org (connected, tenant d6b68ad8, CRM client #14) and pull them back for the portal, or raise them in SenseAi and push to Xero. Decides who owns the invoice number, who chases payment, and where the client\'s payment status is read from.',
                priority: 'high',
                milestone: true,
            },
            {
                name: 'Build the invoice data model',
                description: 'Invoice and line tables (or a mirror of the Xero invoice, per the decision above), numbering, status, links to quotes, service tiers and time entries. Write last_invoice_date on crm_clients — nothing writes it today.',
                priority: 'high',
            },
            {
                name: 'Generate invoices from service tiers and time entries',
                description: 'Recurring fees per tier plus billable time. crm_time_entries.invoice_ref already exists as a free-text reference.',
                priority: 'high',
            },
            {
                name: 'Build the invoice document and PDF',
                description: 'Reuse static/css/document.css, the shared white-label look used by quotes, letters and statements.',
            },
            {
                name: 'Publish invoices to the portal',
                description: 'portal_invoices migration, publisher in portal/publish.py, RLS policy, and the SPA tab replacing the placeholder card.',
                priority: 'high',
            },
            {
                name: 'Raise and issue one real invoice end to end',
                milestone: true,
                priority: 'high',
            },
        ]
    );

    // ── Phase 1b ──────────────────────────────────────────────────────
    addPhase(
        'Phase 1b — Refine reporting and finish the portal tab',
        'The reporting engine shipped to prod 2026-09-13. The portal seam is a deliberate no-op and the numbers need validating against a real org.',
        [
            {
                name: 'Re-capture the Xero test fixtures from a real org',
                description: 'Current fixtures are synthetic: sign conventions are inverted and the P&L has no Gross Profit row.',
                priority: 'high',
            },
            {
                name: 'Generate a pack by hand and check every number',
                description: 'Read it against the client\'s real Xero before anything is client-facing. Then set reports_enabled to 1.',
                priority: 'high',
            },
            {
                name: 'Refine the pack content and layout',
                description: 'What goes in, what order, what a client actually reads.',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Build the Reports tab',
                description: 'Migration 0016 (0015 is taken twice), fill publish_to_portal in reports/publish.py, SPA tab with SVG charts, RLS test.',
                priority: 'high',
            },
            {
                name: 'Add the Reports/<FY> SharePoint archive',
                description: 'The Reports folder is flat today.',
            },
        ]
    );

    // ── Phase 1c ──────────────────────────────────────────────────────
    addPhase(
        'Phase 1c — Make the portal a marketing channel',
        'Home and Business Solutions are marketing surfaces aimed at a captive audience, so content reaches clients without emailing them. Business Solutions stays visible while empty — a standing reminder that we offer more than bookkeeping — and turns operational as clients take up offers.',
        [
            {
                name: 'Write the Business Solutions tab copy',
                description: 'What we can build for a client and how they start a conversation. Written to read well empty, since that is its normal state for now.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Replace the Business Solutions placeholder',
                description: 'The nav button, #tab-solutions section and TABS entry already exist. Swap the .coming-wrap block for real markup and drop the "Coming soon" badge. It should look deliberate while empty, not unfinished.',
                priority: 'high',
            },
            {
                name: 'Write the Home tab content',
                description: 'The landing surface after onboarding finishes. The #home-content div already exists as the declared marketing slot and renders whenever the checklist is clear — it just has no content behind it.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Decide how marketing content gets updated',
                description: 'Who changes the copy, how often, and whether it is per-client or the same for everyone.',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Add a "drop us a note" button to Business Solutions',
                description: 'Along the lines of "tell us what you need to make your business better". The collector is nearly free — the onboarding checklist\'s "I need help" branch already does free-text to a CRM note + task with an idempotency stamp. The cost is the client write path: a migration carrying the permissive policy, its restrictive no-staff-write twin, column grants, a state pin and a length cap.',
                priority: 'high',
            },
        ]
    );

    // ── Phase 1d ──────────────────────────────────────────────────────
    addPhase(
        'Phase 1d — Close out the live tabs',
        'ATO and Reconciliation are live; the docs and one data check lag behind.',
        [
            {
                name: 'Update the stale ATO spec and check the FY27 dates',
                description: 'ATO_OBLIGATIONS_SPEC is marked DRAFT but shipped; §2.6 and §4 contradict §5. FY27 calendar dates follow the standing pattern, not published ATO dates.',
            },
            {
                name: 'Activate the portal digest in n8n and switch it on',
                description: 'senseAi-portal-digest is imported but inactive; portal_digest_enabled is 0 in prod. Activate, restart n8n, smoke it, then flip the switch.',
            },
            {
                name: 'Update the stale deferral docs',
                description: 'DEFERRAL_FLOW_SPEC and tasks/todo.md still say "awaiting rollout". It is live — deferral 296 round-tripped to a real client.',
            },
        ]
    );

    // ── Phase 1e ──────────────────────────────────────────────────────
    addPhase(
        'Phase 1e — Scope what Business Solutions delivers',
        'Business Solutions is broader than Document Services. Docservices is one delivery mechanism that can sit behind an offering, not the definition of the offering. Its preview contract is tabular (columns, groups, rows), so it fits timesheet-shaped work and little else. Scoping only — build follows the first real solution.',
        [
            {
                name: 'List the kinds of solution we expect to offer',
                description: 'Advisory, dashboards, training, one-off builds, recurring deliverables, software access — whatever is actually on the table. Until this exists, any data model is a guess.',
                priority: 'high',
                milestone: true,
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Work out what those kinds have in common',
                description: 'The shared shape across them is what the tab renders and what the data model holds. If they have little in common, the tab is a directory pointing at per-solution surfaces rather than one renderer.',
                priority: 'high',
            },
            {
                name: 'Decide which delivery mechanisms sit behind an offering',
                description: 'Docservices for anything tabular and cyclical, a document or report drop, a link out to something hosted elsewhere, or purely a conversation we have offline. One offering may use more than one.',
                priority: 'high',
            },
            {
                name: 'Decide how the tab stays generic as offerings are added',
                description: 'Portal tabs are hard-coded in three places (nav button, section, TABS array) with eager loading, so a sub-surface per offering costs another table, loader and detail view. One table with a content column and a renderer dispatching on a kind field avoids that.',
                priority: 'high',
            },
            {
                name: 'Decide how a client takes up an offer',
                description: 'Whether a call-to-action creates the delivery record directly, or raises a CRM task so we scope and price it first. Likely differs per kind of solution.',
                priority: 'high',
            },
            {
                name: 'Decide where docservices fits and what it needs to change',
                description: 'docservices_catalog and docservices_subscriptions are already the firm-facing definition and per-client uptake for cyclical deliverables. If Business Solutions covers more than that, either docservices generalises or it stays one mechanism among several.',
            },
            {
                name: 'Decide how the portal login replaces the owner magic link',
                description: 'Docservices reaches clients by signed magic-link token with a shared synthetic user, because owner_user_id is NOT NULL — the handover flags this breaks past one magic-link owner. It is also dual-surfaced today: the same cycle renders at the magic-link page and the portal Timesheets tab. Worth settling regardless of the Business Solutions shape.',
                priority: 'high',
            },
            {
                name: 'Decide whether offerings and uptake need an admin UI',
                description: 'Docservices catalog and subscription creation are DB-seed only today — create_subscription() is exposed on no route. Whatever the model ends up being, adding an offering should not be a manual prod script run.',
            },
            {
                name: 'Write the Business Solutions spec',
                description: 'What the offering is, what the tab renders, which mechanisms deliver it, and how a client takes one up.',
                milestone: true,
            },
        ]
    );

    // ── Phase 2 ───────────────────────────────────────────────────────────
    addPhase(
        'Phase 2 — Make an existing client\'s portal show their data',
        'Publishing is event-driven. An existing client sees Details, contacts and live quotes only, and granting access sends them nothing.',
        [
            {
                name: 'Sign in as a real existing client and record what shows',
                description: 'Grant access on a test contact, sign in, screenshot every tab.',
                priority: 'high',
            },
            {
                name: 'Check the live Supabase migrations and member count',
                description: 'Confirm 0001-0015 are applied and count portal_members rows.',
            },
            {
                name: 'Build a backfill that publishes a client\'s full record',
                description: 'Details, contacts, letters, documents, lodgements, quotes. The per-type publishers exist in portal/publish.py.',
                priority: 'high',
            },
            {
                name: 'Send an invite email when portal access is granted',
                description: 'invite_link_for_email exists but has no caller on a bare grant. Today the link only rides on a quote or welcome email.',
                priority: 'high',
            },
            {
                name: 'Decide whether to build bulk access granting',
                description: 'Access is one checkbox per contact; bulk revoke exists, bulk grant does not.',
            },
            {
                name: 'Check every tab\'s empty state',
                description: 'Some tabs will be legitimately empty per client.',
            },
            {
                name: 'Run the backfill on three real clients and review it',
                milestone: true,
            },
        ]
    );

    // ── Phase 3 ───────────────────────────────────────────────────────────
    addPhase(
        'Phase 3 — Get the practice ready to support clients',
        'Must be complete before the announcement sends.',
        [
            {
                name: 'Clean up the client records going to pilot',
                description: 'Details publishes unvalidated: a blank entity type or platform disappears from the client\'s view, a malformed ABN publishes as-is (client #36 has a stray bracket), and an unmatched bookkeeper shows as a raw username.',
                priority: 'high',
            },
            {
                name: 'Resolve or exclude the ambiguous client records',
                description: 'Dolphin Gymnastics #95/#96/#89; Geoffs Cartage #11 vs churned #21.',
            },
            {
                name: 'Confirm who gets portal access at each client',
                description: 'One invite per email address. Multiple people need a contact card each.',
            },
            {
                name: 'Write the portal support runbook',
                description: 'Can\'t log in, expired link, can\'t see something, adding a second contact. Forgot password is the only self-serve reset; there is no resend-invite button.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Test pulling a client out of the pilot',
                description: 'Per-contact revoke works. Per-client revoke is only reachable via offboarding or pipeline-Lost, and revoking more than 5 trips the reconcile delete cap.',
                priority: 'high',
            },
            {
                name: 'Decide whether the portal needs a maintenance mode',
                description: 'Clearing the Supabase keys stops publishing and sweeping but does not log clients out or take the portal down.',
            },
            {
                name: 'Walk Diana through the portal as a client sees it',
                assignees: ['diana'],
            },
            {
                name: 'Run an end-to-end onboarding test with Diana',
                description: 'A1-A3, the client-side B1-B4 checklist from a real portal login, then C1-C9. Diana drives.',
                priority: 'high',
                assignees: ['brad', 'diana'],
                milestone: true,
            },
            {
                name: 'Revise the quote with Diana',
                description: 'Wording, service descriptions, pricing presentation, how it reads in the portal and the PDF.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Revise the engagement letter with Diana',
                description: 'Including how it reads on screen for online signing.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Get the new engagement letter legally reviewed',
                description: 'Covers the current processes and the AI-tools consent position (docs/templates/ai-tools-consent-annexure.md is still a draft).',
                priority: 'high',
            },
            {
                name: 'Set up recurring tasks for all clients',
                description: 'BAS, IAS, payroll runs, monthly reporting per service tier. Whole book, not just the pilot.',
                priority: 'high',
                assignees: ['brad', 'diana'],
                milestone: true,
            },
            {
                name: 'Sign off the client announcement',
                description: 'docs/templates/client-portal-announcement.md, checked against what shipped in Phase 1.',
                priority: 'high',
                milestone: true,
            },
        ]
    );

    // ── Phase 4 ───────────────────────────────────────────────────────────
    addPhase(
        'Phase 4 — Run a pilot with three to five clients',
        '',
        [
            {
                name: 'Pick the pilot cohort',
                description: 'Mix of sole trader, company, one with payroll, one that gets deferrals.',
                priority: 'high',
            },
            {
                name: 'Ring each pilot client before sending anything',
                priority: 'high',
            },
            {
                name: 'Send the announcement to the pilot cohort',
                milestone: true,
            },
            {
                name: 'Send the pilot invites',
                description: 'Early in the day, not Friday. The set-password link lasts 24 hours.',
            },
            {
                name: 'Watch the first sign-ins and log what goes wrong',
                priority: 'high',
            },
            {
                name: 'Test the password recovery path with a pilot client',
                description: 'Let a link expire and walk them through Forgot password.',
            },
            {
                name: 'Fix what the pilot exposed',
                milestone: true,
                priority: 'high',
            },
        ]
    );

    // ── Phase 5 ───────────────────────────────────────────────────────────
    addPhase(
        'Phase 5 — Invite the rest of the clientbase in batches',
        'Announcement to everyone first, then invites in batches.',
        [
            {
                name: 'Send the announcement to the full clientbase',
                milestone: true,
                priority: 'high',
            },
            {
                name: 'Define the batches and their order',
                description: 'Most engaged clients first.',
            },
            {
                name: 'Run the batch invites',
                description: 'Per batch: confirm contact emails, send early in the day, watch for a day.',
            },
            {
                name: 'Keep a running list of what clients ask',
                description: 'Feeds the support runbook.',
            },
            {
                name: 'Chase the clients who never signed in',
            },
            {
                name: 'Roll out SharePoint folder access',
                description: 'After the portal is bedded in. Guest invite redemption is the highest-friction step.',
            },
            {
                name: 'Confirm the full clientbase is live',
                description: 'Every active client invited; remaining email-only clients are a known list.',
                milestone: true,
                priority: 'high',
            },
        ]
    );

    return out;
}
