import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { developerThemeFiles } from "../models/filterConfig.shared";
import type {
  ActionFunctionArgs,
  LinksFunction,
  LoaderFunctionArgs,
  MetaFunction,
} from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { guardAction } from "../models/adminErrors.server";
import { getConfig, type AdminClient } from "../models/filterSettings.server";
import {
  getThemeInjectStatus,
  injectThemeFilters,
  listThemes,
} from "../models/themeInject.server";
import {
  completeShopOnboarding,
  isShopOnboardingComplete,
} from "../models/shop.server";
import { OnboardingGuide } from "../components/OnboardingGuide";
import homeStyles from "../styles/home.css?url";

export const meta: MetaFunction = () => [
  { title: "ACO Product Filters | Home" },
];

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: homeStyles },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [config, onboardingComplete] = await Promise.all([
    getConfig(session.shop, admin as AdminClient),
    isShopOnboardingComplete(session.shop),
  ]);
  const customFiles = developerThemeFiles(config.behavior);
  const [theme, themeList] = await Promise.all([
    getThemeInjectStatus(admin as AdminClient, customFiles),
    onboardingComplete
      ? Promise.resolve({ themes: [], errors: [] })
      : listThemes(admin as AdminClient),
  ]);

  const enabledFilters = config.filters.filter(
    (filter) => filter.enabled,
  ).length;
  const visibleValues = config.filters.reduce(
    (total, filter) =>
      total + filter.values.filter((value) => !value.hidden).length,
    0,
  );

  return {
    shop: session.shop,
    scannedCount: config.scannedCount,
    enabledFilters,
    visibleValues,
    catalogDetected: config.scannedCount > 0,
    filtersConfigured: config.filters.length > 0 && enabledFilters > 0,
    themeInjected: theme.collectionInjected && theme.searchInjected,
    collectionInjected: theme.collectionInjected,
    searchInjected: theme.searchInjected,
    themeId: theme.themeId,
    themeName: theme.themeName,
    themeStatusAvailable: theme.ok,
    onboardingComplete,
    snapshotPublished:
      Boolean(config.metafieldSyncedAt) && !config.snapshotStale,
    themes: themeList.themes,
    themeErrors: themeList.errors,
  };
};

export const action = (args: ActionFunctionArgs) =>
  guardAction(args, () => indexAction(args));

