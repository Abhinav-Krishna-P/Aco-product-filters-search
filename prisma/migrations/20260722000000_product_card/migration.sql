-- Product-card design + quick-buy (Add to cart / Buy now) button config.
ALTER TABLE "FilterSettings" ADD COLUMN "productCard" JSONB NOT NULL DEFAULT '{}';
