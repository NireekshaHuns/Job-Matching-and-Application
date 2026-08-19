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
    /**
     * The default is "Past 3 days", matching what ingestion now collects.
     *
     * It was "Any time" while the table held a long tail of postings published
     * months earlier, where any window hid most of what a refresh found — the
     * age filter reads `coalesce(posted_at, first_seen_at)`, so a posting
     * discovered today but published weeks ago disappeared the moment it
     * arrived. Ingestion now refuses anything over a week old, so that tail
     * cannot form and the window is a view rather than a filter.
     */
    test('defaults to the last three days', async ({ page }) => {
      await page.goto('/jobs');
      await expect(page.getByRole('radio', { name: 'Past 3 days' })).toBeChecked();
      await expect(page.getByText(SEED.old)).toHaveCount(0);
    });

    test('"Any time" still reaches a posting published weeks ago', async ({ page }) => {
      await page.goto('/jobs');
      await page.getByRole('radio', { name: 'Any time' }).check();
      await expect(page.getByText(SEED.old)).toBeVisible();
    });

    /**
     * The other direction of the hydration swap. Without this, the test above
     * passes on the pre-hydration paint alone — it cannot tell "the default is
     * three days" from "stored filters are never applied".
     */
    test('applies stored filters over the default on first paint', async ({ page }) => {
      await page.addInitScript(() => {
        window.localStorage.setItem('h1b-board:filters:v1', JSON.stringify({ within: 0 }));
      });
      await page.goto('/jobs');

      await expect(page.getByRole('radio', { name: 'Any time' })).toBeChecked();
      await expect(page.getByText(SEED.old)).toBeVisible();
    });

    test('"Past week" narrows to recent postings', async ({ page }) => {
      await page.goto('/jobs');
      await page.getByRole('radio', { name: 'Past week' }).check();
      await expect(page.getByText(SEED.old)).toHaveCount(0);
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
      // It is a real posting, so an unbounded window shows it...
      await page.getByRole('radio', { name: 'Any time' }).check();
      await expect(page.getByText(SEED.undatedOld)).toBeVisible();

      // ...but first seen 20 days ago, so "Past week" must hide it. That is the
      // regression: an undated posting used to match EVERY window forever.
      await page.getByRole('radio', { name: 'Past week' }).check();
      await expect(page.getByText(SEED.undatedOld)).toHaveCount(0);
    });

    test('remembers the chosen window across a reload', async ({ page }) => {
      await page.goto('/jobs');
      await page.getByRole('radio', { name: 'Past week' }).check();
      await expect(page.getByText(SEED.old)).toHaveCount(0);

      await page.reload();
      await expect(page.getByRole('radio', { name: 'Past week' })).toBeChecked();
      await expect(page.getByText(SEED.old)).toHaveCount(0);
    });
  });
});
