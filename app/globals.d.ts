declare module "*.css";

// Shopify Polaris web components (s-*) are typed by @shopify/polaris-types,
// wired in via tsconfig "types". Only elements that package doesn't cover
// are declared here.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-window": React.HTMLAttributes<HTMLElement> & {
        id?: string;
        src?: string;
        ref?: React.Ref<HTMLElement>;
      };
      "ui-save-bar": React.HTMLAttributes<HTMLElement> & { id?: string };
    }
  }
}

export {};
