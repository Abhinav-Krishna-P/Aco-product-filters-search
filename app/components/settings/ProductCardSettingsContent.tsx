import {
  BlockStack,
  Box,
  Button,
  Checkbox,
  Divider,
  InlineStack,
  RadioButton,
  RangeSlider,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import type {
  BadgePosition,
  ProductCardConfig,
} from "../../models/filterConfig.shared";
import {
  BADGE_POSITIONS,
  DISCOUNT_BADGE_TEXT_MAX,
  IMAGE_BADGE_TEXT_MAX,
  LABEL_MAX_LENGTH,
} from "../../models/filterConfig.shared";
import { ColorField } from "./ColorField";
import { BadgePositionPicker } from "./BadgePositionPicker";
import { CardLayoutPicker } from "./CardLayoutPicker";

export type ProductCardSection =
  "source" | "design" | "slideshow" | "sale" | "quickBuy" | "customCss";

export const PRODUCT_CARD_SECTIONS: {
  id: ProductCardSection;
  label: string;
}[] = [
  { id: "source", label: "Card source" },
  { id: "design", label: "Card design" },
  { id: "slideshow", label: "Image slideshow" },
  { id: "sale", label: "Sale & discounts" },
  { id: "quickBuy", label: "Quick-buy buttons" },
  { id: "customCss", label: "Custom CSS" },
];

const CARD_CLASSES: { selector: string; desc: string }[] = [
  { selector: ".aco-pf-card", desc: "The whole product card" },
  {
    selector: ".aco-pf-card__media",
    desc: "Image wrapper (controls the ratio box)",
  },
  { selector: ".aco-pf-card__img", desc: "The product image" },
  { selector: ".aco-pf-card__slide", desc: "Each slideshow image" },
  { selector: ".aco-pf-card__nav", desc: "Slideshow prev/next arrows" },
  { selector: ".aco-pf-card__dots", desc: "Slideshow dot indicators" },
  { selector: ".aco-pf-card__vendor", desc: "Vendor line above the title" },
  { selector: ".aco-pf-card__title", desc: "Product title" },
  { selector: ".aco-pf-card__price", desc: "Price" },
  { selector: ".aco-pf-card__was", desc: "Compare-at (struck-through) price" },
  { selector: ".aco-pf-card__badge", desc: "Discount badge near the price" },
  {
    selector: ".aco-pf-card__flag",
    desc: "Sale / Out of stock badge over the image",
  },
  { selector: ".aco-pf-card__badge--sale", desc: "“Sale” badge only" },
  { selector: ".aco-pf-card__soldout", desc: "“Out of stock” badge only" },
  { selector: ".aco-pf-card__actions", desc: "Quick-buy button row" },
  { selector: ".aco-pf-card__btn", desc: "Any quick-buy button" },
  { selector: ".aco-pf-card__btn--atc", desc: "“Add to cart” button only" },
  { selector: ".aco-pf-card__btn--buy", desc: "“Buy it now” button only" },
];

// Options that belong to a checkbox start where the checkbox's label text
// starts (20px control + 8px gap), so the boxes line up under the label.
const CHECKBOX_INDENT: React.CSSProperties = { paddingInlineStart: 28 };

const codeStyle: React.CSSProperties = {
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  fontSize: 12,
  background: "var(--p-color-bg-surface-secondary, #f1f1f1)",
  padding: "1px 6px",
  borderRadius: 4,
  whiteSpace: "nowrap",
};

type Props = {
  section: ProductCardSection;
  productCard: ProductCardConfig;
  onChange: (productCard: ProductCardConfig) => void;
  customCss: string;
  onCustomCssChange: (css: string) => void;
  /** Apply draft CSS to the live preview only (does not save). */
  onApplyCustomCss?: () => void;
  /** Theme card status/actions, shown under the "Theme product card" choice. */
  themeCardsPanel?: React.ReactNode;
};

export function ProductCardSettingsContent({
  section,
  productCard,
  onChange,
  customCss,
  onCustomCssChange,
  onApplyCustomCss,
  themeCardsPanel,
}: Props) {
  const set = <K extends keyof ProductCardConfig>(
    k: K,
    v: ProductCardConfig[K],
  ) => onChange({ ...productCard, [k]: v });

  if (section === "source") {
    return (
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Card source
        </Text>
        <Text as="p" tone="subdued">
          Choose which product card the filtered results use.
        </Text>
        <RadioButton
          label="ACO custom card"
          helpText="Designed in this customizer. Works on every theme without extra setup."
          checked={productCard.cardSource !== "theme"}
          id="pf-card-source-aco"
          name="pf-card-source"
          onChange={() => set("cardSource", "aco")}
        />
        <RadioButton
          label="Theme product card"
          helpText="Uses your theme's own product card for filtered results. Requires the filters to be injected into the theme."
          checked={productCard.cardSource === "theme"}
          id="pf-card-source-theme"
          name="pf-card-source"
          onChange={() => set("cardSource", "theme")}
        />
        {productCard.cardSource === "theme" ? themeCardsPanel : null}
      </BlockStack>
    );
  }

  if (section === "design") {
    return (
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Card design
        </Text>
        <CardLayoutPicker
          value={productCard.cardLayout}
          // Layout only changes the structure; "Bordered card" stays as set.
          onSelect={(layout) => set("cardLayout", layout)}
        />
        <Divider />
        <Text as="h3" variant="headingSm">
          Appearance
        </Text>
        <Checkbox
          label="Bordered card (border, padding and subtle frame around each product)"
          checked={productCard.cardBorder}
          onChange={(v) => set("cardBorder", v)}
        />
        <InlineStack gap="500" wrap>
          <ColorField
            label="Background"
            value={productCard.cardBackground}
            onChange={(hex) => set("cardBackground", hex)}
          />
          <ColorField
            label="Text color"
            value={productCard.cardTextColor}
            onChange={(hex) => set("cardTextColor", hex)}
          />
          {productCard.cardBorder ? (
            <ColorField
              label="Border color"
              value={productCard.cardBorderColor}
              onChange={(hex) => set("cardBorderColor", hex)}
            />
          ) : null}
        </InlineStack>
        <RangeSlider
          label={`Corner radius: ${productCard.cardRadius}px`}
          min={0}
          max={24}
          step={1}
          value={productCard.cardRadius}
          onChange={(v) => set("cardRadius", typeof v === "number" ? v : v[0])}
        />
        <div style={{ maxWidth: 360 }}>
          <Select
            label="Shadow"
            options={[
              { label: "None", value: "none" },
              { label: "Soft", value: "soft" },
              { label: "Medium", value: "medium" },
            ]}
            value={productCard.cardShadow}
            onChange={(v) =>
              set("cardShadow", v as ProductCardConfig["cardShadow"])
            }
          />
        </div>
        <Divider />
        <Text as="h3" variant="headingSm">
          Image &amp; text
        </Text>
        <InlineStack gap="400" wrap>
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <s-select
              label="Image ratio"
              value={productCard.imageRatio}
              onChange={(e) => {
                const v = (e.currentTarget as unknown as HTMLSelectElement)
                  .value;
                set("imageRatio", v as ProductCardConfig["imageRatio"]);
              }}
            >
              <s-option value="natural">Natural (original)</s-option>
              <s-option value="square">Square (1:1)</s-option>
              <s-option value="portrait">Portrait (3:4)</s-option>
            </s-select>
          </div>
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <s-select
              label="Image fit"
              details="How the image sits inside the ratio box."
              value={productCard.imageFit}
              onChange={(e) => {
                const v = (e.currentTarget as unknown as HTMLSelectElement)
                  .value;
                set("imageFit", v as ProductCardConfig["imageFit"]);
              }}
            >
              <s-option value="cover">Cover (fill, may crop)</s-option>
              <s-option value="contain">Contain (show whole image)</s-option>
            </s-select>
          </div>
        </InlineStack>
        <InlineStack gap="400" wrap>
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <s-select
              label="Text alignment"
              value={productCard.textAlign}
              onChange={(e) => {
                const v = (e.currentTarget as unknown as HTMLSelectElement)
                  .value;
                set("textAlign", v as ProductCardConfig["textAlign"]);
              }}
            >
              <s-option value="left">Left</s-option>
              <s-option value="center">Centered</s-option>
            </s-select>
          </div>
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <s-select
              label="Title weight"
              value={String(productCard.titleWeight)}
              onChange={(e) => {
                const v = Number(
                  (e.currentTarget as unknown as HTMLSelectElement).value,
                );
                set("titleWeight", v as ProductCardConfig["titleWeight"]);
              }}
            >
              <s-option value="400">Regular</s-option>
              <s-option value="500">Medium</s-option>
              <s-option value="600">Semibold</s-option>
              <s-option value="700">Bold</s-option>
            </s-select>
          </div>
        </InlineStack>
        <InlineStack gap="400" wrap>
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <s-number-field
              label="Title font size"
              details="Size in pixels (px)"
              suffix="px"
              value={String(productCard.titleSize)}
              min={11}
              max={30}
              step={1}
              onChange={(e) => {
                const raw = Number(
                  (e.currentTarget as unknown as HTMLInputElement).value,
                );
                if (!Number.isFinite(raw)) return;
                const clamped = Math.min(30, Math.max(11, Math.round(raw)));
                set("titleSize", clamped);
              }}
            />
          </div>
          <div style={{ minWidth: 200, flex: "1 1 200px" }}>
            <s-number-field
              label="Price font size"
              details="Size in pixels (px)"
              suffix="px"
              value={String(productCard.priceSize)}
              min={11}
              max={24}
              step={1}
              onChange={(e) => {
                const raw = Number(
                  (e.currentTarget as unknown as HTMLInputElement).value,
                );
                if (!Number.isFinite(raw)) return;
                const clamped = Math.min(24, Math.max(11, Math.round(raw)));
                set("priceSize", clamped);
              }}
            />
          </div>
        </InlineStack>
        <Checkbox
          label="Zoom image on hover"
          checked={productCard.hoverZoom}
          onChange={(v) => set("hoverZoom", v)}
        />
        <Checkbox
          label="Show product vendor above the title"
          checked={productCard.showVendor}
          onChange={(v) => set("showVendor", v)}
        />
      </BlockStack>
    );
  }

  if (section === "slideshow") {
    return (
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Image slideshow
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Show more than one product photo on the card. Uses the product&apos;s
          additional images (products with a single image are unaffected).
        </Text>
        <Checkbox
          label="Enable image slideshow"
          checked={productCard.imageSlideshow}
          onChange={(v) => set("imageSlideshow", v)}
        />
        {productCard.imageSlideshow && (
          <Box paddingInlineStart="600">
            <BlockStack gap="300">
              <div style={{ maxWidth: 360 }}>
                <Select
                  label="How images change"
                  options={[
                    {
                      label: "Auto-slideshow on hover",
                      value: "hover",
                    },
                    {
                      label: "Prev / next arrows (shopper clicks)",
                      value: "arrows",
                    },
                  ]}
                  value={productCard.slideshowMode}
                  onChange={(v) =>
                    set(
                      "slideshowMode",
                      v as ProductCardConfig["slideshowMode"],
                    )
                  }
                  helpText={
                    productCard.slideshowMode === "hover"
                      ? "Images cycle automatically while the shopper hovers over the card."
                      : "Left / right arrows appear on the image; clicking them changes the photo."
                  }
                />
              </div>
              {productCard.slideshowMode === "hover" && (
                <RangeSlider
                  label={`Slide speed: ${productCard.slideshowSpeed.toFixed(
                    1,
                  )}s per image`}
                  min={0.4}
                  max={3}
                  step={0.1}
                  value={productCard.slideshowSpeed}
                  onChange={(v) =>
                    set("slideshowSpeed", typeof v === "number" ? v : v[0])
                  }
                />
              )}
              {productCard.slideshowMode === "arrows" && (
                <Checkbox
                  label="Show arrows all the time (otherwise only on hover)"
                  checked={productCard.slideshowArrowsAlways}
                  onChange={(v) => set("slideshowArrowsAlways", v)}
                />
              )}
              <Checkbox
                label="Show dot indicators"
                checked={productCard.slideshowDots}
                onChange={(v) => set("slideshowDots", v)}
              />
              <RangeSlider
                label={`Max images per card: ${productCard.slideshowMaxImages}`}
                min={2}
                max={10}
                step={1}
                value={productCard.slideshowMaxImages}
                onChange={(v) =>
                  set("slideshowMaxImages", typeof v === "number" ? v : v[0])
                }
                helpText="Only the first N images of each product are loaded."
              />
            </BlockStack>
          </Box>
        )}
      </BlockStack>
    );
  }

  if (section === "sale") {
    return (
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Sale &amp; discounts
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Controls how discounted products (those with a compare-at price higher
          than their price) appear in the grid.
        </Text>
        <Checkbox
          label="Show the compare-at price with a strike-through"
          checked={productCard.showComparePrice}
          onChange={(v) => set("showComparePrice", v)}
          helpText="The original price is struck through next to the lower sale price."
        />
        <Checkbox
          label="Show a discount badge near the price"
          checked={productCard.showDiscountBadge}
          onChange={(v) => set("showDiscountBadge", v)}
        />
        {productCard.showDiscountBadge && (
          <Box paddingInlineStart="600">
            <InlineStack gap="400" wrap>
              <div style={{ minWidth: 180, flex: "1 1 180px", maxWidth: 280 }}>
                <TextField
                  label="Badge text"
                  value={productCard.discountBadgeText}
                  onChange={(v) => set("discountBadgeText", v)}
                  placeholder="Save"
                  autoComplete="off"
                  maxLength={DISCOUNT_BADGE_TEXT_MAX}
                  showCharacterCount
                  helpText={`Shown before the discount percent, e.g. “${
                    productCard.discountBadgeText || "Save"
                  } 20%”. The percent is calculated automatically and can’t be changed.`}
                />
              </div>
              <div style={{ minWidth: 180, flex: "1 1 180px", maxWidth: 280 }}>
                <Select
                  label="Badge style"
                  options={[
                    { label: "Solid (filled pill)", value: "solid" },
                    { label: "Outline (bordered pill)", value: "outline" },
                    { label: "Text only (no pill)", value: "text" },
                  ]}
                  value={productCard.discountBadgeStyle}
                  onChange={(v) =>
                    set(
                      "discountBadgeStyle",
                      v as ProductCardConfig["discountBadgeStyle"],
                    )
                  }
                />
              </div>
            </InlineStack>
          </Box>
        )}
        <Checkbox
          label="Show a “Sale” badge on products with a lower sale price"
          checked={productCard.showSaleBadge}
          onChange={(v) => set("showSaleBadge", v)}
          helpText="Shown on in-stock products whose compare-at price is higher than the price."
        />
        {productCard.showSaleBadge && (
          <Box paddingInlineStart="600">
            <BlockStack gap="300">
              <div style={{ maxWidth: 360 }}>
                <TextField
                  label="“Sale” badge text"
                  value={productCard.saleBadgeText}
                  onChange={(v) =>
                    set("saleBadgeText", v.slice(0, IMAGE_BADGE_TEXT_MAX))
                  }
                  placeholder="Sale"
                  autoComplete="off"
                  maxLength={IMAGE_BADGE_TEXT_MAX}
                  showCharacterCount
                />
              </div>
              <InlineStack gap="500" wrap>
                <ColorField
                  label="Badge color"
                  value={productCard.saleBadgeColor}
                  onChange={(hex) => set("saleBadgeColor", hex)}
                />
                <ColorField
                  label="Text color"
                  value={productCard.saleBadgeTextColor}
                  onChange={(hex) => set("saleBadgeTextColor", hex)}
                />
              </InlineStack>
            </BlockStack>
          </Box>
        )}
        <Checkbox
          label="Show an “Out of stock” badge on unavailable products"
          checked={productCard.showSoldOutBadge}
          onChange={(v) => set("showSoldOutBadge", v)}
          helpText="Shown on products that can’t be purchased. A sold-out sale product shows this badge instead of “Sale”."
        />
        {productCard.showSoldOutBadge && (
          <Box paddingInlineStart="600">
            <BlockStack gap="300">
              <div style={{ maxWidth: 360 }}>
                <TextField
                  label="“Out of stock” badge text"
                  value={productCard.soldOutBadgeText}
                  onChange={(v) =>
                    set("soldOutBadgeText", v.slice(0, IMAGE_BADGE_TEXT_MAX))
                  }
                  placeholder="Out of stock"
                  autoComplete="off"
                  maxLength={IMAGE_BADGE_TEXT_MAX}
                  showCharacterCount
                />
              </div>
              <InlineStack gap="500" wrap>
                <ColorField
                  label="Badge color"
                  value={productCard.soldOutBadgeColor}
                  onChange={(hex) => set("soldOutBadgeColor", hex)}
                />
                <ColorField
                  label="Text color"
                  value={productCard.soldOutBadgeTextColor}
                  onChange={(hex) => set("soldOutBadgeTextColor", hex)}
                />
              </InlineStack>
            </BlockStack>
          </Box>
        )}
        {(productCard.showSaleBadge || productCard.showSoldOutBadge) &&
          (() => {
            // Size and corner are shared: a card shows at most one badge.
            // The picker previews the Sale badge when it is on.
            const isSale = productCard.showSaleBadge;
            const text = isSale
              ? productCard.saleBadgeText || "Sale"
              : productCard.soldOutBadgeText || "Out of stock";
            const bg = isSale
              ? productCard.saleBadgeColor
              : productCard.soldOutBadgeColor;
            const fg = isSale
              ? productCard.saleBadgeTextColor
              : productCard.soldOutBadgeTextColor;
            return (
              <BlockStack gap="300">
                <div style={{ maxWidth: 360 }}>
                  <Select
                    label="Badge size"
                    options={[
                      { label: "Small", value: "small" },
                      { label: "Medium", value: "medium" },
                      { label: "Large", value: "large" },
                    ]}
                    value={productCard.badgeSize}
                    onChange={(v) =>
                      set("badgeSize", v as ProductCardConfig["badgeSize"])
                    }
                  />
                </div>
                <BadgePositionPicker
                  label="Badge position"
                  helpText="Choose which corner of the product image the badge sits in."
                  badgeText={text}
                  badgeColor={bg}
                  badgeTextColor={fg}
                  value={
                    BADGE_POSITIONS.includes(productCard.badgePosition)
                      ? productCard.badgePosition
                      : "top-left"
                  }
                  onChange={(pos: BadgePosition) => set("badgePosition", pos)}
                />
              </BlockStack>
            );
          })()}
      </BlockStack>
    );
  }

  if (section === "quickBuy") {
    return (
      <BlockStack gap="300">
        <Text as="h3" variant="headingSm">
          Quick-buy buttons
        </Text>
        <Text as="p" variant="bodySm" tone="subdued">
          Let shoppers buy straight from the product grid. Add to cart adds the
          item without leaving the page; Buy it now takes them to checkout.
        </Text>
        <Checkbox
          label="Show “Add to cart” button"
          checked={productCard.showAddToCart}
          onChange={(v) => set("showAddToCart", v)}
        />
        {productCard.showAddToCart && (
          <div style={CHECKBOX_INDENT}>
            <BlockStack gap="300">
              <div style={{ maxWidth: 360 }}>
                <TextField
                  label="Button text"
                  value={productCard.addToCartText}
                  onChange={(v) => set("addToCartText", v)}
                  placeholder="Add to cart"
                  autoComplete="off"
                  maxLength={LABEL_MAX_LENGTH}
                  showCharacterCount
                />
              </div>
              <div style={{ maxWidth: 360 }}>
                <Select
                  label="After adding to cart"
                  options={[
                    { label: "Stay on page (show “Added ✓”)", value: "stay" },
                    { label: "Go to the cart page", value: "cart" },
                  ]}
                  value={productCard.afterAddToCart}
                  onChange={(v) =>
                    set(
                      "afterAddToCart",
                      v as ProductCardConfig["afterAddToCart"],
                    )
                  }
                />
              </div>
            </BlockStack>
          </div>
        )}
        <Checkbox
          label="Show “Buy it now” button (adds the item and goes straight to checkout)"
          checked={productCard.showBuyNow}
          onChange={(v) => set("showBuyNow", v)}
        />
        {productCard.showBuyNow && (
          <div style={CHECKBOX_INDENT}>
            <div style={{ maxWidth: 360 }}>
              <TextField
                label="Button text"
                value={productCard.buyNowText}
                onChange={(v) => set("buyNowText", v)}
                placeholder="Buy it now"
                autoComplete="off"
                maxLength={LABEL_MAX_LENGTH}
                showCharacterCount
              />
            </div>
          </div>
        )}
        {(productCard.showAddToCart || productCard.showBuyNow) && (
          <>
            <div style={{ maxWidth: 360 }}>
              <Select
                label="For products with several variants"
                options={[
                  {
                    label: "Add the first available variant",
                    value: "firstAvailable",
                  },
                  {
                    label: "Show a Choose variant button",
                    value: "chooseVariant",
                  },
                  {
                    label: "Send shopper to the product page",
                    value: "productPage",
                  },
                ]}
                value={productCard.variantMode}
                onChange={(v) =>
                  set("variantMode", v as ProductCardConfig["variantMode"])
                }
                helpText="Products with a single variant always add directly."
              />
            </div>
            {productCard.variantMode === "chooseVariant" && (
              <div style={{ maxWidth: 360 }}>
                <TextField
                  label="Choose variant button text"
                  value={productCard.chooseVariantText}
                  onChange={(v) => set("chooseVariantText", v)}
                  placeholder="Choose variant"
                  autoComplete="off"
                  maxLength={LABEL_MAX_LENGTH}
                  showCharacterCount
                />
              </div>
            )}
            <Divider />
            <Text as="h3" variant="headingSm">
              Button style
            </Text>
            <div style={{ maxWidth: 360 }}>
              <BlockStack gap="300">
                <Select
                  label="Fill"
                  options={[
                    { label: "Solid", value: "solid" },
                    { label: "Outline", value: "outline" },
                  ]}
                  value={productCard.buttonStyle}
                  onChange={(v) =>
                    set("buttonStyle", v as ProductCardConfig["buttonStyle"])
                  }
                />
                <RangeSlider
                  label={`Corner radius: ${productCard.buttonRadius}px`}
                  min={0}
                  max={30}
                  step={1}
                  value={productCard.buttonRadius}
                  onChange={(v) =>
                    set("buttonRadius", typeof v === "number" ? v : v[0])
                  }
                />
              </BlockStack>
            </div>
            <InlineStack gap="500" wrap>
              <ColorField
                label={
                  productCard.buttonStyle === "outline"
                    ? "Border & text color"
                    : "Button color"
                }
                value={productCard.buttonColor}
                onChange={(hex) => set("buttonColor", hex)}
              />
              <ColorField
                label={
                  productCard.buttonStyle === "outline"
                    ? "Text color on hover"
                    : "Text color"
                }
                value={productCard.buttonTextColor}
                onChange={(hex) => set("buttonTextColor", hex)}
                helpText={
                  productCard.buttonStyle === "outline"
                    ? "Used once the button fills on hover."
                    : undefined
                }
              />
            </InlineStack>
          </>
        )}
      </BlockStack>
    );
  }

  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">
        Custom CSS
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Fine-tune any part of a product card with your own CSS. These are the
        classes each card exposes — target them with the{" "}
        <code style={codeStyle}>.aco-pf-*</code> selectors below. (This is the
        same block-scoped stylesheet as the Advanced tab&apos;s Custom CSS.)
      </Text>
      <Box
        background="bg-surface-secondary"
        borderRadius="200"
        padding="300"
        borderColor="border"
        borderWidth="025"
      >
        <BlockStack gap="150">
          {CARD_CLASSES.map((c) => (
            <InlineStack
              key={c.selector}
              gap="300"
              wrap={false}
              blockAlign="center"
            >
              <span style={{ ...codeStyle, flex: "0 0 auto" }}>
                {c.selector}
              </span>
              <Text as="span" variant="bodySm" tone="subdued">
                {c.desc}
              </Text>
            </InlineStack>
          ))}
        </BlockStack>
      </Box>
      <div className="pf-custom-css-field">
        <TextField
          label="Custom CSS"
          labelHidden
          value={customCss}
          onChange={onCustomCssChange}
          multiline={6}
          autoComplete="off"
          placeholder={
            ".aco-pf-card__btn--atc { text-transform: uppercase; }\n" +
            ".aco-pf-card__title { font-weight: 700; }"
          }
          helpText="Click Apply to update the preview. Save in the header to publish to the storefront."
        />
      </div>
      {onApplyCustomCss ? (
        <InlineStack align="end">
          <Button variant="primary" onClick={onApplyCustomCss}>
            Apply custom CSS
          </Button>
        </InlineStack>
      ) : null}
    </BlockStack>
  );
}
