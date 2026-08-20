import { useEffect, useState } from "react";
import {
  Banner,
  BlockStack,
  Button,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import { useAppBridge } from "@shopify/app-bridge-react";
import { useFetcher } from "@remix-run/react";
import type { AdminValue } from "../../models/filterConfig.shared";
import {
  LABEL_MAX_LENGTH,
  bareProductId,
  gidProductId,
} from "../../models/filterConfig.shared";
import type { CollectionRule } from "../../models/collectionRules.shared";
import {
  RULE_COLUMNS,
  RULE_RELATION_LABELS,
  ruleColumnSpec,
  sanitizeRules,
} from "../../models/collectionRules.shared";
import type {
  CollectionSummary,
  CollectionActionData,
} from "./filtersTabTypes";

/**
 * Create a Shopify collection and add it to the tree.
 *
 * The tree can only contain collections that really exist in Shopify — that's
 * what the storefront resolves each node against — so "add a sub-collection"
 * means "create a collection". Name + hand-picked products is exactly the
 * custom-filter option flow; the difference is that this one round-trips to
 * Shopify (collectionCreate) instead of staying in our config.
 *
 * The node isn't persisted until the merchant saves the settings page, but the
 * collection itself exists in Shopify the moment this succeeds.
 */
export function NewCollectionModal({
  parentRaw,
  parentLabel,
  onClose,
  onCreated,
}: Readonly<{
  parentRaw: string | null;
  parentLabel: string | null;
  onClose: () => void;
  onCreated: (collection: CollectionSummary, parentRaw: string | null) => void;
}>) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<CollectionActionData>();
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<"manual" | "rules">("manual");
  const [productIds, setProductIds] = useState<string[]>([]);
  const [matchAny, setMatchAny] = useState(false);
  const [rules, setRules] = useState<CollectionRule[]>([
    { column: "TAG", relation: "EQUALS", condition: "" },
  ]);

  const creating = fetcher.state !== "idle";
  const errors = fetcher.data?.errors ?? [];
  const created = fetcher.data?.collection;
  // Only complete rules are worth sending — the server drops the rest anyway.
  const validRules = sanitizeRules(rules);
  const canCreate =
    !!title.trim() && (mode === "manual" || validRules.length > 0);

  const patchRule = (i: number, p: Partial<CollectionRule>) =>
    setRules((prev) =>
      prev.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...p };
        // Switching column can strand a relation the new column doesn't allow
        // (e.g. "contains" on a tag) — fall back to its first legal one.
        const spec = ruleColumnSpec(next.column);
        if (spec && !spec.relations.includes(next.relation)) {
          next.relation = spec.relations[0];
        }
        return next;
      }),
    );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && created) {
      // Created, but something non-fatal went wrong (typically: it couldn't be
      // published to the Online Store). The modal closes on success, so the
      // banner would never be read — say it in a toast instead.
      if (errors.length > 0) {
        shopify.toast.show(errors[0].message, {
          isError: true,
          duration: 8000,
        });
      }
      onCreated(created, parentRaw);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const pickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      selectionIds: productIds.map((id) => ({ id: gidProductId(id) })),
    });
    if (!selected) return;
    setProductIds([
      ...new Set(selected.map((p: { id: string }) => bareProductId(p.id))),
    ]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={
        parentLabel
          ? `New sub-collection under "${parentLabel}"`
          : "New collection"
      }
      primaryAction={{
        content: "Create in Shopify",
        loading: creating,
        disabled: !canCreate || creating,
        onAction: () => {
          const fd = new FormData();
          fd.set("intent", "collection:create");
          fd.set("title", title.trim());
          fd.set(
            "productIds",
            JSON.stringify(mode === "manual" ? productIds : []),
          );
          fd.set("rules", JSON.stringify(mode === "rules" ? validRules : []));
          fd.set("matchAny", matchAny ? "1" : "0");
          fetcher.submit(fd, { method: "POST", action: "/app/settings" });
        },
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {errors.length > 0 && (
            <Banner tone="critical">
              <BlockStack gap="100">
                {errors.map((e, i) => (
                  <Text as="p" variant="bodySm" key={i}>
                    {e.message}
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          )}

          <TextField
            label="Collection name"
            value={title}
            onChange={setTitle}
            placeholder="e.g. Hot Wheels"
            autoComplete="off"
            maxLength={LABEL_MAX_LENGTH}
            showCharacterCount
            helpText={
              parentLabel
                ? `Created in Shopify, then nested under "${parentLabel}" in this tree.`
                : "Created in Shopify as a collection, then added at the top level of this tree."
            }
          />

          <Select
            label="Which products belong to it"
            options={[
              { label: "Products I pick", value: "manual" },
              { label: "Products matching conditions", value: "rules" },
            ]}
            value={mode}
            onChange={(v) => setMode(v as "manual" | "rules")}
            helpText={
              mode === "manual"
                ? "A manual collection — it holds exactly what you choose."
                : "An automated collection — Shopify keeps it up to date, so products you add later join it on their own."
            }
          />

          {mode === "manual" ? (
            <InlineStack gap="300" blockAlign="center">
              <Button onClick={pickProducts}>Choose products</Button>
              <Text
                as="span"
                variant="bodySm"
                tone={productIds.length === 0 ? "critical" : "subdued"}
              >
                {productIds.length === 0
                  ? "No products yet"
                  : `${productIds.length} product${productIds.length === 1 ? "" : "s"}`}
              </Text>
            </InlineStack>
          ) : (
            <BlockStack gap="300">
              <Select
                label="A product joins when it matches"
                options={[
                  { label: "All of these conditions", value: "all" },
                  { label: "Any of these conditions", value: "any" },
                ]}
                value={matchAny ? "any" : "all"}
                onChange={(v) => setMatchAny(v === "any")}
              />

              {rules.map((rule, i) => {
                const spec = ruleColumnSpec(rule.column);
                return (
                  <InlineStack
                    // Rules are positional and editable in place, so the index
                    // is the only stable identity they have.
                    // eslint-disable-next-line react/no-array-index-key
                    key={i}
                    gap="200"
                    blockAlign="end"
                    wrap
                  >
                    <div style={{ minWidth: 150, flex: "1 1 150px" }}>
                      <Select
                        label="Product field"
                        labelHidden
                        options={RULE_COLUMNS.map((c) => ({
                          label: c.label,
                          value: c.value,
                        }))}
                        value={rule.column}
                        onChange={(v) =>
                          patchRule(i, {
                            column: v as CollectionRule["column"],
                          })
                        }
                      />
                    </div>
                    <div style={{ minWidth: 150, flex: "1 1 150px" }}>
                      <Select
                        label="Condition"
                        labelHidden
                        options={(spec?.relations ?? []).map((r) => ({
                          label: RULE_RELATION_LABELS[r],
                          value: r,
                        }))}
                        value={rule.relation}
                        onChange={(v) =>
                          patchRule(i, {
                            relation: v as CollectionRule["relation"],
                          })
                        }
                      />
                    </div>
                    <div style={{ minWidth: 140, flex: "1 1 140px" }}>
                      <TextField
                        label="Value"
                        labelHidden
                        type={spec?.numeric ? "number" : "text"}
                        value={rule.condition}
                        onChange={(v) => patchRule(i, { condition: v })}
                        placeholder={spec?.numeric ? "e.g. 25" : "e.g. sale"}
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      icon={DeleteIcon}
                      tone="critical"
                      disabled={rules.length === 1}
                      onClick={() =>
                        setRules((prev) => prev.filter((_, j) => j !== i))
                      }
                      accessibilityLabel={`Remove condition ${i + 1}`}
                    />
                  </InlineStack>
                );
              })}

              <InlineStack gap="300" blockAlign="center">
                <Button
                  icon={PlusIcon}
                  onClick={() =>
                    setRules((prev) => [
                      ...prev,
                      { column: "TAG", relation: "EQUALS", condition: "" },
                    ])
                  }
                >
                  Add condition
                </Button>
                {validRules.length === 0 && (
                  <Text as="span" variant="bodySm" tone="critical">
                    Fill in at least one condition
                  </Text>
                )}
              </InlineStack>
            </BlockStack>
          )}

          <Text as="p" variant="bodySm" tone="subdued">
            A collection with no products returns nothing, so shoppers
            won&apos;t see it while "Hide values that would give zero results"
            is on (Behavior tab). Nesting is set here, in this app — Shopify
            itself has no parent/child relationship between collections.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/**
 * Confirm deleting a tree node's collection — from Shopify, not just from this
 * tree. Only leaves reach this modal (a parent's Delete button is disabled),
 * because removing a collection that has sub-collections would leave those
 * children pointing at a parent that no longer exists.
 *
 * The wording has to be blunt: the merchant is one click from losing a
 * collection that other parts of their store (menus, links, automations) may
 * depend on.
 */
export function DeleteCollectionModal({
  value,
  onClose,
  onDeleted,
}: Readonly<{
  value: AdminValue;
  onClose: () => void;
  onDeleted: () => void;
}>) {
  const shopify = useAppBridge();
  const fetcher = useFetcher<CollectionActionData>();
  const name = value.label ?? value.raw;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show(`Deleted "${name}" from Shopify`);
      onDeleted();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  const errors = fetcher.data?.errors ?? [];
  const deleting = fetcher.state !== "idle";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete "${name}"?`}
      primaryAction={{
        content: "Delete from Shopify",
        destructive: true,
        loading: deleting,
        disabled: deleting,
        onAction: () => {
          const fd = new FormData();
          fd.set("intent", "collection:delete");
          fd.set("handle", value.raw);
          fetcher.submit(fd, { method: "POST", action: "/app/settings" });
        },
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {errors.length > 0 && (
            <Banner tone="critical">
              <BlockStack gap="100">
                {errors.map((e, i) => (
                  <Text as="p" variant="bodySm" key={i}>
                    {e.message}
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          )}

          <Banner tone="critical">
            <Text as="p" variant="bodySm">
              This deletes the <strong>{name}</strong> collection from your
              Shopify admin — not just from this filter tree. Anything else that
              points at it (navigation menus, links, apps, automations) will
              break, and it can&apos;t be undone from here.
            </Text>
          </Banner>

          <Text as="p" variant="bodySm" tone="subdued">
            The products inside it are not deleted — they stay in your catalog
            and in every other collection they belong to.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

/**
 * Edit which products a tree node's collection holds. Loads the current
 * membership from Shopify on open, so the picker starts from the truth rather
 * than from anything cached in our config, and saves the difference.
 *
 * Automated (rule-based) collections are read-only here: their membership comes
 * from their conditions in Shopify.
 */
export function CollectionProductsModal({
  value,
  onClose,
}: Readonly<{ value: AdminValue; onClose: () => void }>) {
  const shopify = useAppBridge();
  const loader = useFetcher<CollectionActionData>();
  const saver = useFetcher<CollectionActionData>();
  const publisher = useFetcher<CollectionActionData>();
  const [productIds, setProductIds] = useState<string[] | null>(null);

  // Load the collection once, when the modal opens.
  useEffect(() => {
    const fd = new FormData();
    fd.set("intent", "collection:load");
    fd.set("handle", value.raw);
    loader.submit(fd, { method: "POST", action: "/app/settings" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value.raw]);

  useEffect(() => {
    if (publisher.state === "idle" && publisher.data?.ok) {
      shopify.toast.show("Published to the Online Store");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publisher.state, publisher.data]);

  // The publish response carries a fresh summary, so it supersedes the load.
  const collection =
    publisher.data?.collection ?? loader.data?.collection ?? null;
  useEffect(() => {
    if (collection && productIds === null) setProductIds(collection.productIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection]);

  useEffect(() => {
    if (saver.state === "idle" && saver.data?.ok) {
      shopify.toast.show("Collection products updated");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saver.state, saver.data]);

  const loading = loader.state !== "idle";
  const saving = saver.state !== "idle";
  const errors = [
    ...(loader.data?.errors ?? []),
    ...(saver.data?.errors ?? []),
    ...(publisher.data?.errors ?? []),
  ];
  const editable = !!collection && !collection.smart;
  const current = productIds ?? [];

  const pickProducts = async () => {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: true,
      action: "select",
      selectionIds: current.map((id) => ({ id: gidProductId(id) })),
    });
    if (!selected) return;
    setProductIds([
      ...new Set(selected.map((p: { id: string }) => bareProductId(p.id))),
    ]);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Products in "${value.label ?? value.raw}"`}
      primaryAction={{
        content: "Save to Shopify",
        loading: saving,
        disabled: !editable || saving || loading || !!collection?.truncated,
        onAction: () => {
          const fd = new FormData();
          fd.set("intent", "collection:setProducts");
          fd.set("handle", value.raw);
          fd.set("productIds", JSON.stringify(current));
          saver.submit(fd, { method: "POST", action: "/app/settings" });
        },
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          {errors.length > 0 && (
            <Banner tone="critical">
              <BlockStack gap="100">
                {errors.map((e, i) => (
                  <Text as="p" variant="bodySm" key={i}>
                    {e.message}
                  </Text>
                ))}
              </BlockStack>
            </Banner>
          )}

          {loading && !collection && (
            <Text as="p" variant="bodySm" tone="subdued">
              Loading this collection from Shopify…
            </Text>
          )}

          {/* The single most common reason a tree node renders and then
              disappears on the storefront: the Storefront API only returns
              collections published to the Online Store, so an unpublished one
              counts zero products and gets hidden by dynamic faceting. */}
          {collection?.published === false && (
            <Banner
              tone="warning"
              title="Not visible to your storefront"
              action={{
                content: "Publish to Online Store",
                loading: publisher.state !== "idle",
                onAction: () => {
                  const fd = new FormData();
                  fd.set("intent", "collection:publish");
                  fd.set("handle", value.raw);
                  publisher.submit(fd, {
                    method: "POST",
                    action: "/app/settings",
                  });
                },
              }}
            >
              <Text as="p" variant="bodySm">
                "{collection.title}" isn&apos;t published to the Online Store
                sales channel, so your theme can&apos;t see it. It will show in
                the filter for a moment and then disappear once product counts
                are worked out.
              </Text>
            </Banner>
          )}

          {collection?.smart && (
            <Banner tone="info">
              <Text as="p" variant="bodySm">
                "{collection.title}" is an automated collection — Shopify
                decides its products from the conditions set on it. Edit those
                in <strong>Products → Collections</strong> in your Shopify
                admin.
              </Text>
            </Banner>
          )}

          {collection?.truncated && (
            <Banner tone="warning">
              <Text as="p" variant="bodySm">
                This collection holds more products than can be edited here.
                Saving would drop the ones not shown, so change it in your
                Shopify admin instead.
              </Text>
            </Banner>
          )}

          {editable && (
            <InlineStack gap="300" blockAlign="center">
              <Button onClick={pickProducts} disabled={collection?.truncated}>
                Choose products
              </Button>
              <Text as="span" variant="bodySm" tone="subdued">
                {`${current.length} product${current.length === 1 ? "" : "s"}`}
              </Text>
            </InlineStack>
          )}

          <Text as="p" variant="bodySm" tone="subdued">
            This writes straight to the collection in Shopify — it isn&apos;t
            part of Save on this page.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
