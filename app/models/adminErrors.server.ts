/**
 * Admin-facing error handling.
 *
 * Route actions wrapped in `guardAction` never surface Remix's raw
 * "Application Error" stack page: anything thrown becomes a failed result the
 * page shows as a toast or banner. Thrown Responses (auth redirects from
 * `authenticate.admin`) still propagate because Shopify needs them.
 */

import { describeAdminError } from "./adminErrors.shared.ts";

export type ActionFailure = {
  ok: false;
  errors: { message: string }[];
  action: string;
  config: null;
  themeInject: null;
  themeCards: null;
  themeAssetsSynced: false;
};

export { describeAdminError };

/**
 * Run a route action; convert thrown errors into `{ ok: false, errors }`.
 * The intent is read from a clone of the request so the action can still
 * read the body, and so the page can match the failure to the button pressed.
 */
export async function guardAction<T>(
  args: { request: Request },
  run: () => Promise<T>,
): Promise<T | ActionFailure> {
  // Clone before the action consumes the body.
  const spare = args.request.clone();
  try {
    return await run();
  } catch (err) {
    if (err instanceof Response) throw err;
    let action = "";
    try {
      const fd = await spare.formData();
      action = String(fd.get("intent") || "");
    } catch {
      /* body not a form; leave the intent empty */
    }
    console.error(`[admin] action${action ? ` ${action}` : ""} failed:`, err);
    return {
      ok: false,
      errors: [{ message: describeAdminError(err) }],
      action,
      config: null,
      themeInject: null,
      themeCards: null,
      themeAssetsSynced: false,
    };
  }
}
