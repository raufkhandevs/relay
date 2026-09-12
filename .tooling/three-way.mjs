import { _electron as electron, chromium } from './node_modules/playwright/index.mjs';
import { execSync } from 'node:child_process';

const APP = '/Users/apple/work/app-development/desktop-electron/dist/mac-arm64/desktop-electron.app/Contents/MacOS/desktop-electron';
const MAESTRO = '/Users/apple/.maestro-install/maestro/bin/maestro';
const sh = (c) => execSync(c, { shell: '/bin/zsh', stdio: 'pipe' }).toString();

// ---- desktop: the agent ----
const app = await electron.launch({ executablePath: APP });
const desk = await app.firstWindow();
await desk.waitForLoadState('domcontentloaded');
if (await desk.locator('[data-testid="login-submit"]').count()) {
  await desk.fill('[data-testid="login-email"]', 'agent@relay.test');
  await desk.fill('[data-testid="login-password"]', 'password');
  await desk.click('[data-testid="login-submit"]');
}
await desk.waitForSelector('[data-testid^="ticket-row-"]', { timeout: 20000 });
await desk.click('[data-testid="ticket-row-1"]');
await desk.waitForSelector('[data-testid^="message-"]', { timeout: 15000 });
console.log('1/5 desktop ready   agent, TKT-1');

// ---- web: the customer ----
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:8000/login');
await page.getByRole('textbox', { name: 'Email address' }).fill('priya@relay.test');
await page.getByRole('textbox', { name: 'Password' }).fill('password');
await page.getByRole('button', { name: /log in/i }).click();
await page.waitForURL(/tickets/, { timeout: 15000 });
await page.goto('http://localhost:8000/tickets/1');
await page.waitForSelector('text=CSV', { timeout: 15000 });
console.log('2/5 web ready       priya, TKT-1');

// ---- ios: the same thread ----
sh(`cat > /tmp/t-open.yaml <<'Y'
appId: com.aswad-1.mobile-react-native
---
- launchApp
- assertVisible: "Tickets"
- tapOn:
    id: "ticket-row-1"
Y
${MAESTRO} test /tmp/t-open.yaml`);
console.log('3/5 ios ready       TKT-1');

// ---- one message, from the desktop console ----
const token = 'RELAY' + Math.floor(Math.random() * 9000 + 1000);
await desk.locator('[data-testid="composer-body"]').fill(`One conversation, three clients ${token}`);
await desk.locator('[data-testid="composer-body"]').press('Enter');
await desk.waitForSelector(`text=${token}`, { timeout: 15000 });
console.log(`4/5 sent from desktop   ${token}`);

// ---- assert it landed on the other two ----
await page.waitForSelector(`text=${token}`, { timeout: 20000 });

const msgId = sh(`cd /Users/apple/work/app-development/backend-laravel && php artisan tinker --execute="echo App\\\\Models\\\\Message::where('body','like','%${token}%')->value('id');"`).trim().split('\n').pop().trim();
sh(`cat > /tmp/t-assert.yaml <<'Y'
appId: com.aswad-1.mobile-react-native
---
- assertVisible:
    id: "message-${msgId}"
Y
${MAESTRO} test /tmp/t-assert.yaml`);
console.log(`5/5 arrived on web and ios   message id ${msgId}`);

await desk.screenshot({ path: '/tmp/final-desktop.png' });
await page.screenshot({ path: '/tmp/final-web.png', fullPage: false });
sh('xcrun simctl io booted screenshot /tmp/final-ios.png');
console.log('screenshots written');

await browser.close();
await app.close();
