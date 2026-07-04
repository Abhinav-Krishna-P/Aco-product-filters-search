import {
  redirect,
  type HeadersFunction,
  type LoaderFunctionArgs,
} from "@remix-run/node";
import {
  Link,
  Outlet,
  useLoaderData,
  useLocation,
  useNavigation,
  isRouteErrorResponse,
  useRouteError,
} from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";
import { useEffect, useState } from "react";
// Inlined into the bundle on purpose: the offline screen must show its image
// when the network is gone, so it can't be a separate download.
import disconnectedImg from "../assets/disconnected.webp?inline";
import {
  classifyAdminError,
  describeAdminError,
  type AdminErrorKind,
} from "../models/adminErrors.shared";
import { isShopOnboardingComplete } from "../models/shop.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const onboardingComplete = await isShopOnboardingComplete(session.shop);
  const url = new URL(request.url);
  const isHome = url.pathname === "/app" || url.pathname === "/app/";
  const isOnboardingAction =
    url.searchParams.get("onboarding") === "1" && request.method === "GET";

  if (!onboardingComplete && !isHome && !isOnboardingAction) {
    throw redirect("/app");
  }

  return {
    apiKey: process.env.SHOPIFY_API_KEY || "",
    onboardingComplete,
  };
};

function PageLoadingSpinner() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
      }}
    >
      <s-stack alignItems="center" gap="base" padding="large">
        <s-spinner accessibilityLabel="Loading page" size="large" />
        <s-text>Loading...</s-text>
      </s-stack>
    </div>
  );
}

export default function App() {
  const { apiKey, onboardingComplete } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();
  // Only blank the page for Home ↔ Settings ↔ Analytics switches — not for
  // in-page query changes (e.g. analytics date range presets).
  // The product card customizer renders inside an app window (iframe) where
  // App Bridge does not take over the nav element, so the links would show.
  const isCustomizerWindow = location.pathname.startsWith(
    "/app/product-card-customizer",
  );
  const isPageSwitch =
    navigation.state === "loading" &&
    navigation.location != null &&
    navigation.location.pathname !== location.pathname;

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      {onboardingComplete && !isCustomizerWindow ? (
        <NavMenu>
          <Link to="/app" rel="home">
            Home
          </Link>
          <Link to="/app/settings">Settings </Link>
          <Link to="/app/analytics">Analytics</Link>
        </NavMenu>
      ) : null}
      {isPageSwitch ? <PageLoadingSpinner /> : <Outlet />}
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses (auth bounces), so that
// their headers are included in the response. Everything else gets a friendly
// screen: offline, server down (5xx), or a plain-language generic error.
export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status < 500) {
    return boundary.error(error);
  }
  return <FriendlyErrorPage error={error} />;
}

const ERROR_COPY: Record<
  AdminErrorKind,
  { title: string; body: (message: string) => string; button: string }
> = {
  offline: {
    title: "Check your internet connection",
    body: () =>
      "We couldn't reach the app. Your connection seems to be off or very slow. Reconnect and this page reloads by itself, or try again now.",
    button: "Try again",
  },
  server: {
    title: "Our server isn't responding",
    body: () =>
      "This is a problem on our side, not with your store or connection. Your settings are safe. Please try again in a minute.",
    button: "Try again",
  },
  generic: {
    title: "Something went wrong",
    body: (message) => message,
    button: "Reload page",
  },
};

function FriendlyErrorPage({ error }: { error: unknown }) {
  // Server render can't see the browser's connection; refine after mount.
  const [kind, setKind] = useState<AdminErrorKind>(() =>
    classifyAdminError(error, true),
  );

  useEffect(() => {
    setKind(classifyAdminError(error));
    const goOffline = () => setKind("offline");
    const backOnline = () => {
      // Connection is back: reload so the failed request runs again.
      if (classifyAdminError(error, false) === "offline") {
        window.location.reload();
      }
    };
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", backOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", backOnline);
    };
  }, [error]);

  const copy = ERROR_COPY[kind];
  return (
    <div
      role="alert"
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh",
        boxSizing: "border-box",
        padding: "32px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
      }}
    >
      {kind === "generic" ? (
        <WarningIllustration />
      ) : (
        <img
          src={disconnectedImg}
          alt=""
          width={360}
          height={132}
          style={{
            width: "100%",
            maxWidth: 360,
            height: "auto",
            marginBottom: 24,
          }}
        />
      )}
      <h2
        style={{
          margin: "0 0 8px",
          fontSize: 18,
          fontWeight: 650,
          color: "#303030",
        }}
      >
        {copy.title}
      </h2>
      <p
        style={{
          margin: "0 0 20px",
          maxWidth: 420,
          color: "#616161",
          fontSize: 14,
          lineHeight: 1.5,
        }}
      >
        {copy.body(describeAdminError(error))}
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          background: "#303030",
          color: "#fff",
          border: 0,
          borderRadius: 8,
          padding: "8px 16px",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        {copy.button}
      </button>
    </div>
  );
}

function WarningIllustration() {
  return (
    <svg
      style={{ marginBottom: 16 }}
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="32"
        cy="32"
        r="22"
        fill="#f6f6f6"
        stroke="#8a8a8a"
        strokeWidth="2"
      />
      <path
        d="M32 21v14"
        stroke="#303030"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="32" cy="42" r="2" fill="#303030" />
    </svg>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
