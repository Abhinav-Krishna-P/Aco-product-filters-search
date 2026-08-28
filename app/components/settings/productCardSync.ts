import { useEffect, useRef } from "react";
import type { ProductCardConfig } from "../../models/filterConfig.shared";

export type ProductCardSyncPayload = {
  productCard: ProductCardConfig;
  customCss: string;
};

export type ProductCardSyncMessage =
  | { type: "pf-pc-request-config" }
  | {
    type: "pf-pc-config";
    productCard: ProductCardConfig;
    customCss: string;
    /** When true, iframe should adopt parent state (unsaved customizer edits). */
    draft?: boolean;
    /**
     * Last saved state, when it differs from the adopted state: the iframe
     * compares against it, so restored unsaved edits still count as unsaved.
     */
    baseline?: ProductCardSyncPayload;
  }
  | {
    type: "pf-pc-update";
    productCard?: ProductCardConfig;
    customCss?: string;
  }
  | { type: "pf-pc-saved"; productCard: ProductCardConfig; customCss: string }
  | { type: "pf-pc-dirty"; dirty: boolean }
  | { type: "pf-pc-close" };

export function isProductCardSyncMessage(
  data: unknown,
): data is ProductCardSyncMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as { type: unknown }).type === "string" &&
    (data as { type: string }).type.startsWith("pf-pc-")
  );
}

export function postProductCardUpdate(
  target: Window,
  patch: Partial<ProductCardSyncPayload>,
) {
  target.postMessage({ type: "pf-pc-update", ...patch }, location.origin);
}

export function postProductCardConfig(
  target: Window,
  payload: ProductCardSyncPayload,
  options?: { draft?: boolean; baseline?: ProductCardSyncPayload },
) {
  target.postMessage(
    {
      type: "pf-pc-config",
      ...payload,
      draft: options?.draft ?? false,
      ...(options?.baseline ? { baseline: options.baseline } : {}),
    },
    location.origin,
  );
}

/** Iframe → parent: ask for the state to show (sent once on load). */
export function postProductCardRequestConfig(target: Window) {
  target.postMessage({ type: "pf-pc-request-config" }, location.origin);
}

export function postProductCardSaved(
  target: Window,
  payload: ProductCardSyncPayload,
) {
  target.postMessage({ type: "pf-pc-saved", ...payload }, location.origin);
}

export function postProductCardDirty(target: Window, dirty: boolean) {
  target.postMessage({ type: "pf-pc-dirty", dirty }, location.origin);
}

export function postProductCardClose(target: Window) {
  target.postMessage({ type: "pf-pc-close" }, location.origin);
}

type ParentSyncOptions = {
  productCard: ProductCardConfig;
  customCss: string;
  onProductCardChange: (pc: ProductCardConfig) => void;
  onCustomCssChange: (css: string) => void;
  onSaved?: (payload: ProductCardSyncPayload) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCloseRequested?: () => void;
  /** Reply to the iframe's config request; defaults to the parent's props. */
  getConfigReply?: () => {
    payload: ProductCardSyncPayload;
    options?: { draft?: boolean; baseline?: ProductCardSyncPayload };
  };
};

/** Respond to config requests from an iframe customizer (parent settings page). */
export function useProductCardParentSync({
  productCard,
  customCss,
  onProductCardChange,
  onCustomCssChange,
  onSaved,
  onDirtyChange,
  onCloseRequested,
  getConfigReply,
}: ParentSyncOptions) {
  const latestRef = useRef({ productCard, customCss });
  latestRef.current = { productCard, customCss };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isProductCardSyncMessage(event.data)) return;

      if (event.data.type === "pf-pc-request-config") {
        const source = event.source as Window | null;
        if (source) {
          const reply = getConfigReply?.();
          if (reply) postProductCardConfig(source, reply.payload, reply.options);
          else postProductCardConfig(source, latestRef.current);
        }
        return;
      }

      if (event.data.type === "pf-pc-update") {
        if (event.data.productCard) {
          onProductCardChange(event.data.productCard);
        }
        if (event.data.customCss !== undefined) {
          onCustomCssChange(event.data.customCss);
        }
        return;
      }

      if (event.data.type === "pf-pc-saved") {
        onSaved?.({
          productCard: event.data.productCard,
          customCss: event.data.customCss,
        });
        return;
      }

      if (event.data.type === "pf-pc-dirty") {
        onDirtyChange?.(event.data.dirty);
        return;
      }

      if (event.data.type === "pf-pc-close") {
        onCloseRequested?.();
        return;
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    onProductCardChange,
    onCustomCssChange,
    onSaved,
    onDirtyChange,
    onCloseRequested,
    getConfigReply,
  ]);
}
