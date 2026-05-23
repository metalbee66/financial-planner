/**
 * Celebrations — Task 7.1.
 *
 * Three intensities (light / medium / full) keyed to the task lifecycle:
 *
 *   - light  : a regular task transitions to done
 *   - medium : a milestone task transitions to done (and isn't the last in the project)
 *   - full   : the last open task in a project transitions to done, OR the project
 *              status is explicitly flipped to 'completed'
 *
 * Each intensity has a pool of named variants. The picker rotates through one
 * shuffled cycle of the pool before refilling, so users never see the same
 * celebration twice in a row (the plan-§7.1 verification: "Mark 5 tasks done
 * in a row → all 5 celebrations are different").
 *
 * Pure helpers live here so they're unit-testable. The DOM/audio side effect
 * (`triggerCelebration`) is fire-and-forget — it injects an overlay into
 * `document.body`, runs CSS keyframe animations, and cleans up after 3 sec.
 * Sound is opt-in via `setCelebrationSoundEnabled(true)`.
 */

export const CELEBRATION_INTENSITIES = ['light', 'medium', 'full'];

/**
 * Variant catalogue. Adding a new variant id here + matching CSS class is the
 * only change needed to grow the pool. Light needs ≥5 entries to satisfy the
 * plan-§7.1 "5 in a row, all different" verification.
 */
export const CELEBRATION_VARIANTS = Object.freeze({
    light: ['emoji-burst', 'confetti-small', 'sparkle-wave', 'check-pop', 'star-shower'],
    medium: ['confetti-medium', 'milestone-banner', 'emoji-rain'],
    full: ['confetti-full', 'project-complete-banner'],
});

const SOUND_PREF_KEY = 'celebrate_sound_enabled';

/**
 * Decide which intensity to play. Plan §7.1: "Last project task done triggers
 * full-screen celebration" wins over "Marking a milestone done triggers a
 * stronger celebration" — finishing the project is the bigger moment.
 */
export function classifyCelebration(opts) {
    const o = opts || {};
    if (o.allTasksDoneAfter) return 'full';
    if (o.wasMilestone) return 'medium';
    return 'light';
}

// Per-intensity queue. Each cycle is a fresh shuffle of the pool; we pop from
// the front and refill (with anti-repeat) when empty.
const variantQueues = { light: [], medium: [], full: [] };
const lastPicked = { light: null, medium: null, full: null };

function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

/**
 * Pick the next variant for `intensity`. Returns null for unknown intensities
 * so the caller can no-op cleanly. Guarantees:
 *   - no repeats within a single shuffled cycle of the pool
 *   - first pick of a new cycle is never equal to the last pick of the prior
 *     cycle (so consecutive calls always differ when the pool has ≥2 entries)
 */
export function pickCelebrationVariant(intensity) {
    if (!intensity || !CELEBRATION_VARIANTS[intensity]) return null;
    const pool = CELEBRATION_VARIANTS[intensity];
    if (pool.length === 0) return null;
    let queue = variantQueues[intensity];
    if (!queue || queue.length === 0) {
        queue = shuffleInPlace(pool.slice());
        // Anti-repeat: if the freshly-shuffled cycle would start with the
        // same id we last popped, swap with the next entry (only meaningful
        // when pool.length ≥ 2).
        if (queue.length >= 2 && lastPicked[intensity] && queue[0] === lastPicked[intensity]) {
            [queue[0], queue[1]] = [queue[1], queue[0]];
        }
        variantQueues[intensity] = queue;
    }
    const v = queue.shift();
    lastPicked[intensity] = v;
    return v;
}

/** Test seam. Reset queues + last-picked state so a test starts deterministic. */
export function __resetCelebrationQueues() {
    for (const k in variantQueues) variantQueues[k] = [];
    for (const k in lastPicked) lastPicked[k] = null;
}

export function isCelebrationSoundEnabled() {
    try {
        return localStorage.getItem(SOUND_PREF_KEY) === 'true';
    } catch {
        return false;
    }
}

export function setCelebrationSoundEnabled(enabled) {
    try {
        localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false');
    } catch (e) {
        console.error('celebrate sound pref save error:', e);
    }
}

// ── DOM + audio side effects ──

const ROOT_ID = 'celebrate-root';
const ACTIVE_CLASS = 'celebrate-active';
const CELEBRATION_DURATION_MS = 3000;

/**
 * Inject + animate a celebration overlay. Fire-and-forget: returns
 * immediately, the overlay auto-clears after CELEBRATION_DURATION_MS. Safe to
 * call from anywhere (creates the root container on first use). No-op when
 * intensity is unknown.
 */
