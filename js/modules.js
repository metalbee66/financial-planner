/**
 * Module registry — the shell renders one nav button per entry and
 * mounts each module exactly once into a content host. Adding a new
 * top-level module means: write `app/js/modules/<id>/index.js` exposing
 * a `mount(host)` function, then add an entry below.
 */

import { mount as mountFinance } from './modules/finance/index.js';
import { mount as mountProjects } from './modules/projects/index.js';

// Task 8.2: the PM DLBooks (legacy) module is retired now that Task 8.1's
// one-shot migration has copied its data into the Projects module. The
// `pm-legacy/` source files are intentionally left on disk so the migration
// runner can still source `loadPM()` on any device that boots fresh after
// the v2.0.0 upgrade. The legacy `pm_dlbooks` Firebase key is untouched.

export const MODULES = [
    {
        id: 'finance',
        label: 'Finance',
        mount: mountFinance,
        // Firebase RTDB keys this module reads/writes (informational; useful
        // for future per-module sync wiring or admin tooling).
        dataKeys: ['budget_cy26', 'budget_ny27', 'week_actuals_cy26', 'accounts_data', 'gl_mappings', 'imported_tx_hashes'],
    },
    {
        id: 'projects',
        label: 'Projects',
        mount: mountProjects,
        // Single root key holds `{ items: [...] }`; Phase 6 adds `prefs` and `notifications` siblings.
        dataKeys: ['projects'],
    },
];
