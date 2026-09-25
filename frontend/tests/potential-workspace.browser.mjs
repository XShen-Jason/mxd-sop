// Run with the frontend dev server: node frontend/tests/potential-workspace.browser.mjs
// All API calls are fixtures; this test never logs in to a real game account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const origin = process.env.POTENTIAL_TEST_ORIGIN ?? 'http://127.0.0.1:5173';
const session = {
  id: 's-test', server_id: 'test-server', state: 'logged_in', created_at: '2026-09-25T00:00:00Z',
  roles: [{ id: '265', name: '测试角色' }], sent_messages: 0,
};
const options = [
  { statType: 'str', statName: '力量', value: '15', showValue: '15', grade: 'B', pool: 'low' },
  { statType: 'str', statName: '力量', value: '15', showValue: '15', grade: 'B', pool: 'high' },
  { statType: 'int', statName: '智力', value: '5', showValue: '5', grade: 'D', pool: 'low' },
  { statType: 'move', statName: '移速', value: '0.15', showValue: '0.15', grade: 'C', pool: 'low' },
];
const equipment = [
  { instanceId: '558106', templateId: '01302120', name: '无潜能测试装备', potentials: [] },
  { instanceId: '681604', templateId: '01102041', name: '已有潜能测试装备', potentials: [
    { slot: 1, statType: 'str', statName: '力量', value: '15', grade: 'B' },
    { slot: 2, statType: 'move', statName: '移速', value: '0.15', grade: 'C' },
  ] },
];
let starts = 0;
let stops = 0;
let failStatus = false;
let statusDelay = 0;
let inFlight = 0;
let maxInFlight = 0;
let deliveryStatus = 'success';
const saves = [];
const errors = [];
await context.route('**/api/**', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  if (!path.startsWith('/api/')) return route.continue();
  const respond = (body, status = 200) => route.fulfill({ status, json: body });
  if (path === '/api/v1/auth/me') return respond({
    id: 'browser-test', username: 'test', displayName: '测试超管', role: 'super_admin', workspacePermissions: {},
  });
  if (path === '/api/v1/operation-groups/options') return respond({ servers: [], reasons: [], operations: [] });
  if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
  if (path.endsWith('/workspace-counts')) return respond({});
  if (path === '/api/v1/auto/overview') return respond({
    servers: [{ id: 'test-server', name: '测试服务器', enabled: true, accounts: [] }], sessions: [], logs: [],
  });
  if (path === '/api/v1/potential-pool') return respond({ options });
  if (path.endsWith('/servers/test-server/sessions')) { starts++; return respond(session, 201); }
  if (path.endsWith('/select-and-enter')) { session.state = 'ready'; session.character_id = '265'; return respond(session); }
  if (path === '/api/v1/auto/sessions/s-test') {
    if (request.method() === 'DELETE') { stops++; return route.fulfill({ status: 204 }); }
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, statusDelay));
    inFlight--;
    return failStatus ? respond({ error: { code: 'endpoint-unavailable', message: '测试连接暂时不可用' } }, 503) : respond(session);
  }
  if (path === '/api/v1/potentials/list') return respond({ session, equipment });
  if (path === '/api/v1/potentials/set') {
    saves.push(request.postDataJSON());
    return respond({ session, result: { delivery_status: deliveryStatus } });
  }
  return respond({ groups: [], accounts: [], activities: [], nextCursor: null });
});

