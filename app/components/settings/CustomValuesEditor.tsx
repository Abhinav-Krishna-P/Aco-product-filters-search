import { useState } from "react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  InlineStack,
  Text,
  TextField,
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import type { AdminFilter, AdminValue } from "../../models/filterConfig.shared";
import {
  LABEL_MAX_LENGTH,
  membershipToSelectionIds,
  selectionToMembership,
  slugify,
} from "../../models/filterConfig.shared";

/**
 * Option editor for custom filters: add/rename/remove options and hand-pick
 * each one's products through the App Bridge resource picker. Product ids are
 * stored bare (numeric) — see PRODUCT_ID_PREFIX — and re-gid'd only to seed the
 * picker with the current selection.
 */
export function CustomValuesEditor({
  filter,
  onChange,
}: Readonly<{
  filter: AdminFilter;
  onChange: (patch: Partial<AdminFilter>) => void;
}>) {
  const shopify = useAppBridge();
  const [newOption, setNewOption] = useState("");

  const addOption = () => {
    const label = newOption.trim();
    if (!label) return;
    const base = slugify(label) || "option";
    let raw = base;
    let n = 2;
    while (filter.values.some((v) => v.raw === raw)) raw = `${base}-${n++}`;
    onChange({
      values: [
        ...filter.values,
        {
          raw,
          label,
          color: null,
          image: null,
          hidden: false,
          pinned: null,
          order: filter.values.length,
          stale: false,
          productIds: [],
          variantIds: [],
        },
      ],
    });
    setNewOption("");
  };

  const patchValue = (raw: string, p: Partial<AdminValue>) =>
    onChange({
      values: filter.values.map((v) => (v.raw === raw ? { ...v, ...p } : v)),
    });

  const removeValue = (raw: string) =>
    onChange({ values: filter.values.filter((v) => v.raw !== raw) });

  // Options with no products can never match, so they're hidden on the
  // storefront — surface that here rather than letting it look like a bug.
  const emptyCount = filter.values.filter(
    (v) => (v.productIds?.length ?? 0) === 0,
  ).length;

  const pickProducts = async (value: AdminValue) => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      // Pass the picked variants back so only those reappear ticked; without
      // them the picker treats the product as fully selected (issue #4).
      selectionIds: membershipToSelectionIds(
        value.productIds ?? [],
        value.variantIds ?? [],
      ),
    });
    // undefined = the merchant cancelled; leave the existing selection alone.
    if (!selected) return;
    patchValue(value.raw, selectionToMembership(selected));
  };

  return (
    <BlockStack gap="300">
      <Text as="h3" variant="headingSm">
        Options
      </Text>
      <Text as="p" variant="bodySm" tone="subdued">
        Each option becomes one selectable value in this filter. Choose the
        products it should match — a shopper picking the option sees exactly
        those products.
      </Text>

      {filter.values.length === 0 && (
        <Text as="p" tone="subdued" variant="bodySm">
          No options yet. Add one below to get started.
        </Text>
      )}

      {emptyCount > 0 && (
        <Banner tone={emptyCount === filter.values.length ? "warning" : "info"}>
          <Text as="p" variant="bodySm">
            {emptyCount === filter.values.length
              ? `None of these options have products yet, so this filter won't appear on your storefront.`
              : `${emptyCount} option${emptyCount === 1 ? "" : "s"} have no products yet and won't appear on your storefront.`}{" "}
            Options match by hand-picked product, so an empty one always returns
            zero results and is hidden by "Hide values that would give zero
            results" (Behavior tab).
          </Text>
        </Banner>
      )}

      {filter.values.map((v) => {
        const count = v.productIds?.length ?? 0;
        const variantCount = v.variantIds?.length ?? 0;
        return (
          <Box
            key={v.raw}
            padding="300"
            borderColor="border"
            borderWidth="025"
            borderRadius="200"
          >
            <InlineStack gap="300" blockAlign="center">
              {/* Only the name field flexes; the count and buttons keep their
                  natural width and drop to a second line on narrow screens. */}
              <div style={{ flex: "1 1 160px", minWidth: 0 }}>
                <TextField
                  label="Option name"
                  labelHidden
                  value={v.label ?? v.raw}
                  onChange={(val) => patchValue(v.raw, { label: val })}
                  autoComplete="off"
                  maxLength={LABEL_MAX_LENGTH}
                />
              </div>
              <div
                style={{ flex: "0 0 auto", textAlign: "right", minWidth: 92 }}
              >
                <Text
                  as="span"
                  variant="bodySm"
                  tone={count === 0 ? "critical" : "subdued"}
                >
                  {count === 0
                    ? "None"
                    : `${count} product${count === 1 ? "" : "s"}` +
                      (variantCount > 0
                        ? ` · ${variantCount} variant${variantCount === 1 ? "" : "s"}`
                        : "")}
                </Text>
              </div>
              <div style={{ flex: "0 0 auto" }}>
                <ButtonGroup noWrap>
                  <Button onClick={() => pickProducts(v)}>
                    Choose products
                  </Button>
                  <Button
                    tone="critical"
                    icon={DeleteIcon}
                    onClick={() => removeValue(v.raw)}
                    accessibilityLabel={`Delete option ${v.label ?? v.raw}`}
                  />
                </ButtonGroup>
              </div>
            </InlineStack>
          </Box>
        );
      })}

      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <div style={{ flex: "1 1 auto", minWidth: 0 }}>
          <TextField
            label="New option"
            labelHidden
            value={newOption}
            onChange={setNewOption}
            placeholder={`Add an option, e.g. \u201cCasual\u201d`}
            autoComplete="off"
            maxLength={LABEL_MAX_LENGTH}
          />
        </div>
        <div style={{ flex: "0 0 auto" }}>
          <Button
            icon={PlusIcon}
            onClick={addOption}
            disabled={!newOption.trim()}
          >
            Add option
          </Button>
        </div>
      </InlineStack>
    </BlockStack>
  );
}
