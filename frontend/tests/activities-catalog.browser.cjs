const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';

async function runViewport(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const errors = [];
  let savedActivities;
  let submittedGroup;
  page.on('pageerror', (error) => errors.push(error.message));

  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    let body = {};
    if (url.pathname.endsWith('/auth/me')) body = {
      id: 'catalog-test', role: 'super_admin', displayName: '目录测试',
      workspacePermissions: { activities: true, request: true }, uploadPermissions: { 'item-catalog': true },
    };
    else if (url.pathname.endsWith('/options')) body = {
      servers: [{ id: 'mushroom', displayName: '蘑菇' }],
      reasons: [{ code: 'event-reward', displayName: '活动奖励' }], operations: [{ type: 'item', displayName: '发物品' }], commandRuleVersion: 'test',
    };
    else if (url.pathname.endsWith('/activities') && route.request().method() === 'GET') body = {
      activities: savedActivities ?? [{ id: 'binding-item', name: '绑定道具回归', description: '', visible: true, updatedAt: '2026-01-01T00:00:00.000Z', rewards: [
        { kind: 'item', quantity: 1, itemCode: '02046830_1', itemName: '超级时装强化卷（绑定）', itemClass: 'consume' },
        { kind: 'item', quantity: 1, itemCode: '01012190_2', itemName: '装备等级测试', itemClass: 'equip', itemLevel: 2 },
      ] }],
    };
    else if (url.pathname.endsWith('/activities') && route.request().method() === 'PUT') {
      savedActivities = route.request().postDataJSON().activities;
      body = { activities: savedActivities };
    }
    else if (url.pathname.endsWith('/operation-groups') && route.request().method() === 'POST') {
      submittedGroup = route.request().postDataJSON();
      body = { id: 'submitted' };
    }
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

  await page.locator('.activity-card .icon-button').nth(1).click();
  await page.locator('.activity-editor').waitFor();
  await page.locator('.activity-editor .primary-button').click();
  await page.waitForTimeout(50);
  assert.equal(savedActivities[0].rewards[0].itemCode, '02046830_1', 'activity save must preserve bound item suffixes');
  assert.deepEqual(savedActivities[0].rewards[1], { kind: 'item', quantity: 1, itemCode: '01012190', itemName: '装备等级测试', itemClass: 'equip', itemLevel: 2 }, 'equipment suffixes remain level metadata');

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

  await page.goto(`${baseUrl}/request`);
  await page.getByLabel('游戏账号').fill('account');
  await page.getByLabel('玩家 QQ').fill('123456');
  await page.getByLabel('角色 ID').fill('123');
  await page.getByLabel(/补充说明/).fill('绑定道具回归');
  await page.locator('.activity-choice').click();
  await page.getByRole('button', { name: /提交申请/ }).click();
  await page.getByRole('button', { name: '确认提交', exact: true }).click();
  await page.locator('.activity-choice[aria-pressed="false"]').waitFor();
  assert.equal(submittedGroup.operations[0].itemCode, '02046830_1', 'quick-fill submission must preserve bound item suffixes');
  assert.deepEqual(submittedGroup.operations[1], { type: 'item', itemCode: '01012190', itemLevel: 2, quantity: 1 });
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