async function indexAction({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const rawIntent = formData.get("intent");
  const intent = typeof rawIntent === "string" ? rawIntent : "";

  if (intent === "onboarding:complete") {
    await completeShopOnboarding(session.shop);
    return { ok: true, completed: true };
  }

  const rawThemeId = formData.get("themeId");
  const themeId = typeof rawThemeId === "string" ? rawThemeId : "";
  if (!themeId) {
    return {
      ok: false,
      errors: [{ message: "Select a theme before continuing." }],
    };
  }

  const config = await getConfig(session.shop, admin as AdminClient);
  const customFiles = developerThemeFiles(config.behavior);

  if (intent === "onboarding:theme-status") {
    const themeInject = await getThemeInjectStatus(
      admin as AdminClient,
      customFiles,
      themeId,
    );
    return {
      ok: themeInject.ok,
      errors: themeInject.errors,
      themeInject,
      action: intent,
    };
  }

  let target: "collection" | "search" | null = null;
  if (intent === "onboarding:inject-collection") target = "collection";
  if (intent === "onboarding:inject-search") target = "search";
  if (!target) {
    return { ok: false, errors: [{ message: "Unknown onboarding action." }] };
  }

  const operationResult = await injectThemeFilters(
    admin as AdminClient,
    customFiles,
    target,
    themeId,
  );
  const themeInject = operationResult.ok
    ? await getThemeInjectStatus(admin as AdminClient, customFiles, themeId)
    : operationResult;
  return {
    ok: operationResult.ok,
    errors: operationResult.errors,
    themeInject,
    action: intent,
  };
}

type SetupStepProps = {
  complete: boolean;
  expanded: boolean;
  label: string;
  description: ReactNode;
  action: string;
  href: string;
  loading?: boolean;
  onAction?: () => void;
  onToggle: () => void;
};

function SetupStep({
  complete,
  expanded,
  label,
  description,
  action,
  href,
  loading = false,
  onAction,
  onToggle,
}: Readonly<SetupStepProps>) {
  return (
    <s-box>
      <s-grid
        gridTemplateColumns="1fr auto"
        gap="base"
        padding="small"
        alignItems="center"
      >
        <s-checkbox label={label} checked={complete} disabled={complete} />
        <s-button
          accessibilityLabel={`Toggle ${label} details`}
          variant="tertiary"
          tone="neutral"
          icon={expanded ? "chevron-up" : "chevron-down"}
          onClick={onToggle}
        />
      </s-grid>
      <s-box
        padding="small"
        paddingBlockStart="none"
        display={expanded ? "auto" : "none"}
      >
        <s-box padding="base" background="subdued" borderRadius="base">
          <s-grid gap="small-200">
            <s-paragraph>{description}</s-paragraph>
            <s-stack direction="inline" gap="small-200">
              {onAction && !complete ? (
                <s-button
                  variant="primary"
                  loading={loading}
                  disabled={loading}
                  onClick={onAction}
                >
                  {action}
                </s-button>
              ) : (
                <s-button
                  href={href}
                  variant={complete ? "secondary" : "primary"}
                >
                  {complete ? "Review" : action}
                </s-button>
              )}
              {complete ? <s-badge tone="success">Completed</s-badge> : null}
            </s-stack>
          </s-grid>
        </s-box>
      </s-box>
    </s-box>
  );
}

const DISMISS_STORAGE_KEYS = {
  banner: "banner",
  setupGuide: "setup-guide",
  calloutCard: "callout",
  featuredApps: "featured-apps",
} as const;

type DetectActionData = {
  ok: boolean;
  errors?: { message: string }[];
};

function BuiltForShopifyBadge() {
  // Inline critical icon size so the diamond doesn't FOUC at full SVG size
  // while home.css is still loading.
  return (
    <span
      className="built-for-shopify-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginTop: 6,
        padding: "2px 8px",
        borderRadius: 4,
        background: "#e0f5ff",
        color: "#202223",
        fontSize: 12,
        fontWeight: 600,
        lineHeight: "20px",
        whiteSpace: "nowrap",
      }}
    >
      <svg
        className="built-for-shopify-badge__icon"
        viewBox="0 0 16 14"
        width={12}
        height={11}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        style={{ width: 12, height: 11, flex: "none", display: "block" }}
      >
        <path
          d="m13 0-1 5-4 9 8-9.5L13 0ZM3 0l1 5 4 9-8-9.5L3 0Z"
          fill="#1495CC"
        />
        <path d="m3 0 1 5 4 9 4-9 1-5H3Z" fill="#58B7DF" />
        <path d="M8 14 4 5l-4-.5L8 14ZM8 14l4-9 4-.5L8 14Z" fill="#035F86" />
        <path d="M8 5.5 4 5l4 9 4-9-4 .5Z" fill="#1495CC" />
        <path d="m4 5 4-5 4 5-4.001.5L4 5Z" fill="#A9DEF4" />
        <path d="M4 5 3 0h5L4 5ZM12 5l1-5H8l4 5Z" fill="#58B7DF" />
        <path d="M4 5 3 0 0 4.5 4 5ZM12 5l1-5 3 4.5-4 .5Z" fill="#1495CC" />
      </svg>
      <span>Built for Shopify</span>
    </span>
  );
}