export function triggerCelebration(opts) {
    const intensity = (opts && opts.intensity) || 'light';
    const variant = pickCelebrationVariant(intensity);
    if (!variant) return;
    const root = ensureRoot();
    const overlay = document.createElement('div');
    overlay.className = `celebrate-overlay celebrate-${intensity} celebrate-variant-${variant}`;
    overlay.dataset.intensity = intensity;
    overlay.dataset.variant = variant;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = renderVariantHtml(intensity, variant);
    root.appendChild(overlay);
    root.classList.add(ACTIVE_CLASS);
    if (isCelebrationSoundEnabled()) playChime(intensity);
    setTimeout(() => {
        overlay.remove();
        if (root.childElementCount === 0) root.classList.remove(ACTIVE_CLASS);
    }, CELEBRATION_DURATION_MS);
}

function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
        root = document.createElement('div');
        root.id = ROOT_ID;
        root.className = 'celebrate-root';
        root.setAttribute('aria-hidden', 'true');
        document.body.appendChild(root);
    }
    return root;
}

const EMOJI_POOLS = {
    'emoji-burst': ['🎉', '✨', '⭐', '🌟', '🎊'],
    'sparkle-wave': ['✨', '💫', '⭐'],
    'star-shower': ['⭐', '🌟', '✨'],
    'milestone-banner': ['🎯'],
    'emoji-rain': ['🎉', '🎊', '✨', '⭐', '🌟', '🎈'],
    'project-complete-banner': ['🏆', '🎉', '🎊'],
};

const CONFETTI_COLORS = ['#00b0f0', '#7030a0', '#00c853', '#ff9800', '#ff5252', '#ffd54f'];

function renderVariantHtml(intensity, variant) {
    switch (variant) {
        case 'check-pop':
            return `<div class="celebrate-badge"><span class="celebrate-badge-icon">✓</span><span class="celebrate-badge-label">Done!</span></div>`;
        case 'milestone-banner':
            return `<div class="celebrate-banner celebrate-banner-milestone"><span>🎯 Milestone reached!</span></div>`;
        case 'project-complete-banner':
            return `<div class="celebrate-banner celebrate-banner-project"><span>🏆 Project complete!</span></div>${renderConfettiHtml(80)}`;
        case 'confetti-small':
            return renderConfettiHtml(20);
        case 'confetti-medium':
            return renderConfettiHtml(50);
        case 'confetti-full':
            return renderConfettiHtml(120);
        default:
            return renderEmojiBurstHtml(variant);
    }
}

function renderEmojiBurstHtml(variant) {
    const pool = EMOJI_POOLS[variant] || EMOJI_POOLS['emoji-burst'];
    const count = variant === 'emoji-rain' ? 40 : (variant === 'star-shower' ? 25 : 18);
    const pieces = [];
    for (let i = 0; i < count; i++) {
        const ch = pool[i % pool.length];
        const left = Math.round(Math.random() * 100);
        const delay = Math.round(Math.random() * 600);
        const drift = Math.round((Math.random() - 0.5) * 80);
        const rotate = Math.round((Math.random() - 0.5) * 720);
        const scale = (0.8 + Math.random() * 0.7).toFixed(2);
        pieces.push(
            `<span class="celebrate-emoji" style="left:${left}%;animation-delay:${delay}ms;--drift:${drift}px;--spin:${rotate}deg;--scale:${scale};">${ch}</span>`
        );
    }
    return pieces.join('');
}

function renderConfettiHtml(count) {
    const pieces = [];
    for (let i = 0; i < count; i++) {
        const left = Math.round(Math.random() * 100);
        const delay = Math.round(Math.random() * 800);
        const drift = Math.round((Math.random() - 0.5) * 120);
        const rotate = Math.round((Math.random() - 0.5) * 720);
        const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        pieces.push(
            `<span class="celebrate-confetti" style="left:${left}%;background:${color};animation-delay:${delay}ms;--drift:${drift}px;--spin:${rotate}deg;"></span>`
        );
    }
    return pieces.join('');
}

// Simple WebAudio chime — two-tone arpeggio. No external assets. Caller
// already gated by isCelebrationSoundEnabled() so we don't repeat the check.
function playChime(intensity) {
    try {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        const ctx = new Ctor();
        const now = ctx.currentTime;
        // Tone count + base freq scales with intensity so 'full' sounds richer.
        const tones = intensity === 'full' ? [659.25, 783.99, 987.77, 1318.51]
            : intensity === 'medium' ? [659.25, 880.0, 1108.73]
            : [659.25, 987.77];
        tones.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = freq;
            const start = now + i * 0.09;
            const stop = start + 0.18;
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, stop);
            osc.connect(gain).connect(ctx.destination);
            osc.start(start);
            osc.stop(stop + 0.02);
        });
        // Close the context after the chime to free hardware. Some browsers
        // gate close() behind start state; ignore failures.
        setTimeout(() => { try { ctx.close(); } catch {} }, 1200);
    } catch (e) {
        console.warn('celebrate chime failed:', e);
    }
}
