import { test, expect } from '@playwright/test';
import { resetAndSeed } from './seed';

test.beforeAll(async () => {
  await resetAndSeed();
});

test('dashboard renders sections and the seeded tier breakdown', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Applications by status' })).toBeVisible();

  // The sponsor-tier breakdown reflects the seed (which includes High jobs).
  const tierPanel = page.locator('div.rounded-lg', {
    has: page.getByRole('heading', { name: 'Jobs by sponsor tier' }),
  });
  await expect(tierPanel).toContainText('High');
});
