import { useState } from "react";
import {
  BlockStack,
  Modal,
  Text,
  TextField,
} from "@shopify/polaris";
import { LABEL_MAX_LENGTH } from "../../models/filterConfig.shared";

/** Name prompt for a new custom filter. The key is derived from the name. */
export function NewCustomFilterModal({
  onClose,
  onCreate,
}: Readonly<{ onClose: () => void; onCreate: (name: string) => void }>) {
  const [name, setName] = useState("");
  const trimmed = name.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title="New custom filter"
      primaryAction={{
        content: "Create",
        disabled: !trimmed,
        onAction: () => onCreate(trimmed),
      }}
      secondaryActions={[{ content: "Cancel", onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="300">
          <TextField
            label="Filter name"
            value={name}
            onChange={setName}
            placeholder="e.g. Style, Occasion, Room"
            autoComplete="off"
            maxLength={LABEL_MAX_LENGTH}
            showCharacterCount
            helpText="Shown as the group heading on your storefront."
          />
          <Text as="p" variant="bodySm" tone="subdued">
            Next you&apos;ll add options (like "Casual" or "Formal") and choose
            which products belong to each one. Custom filters are never changed
            by <strong>Detect filter values</strong>.
          </Text>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}
