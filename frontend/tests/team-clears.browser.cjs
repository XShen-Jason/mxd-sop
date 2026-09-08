const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      const errors = [];
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      let imported = false;
      let role = 'super_admin';
      const servers = [{ id: 'mushroom', displayName: '蘑菇仔' }, { id: 'yeti', displayName: '雪吉拉' }];
      await page.route('**/api/v1/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        let body = {};
        if (url.pathname.endsWith('/auth/me')) body = { id: 'test', role, displayName: '测试账号' };
        else if (url.pathname.endsWith('/options')) body = { servers, reasons: [], operationTypes: [] };
        else if (url.pathname.endsWith('/clears/import')) {
          const payload = request.postDataJSON();
          assert.equal(payload.serverId, 'mushroom');
          assert.match(payload.file.content, /8\/9\/2026/);
          imported = true;
          body = { serverId: 'mushroom', dates: ['2026-09-08'], rowCount: 3, skippedRows: 0, importedAt: new Date().toISOString() };
        } else if (url.pathname.endsWith('/team-view')) {
          const date = url.searchParams.get('date');
          const cleared = imported && date === '2026-09-08';
          body = { date, fetchedAt: '2026-09-08T00:05:00Z', sourceStatus: 'ready', servers: servers.map(server => ({ server, types: ['black-dragon', 'zakum'].map(type => ({
            type, displayName: type === 'zakum' ? '进阶扎昆' : '黑龙', teams: [{ id: `${server.id}-${type}`, sequence: 1, memberCount: 2, members: ['17', '193'],
              clearedMembers: cleared && server.id === 'mushroom' ? type === 'zakum' ? ['17'] : ['17', '193'] : [], cleared: cleared && server.id === 'mushroom' && type === 'black-dragon' }],
          })) })) };
        } else if (url.pathname.endsWith('/events')) { await route.fulfill({ contentType: 'text/event-stream', body: ': ready\n\n' }); return; }
        await route.fulfill({ json: body });
      });
      await page.goto('http://127.0.0.1:5173/team-view');
      const fileInput = page.getByLabel('通关 CSV');
      await fileInput.waitFor({ state: 'attached' });
      assert.equal(await fileInput.isDisabled(), true);
      await page.getByLabel('通关服务器').selectOption('mushroom');
      await fileInput.setInputFiles(path.resolve('data/player-directory/source/9-8.csv'));
      await page.getByRole('button', { name: '上传通关列表', exact: true }).click();
      await page.locator('.team-cleared').waitFor();
      assert.equal(await page.locator('input[type=date]').inputValue(), '2026-09-08');
      assert.equal(await page.locator('.team-cleared').count(), 1);
      assert.equal(await page.locator('.character-cleared').count(), 3);
      assert.equal(await page.getByRole('heading', { name: '进阶扎昆', exact: true }).count(), 1);
      await page.screenshot({ path: path.join(os.tmpdir(), `mxdcmd-team-clears-${width}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
      await page.locator('input[type=date]').fill('2026-09-09');
      await page.waitForFunction(() => !document.querySelector('.team-cleared') && !document.querySelector('.spin'));
      assert.equal(await page.locator('.character-cleared').count(), 0);
      await page.reload();
      await page.locator('input[type=date]').fill('2026-09-08');
      await page.locator('.team-cleared').waitFor();
      role = 'customer';
      await page.reload();
      await page.locator('.team-server-filter-row').waitFor();
      assert.equal(await page.getByLabel('通关服务器').count(), 0);
      assert.deepEqual(errors, []);
      await page.close();
      console.log(`PASS ${width}px: upload gating, date navigation, partial/full highlights, reload, role access, no overflow or browser errors`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
