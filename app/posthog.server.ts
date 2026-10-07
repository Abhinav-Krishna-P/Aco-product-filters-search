import { PostHog } from "posthog-node";

declare global {
  var posthogGlobal: PostHog;
}

if (!global.posthogGlobal) {
  global.posthogGlobal = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: process.env.POSTHOG_HOST,
    enableExceptionAutocapture: true,
  });
}

const posthog = global.posthogGlobal;

export default posthog;
