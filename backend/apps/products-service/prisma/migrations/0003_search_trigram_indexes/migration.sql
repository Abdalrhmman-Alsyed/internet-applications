-- Requirement 3: product search "name/description ILIKE '%word%'" scanned every product
-- (a B-tree index can't help when the word is in the middle). Trigram GIN indexes can.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "products_name_trgm_idx" ON "products" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "products_description_trgm_idx" ON "products" USING GIN ("description" gin_trgm_ops);
