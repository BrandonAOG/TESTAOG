// Automated checks for the AOG Field Hub (not part of the app).
// GitHub runs these on every upload — see .github/workflows/tests.yml.
// Local run:  npm install  →  npx playwright install chromium  →  npx playwright test
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 90 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // On GitHub: 'github' puts each failed check (file, line, message) right on the run's summary page.
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:8080',
    serviceWorkers: 'block',          // test the pages themselves, not an old offline copy
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },   // let the sound checks play
  },
  webServer: {
    command: 'python3 -m http.server 8080',
    url: 'http://localhost:8080/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30 * 1000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'iphone',  use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
});