export default function Index() {
  const data = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const detectFetcher = useFetcher<DetectActionData>();
  const publishFetcher = useFetcher<DetectActionData>();
  const onboardingFetcher = useFetcher<typeof action>();
  const handledDetectData = useRef<DetectActionData | undefined>();
  const handledPublishData = useRef<DetectActionData | undefined>();
  const handledOnboardingData = useRef<typeof onboardingFetcher.data>();
  const detecting =
    detectFetcher.state !== "idle" &&
    detectFetcher.formData?.get("intent") === "detect";
  const publishing =
    publishFetcher.state !== "idle" &&
    publishFetcher.formData?.get("intent") === "republish";
  const rawOnboardingAction = onboardingFetcher.formData?.get("intent");
  const onboardingAction =
    typeof rawOnboardingAction === "string" ? rawOnboardingAction : "";
  const liveTheme = data.themes.find((theme) => theme.role === "MAIN");
  const initialSelectedThemeId = liveTheme?.id || data.themes[0]?.id || "";
  // Theme injections can survive uninstall (Shopify often revokes the token
  // before cleanup runs). Only treat them as onboarding progress once this
  // install has a detected catalog — otherwise reinstalls jump to step 2/3.
  const catalogProgressStarted = data.catalogDetected;
  const initialThemeStatus = {
    collectionInjected:
      catalogProgressStarted &&
      (liveTheme?.id || data.themeId) === data.themeId &&
      data.collectionInjected,
    searchInjected:
      catalogProgressStarted &&
      (liveTheme?.id || data.themeId) === data.themeId &&
      data.searchInjected,
  };
  // Always open on step 1 after install/reinstall. Resume later steps only from
  // catalog progress owned by this install (DB), never from leftover theme files.
  const [onboardingStep, setOnboardingStep] = useState(() => {
    if (data.catalogDetected && data.snapshotPublished) return 2;
    if (data.catalogDetected) return 1;
    return 0;
  });
  const [onboardingComplete, setOnboardingComplete] = useState(
    data.onboardingComplete,
  );

  // Stay in sync if the loader revalidates (e.g. reopen app after Finish setup).
  useEffect(() => {
    setOnboardingComplete(data.onboardingComplete);
  }, [data.onboardingComplete]);

  const [catalogDetected, setCatalogDetected] = useState(data.catalogDetected);
  const [snapshotPublished, setSnapshotPublished] = useState(
    data.snapshotPublished,
  );
  const [selectedThemeId, setSelectedThemeId] = useState(
    initialSelectedThemeId,
  );
  const [selectedThemeStatus, setSelectedThemeStatus] =
    useState(initialThemeStatus);
  const setupProgress = [
    data.catalogDetected,
    data.filtersConfigured,
    data.themeInjected,
  ].filter(Boolean).length;
  const setupComplete = setupProgress === 3;
  const storagePrefix = `aco-pf-home:${data.shop}`;

  const [visible, setVisible] = useState({
    banner: !setupComplete,
    setupGuide: true,
    calloutCard: true,
    featuredApps: true,
  });
  const [expanded, setExpanded] = useState({
    setupGuide: true,
    step1: !data.catalogDetected,
    step2: data.catalogDetected && !data.filtersConfigured,
    step3: data.filtersConfigured && !data.themeInjected,
  });

  const setupSteps = useMemo(
    () => [
      {
        complete: data.catalogDetected,
        label: "Detect products and filter values",
        description:
          "Scan your catalog so the app can find product types, vendors, tags, variants, collections, and price ranges.",
        action: "Detect catalog",
        href: "/app/settings",
      },
      {
        complete: data.filtersConfigured,
        label: "Configure your storefront filters",
        description:
          "Choose which filters shoppers can use, arrange their order, and customize how values are displayed.",
        action: "Configure filters",
        href: "/app/settings",
      },
      {
        complete: data.themeInjected,
        label: "Connect filters to your published theme",
        description:
          "Install the storefront filter files into your published theme after reviewing your layout and behavior settings.",
        action: "Connect theme",
        href: "/app/settings",
      },
    ],
    [data.catalogDetected, data.filtersConfigured, data.themeInjected],
  );

  useEffect(() => {
    if (
      detectFetcher.state !== "idle" ||
      !detectFetcher.data ||
      detectFetcher.data === handledDetectData.current
    ) {
      return;
    }
    handledDetectData.current = detectFetcher.data;
    if (detectFetcher.data.ok) {
      setCatalogDetected(true);
      shopify.toast.show("Filter values detected");
    } else {
      shopify.toast.show(
        detectFetcher.data.errors?.[0]?.message ??
          "Could not detect filter values",
        { isError: true },
      );
    }
  }, [detectFetcher.state, detectFetcher.data, shopify]);

  useEffect(() => {
    if (
      publishFetcher.state !== "idle" ||
      !publishFetcher.data ||
      publishFetcher.data === handledPublishData.current
    ) {
      return;
    }
    handledPublishData.current = publishFetcher.data;
    if (publishFetcher.data.ok) {
      setSnapshotPublished(true);
      shopify.toast.show("Storefront snapshot published");
    } else {
      shopify.toast.show(
        publishFetcher.data.errors?.[0]?.message ??
          "Could not publish the storefront snapshot",
        { isError: true },
      );
    }
  }, [publishFetcher.state, publishFetcher.data, shopify]);

  useEffect(() => {
    const result = onboardingFetcher.data;
    if (
      onboardingFetcher.state !== "idle" ||
      !result ||
      result === handledOnboardingData.current
    ) {
      return;
    }
    handledOnboardingData.current = result;

    if (!result.ok) {
      shopify.toast.show(
        ("errors" in result && result.errors?.[0]?.message) ||
          "Could not complete this step",
        { isError: true },
      );
      return;
    }

    if ("completed" in result && result.completed) {
      setOnboardingComplete(true);
      return;
    }
    if ("themeInject" in result && result.themeInject) {
      if (result.themeInject.themeId !== selectedThemeId) return;
      setSelectedThemeStatus({
        collectionInjected: result.themeInject.collectionInjected,
        searchInjected: result.themeInject.searchInjected,
      });
      if (result.action?.startsWith("onboarding:inject-")) {
        shopify.toast.show("Theme injection updated");
      }
    }
  }, [
    onboardingFetcher.state,
    onboardingFetcher.data,
    selectedThemeId,
    shopify,
  ]);

  const detectCatalog = () => {
    detectFetcher.submit(
      { intent: "detect" },
      { method: "POST", action: "/app/settings?onboarding=1" },
    );
  };

  const publishSnapshot = () => {
    publishFetcher.submit(
      { intent: "republish" },
      { method: "POST", action: "/app/settings?onboarding=1" },
    );
  };

  const selectTheme = (themeId: string) => {
    setSelectedThemeId(themeId);
    setSelectedThemeStatus({
      collectionInjected: false,
      searchInjected: false,
    });
    if (themeId) {
      onboardingFetcher.submit(
        { intent: "onboarding:theme-status", themeId },
        { method: "POST" },
      );
    }
  };

  const injectSelectedTheme = (target: "collection" | "search") => {
    onboardingFetcher.submit(
      {
        intent: `onboarding:inject-${target}`,
        themeId: selectedThemeId,
      },
      { method: "POST" },
    );
  };

  useEffect(() => {
    const isDismissed = (section: string) =>
      window.localStorage.getItem(`${storagePrefix}:${section}`) === "1";
    setVisible({
      banner: !setupComplete && !isDismissed("banner"),
      setupGuide: !isDismissed("setup-guide"),
      calloutCard: !isDismissed("callout"),
      featuredApps: !isDismissed("featured-apps"),
    });
  }, [setupComplete, storagePrefix]);

  const dismiss = (
    section: "banner" | "setupGuide" | "calloutCard" | "featuredApps",
  ) => {
    const storageKey = DISMISS_STORAGE_KEYS[section];
    window.localStorage.setItem(`${storagePrefix}:${storageKey}`, "1");
    setVisible((current) => ({ ...current, [section]: false }));
  };

  const calloutHeading = data.themeInjected
    ? `Filters are connected to ${data.themeName || "your published theme"}`
    : "Make your filters live on the storefront";
  let calloutDescription =
    "Open Settings to review your theme connection and resolve any missing theme files.";
  if (data.themeInjected) {
    calloutDescription =
      "Fine-tune filter behavior, layout, colors, sorting, and product cards from Settings.";
  } else if (data.themeStatusAvailable) {
    calloutDescription =
      "Complete your filter setup, then connect the app to your published theme.";
  }

  if (!onboardingComplete) {
    const themeBusy = onboardingFetcher.state !== "idle";

    return (
      <s-page heading="Set up ACO Product Filters">
        <s-query-container>
          <div
            className="onboarding-shell"
            style={{
              width: "100%",
              maxWidth: "720px",
              margin: "clamp(16px, 6vw, 48px) auto 24px",
              paddingLeft: "16px",
              paddingRight: "16px",
              boxSizing: "border-box",
            }}
          >
            <OnboardingGuide
              step={onboardingStep}
              catalogDetected={catalogDetected}
              snapshotPublished={snapshotPublished}
              selectedThemeId={selectedThemeId}
              selectedThemeStatus={selectedThemeStatus}
              themes={data.themes}
              themeErrors={data.themeErrors}
              detecting={detecting}
              publishing={publishing}
              themeBusy={themeBusy}
              onboardingAction={onboardingAction}
              onStepChange={setOnboardingStep}
              onDetect={detectCatalog}
              onPublish={publishSnapshot}
              onThemeChange={selectTheme}
              onInject={injectSelectedTheme}
              onComplete={() =>
                onboardingFetcher.submit(
                  { intent: "onboarding:complete" },
                  { method: "POST" },
                )
              }
              onSkip={() =>
                onboardingFetcher.submit(
                  { intent: "onboarding:complete" },
                  { method: "POST" },
                )
              }
            />
          </div>
        </s-query-container>
      </s-page>
    );
  }

  return (
    <s-page heading="Home Page">
      <s-query-container>
        {/* s-page only spaces its direct children; the query container hides
            the sections from it, so the stack restores the gap. */}
        <s-stack gap="base">
          {visible.banner && !setupComplete ? (
            <s-banner
              heading="Finish setting up your storefront filters"
              tone="info"
              dismissible
              onDismiss={() => dismiss("banner")}
            >
              Complete the setup guide below to make filtering available to your
              shoppers.
            </s-banner>
          ) : null}
          <s-section padding="base">
            <s-grid
              gridTemplateColumns="@container (inline-size <= 500px) 1fr, 1fr auto 1fr auto 1fr"
              gap="small"
            >
              <s-grid gap="small-300">
                <s-heading>Active filters</s-heading>
                <s-text type="strong">{data.enabledFilters}</s-text>
              </s-grid>
              <s-divider direction="block" />
              <s-grid gap="small-300">
                <s-heading>Visible filter values</s-heading>
                <s-text type="strong">{data.visibleValues}</s-text>
              </s-grid>
              <s-divider direction="block" />
              <s-grid gap="small-300">
                <s-heading>Products scanned</s-heading>
                <s-text type="strong">
                  {data.scannedCount.toLocaleString()}
                </s-text>
              </s-grid>
            </s-grid>
          </s-section>

          {visible.setupGuide ? (
            <s-section>
              <s-grid gap="small">
                <s-grid gap="small-200">
                  <s-grid
                    gridTemplateColumns="1fr auto auto"
                    gap="small-300"
                    alignItems="center"
                  >
                    <s-heading>Setup guide</s-heading>
                    <s-button
                      accessibilityLabel="Toggle setup guide"
                      variant="tertiary"
                      tone="neutral"
                      icon={expanded.setupGuide ? "chevron-up" : "chevron-down"}
                      onClick={() =>
                        setExpanded((current) => ({
                          ...current,
                          setupGuide: !current.setupGuide,
                        }))
                      }
                    />
                  </s-grid>
                  <s-paragraph>
                    Follow these steps to publish useful, theme-matched filters.
                  </s-paragraph>
                  <s-paragraph color="subdued">
                    {setupProgress} out of 3 steps completed
                  </s-paragraph>
                </s-grid>

                <s-box
                  borderRadius="base"
                  border="base"
                  background="base"
                  display={expanded.setupGuide ? "auto" : "none"}
                >
                  {setupSteps.map((step, index) => {
                    const stepKey = `step${index + 1}` as
                      "step1" | "step2" | "step3";
                    return (
                      <div key={step.label}>
                        {index > 0 ? <s-divider /> : null}
                        <SetupStep
                          {...step}
                          expanded={expanded[stepKey]}
                          loading={index === 0 && detecting}
                          onAction={
                            index === 0 && !step.complete
                              ? detectCatalog
                              : undefined
                          }
                          onToggle={() =>
                            setExpanded((current) => ({
                              ...current,
                              [stepKey]: !current[stepKey],
                            }))
                          }
                        />
                      </div>
                    );
                  })}
                </s-box>
              </s-grid>
            </s-section>
          ) : null}

          {visible.calloutCard ? (
            <s-section>
              <s-grid
                gridTemplateColumns="1fr auto"
                gap="small-400"
                alignItems="start"
              >
                <s-grid
                  gridTemplateColumns="@container (inline-size <= 480px) 1fr, 1fr auto"
                  gap="base"
                  alignItems="center"
                >
                  <s-grid gap="small-200">
                    <s-heading>{calloutHeading}</s-heading>
                    <s-paragraph>{calloutDescription}</s-paragraph>
                    <s-stack direction="inline" gap="small-200">
                      <s-button href="/app/settings" variant="primary">
                        Open settings
                      </s-button>
                      <s-button
                        href="/app/analytics"
                        tone="neutral"
                        variant="tertiary"
                      >
                        View analytics
                      </s-button>
                    </s-stack>
                  </s-grid>
                  <s-box
                    maxInlineSize="200px"
                    borderRadius="base"
                    overflow="hidden"
                  >
                    <s-image
                      src="https://cdn.shopify.com/static/images/polaris/patterns/callout.png"
                      alt=""
                      aspectRatio="1/0.5"
                    />
                  </s-box>
                </s-grid>
                <s-button
                  onClick={() => dismiss("calloutCard")}
                  icon="x"
                  tone="neutral"
                  variant="tertiary"
                  accessibilityLabel="Dismiss storefront status card"
                />
              </s-grid>
            </s-section>
          ) : null}

          {visible.featuredApps ? (
            <s-section>
              <s-grid gap="base">
                <s-grid
                  gridTemplateColumns="1fr auto"
                  gap="base"
                  alignItems="center"
                >
                  <s-heading>Works Perfectly With These Apps</s-heading>
                  <s-button
                    onClick={() =>
                      setVisible({ ...visible, featuredApps: false })
                    }
                    icon="x"
                    tone="neutral"
                    variant="tertiary"
                    accessibilityLabel="Dismiss featured apps section"
                  ></s-button>
                </s-grid>
                <s-grid
                  gridTemplateColumns="repeat(auto-fit, minmax(240px, 1fr))"
                  gap="base"
                >
                  <s-clickable
                    href="https://apps.shopify.com/product-labels-badges"
                    border="base"
                    borderRadius="base"
                    padding="base"
                    inlineSize="100%"
                    accessibilityLabel="Download Labeler"
                  >
                    <s-grid
                      gridTemplateColumns="auto 1fr auto"
                      alignItems="stretch"
                      gap="base"
                    >
                      <s-thumbnail
                        size="small"
                        src="https://cdn.shopify.com/app-store/listing_images/d3bb3faab3c4978acd795795f9434cdb/icon/CL_YrJ6jjZIDEAE=.png"
                        alt="Labeler"
                      />
                      <s-box>
                        <s-heading>Labeler: Product Labels Badges</s-heading>
                        <s-paragraph>
                          <strong>Free Plan Available</strong>
                        </s-paragraph>
                        <BuiltForShopifyBadge />
                        <s-paragraph>
                          AI‑Generated Stickers, Product Labels, Badges &
                          Countdown Timers to Boost Conversions and Sales.
                        </s-paragraph>
                      </s-box>
                      <s-stack justifyContent="start">
                        <s-button
                          href="https://apps.shopify.com/product-labels-badges"
                          target="_blank"
                          variant="secondary"
                          accessibilityLabel="Install Labeler from the Shopify App Store"
                        >
                          Install
                        </s-button>
                      </s-stack>
                    </s-grid>
                  </s-clickable>

                  <s-clickable
                    href="https://apps.shopify.com/product-options-addons"
                    border="base"
                    borderRadius="base"
                    padding="base"
                    inlineSize="100%"
                    accessibilityLabel="Download Aco-product-addons"
                  >
                    <s-grid
                      gridTemplateColumns="auto 1fr auto"
                      alignItems="stretch"
                      gap="base"
                    >
                      <s-thumbnail
                        size="small"
                        src="https://cdn.shopify.com/app-store/listing_images/19d3c4f2ddc1df5f1bfa5e279872245b/icon/CKHEoK_W05EDEAE=.png"
                        alt="Aco  Product Options"
                      />
                      <s-box>
                        <s-heading>Aco ‑ Product Options & Addons</s-heading>
                        <s-paragraph>
                          <strong>Free Plan Available</strong>
                        </s-paragraph>
                        <BuiltForShopifyBadge />
                        <s-paragraph>
                          Add unlimited product options for customizable
                          products with dynamic pricing
                        </s-paragraph>
                      </s-box>
                      <s-stack justifyContent="start">
                        <s-button
                          href="https://apps.shopify.com/product-options-addons"
                          target="_blank"
                          variant="secondary"
                          accessibilityLabel="Install Aco Product Options from the Shopify App Store"
                        >
                          Install
                        </s-button>
                      </s-stack>
                    </s-grid>
                  </s-clickable>
                </s-grid>
              </s-grid>
            </s-section>
          ) : null}
        </s-stack>
      </s-query-container>
    </s-page>
  );
}
