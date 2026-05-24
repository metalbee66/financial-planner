/**
 * One-shot seed for the SenseAi "Business transformation & scale" project,
 * imported into the Family Planner Projects module (v2.0.1).
 *
 * Source: a Claude conversation that produced the project tree before the
 * Asana subscription gate locked Brad out of the original Asana board. The
 * JSON below is the literal payload Brad pasted on 2026-05-24.
 *
 * Mapping (confirmed with Brad in the v2.0.1 walkthrough):
 *
 *   project.milestones[]              → a 9th "Milestones" project with one
 *                                       milestone-flagged task per entry, dueDate
 *                                       = milestone.date, isMilestone = true
 *   streams[]                         → one project each, named exactly stream.name
 *   stream.deadline                   → project.endDate
 *   stream.owner                      → kept as default participants (brad+diana)
 *   stream.notes                      → folded into the project description
 *   stream.tasks[]                    → top-level project tasks
 *   stream.tasks[].assignee 'both'    → ['brad','diana']
 *   stream.tasks[].subtasks[] strings → real child tasks with parentTaskId set
 *   stream.tasks[].status 'template'  → 'not-started' + name prefixed "[Template]"
 *
 * Pure function — accepts the seed object, returns `{projects, tasks}` for
 * the caller to append. Idempotency is the runner's responsibility.
 */

const VALID_STATUSES = new Set(['not-started', 'in-progress', 'review', 'done', 'blocked']);
const VALID_PRIORITIES = new Set(['low', 'normal', 'high']);

function nowIso() { return new Date().toISOString(); }

