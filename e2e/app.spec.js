import { expect, test } from '@playwright/test';

test.describe('TK103B app', () => {
  test('health reports version', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.version).toBeTruthy();
  });

  test('loads replay shell with version badge', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header.toolbar')).toBeVisible();
    await expect(page.getByLabel('Mode')).toHaveValue('replay');
    await expect(page.locator('.app-version')).toContainText(/ci|dev|e2e|v/i);
  });

  test('can switch to live mode', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Mode').selectOption('live');
    await expect(page.locator('.status-bar-live')).toBeVisible();
  });

  test('trackers API responds', async ({ request }) => {
    const res = await request.get('/api/trackers');
    expect(res.ok()).toBeTruthy();
    const rows = await res.json();
    expect(Array.isArray(rows)).toBe(true);
  });
});
