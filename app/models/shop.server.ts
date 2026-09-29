import prisma from "../db.server";

export type AdminClientLike = {
  graphql: (
    query: string,
    options?: { variables?: Record<string, unknown> },
  ) => Promise<{
    json: () => Promise<any>;
  }>;
};

/**
 * Record a merchant store's installation details in the `Shop` table.
 *
 * Guarantees:
 * - Runs ONLY ONCE per store on the initial install.
 * - If the store already exists in the table (e.g. re-install or repeated auth),
 *   it is completely skipped without overwriting `installedAt`.
 */
export async function recordShopInstall(
  shopDomain: string,
  admin?: AdminClientLike | null,
): Promise<void> {
  if (!shopDomain) return;

  try {
    // Check if store was already recorded on a previous install
    const existing = await prisma.shop.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    if (existing) {
      // Already recorded on initial install — do nothing
      return;
    }

    let name: string | null = null;
    let email: string | null = null;
    let currency: string | null = null;
    let timezone: string | null = null;
    let country: string | null = null;
    let planName: string | null = null;
    let primaryDomain: string | null = null;

    if (admin) {
      try {
        const res = await admin.graphql(`#graphql
          query GetShopDetails {
            shop {
              name
              email
              currencyCode
              ianaTimezone
              billingAddress {
                countryCodeV2
              }
              plan {
                displayName
              }
              primaryDomain {
                url
              }
            }
          }
        `);
        const json = await res.json();
        const data = json?.data?.shop;
        if (data) {
          name = data.name ?? null;
          email = data.email ?? null;
          currency = data.currencyCode ?? null;
          timezone = data.ianaTimezone ?? null;
          country = data.billingAddress?.countryCodeV2 ?? null;
          planName = data.plan?.displayName ?? null;
          primaryDomain = data.primaryDomain?.url ?? null;
        }
      } catch (graphErr) {
        console.warn(
          `[shop] Could not fetch GraphQL details for ${shopDomain}:`,
          graphErr,
        );
      }
    }

    // Insert new shop record
    await prisma.shop.create({
      data: {
        shopDomain,
        name,
        email,
        currency,
        timezone,
        country,
        planName,
        primaryDomain,
      },
    });

    console.info(
      `[shop] Successfully recorded first install for store: ${shopDomain}`,
    );
  } catch (err: any) {
    // If concurrent race condition occurred (P2002 unique constraint on shopDomain), safely ignore
    if (err?.code === "P2002") return;
    console.error(`[shop] Error recording install for ${shopDomain}:`, err);
  }
}

export async function isShopOnboardingComplete(
  shopDomain: string,
): Promise<boolean> {
  const shop = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { onboardingCompletedAt: true },
  });
  return Boolean(shop?.onboardingCompletedAt);
}

export async function completeShopOnboarding(
  shopDomain: string,
): Promise<void> {
  const existing = await prisma.shop.findUnique({
    where: { shopDomain },
    select: { id: true, onboardingCompletedAt: true },
  });
  if (!existing) {
    throw new Error(`Shop install record not found for ${shopDomain}`);
  }
  // Idempotent: keep the original completion time if already finished.
  if (existing.onboardingCompletedAt) return;

  await prisma.shop.update({
    where: { shopDomain },
    data: { onboardingCompletedAt: new Date() },
  });
}
