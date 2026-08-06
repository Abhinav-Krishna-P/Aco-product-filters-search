import type { ReactNode } from "react";

/**
 * Section card used inside every settings tab, built on Shopify's
 * `s-section`: heading, optional description and header actions, then the
 * fields. Purely presentational.
 */

type Props = {
  title: string;
  description?: string;
  /** Right-aligned controls in the header (e.g. a primary button). */
  actions?: ReactNode;
  /** Lay the body out as a responsive two-column grid. */
  columns?: 1 | 2;
  children: ReactNode;
};

export function SettingsSection({
  title,
  description,
  actions,
  columns = 1,
  children,
}: Props) {
  return (
    <s-box padding="base" background="base" border="base" borderRadius="base">
      <s-grid
        // Header actions wrap under the title on narrow screens.
        gridTemplateColumns={
          actions ? "@container (inline-size <= 520px) 1fr, 1fr auto" : "1fr"
        }
        gap="base"
        alignItems="start"
      >
        <s-stack gap="small-200">
          <s-heading>{title}</s-heading>
          {description ? (
            <s-paragraph color="subdued">{description}</s-paragraph>
          ) : null}
        </s-stack>
        {actions ? <s-box>{actions}</s-box> : null}
      </s-grid>
      <s-box paddingBlockStart="base">
        {columns === 2 ? (
          <s-grid
            gridTemplateColumns="@container (inline-size <= 600px) 1fr, 1fr 1fr"
            gap="base"
          >
            {children}
          </s-grid>
        ) : (
          children
        )}
      </s-box>
    </s-box>
  );
}

/** Indented child group shown under a toggle that enables more fields. */
export function SettingsSubgroup({ children }: { children: ReactNode }) {
  return (
    <s-box
      padding="base"
      background="subdued"
      border="base"
      borderRadius="base"
    >
      {children}
    </s-box>
  );
}
