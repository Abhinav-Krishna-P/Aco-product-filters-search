import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "@remix-run/react";
import { Modal, Text } from "@shopify/polaris";
import type { ProductCardConfig } from "../../models/filterConfig.shared";
import { SettingsSection } from "./SettingsSection";
import {
  postProductCardConfig,
  useProductCardParentSync,
} from "./productCardSync";

const APP_WINDOW_ID = "product-card-customizer-window";

type AppWindowElement = HTMLElement & {
  show?: () => Promise<void>;
  hide?: () => Promise<void>;
  contentWindow?: Window | null;
};

type Props = {
  productCard: ProductCardConfig;
  customCss: string;
  /** Parent has unsaved product-card edits not yet written to the DB. */
  productCardDraft?: boolean;
  /** Last persisted card (what Discard returns to). Defaults to the props. */
  savedProductCard?: ProductCardConfig;
  savedCustomCss?: string;
  /** Reset the parent's unsaved product-card edits to the saved card. */
  onDiscard?: () => void;
};

const CLOSE_EVENTS = [
  "cancel",
  "close",
  "hide",
  "dismiss",
  "requestclose",
  "request-close",
  "beforehide",
  "beforeclose",
  "app-window:close",
  "app-window:cancel",
  "s-app-window:close",
  "s-app-window:cancel",
];

