/**
 * GET /api/market-data/schwab/callback
 *
 * Delegates to /api/schwab/callback — the canonical OAuth callback handler.
 * This route exists to support redirect URIs registered under the
 * /api/market-data/schwab/callback path.
 */

import { GET as schwabCallback } from '@/app/api/schwab/callback/route';

export const dynamic = 'force-dynamic';

export { schwabCallback as GET };
