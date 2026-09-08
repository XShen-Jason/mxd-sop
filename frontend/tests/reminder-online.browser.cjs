const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    for (const width of [1440, 1024, 820, 390, 320]) {
      const customer = await browser.newPage({ viewport: { width, height: 900 } });
      const manager = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const pages = [customer, manager];
      const errors = [];
      const server = { id: 'mushroom', displayName: '\u8611\u83c7' };
      const groups = ['101', '102'].map((id, index) => ({ id, characterId: id, account: 'player-account', playerQQ: '123456789',
        server, status: 'approved', reason: { code: 'compensation', text: '\u6d3b\u52a8\u8865\u507f' },
        operations: index ? [{ type: 'kick' }] : [{ type: 'cash', quantity: 10 }],
        submittedBy: { id: 'owner', displayName: 'Owner' }, approvedBy: { id: 'admin', displayName: 'Admin' },
        submittedAt: '2026-09-09T00:00:00Z', reminderCount: 1, lastRemindedAt: '2026-09-09T01:00:00Z',
        commands: [{ operationIndex: 0, sequence: 1, text: `command ${id}` }],
      }));
      let fail = false;
      let onlineRequests = 0;
      for (const page of pages) {
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(() => {
          const sources = [];
          window.EventSource = class extends EventTarget {
            static CLOSED = 2;
            readyState = 1;
            constructor() { super(); sources.push(this); }
            close() { this.readyState = 2; }
          };
          window.changed = detail => sources.filter(source => source.readyState !== 2).forEach(source =>
            source.dispatchEvent(new MessageEvent('changed', { data: JSON.stringify(detail) })));
        });
        await page.route('**/api/v1/**', async route => {
          const url = new URL(route.request().url());
          let body = {};
          if (url.pathname.endsWith('/auth/me')) body = { id: page === customer ? 'owner' : 'admin', role: page === customer ? 'customer' : 'super_admin', displayName: 'Test user' };
          else if (url.pathname.endsWith('/options')) body = { servers: [server], reasons: [], operations: [] };
          else if (url.pathname.endsWith('/archive')) body = { groups, nextCursor: null };
          else if (url.pathname.endsWith('/reminders')) body = { groups: groups.filter(group => group.reminderCount > 0 &&
            (url.searchParams.get('kind') === 'regular' ? group.id === '102' : group.id === '101')), nextCursor: null };
          else if (url.pathname.endsWith('/online') || url.pathname.endsWith('/remind')) {
            const online = url.pathname.endsWith('/online');
            if (online) {
              onlineRequests++;
              await new Promise(resolve => setTimeout(resolve, 150));
              if (fail) { await route.fulfill({ status: 500, json: { error: { code: 'internal-error' } } }); return; }
            }
            const group = groups.find(group => url.pathname.includes(`/${group.id}/`));
            group.reminderCount = online ? 0 : 1;
            if (online) delete group.lastRemindedAt;
            else group.lastRemindedAt = '2026-09-09T02:00:00Z';
            body = group;
            for (const target of pages) await target.evaluate(detail => window.changed(detail), {
              scopes: (target === customer ? ['records', 'reminders'] : ['ready', group.id === '101' ? 'reissue' : 'archive'])
                .map(view => ({ view, serverId: 'mushroom', kind: group.id === '101' ? 'issuance' : 'regular', status: 'approved' })),
              counts: target === customer,
            });
          }
          await route.fulfill({ json: body });
        });
      }
      const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5173';
      await manager.goto(`${base}/ready`);
      await manager.locator('.manager-record').first().waitFor();
      await customer.goto(`${base}/reminders`);
      const onlineButton = () => customer.getByRole('button', { name: '\u7528\u6237\u5df2\u4e0a\u7ebf', exact: true });
      await onlineButton().waitFor();
      await customer.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-reminder-online-${width}.png`), fullPage: true });
      const spacing = await customer.locator('.reminders-table .record-operation').evaluate(el => {
        const parent = el.getBoundingClientRect();
        const buttons = [...el.querySelectorAll('button')].map(button => button.getBoundingClientRect());
        return buttons.every(button => button.left >= parent.left - 1 && button.right <= parent.right + 1)
          && buttons.every((a, i) => buttons.slice(i + 1).every(b =>
            a.bottom <= b.top || b.bottom <= a.top || b.left - a.right >= 7 || a.left - b.right >= 7));
      });
      assert.equal(spacing, true, `${width}px buttons need clear spacing within the action column`);
      assert.equal(await customer.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      fail = true;
      await onlineButton().click();
      assert.equal(await onlineButton().isDisabled(), true);
      await customer.getByRole('alert').waitFor();
      assert.equal(await customer.locator('.reminders-table .record-card').count(), 1);
      fail = false;
      await onlineButton().click();
      await customer.waitForFunction(() => !document.querySelector('.record-online-button'));
      const readyRow = id => manager.locator('.manager-record').filter({ has: manager.locator('.record-character code', { hasText: id }) });
      const remindButton = id => readyRow(id).getByRole('button', { name: '\u63d0\u9192\u4e0a\u7ebf', exact: true });
      await remindButton('101').waitFor();
      assert.equal(groups[0].status, 'approved');
      assert.doesNotMatch(await remindButton('101').getAttribute('class'), /reminded/);
      await remindButton('101').click();
      await onlineButton().waitFor();
      await customer.reload();
      await onlineButton().waitFor();
      await customer.getByRole('button', { name: /\u5e38\u89c4\u64cd\u4f5c/ }).click();
      await customer.locator('.record-character code', { hasText: '102' }).waitFor();
      await onlineButton().click();
      await remindButton('102').waitFor();
      await customer.waitForFunction(() => !document.querySelector('.record-online-button'));
      assert.equal(onlineRequests, 3);
      assert.deepEqual(errors, []);
      for (const page of pages) await page.close();
      console.log(`PASS ${width}px: spacing, disabled state, failure, owner removal, live manager reset, repeat reminder, regular records`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
