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
      const server = { id: 'mushroom', displayName: 'Test server' };
      const groups = ['101', '102', '103', '104'].map((id, index) => ({
        id, characterId: id, server, reason: { code: 'test', text: 'Test request' },
        operations: [{ type: 'kick' }], status: 'approved',
        submittedAt: `2026-09-09T00:00:0${4 - index}Z`,
        submittedBy: { id: 'customer', displayName: 'Customer' },
        commands: [{ operationIndex: 0, sequence: 1, text: `kick ${id}` }],
      }));
      Object.assign(groups[1], { reminderCount: 1, lastRemindedAt: '2026-09-09T01:00:00Z' });
      let fail = false;
      let sequence = 1;
      await page.route('**/api/v1/**', async route => {
        const url = new URL(route.request().url());
        let body = {};
        if (url.pathname.endsWith('/auth/me')) body = { id: 'admin', role: 'super_admin', displayName: 'Admin' };
        else if (url.pathname.endsWith('/options')) body = { servers: [server], reasons: [], operations: [] };
        else if (url.pathname.endsWith('/archive')) body = url.searchParams.has('cursor')
          ? { groups: groups.slice(3), nextCursor: null }
          : { groups: groups.slice(0, 3), nextCursor: 'next' };
        else if (url.pathname.endsWith('/remind')) {
          if (fail) { await route.fulfill({ status: 500, json: { error: { code: 'test-error', message: 'Reminder failed' } } }); return; }
          const group = groups.find(group => url.pathname.endsWith(`/${group.id}/remind`));
          group.reminderCount = (group.reminderCount || 0) + 1;
          group.lastRemindedAt = `2026-09-09T02:00:0${sequence++}Z`;
          body = group;
        } else if (url.pathname.endsWith('/events')) {
          await route.fulfill({ contentType: 'text/event-stream', body: ': ready\n\n' }); return;
        }
        await route.fulfill({ json: body });
      });
      const row = id => page.locator('.manager-record').filter({ has: page.locator('.record-character code', { hasText: id }) });
      const reminder = id => row(id).locator('.record-action-button').first();
      const order = () => page.locator('.manager-record .record-character code').allTextContents();
      const waitOrder = ids => page.waitForFunction(expected =>
        JSON.stringify([...document.querySelectorAll('.manager-record .record-character code')].map(el => el.textContent)) === JSON.stringify(expected), ids);
      await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/ready`);
      await waitOrder(['101', '103', '102']);
      const originalColor = await reminder('101').evaluate(el => getComputedStyle(el).backgroundColor);
      await reminder('101').click();
      await waitOrder(['103', '102', '101']);
      assert.match(await reminder('101').getAttribute('class'), /reminded/);
      assert.notEqual(await reminder('101').evaluate(el => getComputedStyle(el).backgroundColor), originalColor);
      await page.reload();
      await waitOrder(['103', '102', '101']);
      await reminder('102').click();
      await waitOrder(['103', '101', '102']);
      assert.equal(groups[1].reminderCount, 2);
      fail = true;
      await reminder('103').click();
      await page.getByRole('alert').waitFor();
      assert.deepEqual(await order(), ['103', '101', '102']);
      assert.doesNotMatch(await reminder('103').getAttribute('class'), /reminded/);
      await page.getByRole('button', { name: '\u52a0\u8f7d\u66f4\u591a', exact: true }).click();
      await waitOrder(['103', '104', '101', '102']);
      await page.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-ready-reminders-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px: reminder color, bottom placement, reload, repeat, failure, pagination, no overflow`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
