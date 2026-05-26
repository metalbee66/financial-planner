/**
 * Firebase authentication and real-time data sync.
 * Falls back to localStorage if Firebase is not configured or fails.
 *
 * Save functions:
 *   - fbSave(key, data) is the low-level write helper, exported for use
 *     by save functions in other modules (saveBudgetCY in data.js, etc.).
 *   - It always writes to localStorage and conditionally pushes to Firebase
 *     based on `useFirebase && currentUser`. The pre-ES-module code used a
 *     patchSaveFunctions() trick to swap save impls post-sign-in; that is
 *     no longer needed because fbSave checks state itself at call time.
 */

import { FIREBASE_CONFIG, ALLOWED_EMAILS } from './firebase-config.js';
import { migrateOutgoing, migrateWeekActuals, DEFAULT_CY, DEFAULT_NY } from './data.js';
import { DEFAULT_ACCOUNTS } from './modules/finance/accounts.js';
// v2.0.2: DEFAULT_PM import removed; firebase-sync no longer reads or writes
// the legacy `pm_dlbooks` key.
import { DEFAULT_PROJECTS, sanitiseProject, sanitiseTask } from './modules/projects/data.js';
import { state } from './state.js';

let firebaseApp = null;
let firebaseDb = null;
let firebaseAuth = null;
export let currentUser = null;
let useFirebase = false;

const HOUSEHOLD_ID = 'family';

// External hooks set by app.js after the modules are wired (avoids a
// hard import cycle from sync → ui-render → sync).
let renderBudgetTab = null;
let renderAccountsTab = null;
let renderProjectsTab = null;
let renderEmailQueueAdmin = null;

export function registerRenderHooks(hooks) {
    renderBudgetTab = hooks.renderBudgetTab;
    renderAccountsTab = hooks.renderAccountsTab;
    renderProjectsTab = hooks.renderProjectsTab;
    renderEmailQueueAdmin = hooks.renderEmailQueueAdmin;
}

function isFirebaseConfigured() {
    return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.length > 0;
}

export async function initFirebase() {
    if (!isFirebaseConfigured()) {
        console.log('Firebase not configured — using localStorage.');
        return false;
    }

    try {
        firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDb = firebase.database();
        firebaseAuth = firebase.auth();
        useFirebase = true;
        console.log('Firebase initialized.');
        return true;
    } catch (e) {
        console.error('Firebase init failed:', e);
        return false;
    }
}

export function getFirebaseAuth() {
    return firebaseAuth;
}

export function isUsingFirebase() {
    return useFirebase;
}

export function setCurrentUser(user) {
    currentUser = user;
}

// ── Authentication ──

export function showLoginScreen() {
    document.getElementById('app-wrapper').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

export function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-wrapper').style.display = '';
}

export async function signInWithGoogle() {
    // v2.0.4: reverted PB.6's switch to signInWithRedirect — Brad hit a
    // sign-in loop in production (Google → redirect back → still on login
    // screen → repeat) because the Firebase compat layer doesn't
    // auto-consume the redirect result and third-party cookie restrictions
    // can drop the auth state between hops. Popup is more reliable across
    // browsers; the Cross-Origin-Opener-Policy warnings PB.6 silenced are
    // console-only and don't affect functionality. The ALLOWED_EMAILS gate
    // still lives in shell.js's onAuthStateChanged listener, which fires
    // when the popup completes.
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const result = await firebaseAuth.signInWithPopup(provider);
        return result && result.user ? result.user : null;
    } catch (e) {
        console.error('Sign-in error:', e);
        alert('Sign-in failed: ' + e.message);
    }
    return null;
}

export function signOut() {
    if (firebaseAuth) firebaseAuth.signOut();
    currentUser = null;
    showLoginScreen();
}

// ── Data sync ──

function dbRef(path) {
    return firebaseDb.ref(`household/${HOUSEHOLD_ID}/${path}`);
}

/** Always write localStorage; conditionally push to Firebase when user is signed in. */
export function fbSave(key, data) {
    if (useFirebase && currentUser) {
        dbRef(key).set(data).catch(e => console.error('Firebase save error:', key, e));
    }
    localStorage.setItem(key, JSON.stringify(data));
}

/**
 * Write one email-queue entry under /household/family/email_queue/{id} for the
 * n8n drainer (plan §6.3). Always mirrors to a localStorage `email_queue` map
 * keyed by entry id — gives E2E tests + offline-mode debugging visibility into
 * what would have been sent, even when Firebase isn't connected. Re-used by
 * the Phase 6.5 admin panel's Retry button, which overwrites the same id with
 * `sent: false, attempts: 0, failed: false` so n8n picks it up again.
 */
export function enqueueEmail(entry) {
    if (!entry || !entry.id) return;
    if (useFirebase && currentUser) {
        dbRef(`email_queue/${entry.id}`).set(entry)
            .catch(e => console.error('Firebase enqueueEmail error:', entry.id, e));
    }
    const map = readLocalEmailQueue();
    map[entry.id] = entry;
    localStorage.setItem('email_queue', JSON.stringify(map));
}

