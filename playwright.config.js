import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for Family Planner end-to-end smoke tests.
 *
 * The app is a static site served by `python server.py` on port 8080.
 * `webServer.reuseExistingServer` lets the dev workflow be: leave the dev
 * server running, then `npm run test:e2e` re-uses it. CI would set the env
 * var to false and let Playwright spawn its own.
 *
 * Chromium-only by design — the app is GitHub-Pages-hosted and Brad's
 * browser is Chrome; cross-browser coverage is not a requirement here.
 * Add Firefox/WebKit projects if that ever changes.
 */
export default defineConfig({
    testDir: './tests-e2e',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: false, // tests share localStorage state per worker; serial keeps blame trivial
    workers: 1,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'off',
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],
    webServer: {
        command: 'python server.py',
        url: 'http://localhost:8080',
        reuseExistingServer: true,
        stdout: 'ignore',
        stderr: 'pipe',
        timeout: 10_000,
        env: {
            // Suppress the auto-open browser tab in server.py so test runs
            // don't keep spawning fresh windows.
            FAMILY_PLANNER_NO_BROWSER: '1',
        },
    },
});
