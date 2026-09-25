// Run with both dev servers, or AUTO_TEST_ORIGIN=http://127.0.0.1:26909 after building auto.
// API traffic is fully mocked: this regression never sends commands to a live game server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const { checkAccountControls, checkMessageResult } = require('./server-account-checks.cjs');
const { checkServerListStatus } = require('./server-list-status-checks.cjs');

const reference = { spawn_rate: 2, exp_rate: 13, exp_max: 999999, drop_rate: 3, meso_rate: 5, domain_times: 2 };
const account = { id: 'a-fixture', server_id: 'mushroom', username: '测试GM', character_id: '265', character_name: '测试角色', credential_type: 'password', enabled: true, automation_enabled: false, status: 'online', updated_at: '2026-09-25T00:00:00Z' };
const makeServer = (id, name) => ({ ...reference, id, name, address: '127.0.0.1:12660', version: '1.0.2', map_id: '211000000', enabled: true, accounts: [{ ...account, server_id: id }] });
const targets = [
  { name: 'main', origin: process.env.TEST_BASE_URL || 'http://localhost:5173', route: '/server-operations', panel: '.server-message-panel', reference: '.server-quick-command-reference' },
  { name: 'auto', origin: process.env.AUTO_TEST_ORIGIN || 'http://127.0.0.1:6909', route: '/', panel: '.management-message', reference: '.management-quick-command-reference' },
];

