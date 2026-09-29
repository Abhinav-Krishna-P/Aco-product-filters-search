import type { ReactNode } from "react";

type ThemeOption = {
  id: string;
  name: string;
  role: string;
};

type OnboardingGuideProps = {
  step: number;
  catalogDetected: boolean;
  snapshotPublished: boolean;
  selectedThemeId: string;
  selectedThemeStatus: {
    collectionInjected: boolean;
    searchInjected: boolean;
  };
  themes: ThemeOption[];
  themeErrors: { message: string }[];
  detecting: boolean;
  publishing: boolean;
  themeBusy: boolean;
  onboardingAction: string;
  onStepChange: (step: number) => void;
  onDetect: () => void;
  onPublish: () => void;
  onThemeChange: (themeId: string) => void;
  onInject: (target: "collection" | "search") => void;
  onComplete: () => void;
  onSkip: () => void;
};

type GuideStepProps = {
  label: string;
  complete: boolean;
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
};

function GuideStep({
  label,
  complete,
  expanded,
  disabled = false,
  onToggle,
  children,
}: Readonly<GuideStepProps>) {
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
          accessibilityLabel={`Toggle ${label}`}
          variant="tertiary"
          tone="neutral"
          icon={expanded ? "chevron-up" : "chevron-down"}
          disabled={disabled}
          onClick={onToggle}
        />
      </s-grid>
      {/* Do not use display="none" on s-box: before Polaris upgrades the custom
          element, that attribute is ignored and every step body briefly shows. */}
      {expanded ? (
        <s-box padding="small" paddingBlockStart="none">
          <s-box padding="base" background="subdued" borderRadius="base">
            {children}
          </s-box>
        </s-box>
      ) : null}
    </s-box>
  );
}