function makeProjectId(slug) {
    const tag = slug ? `_${slug}` : '';
    return 'p_bt' + tag + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function makeTaskId(slug = '') {
    const tag = slug ? `_${slug}` : '';
    return 't_bt' + tag + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function trim(s) { return typeof s === 'string' ? s.trim() : ''; }

function mapAssignee(a) {
    if (a === 'brad' || a === 'diana') return [a];
    if (a === 'both') return ['brad', 'diana'];
    return [];
}

function mapStatus(s) {
    if (s === 'todo') return 'not-started';
    if (s === 'template') return 'not-started';
    return VALID_STATUSES.has(s) ? s : 'not-started';
}

function mapPriority(p) {
    if (p === 'medium') return 'normal';
    return VALID_PRIORITIES.has(p) ? p : 'normal';
}

function buildProject({ name, endDate, description }) {
    const at = nowIso();
    return {
        id: makeProjectId(),
        name: trim(name),
        status: 'active',
        statusOverride: false,
        startDate: null,
        endDate: endDate || null,
        participants: ['brad', 'diana'],
        description: trim(description),
        createdAt: at,
        updatedAt: at,
        archivedAt: null,
    };
}

function buildTask(src, projectId, opts = {}) {
    const at = nowIso();
    const status = mapStatus(src.status);
    const namePrefix = src.status === 'template' ? '[Template] ' : '';
    return {
        id: makeTaskId(),
        projectId,
        parentTaskId: opts.parentTaskId || null,
        name: namePrefix + trim(src.name),
        description: trim(src.description),
        status,
        assignees: mapAssignee(src.assignee),
        startDate: src.start_date || null,
        dueDate: src.due_date || null,
        priority: mapPriority(src.priority),
        dependsOn: [],
        comments: [],
        events: [],
        attachments: [],
        isMilestone: opts.isMilestone === true,
        createdAt: at,
        updatedAt: at,
        completedAt: status === 'done' ? at : null,
    };
}

function buildSubtask({ name, parent, projectId }) {
    const at = nowIso();
    return {
        id: makeTaskId('st'),
        projectId,
        parentTaskId: parent.id,
        name: trim(name),
        description: '',
        status: 'not-started',
        assignees: parent.assignees.slice(),
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

/**
 * Convert the SenseAi business-transformation seed JSON into Projects-module
 * shape. Returns `{ projects, tasks }`; never mutates the input.
 *
 * Streams with blank names or missing task arrays are silently skipped.
 */
export function seedBusinessTransformProjects(seed) {
    const out = { projects: [], tasks: [] };
    if (!seed || typeof seed !== 'object') return out;
    const meta = seed.project || {};

    // 9th project — Milestones across the whole rollout.
    const milestones = Array.isArray(meta.milestones) ? meta.milestones : [];
    if (milestones.length > 0) {
        const milestoneProj = buildProject({
            name: 'Milestones',
            endDate: meta.target_date || null,
            description: `Cross-stream checkpoints for ${trim(meta.name) || 'the v2.0 rollout'}.`,
        });
        out.projects.push(milestoneProj);
        for (const m of milestones) {
            if (!m || !trim(m.name)) continue;
            const task = buildTask(
                {
                    name: m.name,
                    status: 'todo',
                    assignee: meta.owner || 'brad',
                    due_date: m.date || null,
                    description: '',
                },
                milestoneProj.id,
                { isMilestone: true }
            );
            out.tasks.push(task);
        }
    }

    const streams = Array.isArray(seed.streams) ? seed.streams : [];
    for (const stream of streams) {
        if (!stream || !trim(stream.name)) continue;
        const desc = [stream.owner ? `Owner: ${stream.owner}.` : null, trim(stream.notes)]
            .filter(Boolean)
            .join(' ');
        const proj = buildProject({
            name: stream.name,
            endDate: stream.deadline || null,
            description: desc,
        });
        out.projects.push(proj);
        const tasks = Array.isArray(stream.tasks) ? stream.tasks : [];
        for (const t of tasks) {
            if (!t || !trim(t.name)) continue;
            const parent = buildTask(t, proj.id);
            out.tasks.push(parent);
            const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
            for (const st of subs) {
                if (!trim(st)) continue;
                out.tasks.push(buildSubtask({ name: st, parent, projectId: proj.id }));
            }
        }
    }

    return out;
}

/**
 * The literal seed payload Brad pasted in the v2.0.1 walkthrough. Kept as a
 * frozen constant so re-runs / tests are deterministic. To re-import after
 * fixing a transcription glitch: flip the runner's idempotency flag back to
 * false (via the in-app admin path or by editing localStorage), edit the
 * relevant entry below, and let the next page-load re-apply the seed.
 */
export const BUSINESS_TRANSFORM_SEED = Object.freeze({
    project: {
        name: 'Business transformation & scale — SPEC v2.0',
        description: 'End-to-end business transformation from sole operator to registered company, scaling from 10 to 50 Xero clients with AI-supported workflows.',
        owner: 'brad',
        target_date: '2026-07-01',
        milestones: [
            { name: 'CRM MVP live', date: '2026-04-18' },
            { name: 'Tech infrastructure complete', date: '2026-04-30' },
            { name: 'Mini S12 Pro configured', date: '2026-04-22' },
            { name: 'SharePoint migration complete', date: '2026-05-16' },
            { name: 'SEi14 live', date: '2026-05-31' },
            { name: 'AI agents operational', date: '2026-05-31' },
            { name: 'SOPs complete', date: '2026-05-31' },
            { name: 'Director IDs + company registered', date: '2026-06-07' },
            { name: 'ABN + GST registered', date: '2026-06-10' },
            { name: 'Bank account open', date: '2026-06-14' },
            { name: 'Business transferred to new entity', date: '2026-06-28' },
            { name: 'Trading as company', date: '2026-07-01' },
        ],
    },
    streams: [
        {
            id: 'stream_1',
            name: 'Stream 1 — CRM build',
            owner: 'brad',
            deadline: '2026-05-31',
            tasks: [
                {
                    id: 's1_t1',
                    name: 'Phase 1: Auth module',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-12', due_date: '2026-04-12', status: 'todo',
                    description: 'auth/models.py — users table, password hashing via werkzeug.security\nauth/routes.py — /auth/login, /auth/logout Blueprint\nauth/decorators.py — @login_required, @role_required, @api_key_or_login_required\nauth/cli.py — python -m auth.cli create-user --username brad --role admin\nCreate 2 users: brad (admin), diana (bookkeeper)\nFollow core/approval_queue.py SQLite pattern: _CREATE_TABLE constant, _get_conn() with WAL mode, auto-creation',
                    subtasks: [
                        'auth/models.py — users table + password hashing',
                        'auth/routes.py — login/logout Blueprint',
                        'auth/decorators.py — @login_required, @role_required, @api_key_or_login_required',
                        'auth/cli.py — create-user CLI command',
                        'Seed users: brad (admin), diana (bookkeeper)',
                        'Follow _get_conn() WAL mode pattern from existing codebase',
                    ],
                },
                {
                    id: 's1_t2',
                    name: 'Phase 1: Client CRUD + contacts + shared nav',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-13', due_date: '2026-04-14', status: 'todo',
                    description: 'templates/base.html shared layout and nav. crm_clients and crm_contacts tables with full CRUD. crm/services.py skeleton with log_activity() helper. Client list and detail views.',
                    subtasks: [
                        'templates/base.html — shared layout, nav: Xero Chat | Clients | Tasks | Dashboard',
                        'crm_clients table — include bas_frequency, next_bas_due, health_updated_at from day one',
                        'crm_contacts table — embedded in client detail page',
                        'crm/services.py — log_activity() helper, all activity writes route through it',
                        'Client list view — sortable by name/status/health, filterable, searchable',
                        'Client detail page — all fields, inline contacts, activity log, notes',
                        'Link crm_clients.tenant_id to Xero organisations table',
                    ],
                },
                {
                    id: 's1_t3',
                    name: 'Phase 1: Tasks + activity log',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-15', due_date: '2026-04-16', status: 'todo',
                    description: 'crm_tasks and crm_activities tables with CRUD. Task list view. Activity log on client detail page.',
                    subtasks: [
                        'crm_tasks table — include opportunity_id FK (nullable) for pipeline linkage',
                        'Task list view — filterable by assignee, status, client, due date',
                        'crm_activities table — type: note, call, email, meeting, status_change, task_completed',
                        'Activity log on client detail — timestamped, user-attributed',
                        'All activity writes route through log_activity() in services.py — never direct inserts',
                    ],
                },
                {
                    id: 's1_t4',
                    name: 'Phase 1: Migrate 10 clients + Diana walkthrough',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-17', due_date: '2026-04-18', status: 'todo',
                    description: 'Seed all 10 active clients into CRM. Link Xero tenant IDs. Diana walkthrough and sign-off.',
                    subtasks: [
                        'Create crm_clients records for all 10 active clients',
                        'Link each to their Xero tenant_id',
                        'Record: service scope, monthly fee, BAS frequency, next BAS due, start date',
                        "Flag clients with software on Diana's PC",
                        'Assign Diana as primary_bookkeeper on each record',
                        'Diana walkthrough — full session, raise issues',
                        'Buffer: polish, edge case fixes, missed fields',
                    ],
                },
                {
                    id: 's1_t5',
                    name: 'Phase 2: Pipeline + health indicators + BAS schedule',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-19', due_date: '2026-04-26', status: 'todo',
                    description: 'Pipeline Kanban board, advance_pipeline_stage() with activity log, BAS schedule table, calculate_health() with dual-path refresh.',
                    subtasks: [
                        'crm_pipeline table with CRUD',
                        'Pipeline Kanban board — drag to advance, visual cards',
                        'advance_pipeline_stage(opportunity_id, new_stage, performed_by) in services.py — updates stage, writes activity log (type: status_change), fires pipeline-change webhook to n8n',
                        'All stage changes route through advance_pipeline_stage() only',
                        'crm_bas_schedule table — one row per period per client',
                        'refresh_bas_schedule(client_id) in services.py — recomputes crm_clients.next_bas_due',
                        'calculate_health(tenant_id) in services.py — returns: healthy, attention, at_risk, critical',
                        'On-demand health: client detail route calls calculate_health() at start, writes back',
                        'Scheduled health: n8n calls PUT /api/crm/clients/<id> at 7:15am AEST',
                    ],
                },
                {
                    id: 's1_t6',
                    name: 'Phase 2: Devices + dashboard + n8n API',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-27', due_date: '2026-04-30', status: 'todo',
                    description: 'Device registry, business dashboard, Diana workload view, full REST API for n8n with API key auth.',
                    subtasks: [
                        'crm_devices table with CRUD',
                        'Device registry view — status, client, Tailscale IP, lease info',
                        'Business dashboard — active clients, MRR, pipeline value, tasks overdue, device fleet',
                        'Diana workload view — tasks by client and due date',
                        '@api_key_or_login_required — checks X-API-Key header against N8N_API_KEY in .env',
                        'GET /api/crm/clients',
                        'GET /api/crm/clients/<id>',
                        'PUT /api/crm/clients/<id>',
                        'POST /api/crm/tasks',
                        'GET /api/crm/tasks?assigned_to=&status=',
                        'PUT /api/crm/tasks/<id>',
                        'POST /api/crm/activities',
                        'GET /api/crm/devices',
                        'GET /api/crm/dashboard',
                        'POST /api/crm/pipeline/<id>/advance',
                        'Webhook dispatch: pipeline-change, client-health-alert, device-offline',
                        'Add N8N_API_KEY and N8N_WEBHOOK_BASE to .env and .env.example',
                    ],
                },
                {
                    id: 's1_t7',
                    name: 'Phase 3: Quote builder + PDF + pipeline reports',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-01', due_date: '2026-05-31', status: 'todo',
                    description: 'Quote builder with service tier templates, HTML print-to-PDF output, pipeline and fleet reports.',
                    subtasks: [
                        'crm_quotes and crm_quote_lines tables with CRUD',
                        'Quote number generation: Q-YYYY-NNNN format',
                        'Quote builder UI — select tier, add line items, calculate total',
                        'Service tier templates: Essentials, Standard, Managed',
                        'Quote rendering: /crm/quotes/<id>/print — styled HTML + print CSS, browser print-to-PDF',
                        'No new Python dependency for PDF — evaluate WeasyPrint/Playwright only if n8n needs server-side generation',
                        'Quote status: Draft → Sent → Accepted → Declined',
                        'Pipeline activity logging + win/loss recording',
                        'Pipeline report, device fleet report, client health dashboard',
                    ],
                },
            ],
        },
        {
            id: 'stream_2',
            name: 'Stream 2 — Tech infrastructure',
            owner: 'brad',
            deadline: '2026-05-31',
            tasks: [
                {
                    id: 's2_t1', name: 'DNS move to Cloudflare',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-04-14', due_date: '2026-04-16', status: 'todo',
                    subtasks: [
                        'Log into GoDaddy — note all current DNS records (A, MX, CNAME, TXT)',
                        'Create free Cloudflare account, add domain',
                        'Verify scanned records match GoDaddy exactly before switching',
                        'Update nameservers at GoDaddy to Cloudflare nameservers',
                        'Verify propagation, enable proxy on web-facing records',
                        'Enable HTTPS redirect rule',
                        'Set up SPF, DKIM, DMARC — critical before M365 cutover',
                    ],
                },
                {
                    id: 's2_t2', name: 'Microsoft 365 setup + Zoho migration',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-14', due_date: '2026-04-22', status: 'todo',
                    subtasks: [
                        'Purchase Business Standard ($17 AUD/user/month x 2)',
                        'Create M365 tenant using business domain',
                        'Verify domain via DNS TXT record in Cloudflare',
                        'Create accounts for Brad and Diana',
                        'Configure MX records in Cloudflare for Exchange',
                        'Set up email aliases: info@, bookkeeping@',
                        'Install M365 apps on both machines',
                        'Migrate Zoho email via IMAP migration tool',
                        'Test send/receive, cancel Zoho once confirmed clean',
                    ],
                },
                {
                    id: 's2_t3', name: 'Mini S12 Pro setup — client endpoint proof of concept',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-20', due_date: '2026-04-22', status: 'todo',
                    notes: 'Arrives 20 April',
                    subtasks: [
                        'Verify Windows 11 Pro — upgrade from Home if needed (~$20 AUD)',
                        'Run Windows Update fully before any configuration',
                        'Install Tailscale, add to network',
                        'Enable Wake-on-LAN in BIOS',
                        'Configure auto power-on after power failure in BIOS',
                        'Enable Remote Desktop',
                        'Diana tests RDP over Tailscale — full Xero + software session',
                        'Document provisioning steps — becomes SOP for all future client devices',
                        'Create base Windows snapshot for re-provisioning',
                        'Label: serial + Tailscale node ID, register in CRM device module',
                    ],
                },
                {
                    id: 's2_t4', name: 'SEi14 setup — Hyper-V + Docker + Flask service',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-01', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Confirm Windows 11 Pro on delivery, run Windows Update',
                        'Enable Hyper-V — Control Panel → Programs → Turn Windows Features On/Off',
                        'Install Tailscale, add to same network as Diana and S12 Pro',
                        'Set up Hyper-V external virtual switch for VM internet access',
                        'Create base Windows 11 VM template, snapshot clean state',
                        'Install Docker Desktop (WSL2 backend)',
                        'Deploy n8n: docker run -d --name n8n -p 5678:5678 --restart unless-stopped n8nio/n8n',
                        'Install Flask monolith as Windows Service via NSSM',
                        'Install Node.js, Python 3.14, Git, VS Code',
                        'Set up Task Scheduler: sync_all.py daily 7:00am AEST',
                        'Configure backup: daily DB to USB + weekly to OneDrive',
                        'Purchase and configure UPS',
                        'Test: NSSM restarts Flask after crash, docker restart n8n resumes, DB restore from USB',
                    ],
                },
                {
                    id: 's2_t5', name: 'SharePoint document migration',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-01', due_date: '2026-05-16', status: 'todo',
                    subtasks: [
                        'Create SharePoint site for the business',
                        'Build folder architecture: /Clients/[Name]/Workpapers/[Year]/, /Reports/, /Correspondence/, /Onboarding/, /Internal/SOPs/, /Internal/Templates/, /Internal/Company/, /Devices/[Serial]/',
                        'Set permissions: Diana full access to client folders; clients guest access to own folder only',
                        'Migrate Google Drive files folder by folder — verify completeness',
                        'Set up OneDrive sync on both machines',
                        'Test client external access',
                        'Retire Google Drive once confirmed complete',
                    ],
                },
            ],
        },
        {
            id: 'stream_3',
            name: 'Stream 3 — Client VM migration',
            owner: 'brad',
            deadline: '2026-05-31',
            tasks: [
                {
                    id: 's3_t1', name: "Audit client software on Diana's PC",
                    assignee: 'diana', priority: 'high',
                    start_date: '2026-04-14', due_date: '2026-04-22', status: 'todo',
                    subtasks: [
                        "List all client-specific software on Diana's PC",
                        'Record per client: software name, version, licence key/login, data file location',
                        'Identify clients requiring VPN or specific network access',
                        'Flag hardware-locked licences — may need vendor contact',
                        'Prioritise migration order: highest risk or most active clients first',
                        'Confirm pure Xero cloud clients need no VM',
                        'Output: clear list for Brad to plan VM builds',
                    ],
                },
                {
                    id: 's3_t2', name: 'Build and validate client VMs on SEi14',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-01', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Clone base VM template on SEi14 for each client',
                        'Name VM: Client-[ClientName]',
                        'Install client-specific software',
                        'Transfer or restore client data files',
                        'Configure VPN/network settings if required',
                        'Diana tests: RDP over Tailscale, verify software and data intact',
                        'Register VM in CRM crm_devices table',
                        "Remove client software from Diana's local machine",
                        "Final state: Diana's machine has zero client software installed",
                    ],
                },
            ],
        },
        {
            id: 'stream_4',
            name: 'Stream 4 — AI agents & automation',
            owner: 'brad',
            deadline: '2026-05-31',
            notes: 'Depends on SEi14 being live. All n8n-to-CRM communication via REST API — never direct DB access.',
            tasks: [
                {
                    id: 's4_t1', name: 'n8n setup and credential configuration',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-01', due_date: '2026-05-07', status: 'todo',
                    subtasks: [
                        'n8n running in Docker on SEi14, access via Tailscale IP port 5678',
                        'Create n8n admin account — not default credentials, store in password manager',
                        'Configure credentials: Xero OAuth2, M365/Graph API, CRM API key, Tailscale API',
                        'Build and test one simple end-to-end workflow before building complex agents',
                    ],
                },
                {
                    id: 's4_t2', name: 'Agent: Xero health sync',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-07', due_date: '2026-05-14', status: 'todo',
                    subtasks: [
                        'Schedule: daily 7:15am AEST after sync_all.py completes',
                        'GET /api/crm/clients — retrieve all active clients with tenant_id',
                        'For each client GET /api/crm/clients/<id> — retrieve Xero warehouse health indicators',
                        'Update health_status via PUT /api/crm/clients/<id>',
                        'Alert: reconciliation > 7 days behind — POST /api/crm/tasks (category: alert, priority: high, assigned_to: diana)',
                        'Alert: overdue invoices > $500 — POST /api/crm/tasks (category: alert)',
                    ],
                },
                {
                    id: 's4_t3', name: 'Agent: Client onboarding',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-14', due_date: '2026-05-21', status: 'todo',
                    subtasks: [
                        "Trigger: pipeline-change webhook with new_stage = 'onboarding'",
                        'Step 1: Send welcome email via M365 Graph API',
                        'Step 2: Create client SharePoint folder structure',
                        'Step 3: POST /api/crm/tasks — onboarding task list, assign to Diana',
                        'Step 4: If managed_endpoint_flag = 1, create device provisioning task for Brad',
                        'Step 5: Generate engagement letter, attach via POST /api/crm/activities',
                        'Step 6: Send document request checklist to primary contact',
                        'Step 7: Day 3 — if no SharePoint activity, automated follow-up email',
                        'Step 8: Create Xero org connection task, assign to Diana',
                        'Log all steps via POST /api/crm/activities',
                    ],
                },
                {
                    id: 's4_t4', name: 'Agent: Monthly reporting',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-14', due_date: '2026-05-21', status: 'todo',
                    subtasks: [
                        'Trigger: 1st of each month 8:00am AEST',
                        'For each active client: GET /api/crm/clients/<id> — Xero health data from warehouse',
                        'Pass data to Claude API — generate natural language monthly summary',
                        'Save draft to /Clients/[ClientName]/Reports/[Year-Month]-draft.md on SharePoint',
                        'POST /api/crm/tasks: review and send report, assigned Diana, due 5th of month',
                        'On Diana completing task: auto-send report via M365 Graph API',
                        'Log send via POST /api/crm/activities',
                    ],
                },
                {
                    id: 's4_t5', name: 'Agent: BAS preparation',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-21', due_date: '2026-05-28', status: 'todo',
                    subtasks: [
                        'Trigger: daily check — clients where next_bas_due within 14 days and no in_progress BAS task',
                        'For each: GET /api/crm/clients/<id> — GST data from Xero warehouse',
                        'Generate BAS prep summary: GST collected, paid, net position, flagged transactions',
                        'POST /api/crm/tasks: BAS prep [ClientName] [Period], assigned Diana, due 7 days before deadline, category: bas, priority: high',
                        'Post-lodgement (Diana marks done): log via POST /api/crm/activities',
                        'Update next_bas_due via PUT /api/crm/clients/<id>, trigger refresh_bas_schedule()',
                    ],
                },
                {
                    id: 's4_t6', name: 'Agent: Acquisition follow-up',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-21', due_date: '2026-05-28', status: 'todo',
                    subtasks: [
                        "Trigger: pipeline-change webhook with new_stage = 'lead'",
                        'Day 0: introduction email via M365',
                        'Day 3: if no activity — follow-up email',
                        'Day 7: if no activity — POST /api/crm/tasks: personal outreach task for Brad',
                        "Day 14: advance to 'nurture', monthly newsletter only",
                        'On quote sent: day 2, 5, 10 automated follow-up emails',
                        'On quote accepted: fire onboarding agent trigger',
                        "On quote declined: log reason, advance to 'lost'",
                    ],
                },
                {
                    id: 's4_t7', name: 'Agent: Health monitoring + device monitoring',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-21', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'CLIENT HEALTH: daily — for clients where health_status degraded vs previous day, POST /api/crm/tasks urgent alert for Diana',
                        'Weekly digest email to Brad (Mondays 8am): fleet health, pipeline status, Diana open task count',
                        'DEVICE MONITORING: daily via Tailscale API — check online/offline status of all active devices',
                        'Device offline > 4 hours during business hours: POST /api/crm/tasks device alert for Brad, priority: high',
                        'Device offline > 24 hours: client notification email via M365',
                        'Monthly 1st: generate device fleet report',
                        '60 days before lease_next_review: POST /api/crm/tasks lease renewal review for Brad',
                    ],
                },
            ],
        },
        {
            id: 'stream_5',
            name: 'Stream 5 — Legal & corporate structure',
            owner: 'brad',
            deadline: '2026-07-01',
            notes: 'Owner-led with AI assistance. No external advisors required.',
            tasks: [
                {
                    id: 's5_t1', name: 'Document corporate structure + trust deed review',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-12', due_date: '2026-04-30', status: 'todo',
                    subtasks: [
                        'Confirm structure: Pty Ltd as trustee of existing family trust',
                        'Map entity diagram: Trust → Trustee Company → Operating Business',
                        'Define shareholding (Brad and Diana) and directorship (both directors)',
                        'Review trust deed: permits company as trustee, permits commercial bookkeeping operations, distribution clause flexibility, appointor provisions',
                        'Document structure memo — entity diagram + key decisions',
                        'Confirm profit flow: business income → company as trustee → trust → distributions',
                    ],
                },
                {
                    id: 's5_t2', name: 'Company name — confirm and check availability',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-12', due_date: '2026-04-25', status: 'todo',
                    subtasks: [
                        'Confirm business/trading name — existing brand or new?',
                        'Check ASIC company name availability: asic.gov.au',
                        'Check business name register: business.gov.au',
                        'Register business name with ASIC if trading name differs ($44 AUD/year)',
                        'Confirm domain availability if new name',
                        'Lock the name — all subsequent steps use this',
                    ],
                },
                {
                    id: 's5_t3', name: 'Professional obligations — BAS agent + PI insurance + Privacy',
                    assignee: 'diana', priority: 'high',
                    start_date: '2026-04-21', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        "Confirm Diana's BAS Agent registration status and renewal date via TPB portal",
                        'Check TPB requirements for BAS agents operating through a company — may need entity update',
                        'Obtain PI insurance quote in company name ($500–1,500 AUD/year) — TPB mandatory requirement',
                        "Review cyber liability insurance — 50 clients' financial data is significant exposure",
                        'Confirm Privacy Act obligations for financial data handlers',
                        'Draft privacy policy for website and client engagement letters',
                        'Notify TPB of entity change via TPB portal — do in late June post-registration',
                    ],
                },
                {
                    id: 's5_t4', name: 'Director ID registrations',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-06-01', due_date: '2026-06-07', status: 'todo',
                    subtasks: [
                        'Both Brad and Diana must hold Director IDs before company can be registered',
                        'Apply via ABRS portal: abrs.gov.au',
                        'Set up myGovID at Standard strength minimum if not done',
                        "Verify identity in myGovID (Medicare, driver's licence, or passport)",
                        'Submit Director ID application — typically instant at Standard strength',
                        'Store both Director IDs in password manager immediately',
                    ],
                },
                {
                    id: 's5_t5', name: 'Company registration — ASIC',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-06-07', due_date: '2026-06-07', status: 'todo',
                    subtasks: [
                        'File via ASIC: asic.gov.au/for-business/registering-a-company',
                        'Fee: $576 AUD',
                        'Required: company name, registered office, director details + Director IDs, share structure',
                        'Receive Certificate of Incorporation and ACN — usually same business day',
                        'Store on SharePoint /Internal/Company/: Certificate, Constitution/Replaceable Rules, registers',
                    ],
                },
                {
                    id: 's5_t6', name: 'ABN + TFN + GST + PAYG registration',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-06-07', due_date: '2026-06-10', status: 'todo',
                    subtasks: [
                        'Apply for company ABN via ABR immediately after ACN issued: abr.business.gov.au',
                        'Register for GST simultaneously — turnover will exceed $75,000',
                        'Apply for company TFN via ATO business portal',
                        'Confirm trust ABN and TFN current and correctly linked',
                        'Register for PAYG withholding',
                        'Register for Single Touch Payroll via Xero once payroll configured',
                    ],
                },
                {
                    id: 's5_t7', name: 'Business bank account',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-06-10', due_date: '2026-06-14', status: 'todo',
                    subtasks: [
                        'Open business transaction account: company name as trustee for trust',
                        'Required docs: Certificate of Incorporation, ACN, ABN, trust deed, director IDs, personal ID both directors',
                        'Recommended: Macquarie Business Banking or NAB Business (strong Xero integration)',
                        'Open dedicated GST holding account — fortnightly automatic sweep',
                        'Connect to company Xero file',
                        'Obtain BSB and account number — begin updating client direct debit arrangements',
                    ],
                },
                {
                    id: 's5_t8', name: 'Transfer business to new entity — hard cutover 28 June',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-06-14', due_date: '2026-06-28', status: 'todo',
                    subtasks: [
                        'Draft updated engagement letter: new entity name, ABN, bank details, effective date',
                        'Issue to all 10 clients — request countersignature or written acknowledgement',
                        'Update Xero practice manager account — entity name and ABN',
                        'Transfer all subscriptions to new entity: Xero, M365, Tailscale, n8n',
                        'Update Wix website with new entity details',
                        'Notify ATO via TPB portal of new entity as BAS agent practice',
                        'Update PI insurance to new entity',
                        'Set up payroll in Xero for Brad and Diana',
                        'Update email signatures with new entity name and ABN',
                        'Hard cutover: 28 June — all operations under new entity',
                    ],
                },
            ],
        },
        {
            id: 'stream_6',
            name: 'Stream 6 — SOPs & knowledge base',
            owner: 'brad',
            deadline: '2026-05-31',
            notes: 'SOPs live on SharePoint /Internal/SOPs/ — included in M365, no additional cost.',
            tasks: [
                {
                    id: 's6_t1', name: 'SharePoint SOP library setup',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-04-14', due_date: '2026-04-22', status: 'todo',
                    subtasks: [
                        'Create SOP structure in SharePoint /Internal/SOPs/',
                        'Create SOP page template: Purpose, Scope, Who It Applies To, Steps, Notes, Version History',
                        'Create /Internal/Templates/ section',
                        'Grant Diana full read/write access',
                    ],
                },
                {
                    id: 's6_t2', name: "Diana's bookkeeping SOPs",
                    assignee: 'diana', priority: 'high',
                    start_date: '2026-04-21', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Monthly bookkeeping SOP: reconciliation, transaction coding, reporting',
                        'BAS preparation and lodgement SOP: Xero data pull through to ATO lodgement',
                        'Payroll processing SOP: pay run, STP lodgement, superannuation',
                        'Month-end close SOP: what happens at end of each month per client',
                        'Write each SOP as if training someone with no prior experience',
                        'Review with Brad — flag any steps automatable by AI agent',
                    ],
                },
                {
                    id: 's6_t3', name: 'Business SOPs — onboarding, quoting, exit',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-21', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'New client onboarding SOP: signed agreement → first active month',
                        'Quoting and proposal SOP: discovery call → signed agreement incl. managed endpoint',
                        'New client VM setup SOP: hardware to RDP-ready',
                        'Client Beelink provisioning SOP: unbox to deployed, target under 90 minutes',
                        'Client exit SOP: offboarding, data handover, device return, agreement termination',
                        'Staff onboarding SOP: built from all the above — ready before first hire',
                        'Each SOP links to CRM pipeline stages and n8n automation triggers',
                    ],
                },
                {
                    id: 's6_t4', name: 'Document templates library',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-01', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Client engagement letter — new entity, scope, fees, payment terms, data handling, termination',
                        'Quote/proposal template — HTML output from CRM quote builder',
                        'Monthly report template — used by monthly reporting agent',
                        'BAS covering letter template',
                        'Device lease agreement addendum (one page): company ownership, client liability, return terms, buyout option, remote access right',
                        'Client exit letter template',
                        'New staff offer letter template',
                    ],
                },
            ],
        },
        {
            id: 'stream_7',
            name: 'Stream 7 — Managed endpoint service',
            owner: 'brad',
            deadline: '2026-05-31',
            tasks: [
                {
                    id: 's7_t1', name: 'Validate S12 Pro as client device',
                    assignee: 'diana', priority: 'high',
                    start_date: '2026-04-22', due_date: '2026-04-25', status: 'todo',
                    subtasks: [
                        'Diana runs full bookkeeping session via RDP over Tailscale on S12 Pro',
                        'Realistic load: multiple browser tabs, Xero, accounting software simultaneously',
                        'Brad monitors: CPU, RAM usage, RDP latency',
                        'Note: RAM is soldered on N100 — cannot upgrade, different unit required if insufficient',
                        '256GB storage: check free space after OS and software — flag if < 80GB',
                        'Output: confirmed yes/no on 8GB/256GB as standard client device spec',
                    ],
                },
                {
                    id: 's7_t2', name: 'Write device provisioning SOP',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-04-25', due_date: '2026-05-10', status: 'todo',
                    subtasks: [
                        'Target: unbox to RDP-ready in under 90 minutes',
                        'Step 1: Verify Windows 11 Pro, upgrade if Home',
                        'Step 2: Run Windows Update',
                        'Step 3: Install Tailscale, note node ID',
                        'Step 4: Enable Wake-on-LAN in BIOS',
                        'Step 5: Configure auto power-on after power failure in BIOS',
                        'Step 6: Enable Remote Desktop',
                        'Step 7: Install client software if known',
                        'Step 8: Create CRM device record',
                        'Step 9: Test Diana RDP over Tailscale',
                        'Step 10: Register in n8n monitoring workflow',
                        'Step 11: Label device — serial + Tailscale node ID',
                        'Time the full process — refine until consistently under 90 minutes',
                    ],
                },
                {
                    id: 's7_t3', name: 'Commercial model + lease agreement',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-01', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Email Beelink wholesale: wholesale@bee-link.com — 5-10 unit initial order',
                        'Set lease fee: $45–55 AUD/month (hardware payback ~4 months)',
                        'Set managed endpoint fee: $25–35 AUD/month (Tailscale, monitoring, updates, support)',
                        'Option: bundle into one monthly line item',
                        'Draft device lease addendum: company retains ownership, client liable for damage, return within 14 days, buyout at 24 months, company retains remote access right',
                        'Build lease into CRM quote builder as line item option',
                        'Add device MRR to business dashboard',
                    ],
                },
                {
                    id: 's7_t4', name: 'Bulk inventory — order and tracking',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-15', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Initial order: 5 units',
                        "Track in CRM crm_devices: status = 'stock' for undeployed units",
                        'Reorder trigger: available stock drops to 2 units',
                        'Consider branding: sticker or engraved label',
                        'Decide storage location for spare units',
                        'Build reorder process: who approves, who orders, lead time from Beelink',
                    ],
                },
            ],
        },
        {
            id: 'stream_8',
            name: 'Stream 8 — Growth & acquisition',
            owner: 'brad',
            deadline: '2026-12-31',
            tasks: [
                {
                    id: 's8_t1', name: 'Capacity model — current and AI-augmented',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-01', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Define current capacity: clients Diana can manage at current workflow',
                        'Estimate time per client per month across all service types',
                        'Define AI-augmented capacity ceiling with agents operational',
                        'Build capacity model on CRM dashboard: active clients vs estimated hours vs available hours',
                        'Hiring trigger: 80% utilisation — begin recruitment 6-8 weeks before breaking point',
                        'Target 50 clients before first hire — real number is wherever quality degrades',
                    ],
                },
                {
                    id: 's8_t2', name: 'Acquisition channels setup',
                    assignee: 'brad', priority: 'medium',
                    start_date: '2026-05-01', due_date: '2026-06-15', status: 'todo',
                    subtasks: [
                        'Xero partner directory — ensure status current, complete profile, collect client reviews',
                        'Xero advisor directory — complete all fields and specialisations',
                        'Google Business Profile — create/update with new entity details post-registration',
                        'LinkedIn — update business page, optimise personal profiles, post thought leadership',
                        'Referral program — formalise: introduce a client, receive fee credit',
                        'Wix website — new entity, service tiers with pricing, enquiry form',
                        'Bookkeeping communities — answer questions, build credibility',
                    ],
                },
                {
                    id: 's8_t3', name: 'Service tier definition and pricing',
                    assignee: 'brad', priority: 'high',
                    start_date: '2026-05-01', due_date: '2026-05-31', status: 'todo',
                    subtasks: [
                        'Essentials: reconciliation, BAS, monthly report — Xero cloud only, fixed monthly fee',
                        'Standard: Essentials + payroll, AP/AR management — fixed monthly fee',
                        'Managed: Standard + Beelink at client site, priority SLA, quarterly review — includes device lease',
                        'Price to reflect AI efficiency gains — competitive and profitable simultaneously',
                        'Build all three as templates in CRM quote builder',
                        'Publish pricing on Wix website',
                        'Review quarterly against capacity model and market rates',
                    ],
                },
            ],
        },
        {
            id: 'stream_adhoc',
            name: 'Adhoc — Diana',
            owner: 'diana',
            tasks: [
                {
                    id: 'adhoc_t1', name: 'Bank reconciliation catch-up — [client name]',
                    assignee: 'diana', priority: 'medium', status: 'template',
                    description: 'Catch-up reconciliation for unreconciled bank transactions on client Xero file. Log completion and any issues in CRM activity log. Replace [client name] with actual client when creating.',
                },
                {
                    id: 'adhoc_t2', name: 'Adhoc financial report — [client name]',
                    assignee: 'diana', priority: 'medium', status: 'template',
                    description: 'Prepare one-off report as requested. Confirm scope, period, and format before starting. Save to /Clients/[ClientName]/Reports/ on SharePoint.',
                },
                {
                    id: 'adhoc_t3', name: 'Data entry correction — [client name]',
                    assignee: 'diana', priority: 'high', status: 'template',
                    description: 'Review and correct data entry errors in client Xero file. Document what changed, why, and original value in CRM activity log.',
                },
                {
                    id: 'adhoc_t4', name: 'Client query response — [client name]',
                    assignee: 'diana', priority: 'medium', status: 'template',
                    description: 'Respond to client query regarding accounts, transactions, or reports. Log query and resolution in CRM activity log.',
                },
                {
                    id: 'adhoc_t5', name: 'Adhoc payroll run — [client name]',
                    assignee: 'diana', priority: 'high', status: 'template',
                    description: 'Process payroll run outside normal schedule. Confirm amounts, pay date, and superannuation obligations before processing. Lodge STP update after.',
                },
            ],
        },
    ],
});
