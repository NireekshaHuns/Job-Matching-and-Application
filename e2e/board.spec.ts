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

  test('"Show closed" reveals a closed posting', async ({ page }) => {
    await page.goto('/jobs');
    // Closed postings are retained but hidden, so the filter stays auditable.
    await expect(page.getByText(SEED.closed)).toHaveCount(0);
    await page.getByLabel('Show closed').check();
    await expect(page.getByText(SEED.closed)).toBeVisible();
  });

  test('"Include senior" reveals a senior posting', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByText(SEED.senior)).toHaveCount(0);
    await page.getByLabel('Include senior').check();
    await expect(page.getByText(SEED.senior)).toBeVisible();
  });

  test('"Remote only" keeps remote postings and drops on-site ones', async ({ page }) => {
    await page.goto('/jobs');
    await expect(page.getByText(SEED.remote)).toBeVisible();
    await expect(page.getByText(SEED.high)).toBeVisible();

    await page.getByLabel('Remote only').check();
    await expect(page.getByText(SEED.remote)).toBeVisible();
    // The seeded High role is New York, NY — not remote.
    await expect(page.getByText(SEED.high)).toHaveCount(0);
  });

  test.describe('date posted window', () => {
    test('defaults to Past week and hides a 20-day-old posting', async ({ page }) => {
      await page.goto('/jobs');
      await expect(page.getByRole('radio', { name: 'Past week' })).toBeChecked();
      await expect(page.getByText(SEED.old)).toHaveCount(0);
    });

    test('"Any time" reveals it', async ({ page }) => {
      await page.goto('/jobs');
      await page.getByRole('radio', { name: 'Any time' }).check();
      await expect(page.getByText(SEED.old)).toBeVisible();
    });

    /**
     * Regression guard for the age filter. It used to read
     *   posted_at IS NULL OR posted_at >= now() - N days
     * so a posting with no date matched EVERY window forever. On production
     * that left 33 stale rows crowding out 3 genuinely-recent ones. The filter
     * now falls back to first_seen_at.
     */
    test('a posting with no date is aged by when it was first seen', async ({ page }) => {
      await page.goto('/jobs');
      // First seen 20 days ago: must NOT appear under "Past week"...
      await expect(page.getByText(SEED.undatedOld)).toHaveCount(0);

      await page.getByRole('radio', { name: 'Any time' }).check();
      // ...but it is still a real posting, so "Any time" shows it.
      await expect(page.getByText(SEED.undatedOld)).toBeVisible();
    });
  });
});