export function OnboardingGuide({
  step,
  catalogDetected,
  snapshotPublished,
  selectedThemeId,
  selectedThemeStatus,
  themes,
  themeErrors,
  detecting,
  publishing,
  themeBusy,
  onboardingAction,
  onStepChange,
  onDetect,
  onPublish,
  onThemeChange,
  onInject,
  onComplete,
  onSkip,
}: Readonly<OnboardingGuideProps>) {
  const catalogReady = catalogDetected && snapshotPublished;
  const themeReady =
    selectedThemeStatus.collectionInjected ||
    selectedThemeStatus.searchInjected;
  const welcomeComplete = step > 0 || catalogDetected;
  const completedSteps = [welcomeComplete, catalogReady, themeReady].filter(
    Boolean,
  ).length;
  const selectedTheme = themes.find((theme) => theme.id === selectedThemeId);
  const completingOnboarding =
    themeBusy && onboardingAction === "onboarding:complete";

  return (
    <s-section>
      <s-grid gap="base">
        <s-grid gap="small-200">
          <s-stack
            direction="inline"
            justifyContent="space-between"
            alignItems="center"
          >
            <s-heading>Welcome to ACO Product Filters</s-heading>
            <s-badge tone={themeReady ? "success" : "info"}>
              {themeReady ? "Ready" : "Quick setup"}
            </s-badge>
          </s-stack>
          <s-paragraph>
            Complete these steps to add fast, customizable product filters to
            your storefront.
          </s-paragraph>
          <s-paragraph color="subdued">
            {completedSteps} out of 3 steps completed
          </s-paragraph>
        </s-grid>

        {step === 3 ? (
          <s-grid gap="base">
            <s-banner heading="Your filters are ready" tone="success">
              Your catalog is synchronized, the storefront snapshot is
              published, and filters are connected to your selected theme.
            </s-banner>
            <s-paragraph>
              Continue to the home dashboard to review filter activity. You can
              customize layout, behavior, sorting, and product cards from
              Settings at any time.
            </s-paragraph>
            <s-stack direction="inline" justifyContent="space-between">
              <s-button onClick={() => onStepChange(2)}>Back</s-button>
              <s-button
                variant="primary"
                loading={completingOnboarding}
                disabled={themeBusy}
                onClick={onComplete}
              >
                Go to home
              </s-button>
            </s-stack>
          </s-grid>
        ) : (
          <s-grid gap="base">
            <s-box borderRadius="base" border="base" background="base">
              <GuideStep
                label="Learn what ACO Product Filters can do"
                complete={welcomeComplete}
                expanded={step === 0}
                onToggle={() => onStepChange(0)}
              >
                <s-grid gap="small-200">
                  <s-heading>Help shoppers find products faster</s-heading>
                  <s-paragraph>
                    Detect catalog values automatically, configure collection
                    and search filters, customize product cards and layouts, and
                    measure shopper activity with filter analytics.
                  </s-paragraph>
                  <s-stack direction="inline">
                    <s-button variant="primary" onClick={() => onStepChange(1)}>
                      Get started
                    </s-button>
                  </s-stack>
                </s-grid>
              </GuideStep>

              <s-divider />

              <GuideStep
                label="Sync and publish your catalog"
                complete={catalogReady}
                expanded={step === 1}
                disabled={!welcomeComplete}
                onToggle={() => onStepChange(1)}
              >
                <s-grid gap="base">
                  <s-grid
                    gridTemplateColumns="@container (inline-size <= 520px) 1fr, 1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-grid gap="small-200">
                      <s-stack direction="inline" gap="small-200">
                        <s-heading>Detect products and filter values</s-heading>
                        {catalogDetected ? (
                          <s-badge tone="success">Completed</s-badge>
                        ) : null}
                      </s-stack>
                      <s-paragraph>
                        Scan your Shopify catalog and create the available
                        filter groups and values.
                      </s-paragraph>
                    </s-grid>
                    <s-button
                      variant="primary"
                      loading={detecting}
                      disabled={detecting}
                      onClick={onDetect}
                    >
                      {catalogDetected ? "Detect again" : "Detect catalog"}
                    </s-button>
                  </s-grid>

                  <s-divider />

                  <s-grid
                    gridTemplateColumns="@container (inline-size <= 520px) 1fr, 1fr auto"
                    gap="base"
                    alignItems="center"
                  >
                    <s-grid gap="small-200">
                      <s-stack direction="inline" gap="small-200">
                        <s-heading>Publish storefront snapshot</s-heading>
                        {snapshotPublished ? (
                          <s-badge tone="success">Published</s-badge>
                        ) : null}
                      </s-stack>
                      <s-paragraph>
                        Publish the detected configuration for your storefront
                        to read.
                      </s-paragraph>
                    </s-grid>
                    <s-button
                      loading={publishing}
                      disabled={!catalogDetected || publishing}
                      onClick={onPublish}
                    >
                      Publish to storefront
                    </s-button>
                  </s-grid>

                  <s-stack direction="inline" justifyContent="space-between">
                    <s-button
                      variant="tertiary"
                      tone="neutral"
                      onClick={() => onStepChange(0)}
                    >
                      Back
                    </s-button>
                    <s-button
                      variant="primary"
                      disabled={!catalogReady}
                      onClick={() => onStepChange(2)}
                    >
                      Next
                    </s-button>
                  </s-stack>
                </s-grid>
              </GuideStep>

              <s-divider />

              <GuideStep
                label="Connect filters to a theme"
                complete={themeReady}
                expanded={step === 2}
                disabled={!catalogReady}
                onToggle={() => onStepChange(2)}
              >
                <s-grid gap="base">
                  <s-paragraph>
                    Select a store theme, then inject filters into its
                    collection and search pages.
                  </s-paragraph>

                  {themeErrors.length ? (
                    <s-banner
                      heading="Themes could not be loaded"
                      tone="critical"
                    >
                      {themeErrors.map((error) => error.message).join(" ")}
                    </s-banner>
                  ) : (
                    <s-select
                      label="Theme"
                      value={selectedThemeId}
                      onInput={(event) =>
                        onThemeChange(
                          (event.currentTarget as unknown as HTMLSelectElement).value,
                        )
                      }
                    >
                      {themes.map((theme) => (
                        <s-option key={theme.id} value={theme.id}>
                          {`${theme.name}${theme.role === "MAIN" ? " (Live)" : ""}`}
                        </s-option>
                      ))}
                    </s-select>
                  )}

                  {selectedTheme ? (
                    <s-grid gap="base">
                      <s-stack
                        direction="inline"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <s-heading>{selectedTheme.name}</s-heading>
                        <s-badge
                          tone={
                            selectedTheme.role === "MAIN" ? "success" : "info"
                          }
                        >
                          {selectedTheme.role === "MAIN"
                            ? "Live"
                            : "Unpublished"}
                        </s-badge>
                      </s-stack>

                      <s-grid
                        gridTemplateColumns="@container (inline-size <= 520px) 1fr, 1fr 1fr"
                        gap="base"
                      >
                        <s-box
                          padding="base"
                          border="base"
                          borderRadius="base"
                        >
                          <s-grid gap="small-200">
                            <s-stack
                              direction="inline"
                              justifyContent="space-between"
                            >
                              <s-heading>Collection page</s-heading>
                              {selectedThemeStatus.collectionInjected ? (
                                <s-badge tone="success">Injected</s-badge>
                              ) : null}
                            </s-stack>
                            <s-button
                              loading={
                                themeBusy &&
                                onboardingAction ===
                                  "onboarding:inject-collection"
                              }
                              disabled={
                                themeBusy ||
                                selectedThemeStatus.collectionInjected
                              }
                              onClick={() => onInject("collection")}
                            >
                              Inject to collection
                            </s-button>
                          </s-grid>
                        </s-box>

                        <s-box
                          padding="base"
                          border="base"
                          borderRadius="base"
                        >
                          <s-grid gap="small-200">
                            <s-stack
                              direction="inline"
                              justifyContent="space-between"
                            >
                              <s-heading>Search page</s-heading>
                              {selectedThemeStatus.searchInjected ? (
                                <s-badge tone="success">Injected</s-badge>
                              ) : null}
                            </s-stack>
                            <s-button
                              loading={
                                themeBusy &&
                                onboardingAction === "onboarding:inject-search"
                              }
                              disabled={
                                themeBusy ||
                                selectedThemeStatus.searchInjected
                              }
                              onClick={() => onInject("search")}
                            >
                              Inject to search
                            </s-button>
                          </s-grid>
                        </s-box>
                      </s-grid>
                    </s-grid>
                  ) : null}

                  <s-stack direction="inline" justifyContent="space-between">
                    <s-button
                      variant="tertiary"
                      tone="neutral"
                      onClick={() => onStepChange(1)}
                    >
                      Back
                    </s-button>
                    <s-button
                      variant="primary"
                      disabled={!themeReady}
                      onClick={() => onStepChange(3)}
                    >
                      Finish setup
                    </s-button>
                  </s-stack>
                </s-grid>
              </GuideStep>
            </s-box>

            <s-stack direction="inline" justifyContent="end">
              <s-button
                variant="primary"
                loading={completingOnboarding}
                disabled={themeBusy}
                onClick={onSkip}
              >
                Skip / do it later
              </s-button>
            </s-stack>
          </s-grid>
        )}
      </s-grid>
    </s-section>
  );
}
