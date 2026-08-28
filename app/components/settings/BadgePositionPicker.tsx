import { BlockStack, Box, InlineGrid, Text } from "@shopify/polaris";
import type { BadgePosition } from "../../models/filterConfig.shared";
import { BADGE_POSITIONS } from "../../models/filterConfig.shared";

type Props = {
  label: string;
  helpText?: string;
  /** Text printed inside the mini badge, e.g. "Sale" or "Out of stock". */
  badgeText: string;
  /** Pill background (hex). */
  badgeColor: string;
  /** Pill label color (hex). */
  badgeTextColor: string;
  value: BadgePosition;
  onChange: (value: BadgePosition) => void;
};

const POSITION_LABEL: Record<BadgePosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
};

// Mini badge inset from the card edge, mirrors the storefront .aco-pf-card__flag
// offsets so the picker previews where the real badge lands.
const CORNER_STYLE: Record<BadgePosition, React.CSSProperties> = {
  "top-left": { top: 5, left: 5 },
  "top-right": { top: 5, right: 5 },
  "bottom-left": { bottom: 5, left: 5 },
  "bottom-right": { bottom: 5, right: 5 },
};

/**
 * Visual picker for the Sale / Out of stock badge corner. Four small product
 * image thumbnails in a row, each with the badge in a different corner;
 * clicking one selects that corner. Radio semantics for keyboard/AT users.
 */
export function BadgePositionPicker({
  label,
  helpText,
  badgeText,
  badgeColor,
  badgeTextColor,
  value,
  onChange,
}: Readonly<Props>) {
  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodyMd" fontWeight="medium">
        {label}
      </Text>
      <Box
        maxWidth="400px"
        padding="200"
        background="bg-surface"
        borderRadius="300"
        borderColor="border"
        borderWidth="025"
      >
        <div role="radiogroup" aria-label={label}>
          <InlineGrid columns={4} gap="200">
            {BADGE_POSITIONS.map((pos) => {
              const selected = pos === value;
              return (
                <button
                  key={pos}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={POSITION_LABEL[pos]}
                  onClick={() => onChange(pos)}
                  style={{
                    all: "unset",
                    display: "block",
                    cursor: "pointer",
                    borderRadius: 10,
                  }}
                >
                  <Box
                    background={
                      selected ? "bg-fill-brand-selected" : "bg-fill-secondary"
                    }
                    borderRadius="200"
                    borderColor="border"
                    borderWidth="025"
                  >
                    <div
                      style={{
                        position: "relative",
                        width: "100%",
                        aspectRatio: "4 / 5",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          ...CORNER_STYLE[pos],
                          display: "inline-block",
                          maxWidth: "calc(100% - 10px)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          padding: "1px 6px",
                          borderRadius: 999,
                          fontSize: 9,
                          fontWeight: 600,
                          lineHeight: 1.4,
                          whiteSpace: "nowrap",
                          background: badgeColor,
                          color: badgeTextColor,
                          boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                        }}
                      >
                        {badgeText}
                      </span>
                    </div>
                  </Box>
                  <Box paddingBlockStart="100">
                    <Text
                      as="p"
                      variant="bodySm"
                      alignment="center"
                      tone={selected ? undefined : "subdued"}
                      fontWeight={selected ? "semibold" : "regular"}
                    >
                      {POSITION_LABEL[pos]}
                    </Text>
                  </Box>
                </button>
              );
            })}
          </InlineGrid>
        </div>
      </Box>
      {helpText ? (
        <Text as="p" variant="bodySm" tone="subdued">
          {helpText}
        </Text>
      ) : null}
    </BlockStack>
  );
}
