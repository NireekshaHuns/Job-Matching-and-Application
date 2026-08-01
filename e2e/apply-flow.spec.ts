import { test, expect } from '@playwright/test';
import { resetAndSeed, SEED } from './seed';

test.beforeAll(async () => {
  await resetAndSeed();
});

test('mark-applied on the board appears in the tracker and status is editable', async ({
  page,
}) => {
  await page.goto('/jobs');
  const card = page.getByRole('listitem').filter({ hasText: SEED.high });
  await card.getByRole('button', { name: 'Mark applied' }).click();
  await expect(card.getByText('Applied ✓')).toBeVisible();

  await page.goto('/tracker');
  const row = page.getByRole('listitem').filter({ hasText: SEED.high });
  await expect(row).toBeVisible();

  // The first combobox in a row is the application status selector.
  await row.getByRole('combobox').first().selectOption('interviewing');
  await page.reload();

  const rowAfter = page.getByRole('listitem').filter({ hasText: SEED.high });
  await expect(rowAfter.getByRole('combobox').first()).toHaveValue('interviewing');
});