async function run(browser, target) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const servers = [makeServer('mushroom', '蘑菇服务器'), makeServer('yeti', '雪人服务器')];
  const errors = [];
  const sent = [];
  const accountActions = [];
  const connection = { available: true, overviewFails: false };
  let fail = false;
  let offline = false;
  let delivery = 'success';
  let overviews = 0;
  let holdSend = false;
  let releaseSend;
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;
    if (!pathname.startsWith('/api/')) return route.continue();
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (pathname.endsWith('/auth/me')) return reply({
      id: 'test', username: 'test', displayName: '测试管理员', role: 'super_admin', active: true,
      workspacePermissions: { 'server-operations': true },
    });
    if (pathname.endsWith('/operator/me')) return reply({ user: { username: 'test' }, must_change: false, expires_at: '2099-01-01T00:00:00Z' });
    if (pathname.endsWith('/options')) return reply({ servers: servers.map((s) => ({ id: s.id, displayName: s.name })), reasons: [], operations: [], commandRuleVersion: 'fixture' });
    if (pathname.endsWith('/workspace-counts')) return reply({});
    if (pathname.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': fixture\n\n' });
    if (pathname.endsWith('/logs')) return reply({ logs: [] });
    if (pathname.endsWith('/player-integration/status')) return reply({ enabled: false, mode: 'local', activeEndpoint: '', endpoints: { local: { configured: false, available: null }, remote: { configured: false, available: null } } });
    if (pathname.endsWith('/auto/status')) return reply({ enabled: true, configured: true, available: connection.available, endpoint: 'http://127.0.0.1:26909' });
    if (pathname.endsWith('/overview')) {
      overviews++;
      if (connection.overviewFails) return reply(target.name === 'main' ? { error: { code: 'endpoint-unavailable', message: '测试连接中断' } } : { error: 'service_unavailable' }, 503);
      return reply({ fetched_at: new Date().toISOString(), sessions: [], logs: [], servers: servers.map((server) => ({ ...server, accounts: server.accounts.map((item) => ({ ...item, status: offline ? 'offline' : item.enabled ? item.status : 'disabled' })) })) });
    }
    if (pathname.includes('/accounts/a-fixture') && (request.method() === 'PATCH' || /\/(start|stop)$/.test(pathname))) {
      const stored = servers[0].accounts[0];
      const body = request.postDataJSON();
      accountActions.push({ path: pathname, body });
      if (request.method() === 'PATCH') { assert.deepEqual(Object.keys(body), ['automation_enabled']); stored.automation_enabled = body.automation_enabled; }
      else stored.enabled = pathname.endsWith('/start');
      return reply({ ...stored, status: stored.enabled ? 'online' : 'disabled' });
    }
    if (pathname.endsWith('/message') && request.method() === 'POST') {
      sent.push({ path: pathname, body: request.postDataJSON() });
      if (holdSend) await new Promise((resolve) => { releaseSend = resolve; });
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (fail) return reply(target.name === 'main' ? { error: { code: 'endpoint-unavailable', message: '测试失败' } } : { error: 'test_failure' }, 502);
      assert.equal(servers[0].accounts[0].enabled, true, 'manual send requires login');
      return reply({ result: { status: 'server_response_received', game_server_status: delivery, delivery_status: delivery, message: '已收到', server_response: '测试服务器响应', game_server_response_latency_ms: 36 }, auto_process: { latency_ms: 18, status: 'success' }, account: servers[0].accounts[0] });
    }
    errors.push(`Unexpected API: ${request.method()} ${pathname}`);
    return reply({ error: 'unexpected_fixture_request' }, 500);
  });
  try {
    await page.goto(target.origin + target.route);
    if (target.name === 'main') await page.getByRole('tab', { name: '游戏服务器' }).click();
    else await page.getByRole('button', { name: '服务器管理', exact: true }).click();
    const panel = page.locator(target.panel);
    await panel.waitFor();
    await checkServerListStatus(page, target, servers, connection);
    await checkAccountControls(page, panel, target, servers[0].accounts[0], accountActions);
    assert.equal(await panel.getByRole('heading', { name: 'GM 消息与快捷指令', exact: true }).count(), 1);
    assert.equal(await panel.getByRole('spinbutton').count(), 6);
    assert.equal(await panel.getByRole('spinbutton', { name: '持续分钟数', exact: true }).inputValue(), '999999');
    assert(!(await panel.innerText()).includes('上限'));
    assert(!(await panel.innerText()).includes('参考'), 'configuration captions should omit reference wording');
    assert.equal(await panel.getByText('当前服务器配置', { exact: true }).count(), 1);
    assert(!(await panel.innerText()).includes('\uFFFD'));

    const form = (label) => panel.getByRole('form', { name: `${label}快捷指令`, exact: true });
    const spawn = form('怪物数量');
    const exp = form('经验倍率');
    const dialog = page.getByRole('dialog', { name: '确认发送？', exact: true });
    const screenshots = path.join(os.tmpdir(), 'mxd-quick-command-checks');
    fs.mkdirSync(screenshots, { recursive: true });
    const openConfirmation = async (button, message, channel = '私聊') => {
      const count = sent.length;
      await button.click();
      await dialog.waitFor();
      assert.equal(sent.length, count, 'opening confirmation must not send');
      const details = await dialog.locator('dl').innerText();
      for (const value of ['蘑菇服务器', '127.0.0.1:12660', '测试GM', '测试角色', '265', channel]) assert(details.includes(value));
      assert.equal(await dialog.getByLabel('待发送内容', { exact: true }).innerText(), message);
      assert(await dialog.getByRole('button', { name: '取消', exact: true }).evaluate((element) => document.activeElement === element));
    };
    const confirm = async () => {
      await dialog.getByRole('button', { name: '确认发送', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    };
    const checkCompactRows = async () => {
      for (const row of await panel.getByRole('form', { name: /快捷指令$/ }).all()) {
        assert((await row.boundingBox()).height <= 100, 'each normal card should fit two compact rows');
        const controls = await row.locator('input, button').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));
        assert(Math.max(...controls) - Math.min(...controls) <= 2, `inputs and buttons should share one row: ${controls.join(', ')}`);
      }
    };
    await checkCompactRows();
    const input = (label) => panel.getByRole('spinbutton', { name: label, exact: true });
    await input('怪物数量倍率').fill('7');
    assert((await spawn.locator(target.reference).innerText()).includes('2'));
    const previous = overviews;
    servers[0].spawn_rate = 4;
    await spawn.locator(target.reference).filter({ hasText: '4 倍' }).waitFor();
    assert(overviews > previous);
    assert.equal(await input('怪物数量倍率').inputValue(), '7', 'polling must preserve drafts');
    await spawn.getByRole('button', { name: '恢复当前配置' }).click();
    assert.equal(await input('怪物数量倍率').inputValue(), '4');
    await input('怪物数量倍率').fill('7');

    await page.getByRole('button', { name: /雪人服务器/ }).filter({ has: page.locator('strong') }).first().click();
    assert.equal(await input('怪物数量倍率').inputValue(), '2', 'server switch must not reuse another draft');
    await page.getByRole('button', { name: /蘑菇服务器/ }).filter({ has: page.locator('strong') }).first().click();
    assert.equal(await input('怪物数量倍率').inputValue(), '4');
    assert.equal(sent.length, 0, 'edits, polling, reset and server switching must never send commands');

    if (target.name === 'main') await panel.getByRole('radio', { name: '世界', exact: true }).click();
    else await panel.getByLabel('消息类型', { exact: true }).selectOption('world');
    await panel.getByPlaceholder('输入自定义 GM 消息').fill('保留我的自定义消息');
    const spawnSend = spawn.getByRole('button', { name: '发送怪物数量', exact: true });
    await input('怪物数量倍率').fill('7');
    for (const close of ['取消', '关闭确认', 'Escape']) {
      await openConfirmation(spawnSend, 'spawnrate@7');
      if (close === 'Escape') await page.keyboard.press('Escape');
      else await dialog.getByRole('button', { name: close, exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      assert.equal(sent.length, 0, `${close} must not send`);
      assert.equal(await input('怪物数量倍率').inputValue(), '7');
      assert(await spawnSend.evaluate((element) => document.activeElement === element), 'cancel restores focus');
    }
    const cases = [
      ['怪物数量', [['怪物数量倍率', '7']], 'spawnrate@7'],
      ['经验倍率', [['经验倍率', '2'], ['持续分钟数', '60']], 'exp@2@60'],
      ['爆率/掉落', [['掉落倍率', '8']], 'droprate@8'],
      ['金币倍率', [['金币倍率', '6']], 'mesorate@6'],
      ['副本次数', [['副本次数', '9']], 'domaintimes@9'],
    ];
    for (const [label, values, message] of cases) {
      for (const [field, value] of values) await input(field).fill(value);
      const button = form(label).getByRole('button', { name: `发送${label}`, exact: true });
      const count = sent.length;
      await openConfirmation(button, message);
      if (label === '经验倍率') await page.screenshot({ path: path.join(screenshots, `${target.name}-confirmation-desktop.png`) });
      await confirm();
      await page.waitForFunction(() => document.body.innerText.includes('测试服务器响应'));
      await button.waitFor({ state: 'visible' });
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].some((item) => item.textContent === '发送中…'));
      assert.equal(sent.length, count + 1);
      assert.deepEqual(sent.at(-1).body, { message, mode: 'privateChat' });
      assert(sent.at(-1).path.includes('/servers/mushroom/accounts/a-fixture/message'));
    }
    await checkMessageResult(page, panel, target, screenshots);
    assert.equal(await panel.getByPlaceholder('输入自定义 GM 消息').inputValue(), '保留我的自定义消息');
    assert((await exp.locator(target.reference).innerText()).includes('999999 分钟'));
    assert.equal(await input('持续分钟数').inputValue(), '60');

    const customSend = panel.getByRole('button', { name: '发送消息', exact: true });
    await openConfirmation(customSend, '保留我的自定义消息', '世界');
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await panel.getByPlaceholder('输入自定义 GM 消息').inputValue(), '保留我的自定义消息');
    await openConfirmation(customSend, '保留我的自定义消息', '世界');
    holdSend = true;
    const customCount = sent.length;
    await dialog.getByRole('button', { name: '确认发送', exact: true }).evaluate((button) => { button.click(); button.click(); });
    await page.waitForFunction(() => document.querySelector('dialog .primary-button')?.textContent === '发送中…');
    assert(await dialog.getByRole('button', { name: '发送中…', exact: true }).isDisabled());
    assert(await dialog.getByRole('button', { name: '取消', exact: true }).isDisabled());
    await page.keyboard.press('Escape');
    assert(await dialog.isVisible(), 'pending sends cannot dismiss confirmation');
    while (!releaseSend) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(sent.length, customCount + 1, 'duplicate confirmation must send once');
    releaseSend(); releaseSend = undefined; holdSend = false;
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(sent.at(-1).body, { message: '保留我的自定义消息', mode: 'world' });
    assert.equal(await panel.getByPlaceholder('输入自定义 GM 消息').inputValue(), '');

    const count = sent.length;
    for (const invalid of ['', '0', '-1', '1.5', '9007199254740992']) {
      await input('持续分钟数').fill(invalid);
      await exp.getByRole('button', { name: '发送经验倍率', exact: true }).click();
      assert.equal(await exp.getByRole('alert').innerText(), '请输入大于 0 的整数');
      assert.equal(sent.length, count);
      assert.equal(await dialog.count(), 0, 'invalid parameters must not open confirmation');
    }
    await input('持续分钟数').fill('120');
    fail = true;
    await openConfirmation(exp.getByRole('button', { name: '发送经验倍率', exact: true }), 'exp@2@120');
    await confirm();
    await panel.getByText('发送失败，请重试', { exact: true }).waitFor();
    assert.equal(await input('持续分钟数').inputValue(), '120');
    fail = false;
    delivery = 'unknown';
    await openConfirmation(exp.getByRole('button', { name: '发送经验倍率', exact: true }), 'exp@2@120');
    await confirm();
    await page.waitForFunction(() => document.body.innerText.includes('未确认'));
    assert((await exp.locator(target.reference).innerText()).includes('999999 分钟'), 'unknown delivery must not change references');
    await openConfirmation(exp.getByRole('button', { name: '发送经验倍率', exact: true }), 'exp@2@120');
    const beforeOffline = sent.length;
    offline = true;
    await page.waitForFunction((selector) => document.querySelector(selector + ' button[aria-label="发送经验倍率"]')?.disabled, target.panel);
    await confirm();
    await panel.getByText('目标服务器或账号状态已变化，请重新确认后发送', { exact: true }).waitFor();
    assert.equal(sent.length, beforeOffline, 'offline target must require a fresh confirmation');
    assert(await exp.getByRole('button', { name: '发送经验倍率' }).isDisabled());
    await input('持续分钟数').fill('180');
    await panel.screenshot({ path: path.join(screenshots, `${target.name}-desktop.png`) });
    await page.setViewportSize({ width: 375, height: 844 });
    if (target.name === 'main') await page.locator('.sidebar').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await panel.scrollIntoViewIfNeeded();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile must not overflow');
    await checkCompactRows();
    await panel.screenshot({ path: path.join(screenshots, `${target.name}-mobile.png`) });
    offline = false;
    await page.waitForFunction((selector) => !document.querySelector(selector + ' button[aria-label="发送经验倍率"]')?.disabled, target.panel);
    const longMessage = '请核对参数与服务器'.repeat(50);
    await panel.getByPlaceholder('输入自定义 GM 消息').fill(longMessage);
    await openConfirmation(customSend, longMessage, '世界');
    const bounds = await dialog.boundingBox();
    assert(bounds.x >= 0 && bounds.x + bounds.width <= 375 && bounds.y >= 0 && bounds.y + bounds.height <= 844, 'mobile dialog must fit viewport');
    assert(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'long messages must wrap');
    await page.screenshot({ path: path.join(screenshots, `${target.name}-confirmation-mobile.png`) });
    await page.keyboard.press('Escape');
    assert.equal(await panel.getByPlaceholder('输入自定义 GM 消息').inputValue(), longMessage);
    assert.deepEqual(errors, []);
    console.log(`${target.name}: 5 commands, confirmation/cancel/Escape, duplicate protection, custom channels, changed targets, validation, failures and mobile passed; screenshots: ${screenshots}`);
  } catch (error) {
    console.error(target.name, errors, (await page.locator('body').innerText()).slice(0, 1800));
    throw error;
  } finally {
    releaseSend?.();
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try { for (const target of targets) await run(browser, target); }
  finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
