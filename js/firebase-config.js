/**
 * Firebase configuration.
 *
 * TO SET UP:
 * 1. Go to https://console.firebase.google.com
 * 2. Create a new project (e.g. "financial-planner")
 * 3. Go to Project Settings > General > Your apps > Add web app
 * 4. Copy the config object and paste below
 * 5. Go to Build > Authentication > Sign-in method > Enable Google
 * 6. Go to Build > Realtime Database > Create Database (start in test mode)
 * 7. Update database rules (see RULES below)
 */

const FIREBASE_CONFIG = {
    // PASTE YOUR CONFIG HERE:
    apiKey: "",
    authDomain: "",
    databaseURL: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: ""
};

/**
 * DATABASE RULES — paste these in Firebase Console > Realtime Database > Rules:
 *
 * {
 *   "rules": {
 *     "household": {
 *       "$uid": {
 *         ".read": "auth != null",
 *         ".write": "auth != null"
 *       }
 *     }
 *   }
 * }
 */

// Allowed Google emails (only these can sign in)
const ALLOWED_EMAILS = [
    // "brad@example.com",
    // "diana@example.com",
];