/**
 * Remove one or more email-queue entries (admin "Clear sent older than 7
 * days" button). Mirrors the remove across Firebase + localStorage.
 */
export function removeEmailQueueEntries(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;
    if (useFirebase && currentUser) {
        for (const id of ids) {
            dbRef(`email_queue/${id}`).remove()
                .catch(e => console.error('Firebase removeEmailQueueEntries error:', id, e));
        }
    }
    const map = readLocalEmailQueue();
    let touched = false;
    for (const id of ids) {
        if (id in map) { delete map[id]; touched = true; }
    }
    if (touched) localStorage.setItem('email_queue', JSON.stringify(map));
}

/**
 * v2.0.2 one-shot: remove the legacy `pm_dlbooks` data from Firebase and
 * localStorage. Safe to call when neither side has the key — `.remove()`
 * is a no-op on missing keys and `localStorage.removeItem` is unconditional.
 * Called by `maybeCleanupLegacyPMData` in shell.js after the Phase 8.1
 * migration has run on this projects bucket.
 */
export function deleteLegacyPMData() {
    if (useFirebase && currentUser) {
        dbRef('pm_dlbooks').remove()
            .catch(e => console.error('Firebase deleteLegacyPMData error:', e));
    }
    localStorage.removeItem('pm_dlbooks');
}

function readLocalEmailQueue() {
    try {
        const raw = localStorage.getItem('email_queue');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        }
    } catch (e) {
        console.error('email_queue parse error:', e);
    }
    return {};
}

export async function fbLoad(key) {
    if (useFirebase && currentUser) {
        try {
            const snap = await dbRef(key).once('value');
            if (snap.exists()) {
                const val = snap.val();
                // Validate it's meaningful data (has expected structure)
                if (val && typeof val === 'object') {
                    console.log('Firebase loaded:', key);
                    return val;
                }
            }
            console.log('Firebase empty for:', key);
        } catch (e) {
            console.error('Firebase load error:', key, e);
        }
    }
    return null;
}

function fbListen(key, callback) {
    if (useFirebase && currentUser) {
        dbRef(key).on('value', (snap) => {
            if (snap.exists()) {
                callback(snap.val());
            }
        });
    }
}

export function setupRealtimeListeners() {
    fbListen('budget_cy26', (data) => {
        if (data && data.outgoings) {
            data.outgoings.forEach(migrateOutgoing);
            state.budgetCY = data;
            if (renderBudgetTab) renderBudgetTab(state.budgetCY, 'cy-');
        }
    });

    fbListen('budget_ny27', (data) => {
        if (data && data.outgoings) {
            data.outgoings.forEach(migrateOutgoing);
            state.budgetNY = data;
            if (renderBudgetTab) renderBudgetTab(state.budgetNY, 'ny-');
        }
    });

    fbListen('accounts_data', (data) => {
        if (data && data.banking) {
            state.accountsData = data;
            if (renderAccountsTab) renderAccountsTab(state.accountsData);
        }
    });

    fbListen('gl_mappings', (data) => {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            state.glMappings = data;
        }
    });

    // Task 8.2: pm_dlbooks listener removed — the PM DLBooks (legacy) tab no
    // longer renders, so there's no UI to refresh on remote changes. The data
    // itself is preserved in RTDB; the one-shot Phase 8.1 migration consumes
    // it once per device and writes a flag to prevent re-running.

    fbListen('email_queue', (data) => {
        // n8n drains this key (PATCH sent/attempts/failed/sentAt on each entry,
        // remove via the admin panel). Mirror the live tree into localStorage
        // so the admin panel renders fresh status without a page reload.
        if (data && typeof data === 'object' && !Array.isArray(data)) {
            localStorage.setItem('email_queue', JSON.stringify(data));
        } else {
            localStorage.setItem('email_queue', '{}');
        }
        if (renderEmailQueueAdmin) renderEmailQueueAdmin();
    });

    fbListen('projects', (data) => {
        if (data && Array.isArray(data.items)) {
            state.projectsData = {
                ...data,
                items: data.items.map(sanitiseProject).filter(Boolean),
                tasks: Array.isArray(data.tasks) ? data.tasks.map(sanitiseTask).filter(Boolean) : [],
                notifications: (data.notifications && typeof data.notifications === 'object' && !Array.isArray(data.notifications))
                    ? data.notifications
                    : {},
                prefs: (data.prefs && typeof data.prefs === 'object' && !Array.isArray(data.prefs))
                    ? data.prefs
                    : {},
                digest_pending: (data.digest_pending && typeof data.digest_pending === 'object' && !Array.isArray(data.digest_pending))
                    ? data.digest_pending
                    : {},
                pm_dlbooks_migrated_to_projects: data.pm_dlbooks_migrated_to_projects === true,
                business_transform_seeded: data.business_transform_seeded === true,
                pm_dlbooks_cleaned: data.pm_dlbooks_cleaned === true,
                business_transform_update_20260525_applied: data.business_transform_update_20260525_applied === true,
                business_transform_extras_20260525_applied: data.business_transform_extras_20260525_applied === true,
            };
            if (renderProjectsTab) renderProjectsTab();
        }
    });
}