async function openPage() {
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin + '/potential-editor');
  await page.waitForTimeout(800);
  if (!(await page.getByRole('heading', { name: '修改潜能', exact: true }).count())) {
    console.log('PAGE:', await page.locator('body').innerText(), 'ERRORS:', errors);
  }
  return page;
}
async function waitEnabled(locator) {
  await locator.waitFor();
  await locator.page().waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((entry) => entry.textContent.includes('获取潜能列表'));
    return button && !button.disabled;
  });
}
try {
  let page = await openPage();
  fs.mkdirSync('data/generated/potential-qa', { recursive: true });
  assert.equal(await page.getByLabel('游戏密码', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '登录账号', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await dialog.evaluate((element) => element.contains(document.activeElement)), true);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 0);
  assert.equal(await page.getByRole('button', { name: '登录账号', exact: true }).evaluate((element) => document.activeElement === element), true);
  await page.getByRole('button', { name: '登录账号', exact: true }).click();
  await page.screenshot({ path: 'data/generated/potential-qa/login-dialog.png', fullPage: true });
  await page.getByLabel('游戏账号', { exact: true }).fill('fixture-account');
  await page.getByLabel('游戏密码', { exact: true }).fill('fixture-password');
  await dialog.getByRole('button', { name: '登录账号', exact: true }).click();
  await dialog.getByRole('button', { name: '稍后进入', exact: true }).click();
  assert.equal(stops, 0);
  await page.getByRole('button', { name: '继续进入游戏', exact: true }).click();
  await page.getByRole('button', { name: '进入游戏', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  const list = page.getByRole('button', { name: '获取潜能列表', exact: true });
  await waitEnabled(list);
  await list.click();
  const card = page.locator('article').filter({ hasText: '无潜能测试装备' });
  const slots = card.getByRole('combobox');
  assert.equal(await card.locator('.potential-saved-slot input').count(), 0);
  assert.equal(await card.locator('.potential-saved-value.is-empty').count(), 3);
  await slots.nth(0).fill('力量 15');
  assert.equal(await slots.nth(0).evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
  assert.equal(await slots.nth(0).evaluate((element) => getComputedStyle(element).boxShadow), 'none');
  assert.notEqual(await card.locator('.potential-combobox').nth(0).evaluate((element) => getComputedStyle(element).boxShadow), 'none');
  await page.getByRole('option', { name: /力量/ }).waitFor();
  assert.equal(await page.getByRole('option', { name: /力量/ }).count(), 1);
  await slots.nth(0).press('Enter');
  await slots.nth(1).fill('INT d');
  await slots.nth(1).press('Enter');
  await slots.nth(2).fill('移速 0.15');
  await slots.nth(2).press('ArrowDown');
  await slots.nth(2).press('Enter');
  assert.equal(await card.locator('.potential-comparison-row.is-modified').count(), 3);
  assert.equal(await card.locator('.potential-saved-value.is-empty').count(), 3);
  await card.getByRole('button', { name: '添加潜能', exact: true }).click();
  await page.getByRole('status').filter({ hasText: '服务器已确认修改' }).waitFor();
  assert.equal(await card.locator('.potential-comparison-row.is-modified').count(), 0);
  assert.match(await card.getByLabel('已保存槽位 1', { exact: true }).innerText(), /力量/);
  assert.equal(await page.locator('.notice-stack').evaluate((element) => getComputedStyle(element).position), 'fixed');
  assert.deepEqual(saves[0], { session_id: 's-test', instance_id: '558106', potentials: [
    { stat_type: 'str', value: '15' }, { stat_type: 'int', value: '5' }, { stat_type: 'move', value: '0.15' },
  ] });
  await slots.nth(0).click();
  assert.equal(await slots.nth(0).inputValue(), '');
  await slots.nth(0).press('Escape');
  assert.match(await slots.nth(0).inputValue(), /力量/);
  // Saving one existing slot must retain the second slot and its order.
  const existing = page.locator('article').filter({ hasText: '已有潜能测试装备' });
  await existing.getByRole('combobox').nth(0).fill('智力');
  await existing.getByRole('combobox').nth(0).press('Enter');
  assert.match(await existing.getByLabel('已保存槽位 1', { exact: true }).innerText(), /力量/);
  assert.equal(await existing.locator('.potential-comparison-row.is-modified').count(), 1);
  await page.screenshot({ path: 'data/generated/potential-qa/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 375, height: 850 });
  await page.waitForTimeout(350);
  const left = await existing.locator('.potential-saved-slot').first().boundingBox();
  const right = await existing.getByRole('combobox').first().boundingBox();
  assert.ok(left.x + left.width <= right.x);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'data/generated/potential-qa/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1050 });
  await existing.getByRole('button', { name: '还原', exact: true }).click();
  assert.equal(await existing.locator('.potential-comparison-row.is-modified').count(), 0);
  await existing.getByRole('combobox').nth(0).fill('智力');
  await existing.getByRole('combobox').nth(0).press('Enter');
  deliveryStatus = 'failure';
  await existing.getByRole('button', { name: '保存潜能', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '游戏服务器拒绝' }).waitFor();
  assert.match(await existing.getByLabel('已保存槽位 1', { exact: true }).innerText(), /力量/);
  assert.equal(await existing.locator('.potential-comparison-row.is-modified').count(), 1);
  deliveryStatus = 'unknown';
  await existing.getByRole('button', { name: '保存潜能', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: '结果尚未确认' }).waitFor();
  assert.match(await existing.getByLabel('已保存槽位 1', { exact: true }).innerText(), /力量/);
  assert.equal(await existing.locator('.potential-comparison-row.is-modified').count(), 1);
  deliveryStatus = 'success';
  await existing.getByRole('button', { name: '保存潜能', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.potential-card.is-dirty').length === 0);
  assert.deepEqual(saves[1].potentials, [{ stat_type: 'int', value: '5' }, { stat_type: 'move', value: '0.15' }]);
  assert.match(await existing.getByLabel('已保存槽位 1', { exact: true }).innerText(), /智力/);
  await page.setViewportSize({ width: 375, height: 850 });
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.reload();
  await waitEnabled(page.getByRole('button', { name: '获取潜能列表', exact: true }));
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole('button', { name: '我的申请', exact: true }).click();
  await page.getByRole('button', { name: '潜能工作区', exact: true }).click();
  await waitEnabled(page.getByRole('button', { name: '获取潜能列表', exact: true }));
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  await page.close();
  page = await openPage();
  await waitEnabled(page.getByRole('button', { name: '获取潜能列表', exact: true }));
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-password')), false);
  failStatus = true;
  await page.reload();
  await page.getByRole('alert').filter({ hasText: '测试连接暂时不可用' }).waitFor();
  assert.equal(starts, 1);
  assert.equal(stops, 0);
  failStatus = false;
  await page.getByRole('button', { name: '刷新状态' }).click();
  await waitEnabled(page.getByRole('button', { name: '获取潜能列表', exact: true }));
  statusDelay = 5500;
  await page.reload();
  await waitEnabled(page.getByRole('button', { name: '获取潜能列表', exact: true }));
  assert.equal(maxInFlight, 1);
  statusDelay = 0;
  await page.getByRole('button', { name: '退出游戏账号', exact: true }).click();
  await page.getByRole('button', { name: '退出账号', exact: true }).click();
  await page.getByRole('button', { name: '登录账号', exact: true }).waitFor();
  assert.equal(stops, 1);
  await page.reload();
  await page.getByRole('button', { name: '登录账号', exact: true }).waitFor();
  assert.equal(starts, 1);
  assert.equal(await page.evaluate(() => localStorage.getItem('ops-potential-session:browser-test')), null);
  assert.deepEqual(errors, []);
  console.log('PASS: login modal, focus, floating notices, comparison/reset/save/failure, empty slots, search, mobile columns, session restore and explicit logout.');
} finally {
  await browser.close();
}
