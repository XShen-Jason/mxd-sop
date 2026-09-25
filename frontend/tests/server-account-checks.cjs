const assert = require('node:assert/strict');
const path = require('node:path');

async function checkAccountControlSizes(page, target) {
  const container = page.locator(target.name === 'main' ? '.server-account-row-actions' : '.management-account-actions').first();
  assert.equal(await container.locator('label').innerText(), '自动化', 'automation label stays concise in either state');
  const controls = await container.locator('button, label > span').evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width, top: bounds.top };
  }));
  assert(controls.length >= 4);
  assert(Math.max(...controls.map((item) => item.height)) - Math.min(...controls.map((item) => item.height)) <= 1, 'account actions must share one height');
  assert(Math.max(...controls.map((item) => item.top)) - Math.min(...controls.map((item) => item.top)) <= 1, `account actions should align in one row: ${JSON.stringify(controls)}`);
  assert(Math.abs(controls.at(-1).width - controls.at(-2).width) <= 1, 'automation and login buttons must share one width');
}

async function checkAccountControls(page, panel, target, account, actions) {
  const toggle = page.getByRole('switch', { name: '自动化 测试GM', exact: true });
  const waitIdle = () => page.waitForFunction(() => {
    const input = document.querySelector('input[role="switch"][aria-label="自动化 测试GM"]');
    return input && !input.disabled;
  });
  assert.equal(await toggle.isChecked(), false);
  await checkAccountControlSizes(page, target);
  assert(await page.getByRole('button', { name: '退出 测试GM', exact: true }).isVisible());
  assert.equal(await panel.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), false);
  await toggle.click();
  await page.waitForFunction(() => document.querySelector('input[aria-label="自动化 测试GM"]')?.checked);
  await waitIdle();
  assert.equal(account.automation_enabled, true);
  await checkAccountControlSizes(page, target);
  assert.equal(account.enabled, true);
  assert.equal(actions.length, 1, 'automation toggle must make only one PATCH');
  if (target.name === 'auto') page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '退出 测试GM', exact: true }).click();
  if (target.name === 'main') await page.getByRole('button', { name: '确认退出', exact: true }).click();
  await page.getByRole('button', { name: '登录 测试GM', exact: true }).waitFor();
  await waitIdle();
  assert.equal(await toggle.isChecked(), true, 'logout preserves automation preference');
  await checkAccountControlSizes(page, target);
  assert(await panel.getByRole('button', { name: '发送消息', exact: true }).isDisabled());
  await toggle.click();
  await page.waitForFunction(() => !document.querySelector('input[aria-label="自动化 测试GM"]')?.checked);
  await waitIdle();
  assert.equal(account.enabled, false, 'automation switch must never log in');
  await page.getByRole('button', { name: '登录 测试GM', exact: true }).click();
  await page.getByRole('button', { name: '退出 测试GM', exact: true }).waitFor();
  await waitIdle();
  assert.equal(await toggle.isChecked(), false, 'login must never enable automation');
  assert.equal(account.enabled, true);
  assert.equal(actions.length, 4);
  assert.equal(await panel.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), false);
}

async function checkMessageResult(page, panel, target, screenshots) {
  const result = panel.locator(target.name === 'main' ? '.message-result-panel' : '.management-message-result');
  await result.waitFor();
  for (const text of ['服务器返回', '消息类型', '消息内容', '服务器原始返回', '完整内容']) assert((await result.innerText()).includes(text));
  const cards = result.locator(target.name === 'main' ? '.message-result-card' : '.management-response-grid > div');
  assert(await cards.count() >= 5);
  assert(await cards.first().evaluate((element) => parseFloat(getComputedStyle(element).borderTopWidth) > 0), 'response cards must retain styling');
  assert.equal(await result.locator(target.name === 'main' ? '.message-delivery-badge' : '.management-delivery-badge').innerText(), '成功');
  assert((await panel.innerText()).includes('36 ms'));
  await result.screenshot({ path: path.join(screenshots, `${target.name}-response-desktop.png`) });
  await page.setViewportSize({ width: 375, height: 844 });
  if (target.name === 'main') await page.locator('.sidebar').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  await result.scrollIntoViewIfNeeded();
  assert(await result.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'response must fit on mobile');
  await result.screenshot({ path: path.join(screenshots, `${target.name}-response-mobile.png`) });
  const row = page.locator(target.name === 'main' ? '.server-account-row' : '.management-account-row').first();
  await checkAccountControlSizes(page, target);
  assert(await row.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'account controls must fit on mobile');
  await row.screenshot({ path: path.join(screenshots, `${target.name}-account-mobile.png`) });
  await page.setViewportSize({ width: 1440, height: 1100 });
}

module.exports = { checkAccountControls, checkMessageResult };
