/**
 * Projects module — Asana-like project & task management.
 *
 * Phase 0.4 stub: registers the module and renders an empty-state with
 * a "+ New Project" button that currently logs to the console. Real CRUD
 * arrives in Phase 1 (project entity), with the full feature set rolled
 * out across Phases 1–7 — see tasks/plan.md.
 */

const TEMPLATE = `
<div class="projects-empty-state">
    <div class="projects-empty-icon">📋</div>
    <h2>No projects yet</h2>
    <p>Track work, milestones, and tasks across the family.</p>
    <button class="projects-new-btn" id="projects-new-btn">+ New Project</button>
    <p class="projects-empty-note">
        Project CRUD lands in Phase 1.
        Full feature set (timeline, calendar, dashboard, comments, attachments,
        email notifications, celebrations) rolls out across Phases 1–7.
    </p>
</div>
`;

let mounted = false;

export function mount(host) {
    if (mounted) return;
    host.innerHTML = TEMPLATE;
    mounted = true;

    host.querySelector('#projects-new-btn').addEventListener('click', () => {
        console.log('[projects] + New Project clicked — Phase 1 will wire CRUD here.');
    });
}
