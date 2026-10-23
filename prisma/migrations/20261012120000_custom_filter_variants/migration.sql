-- Custom filters: variant-level membership. Entries are "productId:variantId"
-- (bare numeric ids) for products where only some variants were picked.
-- IF NOT EXISTS: some databases already got the column via `prisma db push`.
ALTER TABLE "FilterValue" ADD COLUMN IF NOT EXISTS "variantIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
