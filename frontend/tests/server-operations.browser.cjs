const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';

function makeUser() {
  return {
    id: 'browser-test',
    username: 'browser-test',
    role: 'super_admin',
    displayName: 'Browser Test',
    active: true,
    createdAt: '2026-09-13T00:00:00Z',
    workspacePermissions: {
      request: true, records: true, reminders: true, queue: true, ready: true,
      reissue: true, archive: true, activities: true, 'player-directory': true,
      'team-view': true, accounts: true, 'server-operations': true,
    },
  };
}

function makeServer(address = '45.117.11.230:12660', accounts = []) {
  return {
    id: 'mushroom', name: 'Mushroom Server', address, version: '1.0.2',
    map_id: '211000000', enabled: true, keyless_probe_enabled: false, accounts,
  };
}

function makeAccount(overrides = {}) {
  return {
    id: 'account-1', server_id: 'mushroom', username: 'ops-account',
    character_id: '265', character_name: 'Galaxy', enabled: true,
    status: 'online', updated_at: '2026-09-15T00:00:00Z', ...overrides,
  };
}

function makeSetupSession(overrides = {}) {
  return {
    id: 'setup-session-1', server_id: 'mushroom', state: 'logged_in',
    roles: [{ id: '265', name: 'Galaxy', map_id: '211000000', opaque_available: true }, { id: '266', name: 'Nova', map_id: '211000000', opaque_available: true }],
    sent_messages: 0, chat_success_count: 0, chat_failure_count: 0, chat_unknown_count: 0,
    created_at: '2026-09-15T00:00:00Z', updated_at: '2026-09-15T00:00:00Z', ...overrides,
  };
}

