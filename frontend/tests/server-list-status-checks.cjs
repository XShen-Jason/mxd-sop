const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function checkServerListStatus(page, target, servers, connection) {
  const server = servers[0];
  const account = server.accounts[0];
  const rowSelector = target.name === 'main' ? '.server-list-item' : '.management-server-row';
  const row = page.locator(rowSelector).first();
  const colors = {};
  const expectState = async (tone, label) => {
    await row.locator(`[data-server-status][data-status-tone="${tone}"]`).waitFor({ state: 'attached', timeout: 8000 });
    await row.locator('[data-server-status]').waitFor({ state: 'attached', timeout: 8000 });
    const color = await row.locator('[data-server-status]').evaluate((dot) => getComputedStyle(dot).backgroundColor);
    if (colors[tone]) assert.equal(color, colors[tone]);
    colors[tone] = color;
  };
  await expectState('inactive', '在线 · 自动化关闭');
  account.automation_enabled = true;
  await expectState('ready', '在线 · 自动化');
  account.status = 'connecting';
  await expectState('waiting', '连接中');
  account.status = 'reconnecting';
  await expectState('waiting', '重连中');
  account.status = 'failed';
  await expectState('error', '连接失败');
  account.status = 'offline';
  await expectState('error', '离线');
  account.enabled = false;
  await expectState('inactive', '未登录');
  account.enabled = true;
  account.status = 'online';
  server.enabled = false;
  await expectState('inactive', '服务器已停用');
  server.enabled = true;
  await expectState('ready', '在线 · 自动化');
  connection.overviewFails = true;
  await expectState('waiting', '状态待确认');
  connection.overviewFails = false;
  await expectState('ready', '在线 · 自动化');
  if (target.name === 'main') {
    connection.available = false;
    await expectState('waiting', '状态待确认');
    connection.available = true;
    await expectState('ready', '在线 · 自动化');
  }
  server.accounts.push({ ...account, id: 'a-second', username: '重连账号名字比较长', status: 'reconnecting' });
  await row.locator('[data-server-status][data-status-tone="waiting"]').waitFor({ state: 'attached', timeout: 8000 });
  assert.equal(await row.locator('[data-server-status]').getAttribute('data-status-tone'), 'waiting', 'mixed states must not hide reconnecting accounts');
  assert.equal(await row.locator('[data-account-status]').count(), 0, 'server list only shows the aggregate status circle');
  assert.equal(new Set(Object.values(colors)).size, 4, 'status tones must have distinct colors');
  const screenshots = path.join(os.tmpdir(), 'mxd-server-list-checks');
  fs.mkdirSync(screenshots, { recursive: true });
  await row.screenshot({ path: path.join(screenshots, `${target.name}-desktop.png`) });
  await page.setViewportSize({ width: 375, height: 844 });
  if (target.name === 'main') await page.locator('.sidebar').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await row.scrollIntoViewIfNeeded();
  assert(await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'account status text must fit mobile');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'server list must not overflow mobile');
  await row.screenshot({ path: path.join(screenshots, `${target.name}-mobile.png`) });
  await page.setViewportSize({ width: 1440, height: 1100 });
  server.accounts.pop();
  account.automation_enabled = false;
  await expectState('inactive', '在线 · 自动化关闭');
  console.log(`${target.name}: live server list colors, transitions, stale snapshots, mixed accounts and mobile passed`);
}

module.exports = { checkServerListStatus };