/** Initial sync: push defaults to Firebase if empty, or load from Firebase */
export async function initialSync() {
    console.log('Starting initial sync...');

    const fbCY = await fbLoad('budget_cy26');

    if (fbCY && fbCY.outgoings && fbCY.outgoings.length > 0) {
        // Firebase has valid data — use it
        state.budgetCY = fbCY;
        state.budgetCY.outgoings.forEach(migrateOutgoing);

        const fbNY = await fbLoad('budget_ny27');
        if (fbNY && fbNY.outgoings) {
            state.budgetNY = fbNY;
            state.budgetNY.outgoings.forEach(migrateOutgoing);
        }

        const fbWA = await fbLoad('week_actuals_cy26');
        if (fbWA) state.weekActuals = migrateWeekActuals(fbWA);

        const fbAcct = await fbLoad('accounts_data');
        if (fbAcct && fbAcct.banking) state.accountsData = fbAcct;

        const fbGl = await fbLoad('gl_mappings');
        if (fbGl && typeof fbGl === 'object' && !Array.isArray(fbGl)) state.glMappings = fbGl;

        // v2.0.2: pm_dlbooks load removed. Brad signed off on the cleanup;
        // the key is deleted on next boot via maybeCleanupLegacyPMData and
        // the migration runner gracefully handles undefined state.pmData.

        const fbEq = await fbLoad('email_queue');
        if (fbEq && typeof fbEq === 'object' && !Array.isArray(fbEq)) {
            localStorage.setItem('email_queue', JSON.stringify(fbEq));
        }

        const fbProjects = await fbLoad('projects');
        if (fbProjects && Array.isArray(fbProjects.items)) {
            state.projectsData = {
                ...fbProjects,
                items: fbProjects.items.map(sanitiseProject).filter(Boolean),
                tasks: Array.isArray(fbProjects.tasks) ? fbProjects.tasks.map(sanitiseTask).filter(Boolean) : [],
                notifications: (fbProjects.notifications && typeof fbProjects.notifications === 'object' && !Array.isArray(fbProjects.notifications))
                    ? fbProjects.notifications
                    : {},
                prefs: (fbProjects.prefs && typeof fbProjects.prefs === 'object' && !Array.isArray(fbProjects.prefs))
                    ? fbProjects.prefs
                    : {},
                digest_pending: (fbProjects.digest_pending && typeof fbProjects.digest_pending === 'object' && !Array.isArray(fbProjects.digest_pending))
                    ? fbProjects.digest_pending
                    : {},
                pm_dlbooks_migrated_to_projects: fbProjects.pm_dlbooks_migrated_to_projects === true,
                business_transform_seeded: fbProjects.business_transform_seeded === true,
                pm_dlbooks_cleaned: fbProjects.pm_dlbooks_cleaned === true,
                business_transform_update_20260525_applied: fbProjects.business_transform_update_20260525_applied === true,
                business_transform_extras_20260525_applied: fbProjects.business_transform_extras_20260525_applied === true,
            };
        }

        console.log('Data loaded from Firebase.');
    } else {
        // Firebase is empty — push defaults
        console.log('Firebase empty, pushing default data...');
        // Ensure we have good defaults
        if (!state.budgetCY || !state.budgetCY.outgoings || state.budgetCY.outgoings.length === 0) {
            state.budgetCY = JSON.parse(JSON.stringify(DEFAULT_CY));
            state.budgetCY.outgoings.forEach(migrateOutgoing);
        }
        if (!state.budgetNY || !state.budgetNY.outgoings || state.budgetNY.outgoings.length === 0) {
            state.budgetNY = JSON.parse(JSON.stringify(DEFAULT_NY));
            state.budgetNY.outgoings.forEach(migrateOutgoing);
        }
        if (!state.accountsData || !state.accountsData.banking) {
            state.accountsData = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
        }
        if (!state.weekActuals || typeof state.weekActuals !== 'object') {
            state.weekActuals = {};
        }
        // v2.0.2: pm_dlbooks defaulting + push removed. The legacy module is
        // retired; fresh installs shouldn't reintroduce demo PM data.
        if (!state.projectsData || !Array.isArray(state.projectsData.items)) {
            state.projectsData = JSON.parse(JSON.stringify(DEFAULT_PROJECTS));
        }

        fbSave('budget_cy26', state.budgetCY);
        fbSave('budget_ny27', state.budgetNY);
        fbSave('week_actuals_cy26', state.weekActuals);
        fbSave('accounts_data', state.accountsData);
        fbSave('gl_mappings', state.glMappings || {});
        fbSave('projects', state.projectsData);
        console.log('Default data pushed to Firebase.');
    }
}
