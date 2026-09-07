async (page) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  let empty = false;
  const history = Array.from({ length: 9 }, (_, i) => ({ requestId: String(i), bossType: 'zakum', inviteCode: 'ABC123', characterId: '123456789012345678901234567890', day: '2026-09-07', requestedAt: '2026-09-06T12:00:00Z', status: i % 2 ? 'rejected' : 'approved', reason: i % 2 ? 'leader-rejected' : undefined }));
  await page.route('**/api/v1/player/**', async (route) => {
    const url = route.request().url();
    let body;
    if (url.endsWith('/servers')) body = { servers: ['蘑菇'] };
    else if (url.endsWith('/me')) body = { account: { server: '蘑菇', qq: '1234567', gameAccount: 'test-player', characters: ['10001'] } };
    else if (url.includes('/teams/history')) body = { day: '2026-09-07', today: '2026-09-07', teams: [{ bossType: 'zakum', members: [{ characterId: '10001', isLeader: true }] }] };
    else body = { day: '2026-09-08', teams: empty ? [] : ['black-dragon', 'zakum'].map((bossType) => ({ bossType, inviteCode: bossType === 'zakum' ? 'ABC123' : 'DEF456', server: '蘑菇', leader: true, members: [{ characterId: '10001', isLeader: true }], pendingRequests: [{ requestId: 'request-1', characterId: '10002', requestedAt: '2026-09-06T12:00:00Z' }] })), applications: [], history: empty ? [] : history };
    await route.fulfill({ json: body });
  });
  await page.evaluate(() => sessionStorage.setItem('mxd-player-session-token', 'fixture'));
  await page.reload();
  await page.locator('.application-record').first().waitFor();
  await page.locator('.application-record .approved').first().waitFor();
  await page.locator('.application-record .rejected').first().waitFor();
  if (await page.locator('.application-record').count() !== 6) throw new Error('Initial record count');
  await page.getByRole('button', { name: '查看全部 9 条' }).click();
  if (await page.locator('.application-record').count() !== 9) throw new Error('Expanded record count');
  await page.getByRole('button', { name: '收起记录' }).click();
  for (const [width, height] of [[320, 568], [390, 844], [1024, 768], [1440, 900], [1920, 1080]]) {
    await page.setViewportSize({ width, height });
    await page.locator('.application-records').scrollIntoViewIfNeeded();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error(`overflow ${width}`);
    await page.locator('.application-records').screenshot({ path: `.playwright-cli/records-${width}.png` });
    await page.locator('.team-history').screenshot({ path: `.playwright-cli/date-${width}.png` });
    const input = page.getByLabel('开战日期');
    if (await input.evaluate((el) => el.scrollWidth > el.clientWidth)) throw new Error(`date input overflow ${width}`);
    if (width > 980) {
      for (const selector of ['.boss-grid', '.team-list', '.history-grid']) {
        const aligned = await page.locator(selector).evaluate((element) => {
          const [left, right] = Array.from(element.children).map((child) => child.getBoundingClientRect());
          return Math.abs(left.width - right.width) < 1 && Math.abs(left.top - right.top) < 1;
        });
        if (!aligned) throw new Error(`Unequal columns: ${selector} at ${width}`);
      }
      await page.screenshot({ path: `.playwright-cli/layout-${width}.png`, fullPage: true });
    }
  }
  empty = true;
  await page.reload();
  await page.getByText('暂无入队申请记录').waitFor();
  await page.getByRole('heading', { name: '入队申请记录' }).waitFor();
  console.log('PASS: records visible, approval/rejection states, expand/collapse, empty state, mobile and desktop bounds');
}
