import { test, expect } from '@playwright/test';
import { resetAndSeed } from './seed';

test.beforeAll(async () => {
  await resetAndSeed();
});

test('studio uploads a résumé to the corpus and generates one for a JD', async ({ page }) => {
  await page.goto('/studio');
  await expect(page.getByRole('heading', { name: 'Tailoring Studio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your résumé corpus' })).toBeVisible();

  // Upload a text résumé. With no OPENAI_API_KEY in CI it's stored text-only, but
  // it still counts as a corpus entry (enough to enable generation).
  await page.locator('input[type="file"]').setInputFiles({
    name: 'resume-e2e.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Software Engineer. Built Node.js and PostgreSQL services with REST APIs.'),
  });
  await expect(page.getByText(/1 résumé/)).toBeVisible();

  // Provide a job title and generate — without a key this returns the base template.
  await page.getByPlaceholder('Software Engineer').fill('Backend Engineer');
  await page.getByRole('button', { name: 'Generate résumé' }).click();

  // The split view (editable LaTeX + toolbar) appears regardless of PDF compile.
  await expect(page.getByRole('button', { name: 'Download .tex' })).toBeVisible();
  await expect(page.getByLabel('Résumé LaTeX source')).toBeVisible();
});
