/**
 * One-shot seed for the SenseAi client-portal launch to the EXISTING
 * clientbase (portal.dlbooks.com.au).
 *
 * Five phases: close the build gaps → make an existing client's portal
 * non-empty → operational readiness → controlled pilot (3-5 friendly
 * clients) → staged launch to the rest of the book.
 *
 * The load-bearing finding behind Phase 2: portal publishing is
 * EVENT-DRIVEN (on quote send, on letter send, on onboarding-run sweep).
 * An existing client who never went through a guided run signs in to a
 * near-empty portal. Nothing else in this project matters if that isn't
 * fixed first.
 *
 * Pure function — accepts no input, returns `{ projects, tasks }`.
 * Idempotency is the runner's responsibility (flag: `portal_launch_seeded`).
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
        description: 'Take portal.dlbooks.com.au from built-but-event-driven to live across the existing clientbase. Order is deliberate: harden against a third Safe Browsing flag, close the build gaps the announcement promises, fix the empty-portal problem for existing clients, get support ready, pilot on 3-5 friendly clients, then stage the rest. The real blocker is Phase 2 — publishing is event-driven, so an existing client signs in to a near-empty portal and granting access emails them nothing. The announcement draft lives at docs/templates/client-portal-announcement.md and must not send until Phase 3 is done.',
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

    // ── Phase 0 — Safe Browsing: cleared, now stop it recurring ───────────
    addPhase(
        'Phase 0 — Safe Browsing hardening (flag CLEARED)',
        'dlbooks.com.au was domain-flagged by Google Safe Browsing as social engineering. Brad\'s Search Console appeal succeeded in the week of 2026-09-08, so the blocker is gone. But this was the SECOND flag cleared the same way (the first was July, cleared 07-30) — twice is a pattern. A public login form on the domain is the likely trigger and it is not going away, so the remaining work is preventing a third flag landing mid-launch.',
        [
            {
                name: 'Add legitimacy cues to the portal sign-in page',
                description: 'Left as "optional hardening" after the July flag, and the domain was flagged again. Put the firm name, ABN, phone number and a link to the main site on the sign-in page. A bare login form on a small domain is exactly the shape Safe Browsing heuristics penalise — and the cues help real clients trust the page too.',
                priority: 'high',
            },
            {
                name: 'Re-check the flag before each launch batch',
                description: 'It is a browser-side interstitial, so an HTTP 200 proves nothing. Open the portal in a browser with no history on the domain — ideally a phone on mobile data, which is how a client will first meet it. Cheap to check, and a flag discovered by a client mid-onboarding is expensive.',
            },
            {
                name: 'Know the recovery path if it flags a third time',
                description: 'Search Console → dlbooks.com.au property → Security issues → note sample URLs → Request Review. Cleared in roughly a week both times. Worth having written down so it does not need rediscovering under pressure.',
            },
        ]
    );

    // ── Phase 1 — Close the build gaps the announcement promises ──────────
    addPhase(
        'Phase 1 — Close the build gaps',
        'Three portal tabs are "coming soon" placeholder cards with no data path. The announcement draft names all three, so either they ship or those bullets get cut. Decide per tab: build it, or cut it from the statement.',
        [
            {
                name: 'DECIDE: build or cut — Invoices, Reports, Business Solutions',
                description: 'All three are placeholder cards today. Cutting them from the announcement is a legitimate, cheap answer and unblocks everything downstream. Building all three is the largest single block of work in this project. Make this call before starting any of the three tasks below.',
                priority: 'high',
                milestone: true,
            },
            {
                name: 'Invoices tab — almost certainly CUT for launch',
                description: 'This is a missing BUSINESS SYSTEM, not a missing tab. There is no CRM invoice model at all: no crm_invoices table, no portal_invoices migration, no publisher, and last_invoice_date is never written. The warehouse "invoices" table holds the CLIENT\'S OWN Xero AR/AP — publishing that would show clients their own invoices back, which is not what "your invoices from DL Bookkeeping" means. Building it means deciding how DL Books bills (Xero-native from our own org, still unconnected, vs a CRM-side model) and building that first. Recommend cutting the bullet from the announcement.',
                priority: 'high',
            },
            {
                name: 'Reports tab — the realistic one to build (T2)',
                description: 'The reporting engine shipped to prod 2026-09-13; only the portal seam is a deliberate no-op, and the full T2 design is already written in REPORTING_SPEC. Work: migration 0016 (NOT 0015 — two files already claim it), fill publish_to_portal, SPA tab + hand-rolled SVG charts, RLS test. Medium size.',
            },
            {
                name: 'GATE on Reports: re-capture Xero fixtures against a real org',
                description: 'The test fixtures are SYNTHETIC, built from API docs rather than a real Xero org, and real sign conventions differ (liabilities/equity positive in real Xero, negative in the fixtures); the P&L fixture also lacks a Gross Profit row. Publishing client-facing financials off an unvalidated normaliser risks the first number a client ever sees being wrong. Also: reports_enabled defaults to 0 — generate one pack by hand and READ it before letting the job run unattended.',
                priority: 'high',
            },
            {
                name: 'Business Solutions tab — product decision, or cut',
                description: 'No spec, no notes, no data model, no publisher anywhere in the repo — the entire implementation is a nav button and a coming-soon card. Nobody has written down what a "bespoke solution" is as a deliverable, so no estimate is meaningful. Cheapest honest option for launch: leave it or remove it, and cut the bullet.',
            },
            {
                name: 'ATO tab — RESOLVED: live, docs only',
                description: 'Confirmed live and publishing on two real triggers (on BAS lodge, and on a confirmed n8n cron firing since 2026-09-06). The spec header is the stale part. Remaining: flip ATO_OBLIGATIONS_SPEC off DRAFT and reconcile its contradicting sections. ONE REAL RISK: the calendar is seeded to June 2027 using the standing pattern, NOT published ATO dates — clients may be shown wrong FY27 due dates. Verify before launch.',
            },
            {
                name: 'Deferrals — RESOLVED: live, digest is the gap',
                description: 'The contradiction resolves in favour of live: migration applied, code on master, SPA real, and a real deferral round-tripped to a real client (deferral 296, note "test back" landed). The stale docs need updating. The actual gap is the DIGEST: the n8n portal-digest workflow is imported but INACTIVE and portal_digest_enabled is 0 in prod. Activate, restart n8n, smoke it, then flip the switch.',
            },
        ]
    );

    // ── Phase 2 — Make an existing client's portal non-empty ──────────────
    addPhase(
        'Phase 2 — Fix the empty-portal problem (BLOCKER)',
        'Portal publishing is event-driven: data appears on quote send, letter send, or an onboarding-run sweep. An existing client who never went through a guided run would sign in to a near-empty portal. Nothing else in this project matters until this is solved.',
        [
            {
                name: 'Confirm exactly what an existing client sees today',
                description: 'Pick one real existing client, grant portal access on a test contact, sign in and look. Do not reason about this from code — look at the actual screen. This defines the size of the rest of this phase.',
                priority: 'high',
            },
            {
                name: 'Verify live Supabase state against the repo\'s claims',
                description: 'Migration application is asserted in file headers and commit messages, not verified against the database. Confirm migrations 0001-0015 are actually present, and check how many portal_members rows exist today — "live for existing clients" depends on that count as much as on any tab.',
            },
            {
                name: 'Build a "publish everything for this client now" path',
                description: 'A backfill that populates a client\'s portal from current CRM state rather than waiting for the next event. Granting access today publishes Details, contacts and live quotes only — engagement letters, documents, lodgements and recon history stay absent until the next event of each type happens naturally. Every per-type publisher already exists and is individually callable, so this is composition work rather than new integration.',
                priority: 'high',
            },
            {
                name: 'Build the invite email for a bare access grant (BLOCKER)',
                description: 'Ticking "Portal access" creates the Supabase login but sends the client nothing. The set-password link only reaches a client as a passenger on a quote email or the guided-onboarding welcome email — neither of which an existing client receives. Without this there is no way to invite an existing client at all. The link-minting function already exists; it needs a caller and an email.',
                priority: 'high',
            },
            {
                name: 'Decide how to handle one-contact-at-a-time granting',
                description: 'Access is granted by ticking a checkbox on a single contact card; there is no bulk grant path (bulk revoke exists, grant has no counterpart). For a pilot of 3-5 this is fine by hand. Before the full book, decide whether to build a bulk grant or accept the clicking.',
            },
            {
                name: 'Decide the empty-tab presentation',
                description: 'Even after backfill, some tabs will be legitimately empty for some clients (no open quotes, no deferrals). An empty state that says "nothing here yet" reads fine; a blank panel reads broken. Check each tab\'s empty state before a client sees it.',
            },
            {
                name: 'Run the backfill against 2-3 real client records and eyeball the result',
                description: 'Verification gate for this phase. If a real client\'s portal looks worth signing into, Phase 2 is done.',
                milestone: true,
            },
        ]
    );

    // ── Phase 3 — Operational readiness ───────────────────────────────────
    addPhase(
        'Phase 3 — Operational readiness',
        'Everything that is not code: data quality, support, the ability to undo. The announcement must not send until this phase is done.',
        [
            {
                name: 'Data-quality pass on client records going to pilot',
                description: 'The portal Details tab is a read-only projection of the CRM, published unvalidated. Two known traps: a blank or unmapped entity type / platform silently VANISHES from the client\'s view rather than erroring, and a malformed ABN publishes verbatim (client #36 is stored with a stray bracket). The bookkeeper name can fall back to a raw username if no user record matches. Check the pilot cohort by hand — there is no readiness gate for this (CLIENT_READINESS_SPEC covers Xero/DLCA only).',
                priority: 'high',
            },
            {
                name: 'Exclude the ambiguous client records from any pilot',
                description: 'Dolphin Gymnastics has separate entities across #95/#96 with an older unlinked #89 holding history, and "Geoffs Cartage" is ambiguous between #11 and churned #21. Resolve or exclude — do not let a client see a portal built on the wrong entity.',
            },
            {
                name: 'Confirm contact emails and decide who gets access per client',
                description: 'The invite is minted for one exact email address. Clients where an owner AND an office manager both need access require two contact cards with portal access ticked. Settle this per client before inviting.',
            },
            {
                name: 'Write the portal support runbook',
                description: 'No SOP exists for supporting portal clients. Needs at minimum: "I can\'t log in" (Forgot password is the self-serve fix — there is no resend-invite button in the CRM), "my link expired" (24h expiry, same fix), "I can\'t see X", and how to add a second contact. Diana needs this before pilot, not during.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Establish and TEST the pilot abort path',
                description: 'Per-contact revoke works properly — unticking deletes the Supabase user, correctly sparing anyone with another membership. But the per-CLIENT bulk revoke is only reachable by starting an offboarding run or moving the pipeline card to Lost, which is an awkward path for a pilot abort. Two things to settle: an easier abort route, and the fact that revoking more than 5 clients at once trips the nightly reconcile\'s delete cap and needs a deliberate force run. Test on a real test contact before pilot, not during.',
                priority: 'high',
            },
            {
                name: 'Note: there is no portal-wide off switch',
                description: 'Clearing the Supabase keys only stops SenseAi pushing and sweeping — it does not log clients out or take the portal down; the SPA keeps serving whatever was already published. If a true maintenance mode matters, it is net-new work. Decide whether it is needed before launch or accepted as a known gap.',
            },
            {
                name: 'Walk Diana through the portal as a client sees it',
                description: 'She will field most of the questions. She should have signed in and clicked every tab before a client does.',
                assignees: ['diana'],
            },
            {
                name: 'End-to-end onboarding test with Diana, start to finish',
                description: 'Run a complete guided onboarding on a test client with Diana driving — A1-A3 engagement, the client-side B1-B4 checklist done from a real portal login, then C1-C9 systems. She should hit every screen herself rather than watch. This is the single best way to find what is confusing before a real client does, and it doubles as her training.',
                priority: 'high',
                assignees: ['brad', 'diana'],
                milestone: true,
            },
            {
                name: 'Full quoting revision with Diana',
                description: 'Walk the quote end to end with her — wording, service descriptions, pricing presentation, how it reads on the portal and in the PDF. The quote is now a client-facing portal document, so anything awkward in it becomes visible in a way it was not before.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'LOE revision with Diana',
                description: 'Review the engagement letter template with Diana alongside the new-processes rewrite below. She signs and sends these, so the wording needs to be hers as much as ours. Covers how it reads on screen for online signing, not just on paper.',
                priority: 'high',
                assignees: ['brad', 'diana'],
            },
            {
                name: 'Finalise and legally review the new engagement letter',
                description: 'The announcement promises "a new engagement letter covering our processes". It must exist before the statement claims it is coming. Includes the AI-tools consent position — docs/templates/ai-tools-consent-annexure.md is still a draft awaiting legal review. Do the Diana revision above first, then send the settled wording to legal.',
                priority: 'high',
            },
            {
                name: 'Set up recurring tasks for all clients',
                description: 'Every client needs their recurring work scheduled — BAS, IAS, payroll runs, monthly reporting, whatever their service tier includes. Without this the practice is still running on memory, and the portal will show clients a lodgement and reporting history that has nothing feeding it. Do this across the whole book, not just the pilot cohort.',
                priority: 'high',
                assignees: ['brad', 'diana'],
                milestone: true,
            },
            {
                name: 'Sign off the announcement statement',
                description: 'docs/templates/client-portal-announcement.md. Final read against what actually shipped in Phase 1 — cut any bullet describing a tab that did not make it. This is the last gate before anything reaches a client.',
                milestone: true,
                priority: 'high',
            },
        ]
    );

    // ── Phase 4 — Controlled pilot ────────────────────────────────────────
    addPhase(
        'Phase 4 — Controlled pilot (3-5 friendly clients)',
        'Small, hand-picked, forgiving. The point is to find what we got wrong while the blast radius is tiny.',
        [
            {
                name: 'Pick the pilot cohort',
                description: '3-5 clients who will tell us honestly when something is confusing rather than quietly giving up. Ideally a mix: one sole trader, one company, one with payroll/timesheets, one that gets deferrals.',
                priority: 'high',
            },
            {
                name: 'Ring each pilot client before sending anything',
                description: 'A phone call first — "we\'re trying something new, you\'re one of a handful we\'re starting with, tell us what\'s rubbish". Turns a cold email into a favour they are doing us, and dramatically improves the feedback.',
                priority: 'high',
            },
            {
                name: 'Send the statement to the pilot cohort only',
                milestone: true,
            },
            {
                name: 'Send pilot invites — early in the day, not Friday',
                description: 'The set-password link lasts 24 hours (Supabase maximum, already configured). A Monday-morning send is safe through Tuesday morning.',
            },
            {
                name: 'Watch the first sign-ins and log every friction point',
                description: 'Where did they get stuck, what did they ring about, what did they not find. Keep an actual list — this is the entire output of the pilot.',
                priority: 'high',
            },
            {
                name: 'Deliberately test the recovery paths on a pilot client',
                description: 'Let one link expire on purpose and walk a real client through Forgot password. That path will be used often at launch scale; it should be proven at pilot scale.',
            },
            {
                name: 'Collect feedback and fix what the pilot exposed',
                description: 'Then decide: proceed to launch, or run a second pilot round. A second round is not a failure.',
                milestone: true,
                priority: 'high',
            },
        ]
    );

    // ── Phase 5 — Staged launch ───────────────────────────────────────────
    addPhase(
        'Phase 5 — Staged launch to the rest of the book',
        'Statement to everyone first, then invites in small batches. Never one big send — that concentrates every "I can\'t log in" call into the same two days.',
        [
            {
                name: 'Send the statement to the full clientbase',
                description: 'Everyone gets the heads-up, so nobody is surprised when their invite arrives weeks later.',
                milestone: true,
                priority: 'high',
            },
            {
                name: 'Define the batches and their order',
                description: 'Group by something meaningful — bookkeeper, service tier, or how engaged they are. Put the most engaged earlier; they generate useful problems while there is still appetite to fix them.',
            },
            {
                name: 'Run batch invites, one batch at a time',
                description: 'Per batch: confirm contact emails, send early in the day, watch for a day, then move on. Do not start a batch while the previous one still has open questions.',
            },
            {
                name: 'Keep a running list of what clients ask',
                description: 'Feeds the support runbook and shows where the portal itself is unclear. Questions that recur three times are a UI problem, not a training problem.',
            },
            {
                name: 'Chase the clients who never signed in',
                description: 'There will be a tail who ignore it entirely. A phone call converts more of them than a reminder email. Decide how hard to push, and accept that some will stay on email.',
            },
            {
                name: 'Roll SharePoint folder access out behind the portal',
                description: 'Deliberately second. The Microsoft guest-invite redemption is the highest-friction step a client faces, and it should not be their first impression of the new way of working.',
            },
            {
                name: 'Full clientbase live',
                description: 'Every active client invited, support runbook reflects real questions, remaining email-only clients are a known and accepted list rather than an oversight.',
                milestone: true,
                priority: 'high',
            },
        ]
    );

    return out;
}
