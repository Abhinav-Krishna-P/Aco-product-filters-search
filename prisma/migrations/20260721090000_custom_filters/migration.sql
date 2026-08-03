-- Custom filters: hand-picked product membership per filter value, stored as
-- bare numeric product ids.
ALTER TABLE "FilterValue" ADD COLUMN "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
