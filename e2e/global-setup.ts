/** Playwright global setup — seed the throwaway e2e database once before the run. */
import { resetAndSeed } from './seed';

export default async function globalSetup(): Promise<void> {
  await resetAndSeed();
}
