/**
 * Seed registry — single source of truth for the project seeds that can be
 * applied to the Projects bucket.
 *
 * Both the boot sequence (shell.js) and the admin "Project seeds" panel
 * (index.js) read from this registry, so a seed only needs to be declared
 * once. The `/add-to-family-planner` skill appends a new entry here (plus the
 * seed file + its DEFAULT_PROJECTS flag) instead of hand-patching shell.js.
 *
 * Each entry:
 *   id          — stable kebab-case identifier (used as the admin row key)
 *   flag        — idempotency flag name; must be declared in DEFAULT_PROJECTS
 *   label       — human-readable name shown in the admin queue
 *   description — one-line summary shown under the label
 *   run()       — returns { projects, tasks } to append (pure; no side effects)
 */

import { seedBusinessTransformProjects, BUSINESS_TRANSFORM_SEED } from './seed-businesstransform.js';
import { seedSubpoenaBrauerProject } from './seed-subpoena-brauer.js';

export const PROJECT_SEEDS = [
    {
        id: 'business-transform',
        flag: 'business_transform_seeded',
        label: 'Business transformation & scale',
        description: 'SenseAi 8-stream transformation project tree',
        run: () => seedBusinessTransformProjects(BUSINESS_TRANSFORM_SEED),
    },
    {
        id: 'subpoena-brauer',
        flag: 'subpoena_brauer_seeded',
        label: 'Subpoena — Barry Brauer',
        description: 'Court proceedings legal matter (hearing 1 Jul 2026)',
        run: () => seedSubpoenaBrauerProject(),
    },
];

/**
 * Apply a single seed to `projectsData` if it hasn't run yet. Mutates
 * `projectsData` in place (appends to items/tasks, flips the flag) and returns
 * `{ ran, added }`. Idempotent: a no-op when the seed's flag is already set.
 * Persistence (fbSave / saveProjects) is the caller's responsibility.
 */
export function applyProjectSeed(projectsData, seed) {
    const empty = { ran: false, added: { projects: [], tasks: [] } };
    if (!projectsData || projectsData[seed.flag]) return empty;
    const { projects, tasks } = seed.run();
    projectsData.items = (projectsData.items || []).concat(projects);
    projectsData.tasks = (projectsData.tasks || []).concat(tasks);
    projectsData[seed.flag] = true;
    return { ran: true, added: { projects, tasks } };
}
