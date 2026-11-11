/**
 * Requirement 3 demo switch, so "before" and "after" can be shown live on the same code:
 *
 *   PERF_MODE=after  (default) every optimisation on
 *   PERF_MODE=before           Redis cache, ETag, read replica, SQL stats and the
 *                              one-call stock lookup are off (the code behaves as it
 *                              did before requirement 3)
 *
 * Switch with: npm run perf:mode -- before | after   (it also drops/recreates the indexes)
 */
export const PERF_OPTIMIZED = (process.env.PERF_MODE ?? 'after') !== 'before';
