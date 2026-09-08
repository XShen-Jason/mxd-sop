const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const assert = require('node:assert/strict');

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH });
  try {
    const page = await browser.newPage();
    const requests = [];
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const sources = [];
      window.EventSource = class extends EventTarget {
        static CLOSED = 2;
        readyState = 1;
        constructor() { super(); sources.push(this); setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
        close() { this.readyState = 2; }
      };
      window.emitChanges = detail => sources.filter(source => source.readyState !== 2)
        .forEach(source => source.dispatchEvent(new MessageEvent('changed', { data: JSON.stringify(detail) })));
      window.reconnect = () => sources.filter(source => source.readyState !== 2).forEach(source => source.dispatchEvent(new Event('open')));
      let visibility = 'visible';
      Object.defineProperty(document, 'visibilityState', { get: () => visibility });
      window.setVisibility = value => { visibility = value; document.dispatchEvent(new Event('visibilitychange')); };
    });
    await page.route('**/api/v1/**', async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname + url.search);
      let body = {};
      if (url.pathname.endsWith('/auth/me')) body = { id: 'admin', role: 'super_admin', displayName: 'Admin' };
      else if (url.pathname.endsWith('/options')) body = { servers: [{ id: 'mushroom', displayName: 'Mushroom' }, { id: 'yeti', displayName: 'Yeti' }], reasons: [], operations: [] };
      else if (/\/(archive|queue|mine|reminders)$/.test(url.pathname)) body = { groups: [], nextCursor: null };
      else if (url.pathname.endsWith('/activities')) body = { activities: [] };
      await route.fulfill({ json: body });
    });
    const count = fragment => requests.filter(url => url.includes(fragment)).length;
    const settle = () => page.waitForTimeout(220);
    const emit = async (scopes, counts = false) => { await page.evaluate(detail => window.emitChanges(detail), { scopes, counts }); await settle(); };
    const scope = (view, serverId = 'mushroom', kind = 'issuance', status = 'approved') => ({ view, serverId, kind, status });
    const navigate = async view => {
      await page.evaluate(view => { history.pushState({}, '', `/${view}`); dispatchEvent(new PopStateEvent('popstate')); }, view);
      await settle();
    };
    await page.goto(`${process.env.TEST_BASE_URL || 'http://127.0.0.1:5173'}/ready`);
    await page.locator('.manager-groups, .manager-workspace .empty-state h3').waitFor();
    await settle();
    let readyReads = count('/archive');
    let countsReads = count('/workspace-counts');
    await emit([scope('queue', 'mushroom', 'issuance', 'pending'), scope('reissue', 'mushroom', 'issuance', 'pending')], true);
    assert.equal(count('/archive'), readyReads, 'submission must not refresh ready');
    assert.equal(count('/queue'), 0, 'unmounted queue must not load');
    assert.equal(count('/workspace-counts'), countsReads + 1, 'visible navigation counts stay current');
    await emit([scope('queue', 'mushroom', 'issuance', 'pending'), scope('ready')], true);
    assert.equal(count('/archive'), ++readyReads, 'approval refreshes ready once');
    await page.getByRole('button', { name: 'Mushroom', exact: true }).click();
    await settle();
    readyReads = count('/archive');
    await emit([scope('ready', 'yeti')]);
    assert.equal(count('/archive'), readyReads, 'unrelated server must not refresh');
    countsReads = count('/workspace-counts');
    await emit([scope('ready')]);
    assert.equal(count('/archive'), ++readyReads);
    assert.equal(count('/workspace-counts'), countsReads, 'repeat reminder must not reload counts');
    await page.evaluate(() => window.setVisibility('hidden'));
    await emit([scope('ready')], true);
    assert.equal(count('/archive'), readyReads, 'hidden tab must not load');
    assert.equal(count('/workspace-counts'), countsReads);
    await page.evaluate(() => window.setVisibility('visible'));
    await settle();
    assert.equal(count('/archive'), ++readyReads, 'resume coalesces missed relevant changes');
    await navigate('queue');
    let queueReads = count('/queue');
    await emit([scope('ready')]);
    assert.equal(count('/queue'), queueReads, 'reminder must not refresh queue');
    assert.equal(count('/archive'), readyReads, 'unmounted ready must not load');
    await emit([scope('queue', 'mushroom', 'issuance', 'pending')]);
    assert.equal(count('/queue'), queueReads + 1);
    await navigate('ready');
    assert.equal(count('/archive'), ++readyReads, 'navigation loads fresh data');
    await page.evaluate(() => window.reconnect());
    await settle();
    assert.equal(count('/archive'), ++readyReads, 'reconnect recovers missed changes once');
    await navigate('records');
    let ownReads = count('/mine');
    await emit([scope('records', 'mushroom', 'regular')]);
    assert.equal(count('/mine'), ownReads, 'other record type must not reload');
    await emit([scope('records')]);
    assert.equal(count('/mine'), ownReads + 1);
    await navigate('reminders');
    const reminderReads = count('/reminders');
    await emit([scope('records')]);
    assert.equal(count('/reminders'), reminderReads, 'unreminded request must not reload reminders');
    await emit([scope('reminders')]);
    assert.equal(count('/reminders'), reminderReads + 1);
    await navigate('reissue');
    const archiveReads = count('/archive');
    await emit([scope('reissue', 'mushroom', 'issuance', 'cancelled')]);
    assert.equal(count('/archive'), archiveReads, 'excluded status must not reload archive');
    await emit([scope('reissue', 'mushroom', 'issuance', 'pending')]);
    assert.equal(count('/archive'), archiveReads + 1);
    await navigate('request');
    const totalReads = requests.length;
    await emit([scope('queue'), scope('ready'), scope('records'), scope('reminders')]);
    assert.equal(requests.length, totalReads, 'application form must not refresh for record events');
    assert.deepEqual(errors, []);
    console.log('PASS: scoped SSE routing, active view only, filters, counts, hidden tabs, navigation and reconnect');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
