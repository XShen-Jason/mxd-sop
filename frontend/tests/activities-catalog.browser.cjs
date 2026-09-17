const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';

async function runViewport(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname.endsWith('/auth/me')) body = {
      id: 'catalog-test', role: 'super_admin', displayName: '目录测试',
      workspacePermissions: { activities: true }, uploadPermissions: { 'item-catalog': true },
    };
    else if (url.pathname.endsWith('/options')) body = { servers: [], reasons: [], operations: [], commandRuleVersion: 'test' };
    else if (url.pathname.endsWith('/activities')) body = { activities: [] };
    else if (url.pathname.endsWith('/item-catalog/by-class')) body = {
      items: [{ code: '02000000', name: '金币', itemClass: 'consume' }], nextCursor: null, totalCount: 1,
    };
    else if (url.pathname.endsWith('/operation-groups/counts')) body = {};
    else if (url.pathname.endsWith('/events')) {
      await route.fulfill({ contentType: 'text/event-stream', body: ': ready\n\n' });
      return;
    }
    await route.fulfill({ json: body });
  });

  await page.goto(`${baseUrl}/activities`);
  const heading = page.getByRole('heading', { name: '选择道具', exact: true });
  const picker = page.locator('.activity-file-picker');
  const replaceButton = page.getByRole('button', { name: '替换目录', exact: true });
  await heading.waitFor();

  const [headingBox, pickerBox, replaceBox] = await Promise.all([
    heading.boundingBox(), picker.boundingBox(), replaceButton.boundingBox(),
  ]);
  assert.ok(headingBox && pickerBox && replaceBox);
  assert.ok(Math.abs(headingBox.y - pickerBox.y) < 1, 'heading and CSV picker should share one row');
  assert.ok(Math.abs(pickerBox.y - replaceBox.y) < 1, 'CSV controls should share one row');
  assert.ok(Math.abs(pickerBox.height - replaceBox.height) < 1, 'CSV controls should have equal height');
  assert.equal(await page.getByText(/\d+ 项$/).count(), 0);

  await page.getByRole('button', { name: '消耗品', exact: true }).click();
  await page.getByText('02000000 · consume', { exact: true }).waitFor();
  assert.equal(await page.locator('.activity-item-tile').evaluate((element) => element.tagName), 'DIV');
  const copyButton = page.getByRole('button', { name: '复制物品代码: 02000000', exact: true });
  assert.equal(await copyButton.isVisible(), true);
  assert.equal(await copyButton.isEnabled(), true);
  await copyButton.click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '02000000');
  await page.getByText('已复制物品代码 02000000', { exact: true }).waitFor();
  assert.equal(await page.locator('.activity-item-board.is-disabled').count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-activities-catalog-${width}.png`), fullPage: true });
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 390]) await runViewport(browser, width);
  } finally {
    await browser.close();
  }
  console.log('PASS activities catalog: toolbar alignment, raw classes, persistent copy controls, responsive width');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
