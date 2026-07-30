import type { Page } from '@playwright/test';

/**
 * The Next.js dev-overlay badge renders bottom-left over the sidebar footer
 * and intercepts pointer events (dev-server artifact). Hide it so clicks on
 * sidebar controls reach their targets.
 */
export async function hideDevOverlay(page: Page) {
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
}
