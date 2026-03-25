/**
 * Firebase authentication and real-time data sync.
 * Falls back to localStorage if Firebase is not configured or fails.
 */

let firebaseApp = null;
let firebaseDb = null;
let firebaseAuth = null;
let currentUser = null;
let useFirebase = false;

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
    if (firebaseAuth) firebaseAuth.signOut();
    currentUser = null;
    showLoginScreen();
}

// ── Data sync ──

function dbRef(path) {
    return firebaseDb.ref(`household/${HOUSEHOLD_ID}/${path}`);
}

function fbSave(key, data) {
    if (useFirebase && currentUser) {
        dbRef(key).set(data).catch(e => console.error('Firebase save error:', key, e));
    }
    localStorage.setItem(key, JSON.stringify(data));
}

async function fbLoad(key) {
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

function patchSaveFunctions() {
    saveBudgetCY = function(data) {
        localStorage.setItem('budget_cy26', JSON.stringify(data));
        fbSave('budget_cy26', data);
        showToast('Saved');
    };

    saveBudgetNY = function(data) {
        localStorage.setItem('budget_ny27', JSON.stringify(data));
        fbSave('budget_ny27', data);
        showToast('Saved');
    };

    saveWeekActuals = function(data) {
        localStorage.setItem('week_actuals_cy26', JSON.stringify(data));
        fbSave('week_actuals_cy26', data);
    };

    saveAccounts = function(data) {
        localStorage.setItem('accounts_data', JSON.stringify(data));
        fbSave('accounts_data', data);
        showToast('Saved');
    };
}

function setupRealtimeListeners() {
    fbListen('budget_cy26', (data) => {
        if (data && data.outgoings) {
            data.outgoings.forEach(migrateOutgoing);
            budgetCY = data;
            window._budgetData = budgetCY;
            renderBudgetTab(budgetCY, 'cy-');
        }
    });

    fbListen('budget_ny27', (data) => {
        if (data && data.outgoings) {
            data.outgoings.forEach(migrateOutgoing);
            budgetNY = data;
            renderBudgetTab(budgetNY, 'ny-');
        }
    });

    fbListen('accounts_data', (data) => {
        if (data && data.banking) {
            accountsData = data;
            renderAccountsTab(accountsData);
        }
    });
}

/** Initial sync: push defaults to Firebase if empty, or load from Firebase */
async function initialSync() {
    console.log('Starting initial sync...');

    const fbCY = await fbLoad('budget_cy26');

    if (fbCY && fbCY.outgoings && fbCY.outgoings.length > 0) {
        // Firebase has valid data — use it
        budgetCY = fbCY;
        budgetCY.outgoings.forEach(migrateOutgoing);
        window._budgetData = budgetCY;

        const fbNY = await fbLoad('budget_ny27');
        if (fbNY && fbNY.outgoings) {
            budgetNY = fbNY;
            budgetNY.outgoings.forEach(migrateOutgoing);
        }

        const fbWA = await fbLoad('week_actuals_cy26');
        if (fbWA) weekActuals = fbWA;

        const fbAcct = await fbLoad('accounts_data');
        if (fbAcct && fbAcct.banking) accountsData = fbAcct;

        console.log('Data loaded from Firebase.');
    } else {
        // Firebase is empty — push defaults
        console.log('Firebase empty, pushing default data...');
        // Ensure we have good defaults
        if (!budgetCY || !budgetCY.outgoings || budgetCY.outgoings.length === 0) {
            budgetCY = JSON.parse(JSON.stringify(DEFAULT_CY));
            budgetCY.outgoings.forEach(migrateOutgoing);
        }
        if (!budgetNY || !budgetNY.outgoings || budgetNY.outgoings.length === 0) {
            budgetNY = JSON.parse(JSON.stringify(DEFAULT_NY));
            budgetNY.outgoings.forEach(migrateOutgoing);
        }
        if (!accountsData || !accountsData.banking) {
            accountsData = JSON.parse(JSON.stringify(DEFAULT_ACCOUNTS));
        }
        if (!weekActuals || typeof weekActuals !== 'object') {
            weekActuals = {};
        }
        window._budgetData = budgetCY;

        fbSave('budget_cy26', budgetCY);
        fbSave('budget_ny27', budgetNY);
        fbSave('week_actuals_cy26', weekActuals);
        fbSave('accounts_data', accountsData);
        console.log('Default data pushed to Firebase.');
    }
}
