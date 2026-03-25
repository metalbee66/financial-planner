/**
 * Firebase authentication and real-time data sync.
 * Replaces localStorage with Firebase Realtime Database.
 * Falls back to localStorage if Firebase is not configured.
 */

let firebaseApp = null;
let firebaseDb = null;
let firebaseAuth = null;
let currentUser = null;
let useFirebase = false;

// Household ID — shared key so both users see the same data
const HOUSEHOLD_ID = 'family';

function isFirebaseConfigured() {
    return FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.apiKey.length > 0;
}

async function initFirebase() {
    if (!isFirebaseConfigured()) {
        console.log('Firebase not configured — using localStorage.');
        return false;
    }

    try {
        // Firebase SDKs loaded from CDN in index.html
        firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        firebaseDb = firebase.database();
        firebaseAuth = firebase.auth();
        useFirebase = true;
        return true;
    } catch (e) {
        console.error('Firebase init failed:', e);
        return false;
    }
}

// ── Authentication ──

function showLoginScreen() {
    document.getElementById('app-wrapper').style.display = 'none';
    document.getElementById('login-screen').style.display = 'flex';
}

function showApp() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-wrapper').style.display = '';
}

async function signInWithGoogle() {
    const provider = new firebase.auth.GoogleAuthProvider();
    try {
        const result = await firebaseAuth.signInWithPopup(provider);
        const email = result.user.email;

        if (ALLOWED_EMAILS.length > 0 && !ALLOWED_EMAILS.includes(email)) {
            await firebaseAuth.signOut();
            alert('Access denied. Your email is not authorised.');
            return null;
        }

        return result.user;
    } catch (e) {
        console.error('Sign-in error:', e);
        alert('Sign-in failed: ' + e.message);
        return null;
    }
}

function signOut() {
    if (firebaseAuth) {
        firebaseAuth.signOut();
    }
    currentUser = null;
    showLoginScreen();
}

// ── Data sync ──

function dbRef(path) {
    return firebaseDb.ref(`household/${HOUSEHOLD_ID}/${path}`);
}

/** Save data to Firebase (or localStorage fallback) */
function fbSave(key, data) {
    if (useFirebase && currentUser) {
        dbRef(key).set(data);
    }
    // Always save to localStorage as backup
    localStorage.setItem(key, JSON.stringify(data));
}

/** Load data from Firebase once, with localStorage fallback */
async function fbLoad(key) {
    if (useFirebase && currentUser) {
        try {
            const snap = await dbRef(key).once('value');
            if (snap.exists()) {
                return snap.val();
            }
        } catch (e) {
            console.error('Firebase load error for', key, e);
        }
    }
    // Fallback to localStorage
    const saved = localStorage.getItem(key);
    if (saved) {
        try { return JSON.parse(saved); } catch (e) {}
    }
    return null;
}

/** Listen for real-time changes from Firebase */
function fbListen(key, callback) {
    if (useFirebase && currentUser) {
        dbRef(key).on('value', (snap) => {
            if (snap.exists()) {
                callback(snap.val());
            }
        });
    }
}

/** Override the localStorage save functions to also sync to Firebase */
function patchSaveFunctions() {
    const origSaveCY = saveBudgetCY;
    saveBudgetCY = function(data) {
        localStorage.setItem('budget_cy26', JSON.stringify(data));
        fbSave('budget_cy26', data);
        showToast('Saved');
    };

    const origSaveNY = saveBudgetNY;
    saveBudgetNY = function(data) {
        localStorage.setItem('budget_ny27', JSON.stringify(data));
        fbSave('budget_ny27', data);
        showToast('Saved');
    };

    const origSaveWA = saveWeekActuals;
    saveWeekActuals = function(data) {
        localStorage.setItem('week_actuals_cy26', JSON.stringify(data));
        fbSave('week_actuals_cy26', data);
    };

    const origSaveAcct = saveAccounts;
    saveAccounts = function(data) {
        localStorage.setItem('accounts_data', JSON.stringify(data));
        fbSave('accounts_data', data);
        showToast('Saved');
    };
}

/** Set up real-time listeners to update the app when the other user makes changes */
function setupRealtimeListeners() {
    fbListen('budget_cy26', (data) => {
        data.outgoings.forEach(migrateOutgoing);
        budgetCY = data;
        window._budgetData = budgetCY;
        renderBudgetTab(budgetCY, 'cy-');
    });

    fbListen('budget_ny27', (data) => {
        data.outgoings.forEach(migrateOutgoing);
        budgetNY = data;
        renderBudgetTab(budgetNY, 'ny-');
    });

    fbListen('accounts_data', (data) => {
        accountsData = data;
        renderAccountsTab(accountsData);
    });
}

/** Push all local data to Firebase (initial sync) */
async function initialSync() {
    // Check if Firebase has data
    const fbCY = await fbLoad('budget_cy26');
    if (!fbCY) {
        // First time — push local data up
        fbSave('budget_cy26', budgetCY);
        fbSave('budget_ny27', budgetNY);
        fbSave('week_actuals_cy26', weekActuals);
        fbSave('accounts_data', accountsData);
        console.log('Initial data pushed to Firebase.');
    } else {
        // Firebase has data — use it
        budgetCY = fbCY;
        budgetCY.outgoings.forEach(migrateOutgoing);
        window._budgetData = budgetCY;

        const fbNY = await fbLoad('budget_ny27');
        if (fbNY) { budgetNY = fbNY; budgetNY.outgoings.forEach(migrateOutgoing); }

        const fbWA = await fbLoad('week_actuals_cy26');
        if (fbWA) weekActuals = fbWA;

        const fbAcct = await fbLoad('accounts_data');
        if (fbAcct) accountsData = fbAcct;

        console.log('Data loaded from Firebase.');
    }
}
