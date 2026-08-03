import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  matchSmartFilters,
  type SmartFilterGroup,
} from "../models/smartFilters.shared";

const MAX_QUERY_LEN = 400;
const MAX_GROUPS = 80;
const MAX_VALUES_PER_GROUP = 200;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function sanitizeFilters(raw: unknown): SmartFilterGroup[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_GROUPS).map((g: any) => ({
    key: String(g?.key || "").slice(0, 80),
    paramName: String(g?.paramName || "").slice(0, 80),
    label: String(g?.label || "").slice(0, 120),
    values: Array.isArray(g?.values)
      ? g.values.slice(0, MAX_VALUES_PER_GROUP).map((v: any) => ({
          raw: String(v?.raw ?? "").slice(0, 120),
          label: String(v?.label ?? v?.raw ?? "").slice(0, 120),
        }))
      : [],
  }));
}

/**
 * App Proxy: storefront POSTs to /apps/pf-filter/smart-filters
 * → {application_url}/proxy/smart-filters
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.public.appProxy(request);
  return json({
    ok: true,
    service: "smart-filters",
    methods: ["POST"],
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.public.appProxy(request);

  if (request.method !== "POST") {
    return json({ ok: false, message: "Method not allowed" }, 405);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: "Invalid JSON body" }, 400);
  }

  const query = String(body?.query ?? "").slice(0, MAX_QUERY_LEN);
  const filters = sanitizeFilters(body?.filters);

  const result = matchSmartFilters({ query, filters });
  return json(result);
};