async function runViewport(browser, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  let server = null;
  let account = null;
  let setupSession = null;
  let autoAvailable = true;
  let playerConnectionEnabled = true;
  let autoConnectionEnabled = true;
  let transitionOnNextOverview = false;
  let overviewRequests = 0;
  let statusRequests = 0;
  let accountStartRequests = 0;
  let accountStopRequests = 0;
  let accountDeleteRequests = 0;
  let accountReconnectRequests = 0;
  let setupSessionDeleteRequests = 0;
  let messageRequests = 0;
  let serverUpdateRequests = 0;
  let serverDeleteRequests = 0;
  let playerConnectionRequests = 0;
  let autoConnectionRequests = 0;

  page.on('pageerror', (error) => errors.push(error.message));

  const overview = () => {
    overviewRequests += 1;
    if (account && transitionOnNextOverview) {
      transitionOnNextOverview = false;
      return { fetched_at: new Date().toISOString(), servers: [{ ...server, accounts: [{ ...account, status: 'connecting' }] }], sessions: [], logs: [] };
    }
    if (account && account.status === 'connecting') account = { ...account, status: 'online' };
    const currentServer = server ? { ...server, accounts: account ? [{ ...account }] : [] } : null;
    return { fetched_at: new Date().toISOString(), servers: currentServer ? [currentServer] : [], sessions: setupSession ? [setupSession] : [], logs: [] };
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const { pathname } = url;
    let body = {};

    if (pathname.endsWith('/auth/me')) {
      body = makeUser();
    } else if (pathname.endsWith('/options')) {
      body = {
        servers: [
          { id: 'mushroom', displayName: 'Mushroom Server' },
          { id: 'yeti', displayName: 'Yeti Server' },
          { id: 'piaopiao-pig', displayName: 'Piaopiao Pig' },
        ],
        reasons: [], operations: [], commandRuleVersion: 'browser-test',
      };
    } else if (pathname.endsWith('/workspace-counts')) {
      body = {};
    } else if (pathname.endsWith('/events')) {
      await route.fulfill({ contentType: 'text/event-stream', body: ': ready\n\n' });
      return;
    } else if (pathname.endsWith('/player-integration/status')) {
      body = {
        enabled: playerConnectionEnabled, mode: 'local', activeEndpoint: 'http://127.0.0.1:26906',
        endpoints: {
          local: { configured: true, available: playerConnectionEnabled ? true : null },
          remote: { configured: false, available: null },
        }, checkedAt: new Date().toISOString(),
      };
    } else if (pathname.endsWith('/player-integration/connection') && request.method() === 'POST') {
      const payload = request.postDataJSON();
      assert.equal(payload.confirmation, 'CHANGE PLAYER CONNECTION');
      playerConnectionRequests += 1;
      playerConnectionEnabled = payload.enabled;
      body = { enabled: playerConnectionEnabled };
    } else if (pathname.endsWith('/auto/status')) {
      statusRequests += 1;
      body = {
        enabled: autoConnectionEnabled, endpoint: 'http://127.0.0.1:26909', configured: true,
        available: autoConnectionEnabled ? autoAvailable : null, checkedAt: new Date().toISOString(),
      };
    } else if (pathname.endsWith('/auto/connection') && request.method() === 'POST') {
      const payload = request.postDataJSON();
      assert.equal(payload.confirmation, 'CHANGE AUTO CONNECTION');
      autoConnectionRequests += 1;
      autoConnectionEnabled = payload.enabled;
      body = { enabled: autoConnectionEnabled };
    } else if (pathname.endsWith('/auto/overview')) {
      body = overview();
    } else if (pathname === '/api/v1/auto/servers/mushroom/sessions' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      assert.deepEqual(payload, { account: 'ops-account', password: 'secret' });
      setupSession = makeSetupSession();
      body = setupSession;
    } else if (pathname === '/api/v1/auto/sessions/setup-session-1/select-and-enter' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      assert.deepEqual(payload, { character_id: '266' });
      setupSession = makeSetupSession({ state: 'ready', character_id: '266' });
      body = setupSession;
    } else if (pathname === '/api/v1/auto/sessions/setup-session-1' && request.method() === 'DELETE') {
      setupSessionDeleteRequests += 1;
      setupSession = null;
      await route.fulfill({ status: 204 });
      return;
    } else if (pathname === '/api/v1/auto/servers' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      assert.deepEqual(payload, {
        id: 'mushroom', name: 'Mushroom Server', address: '45.117.11.230:12660',
        version: '1.0.2', map_id: '211000000', enabled: true,
      });
      server = makeServer(payload.address);
      body = server;
    } else if (pathname === '/api/v1/auto/servers/mushroom' && request.method() === 'PATCH') {
      const payload = request.postDataJSON();
      serverUpdateRequests += 1;
      assert.deepEqual(payload, { name: 'Mushroom Server', address: '45.117.11.231:12661', version: '1.0.3' });
      server = { ...server, ...payload };
      body = server;
    } else if (pathname === '/api/v1/auto/servers/mushroom' && request.method() === 'DELETE') {
      serverDeleteRequests += 1;
      server = null;
      account = null;
      await route.fulfill({ status: 204 });
      return;
    } else {
      const match = pathname.match(/^\/api\/v1\/auto\/servers\/([^/]+)\/accounts(?:\/([^/]+)(?:\/([^/]+))?)?$/u);
      if (match && match[1] === 'mushroom') {
        const accountId = match[2];
        const action = match[3];
        if (!accountId && request.method() === 'GET') {
          body = { accounts: account ? [{ ...account }] : [] };
        } else if (!accountId && request.method() === 'POST') {
          const payload = request.postDataJSON();
          assert.deepEqual(payload, {
            username: 'ops-account', password: 'secret', character_id: '266',
            character_name: 'Nova', enabled: true, session_id: 'setup-session-1',
          });
          account = makeAccount({ character_id: '266', character_name: 'Nova', status: 'connecting', session_id: 'setup-session-1', session: setupSession });
          transitionOnNextOverview = true;
          body = account;
        } else if (accountId === 'account-1' && !action && request.method() === 'PATCH') {
          const payload = request.postDataJSON();
          assert.deepEqual(payload, {
            username: 'edited-account', password: 'new-secret', character_id: '266',
            character_name: 'Edited', enabled: true,
          });
          account = { ...account, ...payload, status: 'connecting' };
          transitionOnNextOverview = true;
          body = account;
        } else if (accountId === 'account-1' && !action && request.method() === 'DELETE') {
          accountDeleteRequests += 1;
          account = null;
          await route.fulfill({ status: 204 });
          return;
        } else if (accountId === 'account-1' && action === 'start' && request.method() === 'POST') {
          accountStartRequests += 1;
          account = { ...account, enabled: true, status: 'connecting' };
          transitionOnNextOverview = true;
          body = account;
        } else if (accountId === 'account-1' && action === 'stop' && request.method() === 'POST') {
          accountStopRequests += 1;
          account = { ...account, enabled: false, status: 'disabled' };
          body = account;
        } else if (accountId === 'account-1' && action === 'reconnect' && request.method() === 'POST') {
          accountReconnectRequests += 1;
          account = { ...account, enabled: true, status: 'connecting' };
          transitionOnNextOverview = true;
          body = account;
        } else if (accountId === 'account-1' && action === 'message' && request.method() === 'POST') {
          const payload = request.postDataJSON();
          messageRequests += 1;
          assert.equal(payload.mode, payload.message === 'World announcement' ? 'world' : 'privateChat');
          body = {
            result: {
              status: 'server_response_received', message: 'accepted', delivery_status: 'success',
              server_response: `server response for ${payload.message}`,
              server_response_type: 'system_event', server_response_observed: true,
              server_response_code: 0, server_event: 20,
              connection_mode: 'authenticated_connection', game_server_response_latency_ms: 36,
              game_server_status: 'success',
            },
            auto_process: { latency_ms: 18, status: 'success' },
            account,
          };
        } else {
          throw new Error(`Unhandled auto request: ${request.method()} ${pathname}`);
        }
      } else {
        throw new Error(`Unhandled API request: ${request.method()} ${pathname}`);
      }
    }
    await route.fulfill({ json: body });
  });

  await page.goto(`${baseUrl}/server-operations`);
  await page.locator('.server-operations-workspace').waitFor();
  assert.equal(await page.locator('.service-directory-item').count(), 2);
  assert.equal(await page.locator('.service-directory-item.category-automation').count(), 0);

  const playerConnectionToggle = page.locator('.service-directory-item.category-player .service-connection-toggle input');
  await playerConnectionToggle.waitFor({ state: 'attached' });
  await page.waitForFunction(() => !document.querySelector('.service-directory-item.category-player .service-connection-toggle input')?.disabled);
  assert.equal(await playerConnectionToggle.isChecked(), true);
  await playerConnectionToggle.click();
  await page.locator('.action-dialog .danger-primary').click();
  await page.locator('.service-connections.health-disabled').waitFor();
  assert.equal(playerConnectionRequests, 1);
  assert.equal(await playerConnectionToggle.isChecked(), false);
  await playerConnectionToggle.click();
  await page.locator('.action-dialog .primary-button').click();
  await page.locator('.service-connections.health-healthy').waitFor();
  assert.equal(playerConnectionRequests, 2);

  await page.locator('.service-directory-item.category-game .service-directory-select').click();
  await page.locator('.game-server-workspace').waitFor();
  await page.locator('.automation-service-settings.health-healthy').waitFor();

  const autoConnectionToggle = page.locator('.service-directory-item.category-game .service-connection-toggle input');
  await autoConnectionToggle.click();
  await page.locator('.action-dialog .danger-primary').click();
  await page.locator('.server-connection-paused').waitFor();
  const overviewBeforePause = overviewRequests;
  await page.waitForTimeout(2_200);
  assert.equal(overviewRequests, overviewBeforePause);
  assert.equal(autoConnectionRequests, 1);
  await autoConnectionToggle.click();
  await page.locator('.action-dialog .primary-button').click();
  await page.locator('.automation-service-settings.health-healthy').waitFor();
  assert.equal(autoConnectionRequests, 2);
  assert.equal(statusRequests >= 1, true);
  assert.deepEqual(await page.locator('.automation-service-settings .service-mode-card-main strong').allTextContents(), ['本地服务', '远程服务']);

  autoAvailable = false;
  await page.locator('.automation-service-settings .service-mode-refresh').click();
  await page.locator('.automation-service-settings.health-unavailable').waitFor();
  autoAvailable = true;
  await page.locator('.automation-service-settings .service-mode-refresh').click();
  await page.locator('.automation-service-settings.health-healthy').waitFor();

  await page.locator('.server-configure-button:not([disabled])').click();
  const setup = page.locator('.server-dialog');
  await setup.locator('select').selectOption('piaopiao-pig');
  assert.equal(await setup.locator('input[placeholder="1.0.2"]').inputValue(), '1.0.3');
  await setup.locator('select').selectOption('mushroom');
  assert.equal(await setup.locator('input[placeholder="1.0.2"]').inputValue(), '1.0.2');
  const addressInputs = setup.locator('.tcp-address-grid input');
  await addressInputs.nth(0).fill('45.117.11.230');
  await addressInputs.nth(1).fill('12660');
  await setup.locator('form .primary-button').click();
  await page.locator('.server-list-item').waitFor();
  assert.equal(await page.locator('.server-list-copy').getByText('45.117.11.230:12660', { exact: true }).count(), 1);
  assert.equal(await page.locator('.server-detail-actions button').count(), 0);
  assert.equal(await page.locator('.server-add-account').count(), 1);

  await page.locator('.server-add-account').click();
  const accountDialog = page.locator('.account-setup-dialog');
  await accountDialog.locator('input').nth(0).fill('ops-account');
  await accountDialog.locator('input').nth(1).fill('secret');
  await accountDialog.locator('form .primary-button').click();
  await accountDialog.locator('.character-option').nth(1).waitFor();
  assert.equal(await accountDialog.locator('.character-option').count(), 2);
  await accountDialog.locator('.account-step-panel .secondary-button').click();
  await accountDialog.locator('.server-dialog-form').waitFor();
  assert.equal(setupSessionDeleteRequests, 1);
  await accountDialog.locator('input').nth(0).fill('ops-account');
  await accountDialog.locator('input').nth(1).fill('secret');
  await accountDialog.locator('form .primary-button').click();
  await accountDialog.locator('.character-option').nth(1).waitFor();
  await accountDialog.locator('.character-option').nth(1).click();
  await accountDialog.locator('.account-step-panel .primary-button').click();
  await accountDialog.locator('.account-complete-panel').waitFor();
  await accountDialog.locator('.account-complete-panel .primary-button').click();

  const accountRow = page.locator('.server-account-row');
  await accountRow.locator('.state-online').waitFor({ timeout: 7_000 });
  assert.equal(await accountRow.locator('.server-account-copy strong').textContent(), 'ops-account');
  assert.equal(await accountRow.locator('.server-account-copy small').textContent(), '角色 · Nova · 266');
  assert.equal(overviewRequests >= 2, true);

  const messagePanel = page.locator('.server-message-panel');
  assert.deepEqual(await messagePanel.locator('.message-type-option').allTextContents(), ['私聊', '队伍', '公会', '世界', '所有人']);
  assert.deepEqual(await messagePanel.locator('.message-account-row .message-result-metric strong').allTextContents(), ['—', '—']);
  autoAvailable = false;
  await page.locator('.automation-service-settings .service-mode-refresh').click();
  await page.locator('.automation-service-settings.health-unavailable').waitFor();
  await accountRow.locator('.state-unknown').waitFor();
  assert.equal(await messagePanel.locator('.server-message-actions .primary-button').isDisabled(), true);
  autoAvailable = true;
  await page.locator('.automation-service-settings .service-mode-refresh').click();
  await page.locator('.automation-service-settings.health-healthy').waitFor();
  await accountRow.locator('.state-online').waitFor({ timeout: 7_000 });
  await messagePanel.locator('.message-type-option').nth(3).click();
  await messagePanel.locator('textarea').fill('World announcement');
  await messagePanel.locator('.server-message-actions .primary-button').click();
  await messagePanel.locator('.message-result-panel').waitFor();
  assert.equal(await messagePanel.locator('.message-command-label').textContent(), '普通消息');
  assert.equal(await messagePanel.getByText('server response for World announcement', { exact: true }).count(), 1);
  assert.equal(await messagePanel.locator('.message-delivery-badge').textContent(), '成功');
  assert.equal(await messagePanel.getByText('auto-process 服务响应', { exact: true }).count(), 1);
  assert.equal(await messagePanel.getByText('18 ms', { exact: true }).count(), 1);
  assert.equal(await messagePanel.getByText('36 ms', { exact: true }).count(), 1);
  assert.equal(await messagePanel.getByText('完整内容', { exact: true }).count(), 1);
  assert.equal(await messagePanel.locator('.message-result-explanation').count(), 0);
  assert.equal(await messagePanel.locator('.message-result-details').count(), 0);
  await page.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-server-message-${width}.png`), fullPage: true });

  for (const [command, label] of [
    ['drop@265@100000069@1', 'DROP · 物品发放'],
    ['cashid@265@10', 'CASHID · 点券发放'],
    ['herwarp@265', 'HERWARP · 传送'],
    ['ban@265', 'BAN · 封禁'],
  ]) {
    await messagePanel.locator('.message-type-option').first().click();
    await messagePanel.locator('textarea').fill(command);
    await messagePanel.locator('.server-message-actions .primary-button').click();
    await messagePanel.getByText(`server response for ${command}`, { exact: true }).waitFor();
    assert.equal(await messagePanel.locator('.message-command-label').textContent(), label);
    assert.equal(await messagePanel.getByText(`server response for ${command}`, { exact: true }).count(), 1);
  }
  assert.equal(messageRequests, 5);

  const toggle = accountRow.locator('.account-toggle input');
  await toggle.click();
  const actionDialog = page.locator('.action-dialog');
  await actionDialog.waitFor();
  assert.equal(accountStopRequests, 0);
  await actionDialog.locator('.danger-primary').click();
  await accountRow.locator('.state-disabled').waitFor();
  assert.equal(accountStopRequests, 1);

  await toggle.click();
  await accountRow.locator('.state-online').waitFor({ timeout: 7_000 });
  assert.equal(accountStartRequests, 1);

  account = { ...account, status: 'offline', enabled: true };
  await accountRow.locator('.state-offline').waitFor({ timeout: 7_000 });
  await accountRow.locator('.server-account-row-actions > button').nth(2).click();
  await accountRow.locator('.state-online').waitFor({ timeout: 7_000 });
  assert.equal(accountReconnectRequests, 1);

  await accountRow.locator('.server-account-row-actions > button').first().click();
  const editDialog = page.locator('.account-setup-dialog');
  await editDialog.locator('input').nth(0).fill('edited-account');
  await editDialog.locator('input').nth(1).fill('new-secret');
  await editDialog.locator('form .primary-button').click();
  await editDialog.locator('input').nth(0).fill('266');
  await editDialog.locator('input').nth(1).fill('Edited');
  await editDialog.locator('.account-step-panel .primary-button').click();
  await editDialog.locator('.account-complete-panel .primary-button').click();
  await page.locator('.server-account-copy strong').getByText('edited-account', { exact: true }).waitFor();

  const editedRow = page.locator('.server-account-row');
  await editedRow.locator('.server-account-row-actions > button').nth(1).click();
  await page.locator('.action-dialog').waitFor();
  assert.equal(accountDeleteRequests, 0);
  await page.locator('.action-dialog .secondary-button').click();
  await editedRow.locator('.server-account-row-actions > button').nth(1).click();
  await page.locator('.action-dialog .danger-primary').click();
  await page.locator('.server-detail-account-empty').waitFor();
  assert.equal(await page.locator('.server-detail-account-empty button').count(), 0);
  assert.equal(accountDeleteRequests, 1);

  await page.locator('.server-list-item-actions > button').first().click();
  const serverEditDialog = page.locator('.server-dialog');
  const editAddressInputs = serverEditDialog.locator('.tcp-address-grid input');
  await editAddressInputs.nth(0).fill('45.117.11.231');
  await editAddressInputs.nth(1).fill('12661');
  await serverEditDialog.locator('input[placeholder="1.0.2"]').fill('1.0.3');
  await serverEditDialog.locator('form .primary-button').click();
  await page.locator('.server-list-copy').getByText('45.117.11.231:12661', { exact: true }).waitFor();
  assert.equal(serverUpdateRequests, 1);

  await page.locator('.server-list-item-actions > button').nth(1).click();
  await page.locator('.action-dialog').waitFor();
  assert.equal(serverDeleteRequests, 0);
  await page.locator('.action-dialog .secondary-button').click();
  await page.locator('.server-list-item-actions > button').nth(1).click();
  await page.locator('.action-dialog .danger-primary').click();
  await page.locator('.server-detail-empty').waitFor();
  assert.equal(serverDeleteRequests, 1);
  assert.equal(await page.locator('.server-list-item').count(), 0);

  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-server-operations-${width}.png`), fullPage: true });
  await context.close();
  console.log(`PASS ${width}px: service connection gates, auto polling, server/account CRUD, lifecycle controls, messaging, confirmations, and responsive layout`);
}

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 390]) await runViewport(browser, width);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
