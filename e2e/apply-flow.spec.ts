import { test, expect } from '@playwright/test';
import { resetAndSeed, SEED } from './seed';

test.beforeAll(async () => {
  await resetAndSeed();
});

test('apply on the board confirms, appears in the tracker, and status is editable', async ({
  page,
  context,
}) => {
  await page.goto('/jobs');
  const card = page.getByRole('listitem').filter({ hasText: SEED.high });

  // Apply opens the posting in a new tab, then asks for confirmation.
  const popupPromise = context.waitForEvent('page');
  await card.getByRole('button', { name: 'Apply', exact: true }).click();
  const popup = await popupPromise;
  expect(popup).not.toBeNull();
  await popup.close();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Yes, I applied' }).click();

  // Confirming applies the job and hands off to the Tracker automatically.
  await expect(page).toHaveURL(/\/tracker/);
  // Kanban columns render, and the new application sits under "Applied".
  await expect(page.getByRole('heading', { name: 'Applied' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Interview' })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: SEED.high });
  await expect(row).toBeVisible();

  // The first combobox in a row is the application status selector.
  await row.getByRole('combobox').first().selectOption('interviewing');
  await page.reload();

  const rowAfter = page.getByRole('listitem').filter({ hasText: SEED.high });
  await expect(rowAfter.getByRole('combobox').first()).toHaveValue('interviewing');
});
