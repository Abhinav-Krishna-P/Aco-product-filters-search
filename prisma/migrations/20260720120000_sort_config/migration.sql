-- Storefront sort dropdown config (enabled, position, label, option list, default).
ALTER TABLE "FilterSettings" ADD COLUMN "sort" JSONB NOT NULL DEFAULT '{}';
