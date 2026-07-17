-- CreateTable
CREATE TABLE "FilterSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 3,
    "storefrontToken" TEXT,
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "capped" BOOLEAN NOT NULL DEFAULT false,
    "phKey" TEXT,
    "phHost" TEXT,
    "layout" JSONB NOT NULL DEFAULT '{}',
    "appearance" JSONB NOT NULL DEFAULT '{}',
    "behavior" JSONB NOT NULL DEFAULT '{}',
    "metafieldSyncedAt" TIMESTAMP(3),
    "snapshotStale" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FilterSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterDefinition" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "displayStyle" TEXT NOT NULL DEFAULT 'checkbox',
    "defaultOpen" BOOLEAN,
    "collapseAfter" INTEGER,
    "sortValuesBy" TEXT NOT NULL DEFAULT 'alpha',
    "selectionMode" TEXT NOT NULL DEFAULT 'multi',
    "searchable" BOOLEAN NOT NULL DEFAULT false,
    "styleOptions" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "FilterDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FilterValue" (
    "id" TEXT NOT NULL,
    "filterId" TEXT NOT NULL,
    "raw" TEXT NOT NULL,
    "label" TEXT,
    "color" TEXT,
    "image" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "pinned" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "mergeOf" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tooltip" TEXT,
    "stale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FilterValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FilterSettings_shop_key" ON "FilterSettings"("shop");

-- CreateIndex
CREATE INDEX "FilterDefinition_settingsId_order_idx" ON "FilterDefinition"("settingsId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "FilterDefinition_settingsId_key_key" ON "FilterDefinition"("settingsId", "key");

-- CreateIndex
CREATE INDEX "FilterValue_filterId_order_idx" ON "FilterValue"("filterId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "FilterValue_filterId_raw_key" ON "FilterValue"("filterId", "raw");

-- AddForeignKey
ALTER TABLE "FilterDefinition" ADD CONSTRAINT "FilterDefinition_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "FilterSettings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FilterValue" ADD CONSTRAINT "FilterValue_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "FilterDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
