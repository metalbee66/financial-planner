/**
 * Shell — thin entry point for the Family Planner monolith.
 *
 * Responsibilities:
 *   1. Initialise Firebase + run sign-in flow
 *   2. Load all module data into shared state (instant render via localStorage,
 *      then sync from Firebase once authed)
 *   3. Render the top-level module nav from `modules.js`
 *   4. Mount each module exactly once into its own host element; on nav click,
 *      toggle visibility (no remount, so module setup handlers persist)
 *
 * No module-specific logic lives here. Each module owns its own DOM template,
 * sub-nav, edit handlers, and renders.
 */

import {
    loadBudgetCY, loadBudgetNY, loadWeekActuals,
} from './data.js';
import {
    initFirebase, getFirebaseAuth, setCurrentUser, signInWithGoogle, signOut,
    showLoginScreen, showApp, initialSync, setupRealtimeListeners,
    registerRenderHooks, fbSave,
} from './firebase-sync.js';
import { ALLOWED_EMAILS } from './firebase-config.js';
import { state } from './state.js';
import { MODULES } from './modules.js';

import { loadAccounts } from './modules/finance/accounts.js';
import { loadGlMappings, loadStoredHashes } from './modules/finance/import.js';
import { renderBudgetTab } from './modules/finance/budget.js';
import { renderAccountsTab } from './modules/finance/accounts.js';
// Task 8.2: PM DLBooks module retired. `loadPM` stays imported so the one-shot
// Phase 8.1 migration can still source pmData on a fresh device that boots
// after the v2.0.0 upgrade; renderPMTab is no longer wired into anything.
import { loadPM } from './modules/pm-legacy/pm.js';
import { loadProjects, PROJECTS_KEY } from './modules/projects/data.js';
import { renderProjectsTab, renderEmailQueueAdmin, mountBell } from './modules/projects/index.js';
import { migratePMDLBooksToProjects } from './modules/projects/migrate-pm.js';

// Wire render hooks so firebase-sync's realtime listeners can re-render
// when the other user changes data. Registered at module-load time;
// cheap and idempotent.
registerRenderHooks({ renderBudgetTab, renderAccountsTab, renderProjectsTab, renderEmailQueueAdmin });

document.addEventListener('DOMContentLoaded', async () => {
    // Load from localStorage first (instant render before Firebase resolves)
    state.budgetCY = loadBudgetCY();
    state.budgetNY = loadBudgetNY();
    state.weekActuals = loadWeekActuals();
    state.accountsData = loadAccounts();
    state.pmData = loadPM();
    state.glMappings = loadGlMappings();
    state.storedTransactionHashes = loadStoredHashes();
    state.projectsData = loadProjects();

    const fbReady = await initFirebase();

    if (fbReady) {
        const firebaseAuth = getFirebaseAuth();
        firebaseAuth.onAuthStateChanged(async (user) => {
            if (user) {
                if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(user.email)) {
                    await firebaseAuth.signOut();
                    showLoginScreen();
                    return;
                }
                setCurrentUser(user);
                document.getElementById('sign-out-btn').style.display = '';
                showApp();

                await initialSync();
                maybeRunPMMigration();
                bootModules();
                setupRealtimeListeners();
            } else {
                showLoginScreen();
            }
        });

        document.getElementById('google-sign-in').onclick = signInWithGoogle;
        document.getElementById('sign-out-btn').onclick = signOut;
    } else {
        // No Firebase — run locally
        showApp();
        maybeRunPMMigration();
        bootModules();
    }
});

/**
 * Phase 8.1 one-time migration: copy the legacy `pm_dlbooks` tree into the
 * Projects module the first time the app boots after the v2.0.0 upgrade.
 * Idempotent via the `pm_dlbooks_migrated_to_projects` flag on the projects
 * root, so re-running on later loads is a no-op. The legacy `pm_dlbooks`
 * RTDB/localStorage key is intentionally NOT deleted — Task 8.2 retires the
 * tab once the user has confirmed the migration.
 */
function maybeRunPMMigration() {
    if (!state.projectsData || state.projectsData.pm_dlbooks_migrated_to_projects) return;
    const { projects, tasks } = migratePMDLBooksToProjects(state.pmData);
    state.projectsData.items = (state.projectsData.items || []).concat(projects);
    state.projectsData.tasks = (state.projectsData.tasks || []).concat(tasks);
    state.projectsData.pm_dlbooks_migrated_to_projects = true;
    // Persist directly via fbSave so the silent first-boot migration doesn't
    // flash the user-facing "Saved" toast that saveProjects emits.
    fbSave(PROJECTS_KEY, state.projectsData);
    if (projects.length > 0) {
        console.log(`PM DLBooks migration: appended ${projects.length} project(s) and ${tasks.length} task(s) to Projects.`);
    }
}

let modulesBooted = false;

function bootModules() {
    if (modulesBooted) return;
    modulesBooted = true;

    const nav = document.getElementById('top-nav');
    const host = document.getElementById('module-host');
    if (!nav || !host) {
        console.error('Shell: missing #top-nav or #module-host elements');
        return;
    }

    const moduleEls = {};

    // Render top nav + mount each module's content (hidden except first)
    MODULES.forEach((mod, index) => {
        const btn = document.createElement('button');
        btn.className = 'top-nav-btn' + (index === 0 ? ' active' : '');
        btn.dataset.module = mod.id;
        btn.textContent = mod.label;
        btn.addEventListener('click', () => activateModule(mod.id));
        nav.appendChild(btn);

        const moduleEl = document.createElement('div');
        moduleEl.className = 'module-content';
        moduleEl.id = 'module-' + mod.id;
        moduleEl.style.display = index === 0 ? '' : 'none';
        host.appendChild(moduleEl);
        moduleEls[mod.id] = moduleEl;

        mod.mount(moduleEl);
    });

    function activateModule(id) {
        for (const k in moduleEls) {
            moduleEls[k].style.display = k === id ? '' : 'none';
        }
        nav.querySelectorAll('.top-nav-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.module === id);
        });
    }

    // Notification bell lives in the shell header but is owned by the
    // projects module (data + UI). Pass an activator so notification clicks
    // can flip to the Projects tab from any module.
    const bellHost = document.getElementById('notif-bell-host');
    if (bellHost) {
        mountBell({
            host: bellHost,
            onActivateProjects: () => activateModule('projects'),
        });
    }
}
