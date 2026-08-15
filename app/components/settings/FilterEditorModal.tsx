import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Divider,
  InlineStack,
  Modal,
  Select,
  Text,
  TextField,
} from "@shopify/polaris";
import { DeleteIcon, PlusIcon } from "@shopify/polaris-icons";
import type {
  AdminFilter,
  AdminValue,
  BehaviorConfig,
} from "../../models/filterConfig.shared";
import {
  LABEL_MAX_LENGTH,
  displayStylesFor,
} from "../../models/filterConfig.shared";
import { detectSwatchColor } from "../../models/swatchColors";
import { ColorField } from "./ColorField";
import { CustomValuesEditor } from "./CustomValuesEditor";
import {
  NewCollectionModal,
  DeleteCollectionModal,
  CollectionProductsModal,
} from "./CollectionModals";
import {
  VALUES_PAGE,
  treeRows,
  type CollectionSummary,
} from "./filtersTabTypes";

export function FilterEditorModal({
  filter,
  behavior,
  onClose,
  onChange,
}: {
  filter: AdminFilter;
  behavior: BehaviorConfig;
  onClose: () => void;
  onChange: (patch: Partial<AdminFilter>) => void;
}) {
  const [valueSearch, setValueSearch] = useState("");
  const [shownCount, setShownCount] = useState(VALUES_PAGE);
  // Tree drag-and-drop. Rows contain a text input, so a row is only draggable
  // while its grip is held — otherwise selecting label text starts a drag.
  const [dragRaw, setDragRaw] = useState<string | null>(null);
  const [overRaw, setOverRaw] = useState<string | null>(null);
  const [grabbedRaw, setGrabbedRaw] = useState<string | null>(null);
  // Collection-tree authoring: create a Shopify collection for a new node, or
  // edit which products an existing node holds.
  const [creatingUnder, setCreatingUnder] = useState<string | null | false>(
    false,
  );
  const [productsFor, setProductsFor] = useState<AdminValue | null>(null);
  const [deleting, setDeleting] = useState<AdminValue | null>(null);

  const endTreeDrag = () => {
    setDragRaw(null);
    setOverRaw(null);
    setGrabbedRaw(null);
  };

  const isList = filter.type !== "price" && filter.type !== "available";
  const isTree = filter.type === "collection";
  // Custom filters manage their own values (hand-picked products per option),
  // so they replace the detected-values list but keep every style/behavior control.
  const isCustom = filter.type === "custom";
  const showSwatchColor = filter.displayStyle === "swatch";
  const showImage = filter.displayStyle === "image";
  const isPill = filter.displayStyle === "pill";
  const pillFill =
    filter.styleOptions.pillFill === "colored" ? "colored" : "transparent";

  const visibleValues = useMemo(() => {
    const q = valueSearch.trim().toLowerCase();
    // Tree filters browse in DFS order (indented); searching flattens the list.
    const base =
      isTree && !q
        ? treeRows(filter.values).map((r) => r.value)
        : filter.values;
    if (!q) return base;
    return base.filter(
      (v) =>
        v.raw.toLowerCase().includes(q) ||
        (v.label ?? "").toLowerCase().includes(q),
    );
  }, [filter.values, valueSearch, isTree]);

  // raw -> depth for tree indentation in the value list.
  const depthByRaw = useMemo(() => {
    if (!isTree) return new Map<string, number>();
    return new Map(treeRows(filter.values).map((r) => [r.value.raw, r.depth]));
  }, [filter.values, isTree]);

  // Indent: nest under the nearest preceding row that could be its parent
  // (previous row at same or shallower depth than the target depth).
  const indentValue = (raw: string) => {
    const rows = treeRows(filter.values);
    const i = rows.findIndex((r) => r.value.raw === raw);
    if (i <= 0) return;
    const depth = rows[i].depth;
    for (let j = i - 1; j >= 0; j--) {
      if (rows[j].depth === depth) {
        patchValue(raw, { parentRaw: rows[j].value.raw });
        return;
      }
      if (rows[j].depth < depth) return; // would skip a level — no-op
    }
  };

  const outdentValue = (raw: string) => {
    const v = filter.values.find((x) => x.raw === raw);
    if (!v?.parentRaw) return;
    const parent = filter.values.find((x) => x.raw === v.parentRaw);
    patchValue(raw, { parentRaw: parent?.parentRaw ?? null });
  };

  /**
   * Is this a legal drop target? Shared by the drop handler and the drop
   * indicator, so the blue line only appears where a drop will actually land.
   * A target inside the dragged subtree is refused — splicing the block into
   * itself would detach it from the tree.
   */
  const canDropOn = (dragRaw: string, targetRaw: string): boolean => {
    if (dragRaw === targetRaw) return false;
    const rows = treeRows(filter.values);
    const from = rows.findIndex((r) => r.value.raw === dragRaw);
    const to = rows.findIndex((r) => r.value.raw === targetRaw);
    if (from < 0 || to < 0) return false;
    let end = from + 1;
    while (end < rows.length && rows[end].depth > rows[from].depth) end++;
    return !(to >= from && to < end);
  };

  /**
   * Drag-and-drop reorder for the collection tree. The dragged collection
   * carries its descendants and becomes a sibling of the row it's dropped on.
   *
   * Direction decides the landing spot, which is what makes every position
   * reachable: dragging DOWN lands after the target's whole subtree (so the
   * very end is reachable, and you never land inside the target's children),
   * dragging UP lands directly above it.
   *
   * Dropping a collection onto one of its own descendants is refused — that
   * would splice the subtree into itself and detach it from the tree.
   */
  const dropTreeValue = (dragRaw: string, targetRaw: string) => {
    if (dragRaw === targetRaw) return;
    const rows = treeRows(filter.values);
    const from = rows.findIndex((r) => r.value.raw === dragRaw);
    const to = rows.findIndex((r) => r.value.raw === targetRaw);
    if (from < 0 || to < 0) return;
    if (!canDropOn(dragRaw, targetRaw)) return;

    // The dragged node plus its descendants: contiguous rows deeper than it.
    const depth = rows[from].depth;
    let end = from + 1;
    while (end < rows.length && rows[end].depth > depth) end++;
    if (to >= from && to < end) return; // target is inside the dragged subtree

    const next = rows.map((r) => r.value);
    const block = next.splice(from, end - from);

    let insertAt: number;
    if (to > from) {
      // Downward: skip past the target's own subtree, then account for the
      // block already removed from earlier in the array.
      let tEnd = to + 1;
      while (tEnd < rows.length && rows[tEnd].depth > rows[to].depth) tEnd++;
      insertAt = tEnd - block.length;
    } else {
      insertAt = to;
    }

    // Adopt the target's level; ← → stay available for fine adjustment.
    block[0] = { ...block[0], parentRaw: rows[to].value.parentRaw ?? null };
    next.splice(insertAt, 0, ...block);

    const placedAfter = new Set(next.map((v) => v.raw));
    const strays = filter.values.filter((v) => !placedAfter.has(v.raw));
    onChange({ values: [...next, ...strays], sortValuesBy: "manual" });
  };

  const patchValue = (raw: string, p: Partial<AdminValue>) =>
    onChange({
      values: filter.values.map((v) => (v.raw === raw ? { ...v, ...p } : v)),
    });

  /** Direct sub-collections of a node — a node with any of these can't be deleted. */
  const childCount = (raw: string) =>
    filter.values.filter((v) => v.parentRaw === raw && v.raw !== raw).length;

  /** Drop a node whose collection no longer exists in Shopify. */
  const removeValue = (raw: string) =>
    onChange({ values: filter.values.filter((v) => v.raw !== raw) });

  /**
   * Add a tree node for a collection that now exists in Shopify. The node is
   * keyed by the handle Shopify assigned (it de-duplicates handles, so it can
   * differ from the title), and lands directly after its parent so it reads as
   * that parent's first sub-collection. A handle already in the list — a
   * previously detected collection — is re-parented and un-hidden instead of
   * duplicated.
   */
  const addCollectionValue = (
    c: CollectionSummary,
    parentRaw: string | null,
  ) => {
    if (filter.values.some((v) => v.raw === c.handle)) {
      patchValue(c.handle, { parentRaw, hidden: false, stale: false });
      return;
    }
    const node: AdminValue = {
      raw: c.handle,
      parentRaw,
      label: c.title,
      color: null,
      image: null,
      hidden: false,
      pinned: null,
      order: filter.values.length,
      stale: false,
    };
    const next = filter.values.slice();
    const at = parentRaw ? next.findIndex((v) => v.raw === parentRaw) : -1;
    next.splice(at < 0 ? next.length : at + 1, 0, node);
    onChange({ values: next, sortValuesBy: "manual" });
  };

  // Auto-detect swatch colours from value names. Any value that has no colour
  // set yet but whose name matches a known colour (e.g. "beige", "burgandy")
  // is seeded so the picker — and the storefront — show the right swatch.
  // Values with no recognised colour keep `color: null` for manual selection.
  useEffect(() => {
    if (!showSwatchColor) return;
    let changed = false;
    const next = filter.values.map((v) => {
      if (v.color) return v;
      const detected = detectSwatchColor(v.label ?? v.raw);
      if (!detected) return v;
      changed = true;
      return { ...v, color: detected };
    });
    if (changed) onChange({ values: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSwatchColor, filter.key, filter.values]);

  const moveValue = (raw: string, dir: -1 | 1) => {
    const idx = filter.values.findIndex((v) => v.raw === raw);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= filter.values.length) return;
    const next = filter.values.slice();
    const [item] = next.splice(idx, 1);
    next.splice(to, 0, item);
    onChange({ values: next, sortValuesBy: "manual" });
  };

  return (
    <>
      <Modal open onClose={onClose} title={`Edit filter: ${filter.label}`}>
        <Modal.Section>
          <BlockStack gap="400">
            <InlineStack gap="400" wrap>
              <div style={{ width: "min(260px, 100%)" }}>
                <TextField
                  label="Display label"
                  value={filter.label}
                  onChange={(v) => onChange({ label: v })}
                  autoComplete="off"
                  maxLength={LABEL_MAX_LENGTH}
                  showCharacterCount
                />
              </div>
              <div style={{ width: "min(260px, 100%)" }}>
                <Select
                  label="Display style"
                  options={displayStylesFor(filter.type)}
                  value={filter.displayStyle}
                  onChange={(v) => onChange({ displayStyle: v })}
                />
              </div>
            </InlineStack>

            <InlineStack gap="400" wrap>
              <div style={{ width: "min(260px, 100%)" }}>
                <Select
                  label="Open by default"
                  options={[
                    {
                      label: `Inherit global (${behavior.defaultOpen ? "open" : "closed"})`,
                      value: "inherit",
                    },
                    { label: "Open", value: "open" },
                    { label: "Closed", value: "closed" },
                  ]}
                  value={
                    filter.defaultOpen === null
                      ? "inherit"
                      : filter.defaultOpen
                        ? "open"
                        : "closed"
                  }
                  onChange={(v) =>
                    onChange({
                      defaultOpen: v === "inherit" ? null : v === "open",
                    })
                  }
                />
              </div>
              {isList && (
                <div style={{ width: "min(260px, 100%)" }}>
                  <Select
                    label="Selection mode"
                    options={[
                      { label: "Multiple (OR)", value: "multi" },
                      { label: "Single choice", value: "single" },
                    ]}
                    value={filter.selectionMode}
                    onChange={(v) =>
                      onChange({ selectionMode: v as "multi" | "single" })
                    }
                  />
                </div>
              )}
            </InlineStack>

            {isList && (
              <InlineStack gap="400" wrap>
                {/* Trees are ordered by the arrangement in the value list below. */}
                {!isTree && (
                  <div style={{ width: "min(260px, 100%)" }}>
                    <Select
                      label="Sort values by"
                      options={[
                        { label: "A–Z", value: "alpha" },
                        { label: "Manual (drag order below)", value: "manual" },
                      ]}
                      value={filter.sortValuesBy}
                      onChange={(v) =>
                        onChange({ sortValuesBy: v as "manual" | "alpha" })
                      }
                    />
                  </div>
                )}
                <div style={{ width: "min(260px, 100%)" }}>
                  <TextField
                    label="Collapse after N values (0 = inherit global)"
                    type="number"
                    value={String(filter.collapseAfter ?? 0)}
                    onChange={(v) => {
                      const n = parseInt(v, 10);
                      onChange({ collapseAfter: !n || n <= 0 ? null : n });
                    }}
                    autoComplete="off"
                  />
                </div>
                <div style={{ width: "min(260px, 100%)", paddingTop: 22 }}>
                  <Checkbox
                    label="Show search box inside this filter"
                    checked={filter.searchable}
                    onChange={(v) => onChange({ searchable: v })}
                  />
                </div>
              </InlineStack>
            )}

            {isTree && (
              <>
                <Divider />
                <BlockStack gap="400">
                  <InlineStack
                    align="space-between"
                    blockAlign="center"
                    wrap={false}
                  >
                    <Text as="h3" variant="headingSm">
                      Collection tree
                    </Text>
                    <Button
                      icon={PlusIcon}
                      onClick={() => setCreatingUnder(null)}
                    >
                      New collection
                    </Button>
                  </InlineStack>
                  <Text as="p" variant="bodySm" tone="subdued">
                    The tree is built from your Shopify collections — every
                    detected collection is already a node below. Need one that
                    doesn&apos;t exist yet? <strong>New collection</strong>{" "}
                    creates a real collection in Shopify (name + the products
                    you pick) and drops it into the tree, so you can build
                    parents, sub-collections and their sub-collections without
                    leaving this page. Use <strong>Products</strong> on any node
                    to change what it holds, and the bin to delete it from
                    Shopify — only a node with no sub-collections can be
                    deleted.
                  </Text>

                  {/* Two equal columns. Per-field helpText is kept short so the
                    columns stay the same height; the longer note about
                    reordering belongs to the value list, so it sits below. */}
                  <InlineStack gap="400" wrap align="start">
                    <div style={{ width: "min(260px, 100%)" }}>
                      <Select
                        label="Clicking a collection"
                        options={[
                          {
                            label: "Filters the current grid",
                            value: "filter",
                          },
                          {
                            label: "Opens the collection page",
                            value: "navigate",
                          },
                        ]}
                        value={
                          filter.styleOptions.treeMode === "navigate"
                            ? "navigate"
                            : "filter"
                        }
                        onChange={(v) =>
                          onChange({
                            styleOptions: {
                              ...filter.styleOptions,
                              treeMode: v as "filter" | "navigate",
                            },
                          })
                        }
                      />
                    </div>
                    <div style={{ width: "min(260px, 100%)" }}>
                      {filter.styleOptions.treeMode !== "navigate" && (
                        <Select
                          label="Selecting a parent"
                          options={[
                            {
                              label: "Selects only that collection",
                              value: "single",
                            },
                            {
                              label: "Also selects its sub-collections",
                              value: "cascade",
                            },
                          ]}
                          value={
                            filter.styleOptions.treeAutoSelect
                              ? "cascade"
                              : "single"
                          }
                          onChange={(v) =>
                            onChange({
                              styleOptions: {
                                ...filter.styleOptions,
                                treeAutoSelect: v === "cascade",
                              },
                            })
                          }
                          helpText={
                            filter.styleOptions.treeAutoSelect
                              ? "A parent's count covers its sub-collections too, so the number always matches what clicking returns."
                              : "A parent's count covers only the products in that collection itself."
                          }
                        />
                      )}
                    </div>
                  </InlineStack>

                  {/* Applies to both tree modes — navigate trees have carets too. */}
                  <Checkbox
                    label="Expand the whole tree when the filter opens"
                    checked={filter.styleOptions.treeExpanded !== false}
                    onChange={(v) =>
                      onChange({
                        styleOptions: {
                          ...filter.styleOptions,
                          treeExpanded: v,
                        },
                      })
                    }
                    helpText={
                      filter.styleOptions.treeExpanded === false
                        ? "Only top-level collections show; shoppers open a collection's arrow to reveal what's inside."
                        : "Every sub-collection is visible straight away."
                    }
                  />

                  <Text as="p" variant="bodySm" tone="subdued">
                    In the value list below, drag a collection by its{" "}
                    <strong>⠿</strong> handle to move it — it carries its
                    sub-collections and joins the level it&apos;s dropped into.
                    Use <strong>→ ←</strong> to nest or un-nest without moving
                    it.
                  </Text>
                </BlockStack>
              </>
            )}

            {isList && isPill && (
              <InlineStack gap="400" wrap blockAlign="center">
                <div style={{ width: "min(260px, 100%)" }}>
                  <Select
                    label="Selected pill style (when clicked)"
                    options={[
                      { label: "Filled with color", value: "colored" },
                      { label: "Outlined", value: "transparent" },
                    ]}
                    value={pillFill}
                    onChange={(v) =>
                      onChange({
                        styleOptions: {
                          ...filter.styleOptions,
                          pillFill: v as "transparent" | "colored",
                        },
                      })
                    }
                    helpText={
                      pillFill === "transparent"
                        ? "Selected pills show a bold outline only — no fill or color."
                        : undefined
                    }
                  />
                </div>
                {pillFill === "colored" && (
                  <div style={{ paddingTop: 22 }}>
                    <ColorField
                      label="Selected color"
                      value={filter.styleOptions.pillColor ?? "#111111"}
                      onChange={(hex) =>
                        onChange({
                          styleOptions: {
                            ...filter.styleOptions,
                            pillColor: hex,
                          },
                        })
                      }
                    />
                  </div>
                )}
              </InlineStack>
            )}

            {filter.type === "price" && (
              <InlineStack gap="400" wrap>
                <div style={{ width: "min(180px, 100%)" }}>
                  <TextField
                    label="Min"
                    type="number"
                    value={String(filter.styleOptions.min ?? 0)}
                    onChange={(v) =>
                      onChange({
                        styleOptions: {
                          ...filter.styleOptions,
                          min: parseFloat(v) || 0,
                        },
                      })
                    }
                    autoComplete="off"
                  />
                </div>
                <div style={{ width: "min(180px, 100%)" }}>
                  <TextField
                    label="Max"
                    type="number"
                    value={String(filter.styleOptions.max ?? 0)}
                    onChange={(v) =>
                      onChange({
                        styleOptions: {
                          ...filter.styleOptions,
                          max: parseFloat(v) || 0,
                        },
                      })
                    }
                    autoComplete="off"
                  />
                </div>
              </InlineStack>
            )}

            {isCustom && (
              <BlockStack gap="200">
                <Divider />
                <CustomValuesEditor filter={filter} onChange={onChange} />
              </BlockStack>
            )}

            {isList && !isCustom && (
              <BlockStack gap="200">
                <Divider />
                <InlineStack align="space-between" blockAlign="center">
                  <Text as="h3" variant="headingSm">
                    Values ({filter.values.length})
                  </Text>
                  <InlineStack gap="200" blockAlign="center">
                    {/* Sits with the list, not just in the section header: every
                        row offers "+ Sub", so a top-level collection needs an
                        equally reachable way in. */}
                    {isTree && (
                      <Button
                        icon={PlusIcon}
                        onClick={() => setCreatingUnder(null)}
                      >
                        Create collection
                      </Button>
                    )}
                    <div style={{ flex: "1 1 180px", maxWidth: 240 }}>
                      <TextField
                        label="Search values"
                        labelHidden
                        placeholder="Search values…"
                        value={valueSearch}
                        onChange={(v) => {
                          setValueSearch(v);
                          setShownCount(VALUES_PAGE);
                        }}
                        autoComplete="off"
                        clearButton
                        onClearButtonClick={() => setValueSearch("")}
                      />
                    </div>
                  </InlineStack>
                </InlineStack>

                {/* A shop with no collections yet would otherwise see an empty
                    "Values (0)" and no way forward — the tree can't detect what
                    doesn't exist, so offer to create the first one here. */}
                {isTree && filter.values.length === 0 && (
                  <Box
                    padding="500"
                    borderColor="border"
                    borderWidth="025"
                    borderRadius="200"
                  >
                    <BlockStack gap="300" inlineAlign="center">
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        No collections yet
                      </Text>
                      <Button
                        variant="primary"
                        icon={PlusIcon}
                        onClick={() => setCreatingUnder(null)}
                      >
                        Create a collection
                      </Button>
                    </BlockStack>
                  </Box>
                )}

                <BlockStack gap="100">
                  {visibleValues.slice(0, shownCount).map((v) => {
                    const treeDrag = isTree && !valueSearch;
                    return (
                      <div
                        key={v.raw}
                        draggable={treeDrag && grabbedRaw === v.raw}
                        onDragStart={(e) => {
                          if (!treeDrag) return;
                          setDragRaw(v.raw);
                          e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          if (!treeDrag || !dragRaw) return;
                          e.preventDefault();
                          if (overRaw !== v.raw) setOverRaw(v.raw);
                        }}
                        onDrop={(e) => {
                          if (!treeDrag) return;
                          e.preventDefault();
                          if (dragRaw) dropTreeValue(dragRaw, v.raw);
                          endTreeDrag();
                        }}
                        onDragEnd={endTreeDrag}
                        style={
                          treeDrag
                            ? {
                                // Capped relative to the modal so deep trees still fit on phones.
                                paddingLeft: `min(${(depthByRaw.get(v.raw) ?? 0) * 24}px, ${(depthByRaw.get(v.raw) ?? 0) * 5}%)`,
                                opacity: dragRaw === v.raw ? 0.4 : 1,
                                borderTop:
                                  overRaw === v.raw &&
                                  dragRaw &&
                                  canDropOn(dragRaw, v.raw)
                                    ? "2px solid #4a7dff"
                                    : "2px solid transparent",
                              }
                            : undefined
                        }
                      >
                        <InlineStack gap="200" blockAlign="center">
                          {treeDrag && (
                            <>
                              <span
                                aria-hidden="true"
                                onMouseDown={() => setGrabbedRaw(v.raw)}
                                onMouseUp={() => setGrabbedRaw(null)}
                                style={{
                                  cursor: "grab",
                                  color: "#999",
                                  fontSize: 16,
                                  userSelect: "none",
                                  padding: "0 2px",
                                }}
                              >
                                ⠿
                              </span>
                              <ButtonGroup>
                                <Button
                                  size="micro"
                                  disabled={!v.parentRaw}
                                  onClick={() => outdentValue(v.raw)}
                                  accessibilityLabel={`Move ${v.raw} up one level`}
                                >
                                  ←
                                </Button>
                                <Button
                                  size="micro"
                                  onClick={() => indentValue(v.raw)}
                                  accessibilityLabel={`Nest ${v.raw} under the collection above`}
                                >
                                  →
                                </Button>
                              </ButtonGroup>
                            </>
                          )}
                          {!isTree &&
                            filter.sortValuesBy === "manual" &&
                            !valueSearch && (
                              <ButtonGroup>
                                <Button
                                  size="micro"
                                  onClick={() => moveValue(v.raw, -1)}
                                  accessibilityLabel={`Move ${v.raw} up`}
                                >
                                  ↑
                                </Button>
                                <Button
                                  size="micro"
                                  onClick={() => moveValue(v.raw, 1)}
                                  accessibilityLabel={`Move ${v.raw} down`}
                                >
                                  ↓
                                </Button>
                              </ButtonGroup>
                            )}
                          {showSwatchColor && (
                            <ColorField
                              labelHidden
                              swatchSize={28}
                              label={
                                v.color || detectSwatchColor(v.label ?? v.raw)
                                  ? `Swatch color for ${v.raw}`
                                  : `No colour auto-detected for ${v.raw} — pick one`
                              }
                              value={
                                v.color ??
                                detectSwatchColor(v.label ?? v.raw) ??
                                "#cccccc"
                              }
                              onChange={(hex) =>
                                patchValue(v.raw, { color: hex })
                              }
                            />
                          )}
                          <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                            <TextField
                              label={`Display name for ${v.raw}`}
                              labelHidden
                              value={v.label ?? v.raw}
                              onChange={(val) =>
                                patchValue(v.raw, {
                                  label: val === v.raw ? null : val,
                                })
                              }
                              autoComplete="off"
                              maxLength={LABEL_MAX_LENGTH}
                              disabled={v.hidden}
                            />
                          </div>
                          {showImage && (
                            <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                              <TextField
                                label={`Image URL for ${v.raw}`}
                                labelHidden
                                placeholder="Image URL…"
                                value={v.image ?? ""}
                                onChange={(val) =>
                                  patchValue(v.raw, { image: val || null })
                                }
                                autoComplete="off"
                              />
                            </div>
                          )}
                          {v.stale && (
                            <Badge tone="warning">Not in catalog</Badge>
                          )}
                          {isTree && (
                            <ButtonGroup noWrap>
                              <Button
                                size="micro"
                                onClick={() => setProductsFor(v)}
                                accessibilityLabel={`Edit the products in ${v.label ?? v.raw}`}
                              >
                                Products
                              </Button>
                              <Button
                                size="micro"
                                onClick={() => setCreatingUnder(v.raw)}
                                accessibilityLabel={`Add a sub-collection under ${v.label ?? v.raw}`}
                              >
                                + Sub
                              </Button>
                              {/* Only leaves can go: deleting a parent would
                                  orphan its sub-collections, and the delete
                                  reaches into Shopify itself. */}
                              <Button
                                size="micro"
                                tone="critical"
                                icon={DeleteIcon}
                                disabled={childCount(v.raw) > 0}
                                onClick={() => setDeleting(v)}
                                accessibilityLabel={
                                  childCount(v.raw) > 0
                                    ? `${v.label ?? v.raw} has sub-collections — move or delete those first`
                                    : `Delete the collection ${v.label ?? v.raw} from Shopify`
                                }
                              />
                            </ButtonGroup>
                          )}
                          <Button
                            size="micro"
                            pressed={v.pinned === "top"}
                            onClick={() =>
                              patchValue(v.raw, {
                                pinned: v.pinned === "top" ? null : "top",
                              })
                            }
                            accessibilityLabel={`Pin ${v.raw} to top`}
                          >
                            📌
                          </Button>
                          <Button
                            size="micro"
                            pressed={v.hidden}
                            onClick={() =>
                              patchValue(v.raw, { hidden: !v.hidden })
                            }
                          >
                            {v.hidden ? "Show" : "Hide"}
                          </Button>
                        </InlineStack>
                      </div>
                    );
                  })}
                </BlockStack>

                {visibleValues.length > shownCount && (
                  <Button
                    onClick={() => setShownCount((n) => n + VALUES_PAGE)}
                    variant="plain"
                  >
                    {`Show ${Math.min(VALUES_PAGE, visibleValues.length - shownCount)} more of ${visibleValues.length - shownCount} remaining`}
                  </Button>
                )}
              </BlockStack>
            )}
          </BlockStack>
        </Modal.Section>
        <Modal.Section>
          <InlineStack align="end">
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </InlineStack>
        </Modal.Section>
      </Modal>

      {creatingUnder !== false && (
        <NewCollectionModal
          parentRaw={creatingUnder}
          parentLabel={
            creatingUnder
              ? (filter.values.find((v) => v.raw === creatingUnder)?.label ??
                creatingUnder)
              : null
          }
          onClose={() => setCreatingUnder(false)}
          onCreated={(c, parentRaw) => {
            addCollectionValue(c, parentRaw);
            setCreatingUnder(false);
          }}
        />
      )}

      {productsFor && (
        <CollectionProductsModal
          value={productsFor}
          onClose={() => setProductsFor(null)}
        />
      )}

      {deleting && (
        <DeleteCollectionModal
          value={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            removeValue(deleting.raw);
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
