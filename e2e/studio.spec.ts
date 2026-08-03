import { test, expect } from '@playwright/test';
import { resetAndSeed } from './seed';

test.beforeAll(async () => {
  await resetAndSeed();
});

test('studio generates a résumé for the seeded job + base résumé', async ({ page }) => {
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Tailoring Studio' })).toBeVisible();

  // Defaults pre-select the first job + base résumé; generate.
  await page.getByRole('button', { name: 'Generate' }).click();

  // With no OPENAI_API_KEY in CI, the tailor mutation returns the base résumé.
  await expect(page.getByText('Tailored LaTeX')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download .tex' })).toBeVisible();
});
