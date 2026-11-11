-- Requirement 3 (found with EXPLAIN ANALYZE on 300k orders):
-- admin list "WHERE status = ? ORDER BY createdAt DESC" read ~42k rows then sorted them;
-- with (status, createdAt DESC) it reads only the rows of the requested page.
DROP INDEX "orders_status_idx";
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt" DESC);

-- dashboard "last 7 days" was a sequential scan of the whole table.
CREATE INDEX "orders_createdAt_idx" ON "orders"("createdAt");
