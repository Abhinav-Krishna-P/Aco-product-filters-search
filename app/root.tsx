import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "@remix-run/react";

export default function App() {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <link rel="preconnect" href="https://cdn.shopify.com/" />
        <link
          rel="stylesheet"
          href="https://cdn.shopify.com/static/fonts/inter/v4/styles.css"
        />
        <Meta />
        <Links />
        {/*
          Registers Polaris web components (s-select, s-modal, s-number-field,
          etc.). Keep it LAST in <head>: it injects its own Inter font <link>
          into the head as it runs. Placed before <Links />, that link lands
          between the server-rendered tags, React's hydration of <head> fails,
          and React re-renders the whole document — re-inserting every
          stylesheet as non-blocking, so pages (notably the product card
          customizer window) flash unstyled. At the end of <head> the injected
          node is trailing, which React tolerates. Still parser-blocking, so
          the components are defined before <body> is parsed.
        */}
        <script src="https://cdn.shopify.com/shopifycloud/polaris.js" />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