export function ProductCardTab({
  productCard,
  customCss,
  productCardDraft = false,
  savedProductCard,
  savedCustomCss,
  onDiscard,
}: Props) {
  const location = useLocation();
  const latestRef = useRef({ productCard, customCss });
  latestRef.current = { productCard, customCss };
  const draftRef = useRef(productCardDraft);
  draftRef.current = productCardDraft;

  const [windowMounted, setWindowMounted] = useState(false);
  const [isDirty, setIsDirty] = useState(productCardDraft);
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Last saved card: the baseline restored edits are compared against, and
  // what Discard resets the customizer to.
  const savedRef = useRef({
    productCard: savedProductCard ?? productCard,
    customCss: savedCustomCss ?? customCss,
  });
  savedRef.current = {
    productCard: savedProductCard ?? productCard,
    customCss: savedCustomCss ?? customCss,
  };

  // What a (re)loaded customizer should show. Shopify reloads the window's
  // iframe each time it is shown, so unsaved edits (held by the Settings page
  // as productCard/customCss with productCardDraft) are handed back with the
  // saved card as baseline: they come back, and still count as unsaved.
  const getConfigReply = useCallback(() => {
    if (draftRef.current) {
      return {
        payload: latestRef.current,
        options: { draft: true, baseline: savedRef.current },
      };
    }
    return { payload: savedRef.current, options: { draft: true } };
  }, []);

  const customizerSrc = `/app/product-card-customizer${location.search}`;

  const openCustomizer = () => {
    setIsDirty(productCardDraft);
    isDirtyRef.current = productCardDraft;
    setWindowMounted(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(
        APP_WINDOW_ID,
      ) as AppWindowElement | null;
      void el?.show?.();
    });
  };

  const closeWindow = useCallback(() => {
    setIsDirty(false);
    isDirtyRef.current = false;
    setShowDiscardConfirm(false);
    const el = document.getElementById(
      APP_WINDOW_ID,
    ) as AppWindowElement | null;
    // Hide only — keep the iframe mounted so the next open already has the
    // s-page title bar (heading + Save) instead of flashing the app name.
    void el?.hide?.();
  }, []);

  const discardAndClose = useCallback(() => {
    const el = document.getElementById(
      APP_WINDOW_ID,
    ) as AppWindowElement | null;
    const frame = el?.contentWindow;
    // Drop the edits in the Settings page too, so a later Save there can't
    // persist them; then reset the (kept-mounted) customizer to the saved card.
    onDiscard?.();
    draftRef.current = false;
    if (frame) postProductCardConfig(frame, savedRef.current, { draft: true });
    closeWindow();
  }, [closeWindow, onDiscard]);

  // Keep the edits: just bring the window back (unsaved flag untouched).
  const continueEditing = useCallback(() => {
    setShowDiscardConfirm(false);
    const el = document.getElementById(
      APP_WINDOW_ID,
    ) as AppWindowElement | null;
    void el?.show?.();
  }, []);

  // Prefetch the customizer iframe while the merchant is on this tab so the
  // first "Customize product card" click doesn't wait on a cold route load.
  useEffect(() => {
    setWindowMounted(true);
  }, []);

  useProductCardParentSync({
    productCard,
    customCss,
    onProductCardChange: () => {
      setIsDirty(true);
      isDirtyRef.current = true;
    },
    onCustomCssChange: () => {
      setIsDirty(true);
      isDirtyRef.current = true;
    },
    onDirtyChange: (dirty) => {
      setIsDirty(dirty);
      isDirtyRef.current = dirty;
    },
    onSaved: (payload) => {
      savedRef.current = payload;
      draftRef.current = false;
      setIsDirty(false);
      isDirtyRef.current = false;
    },
    onCloseRequested: () => {
      closeWindow();
    },
    getConfigReply,
  });

  // Intercept close events on the app window and its shadow DOM.
  useEffect(() => {
    if (!windowMounted) return;

    const el = document.getElementById(
      APP_WINDOW_ID,
    ) as AppWindowElement | null;
    if (!el) return;

    const onShow = () => {
      const frame = el.contentWindow;
      if (frame) {
        const reply = getConfigReply();
        postProductCardConfig(frame, reply.payload, reply.options);
      }
    };

    const handleCloseAttempt = (e: Event) => {
      // The Settings page's draft flag covers edits made before an iframe
      // reload, which the reloaded customizer may not have reported yet.
      if (!isDirtyRef.current && !draftRef.current) {
        // No unsaved changes — close immediately, no confirmation needed.
        closeWindow();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (
        typeof (e as { stopImmediatePropagation?: () => void })
          .stopImmediatePropagation === "function"
      ) {
        (
          e as { stopImmediatePropagation: () => void }
        ).stopImmediatePropagation();
      }
      setShowDiscardConfirm(true);
    };

    const handleClickCapture = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      const isCloseBtn =
        target.closest?.('[aria-label*="close" i]') ||
        target.closest?.('[aria-label*="cancel" i]') ||
        target.closest?.(".polar-modal-close") ||
        target.closest?.(".s-app-window-close") ||
        target.closest?.('button[aria-label*="Close"]') ||
        target.closest?.('s-button[slot="close"]');

      if (isCloseBtn) {
        handleCloseAttempt(e);
      }
    };

    el.addEventListener("show", onShow);

    CLOSE_EVENTS.forEach((evt) => {
      el.addEventListener(evt, handleCloseAttempt, true);
    });
    el.addEventListener("click", handleClickCapture, true);

    // Also attach to shadow root if available or created asynchronously
    const attachShadowListeners = () => {
      const shadow = el.shadowRoot;
      if (shadow) {
        CLOSE_EVENTS.forEach((evt) => {
          shadow.addEventListener(evt, handleCloseAttempt, true);
        });
        shadow.addEventListener("click", handleClickCapture, true);
        const closeBtns = shadow.querySelectorAll(
          'button, s-button, [aria-label*="close" i], [aria-label*="Close"], .close',
        );
        closeBtns.forEach((btn) => {
          btn.addEventListener("click", handleCloseAttempt, true);
        });
      }
    };

    attachShadowListeners();
    const timer = setInterval(attachShadowListeners, 300);

    return () => {
      clearInterval(timer);
      el.removeEventListener("show", onShow);
      CLOSE_EVENTS.forEach((evt) => {
        el.removeEventListener(evt, handleCloseAttempt, true);
      });
      el.removeEventListener("click", handleClickCapture, true);
      const shadow = el.shadowRoot;
      if (shadow) {
        CLOSE_EVENTS.forEach((evt) => {
          shadow.removeEventListener(evt, handleCloseAttempt, true);
        });
        shadow.removeEventListener("click", handleClickCapture, true);
      }
    };
  }, [windowMounted]);

  return (
    <>
      {windowMounted ? (
        <s-app-window id={APP_WINDOW_ID} src={customizerSrc} />
      ) : null}

      {showDiscardConfirm && (
        <Modal
          open
          onClose={() => setShowDiscardConfirm(false)}
          title="Discard unsaved changes?"
          primaryAction={{
            content: "Discard changes",
            destructive: true,
            onAction: discardAndClose,
          }}
          secondaryActions={[
            {
              content: "Continue editing",
              onAction: continueEditing,
            },
          ]}
        >
          <Modal.Section>
            <Text as="p">
              You have unsaved changes to your product card. Are you sure you
              want to discard them?
            </Text>
          </Modal.Section>
        </Modal>
      )}

      <SettingsSection
        title="Product card"
        description="Customize your product card to match your theme."
        actions={
          <s-button variant="primary" onClick={openCustomizer}>
            Customize product card
          </s-button>
        }
      >
        <s-paragraph color="subdued">
          Your custom product card may not look exactly like your theme&apos;s
          default product card. Most customization options live in the product
          card editor. For further customization or if you run into
          difficulties, contact our team and we&apos;ll help you get it looking
          right.
        </s-paragraph>
      </SettingsSection>
    </>
  );
}
