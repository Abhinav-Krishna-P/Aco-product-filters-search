/** Plain-language version of an error for merchants (safe for client code). */
export function describeAdminError(err: unknown): string {
  const message = err instanceof Error ? err.message : err ? String(err) : "";
  if (/access denied/i.test(message)) {
    return "Shopify doesn't allow apps to edit this theme's files while it is on trial. Purchase the theme, or pick another one.";
  }
  if (/throttl|rate limit|too many requests/i.test(message)) {
    return "Shopify is busy right now. Please try again in a moment.";
  }
  return message || "Something went wrong. Please try again.";
}

export type AdminErrorKind = "offline" | "server" | "generic";

const OFFLINE_RE =
  /failed to fetch|networkerror|load failed|network request failed|err_internet_disconnected|err_network_changed|err_connection/i;
const SERVER_RE =
  /\b50[0234]\b|bad gateway|service unavailable|gateway timeout|internal server error/i;

/**
 * Which friendly screen an admin error deserves.
 *  - offline: the browser has no connection, or a request died in transit
 *  - server:  the app's server answered 5xx (down, bad gateway, timeout)
 *  - generic: anything else
 */
export function classifyAdminError(
  err: unknown,
  online: boolean = typeof navigator === "undefined" ? true : navigator.onLine,
): AdminErrorKind {
  if (!online) return "offline";
  const status =
    err && typeof err === "object" && "status" in err
      ? Number((err as { status: unknown }).status)
      : NaN;
  if (status >= 500 && status <= 599) return "server";
  const message = err instanceof Error ? err.message : err ? String(err) : "";
  if (OFFLINE_RE.test(message)) return "offline";
  if (SERVER_RE.test(message)) return "server";
  return "generic";
}
