import { test, expect } from '@playwright/test';
import { resetAndSeed, SEED } from './seed';

test.beforeAll(async () => {
  await resetAndSeed();
});

test.describe('Job board', () => {
  test('renders seeded jobs; excluded and contract hidden by default', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByRole('heading', { name: 'Job Board' })).toBeVisible();

    const highCard = page.getByRole('listitem').filter({ hasText: SEED.high });
    await expect(highCard).toBeVisible();
    await expect(highCard.getByText(/H-1B High/)).toBeVisible();

    // Default filters: full-time only, exclude Excluded.
    await expect(page.getByText(SEED.excluded)).toHaveCount(0);
    await expect(page.getByText(SEED.contract)).toHaveCount(0);
  });

  test('default sort is Recommended', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByLabel('Sort', { exact: true })).toHaveValue('combined');
    await expect(page.getByLabel('Sort', { exact: true })).toContainText('Recommended');
  });

  test('"Show excluded" reveals the excluded role', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByText(SEED.excluded)).toHaveCount(0);
    await page.getByLabel('Show excluded').check();
    await expect(page.getByText(SEED.excluded)).toBeVisible();
  });
});
