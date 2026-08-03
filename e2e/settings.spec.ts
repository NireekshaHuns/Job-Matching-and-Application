import { test, expect } from '@playwright/test';
import { resetAndSeed } from './seed';

test.beforeAll(async () => {
  await resetAndSeed();
});

test('settings renders the inventory editors and can add a master skill', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Master skills' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bullet bank' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Base résumés' })).toBeVisible();

  // Add a skill and confirm it appears (proves the mutation + invalidation wiring).
  await page.getByPlaceholder('Add a skill (e.g. GraphQL)').fill('graphql-e2e');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText('graphql-e2e')).toBeVisible();
});
