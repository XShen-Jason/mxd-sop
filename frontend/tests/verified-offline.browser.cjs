const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const server = { id: 'mushroom', displayName: '蘑菇' };
      const group = { id: 'offline-cash', characterId: '1852', server, account: 'player', playerQQ: '123456',
        reason: { code: 'compensation', text: '补偿' }, operations: [{ type: 'cash', quantity: 10 }], status: 'approved',
        submittedAt: '2026-09-27T00:00:00Z', submittedBy: { id: 'admin', displayName: 'Admin' },
        executionNote: 'auto 已写入指令但未收到游戏服回执，请核实后再处理，禁止直接重发',
        commands: [{ operationIndex: 0, sequence: 0, text: 'cashid@1852@10' }] };
      let fail = true;
      let verificationRequests = 0;
      let onlineRequests = 0;
      await page.route('**/api/v1/**', async route => {
        const url = new URL(route.request().url());
        let body = {};
        if (url.pathname.endsWith('/auth/me')) body = { id: 'admin', role: 'super_admin', displayName: 'Admin' };
        else if (url.pathname.endsWith('/options')) body = { servers: [server], reasons: [], operations: [] };
        else if (url.pathname.endsWith('/archive')) body = { groups: [group], nextCursor: null };
        else if (url.pathname.endsWith('/reminders')) body = { groups: group.reminderCount ? [group] : [], nextCursor: null };
        else if (url.pathname.endsWith('/remind')) {
          verificationRequests++;
          assert.deepEqual(route.request().postDataJSON(), { verifiedOffline: true });
          if (fail) {
            await route.fulfill({ status: 500, json: { error: { code: 'test-error', message: '核实保存失败' } } });
            return;
          }
          Object.assign(group, { reminderCount: 1, lastRemindedAt: '2026-09-27T01:00:00Z', executionNote: '已核实玩家不在线' });
          body = group;
        } else if (url.pathname.endsWith('/online')) { onlineRequests++; body = group; }
        else if (url.pathname.endsWith('/workspace-counts')) body = { reminders: group.reminderCount || 0, reminderIssuance: group.reminderCount || 0 };
        else if (url.pathname.endsWith('/events')) {
          await route.fulfill({ contentType: 'text/event-stream', body: ': ready\n\n' }); return;
        }
        await route.fulfill({ json: body });
      });
      await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/ready`);
      const verify = page.getByRole('button', { name: '已核实玩家不在线', exact: true });
      await verify.waitFor();
      assert.equal(await verify.isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (width < 900) {
        const time = await page.locator('.manager-record .record-time').boundingBox();
        const action = await verify.boundingBox();
        assert(action.y >= time.y + time.height, 'verification action must not crowd the submission time');
      }
      await page.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-offline-action-${width}.png`), fullPage: true });
      await verify.click();
      await page.getByRole('alert').waitFor();
      assert.equal(await verify.isEnabled(), true);
      assert.equal(group.reminderCount, undefined);
      fail = false;
      await verify.click();
      await page.getByRole('button', { name: '再次提醒', exact: true }).waitFor();
      assert.equal(await page.locator('.record-delivery-warning').count(), 0);
      assert.equal(verificationRequests, 2);
      assert.equal(onlineRequests, 0, 'verification must not send commands');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-verified-offline-${width}.png`), fullPage: true });
      await page.reload();
      await page.getByRole('button', { name: '再次提醒', exact: true }).waitFor();
      await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/reminders`);
      await page.locator('.record-character code', { hasText: '1852' }).waitFor();
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px: offline verification, save failure, reminder placement, reload, no immediate retry`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
