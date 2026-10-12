import { useState, useCallback, useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate, useFetcher } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Box,
  Text,
  Badge,
  Button,
  ButtonGroup,
  DatePicker,
  Banner,
  Popover,
  Link,
  Thumbnail,
  Icon,
  SkeletonDisplayText,
  SkeletonBodyText,
} from "@shopify/polaris";
import type { IconSource } from "@shopify/polaris";
import {
  StoreIcon,
  DiscountIcon,
  CategoriesIcon,
  CashDollarIcon,
  InventoryIcon,
  ColorIcon,
  MeasurementSizeIcon,
  VariantIcon,
  FilterIcon,
} from "@shopify/polaris-icons";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import posthog from "../posthog.server";
import {
  PostHogRateLimitError,
  posthogQueryConfigured,
} from "../posthog-query.server";
import {
  getRangeRaw,
  aggregateAnalytics,
  buildBucketsUtc,
  type FilterPair,
} from "../analytics-cache.server";

/**
 * Filter analytics — reads storefront filter-usage events straight from PostHog
 * Cloud (HogQL via the Query API) and aggregates them for the selected date
 * range. Nothing is read from Postgres: the storefront captures events directly
 * to PostHog, and this loader queries them back out server-side with a personal
 * API key. The usage-over-time chart is a small inline SVG (Polaris has none).
 */

type RangeKey = "yesterday" | "today" | "this_month" | "last_month" | "custom";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function parseYmd(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function resolveRange(
  range: string,
  from: string | null,
  to: string | null,
): {
  key: RangeKey;
  start: Date;
  end: Date;
  granularity: "hour" | "day";
  label: string;
  from: string;
  to: string;
} {
  const now = new Date();
  const today = startOfDay(now);
  let key = (
    ["yesterday", "today", "this_month", "last_month", "custom"].includes(range)
      ? range
      : "today"
  ) as RangeKey;
  let start: Date;
  let end: Date;

  if (key === "yesterday") {
    start = addDays(today, -1);
    end = today;
  } else if (key === "this_month") {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = addDays(today, 1);
  } else if (key === "last_month") {
    start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    end = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (key === "custom") {
    const f = parseYmd(from) ?? today;
    const t = parseYmd(to) ?? f;
    start = startOfDay(f);
    end = addDays(startOfDay(t), 1);
    if (end <= start) end = addDays(start, 1);
  } else {
    key = "today";
    start = today;
    end = addDays(today, 1);
  }

  const spanDays = (end.getTime() - start.getTime()) / 86400000;
  const granularity = spanDays <= 2 ? "hour" : "day";
  const label =
    key === "custom"
      ? `${ymd(start)} → ${ymd(addDays(end, -1))}`
      : key === "yesterday"
        ? "Last day"
        : key === "today"
          ? "Today"
          : key === "this_month"
            ? "This month"
            : "Last month";

  return {
    key,
    start,
    end,
    granularity,
    label,
    from: ymd(start),
    to: ymd(addDays(end, -1)),
  };
}

export type AnalyticsPayload = {
  buckets: { t: number; n: number }[];
  totals: { applies: number; selections: number; clicks: number };
  perFilter: { key: string; label: string; n: number }[];
  perOption: { key: string; label: string; value: string; n: number }[];
  together: FilterPair[];
  priceRanges: { label: string; n: number }[];
  topCategory: { value: string; n: number }[];
  topProducts: {
    productId: string;
    title: string;
    handle: string;
    image: string;
    n: number;
  }[];
  configured: boolean;
  queryError: string | null;
  /** Stale cached numbers; a refresh is running server-side. */
  refreshing?: boolean;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  const isDataRequest = url.searchParams.get("data") === "1";

  const r = resolveRange(
    url.searchParams.get("range") || "today",
    url.searchParams.get("from"),
    url.searchParams.get("to"),
  );
  const { start, end, granularity } = r;

  // Background data fetch endpoint (called by client useFetcher)
  if (isDataRequest) {
    const emptyAgg: AnalyticsPayload = {
      buckets: buildBucketsUtc(start, end, granularity, []),
      totals: { applies: 0, selections: 0, clicks: 0 },
      perFilter: [],
      perOption: [],
      together: [],
      priceRanges: [],
      topCategory: [],
      topProducts: [],
      configured: posthogQueryConfigured(),
      queryError: null,
    };

    const rangeMeta = { range: r.key, from: r.from, to: r.to };
    if (!posthogQueryConfigured()) {
      return { ...emptyAgg, ...rangeMeta, configured: false };
    }

    try {
      const raw = await getRangeRaw(shop, start, end);
      const agg = aggregateAnalytics(raw, start, end, granularity);

      // No background pre-warm of other presets: the PostHog Query API quota
      // is shared by every merchant, so each page view must cost one range.

      return {
        ...agg,
        ...rangeMeta,
        configured: true,
        queryError: null,
        refreshing: raw.refreshing === true,
      };
    } catch (err) {
      console.error("[pf-analytics] PostHog query failed:", err);
      return {
        ...emptyAgg,
        ...rangeMeta,
        configured: true,
        queryError:
          err instanceof PostHogRateLimitError
            ? "Analytics is busy right now. Please try again in a few minutes."
            : err instanceof Error
              ? err.message
              : "PostHog query failed",
      };
    }
  }

  // Instant page navigation: log telemetry and return range metadata in < 1ms
  posthog.capture({
    distinctId: shop,
    event: "analytics_report_viewed",
    properties: {
      shop,
      range: url.searchParams.get("range") || "today",
      $process_person_profile: false,
    },
  });

  return {
    shop,
    range: r.key,
    label: r.label,
    from: r.from,
    to: r.to,
    start: start.toISOString(),
    end: end.toISOString(),
    granularity,
  };
};

// ── client helpers ───────────────────────────────────────────────────────────

const PRESETS: { key: RangeKey; label: string }[] = [
  { key: "yesterday", label: "Last day" },
  { key: "today", label: "Today" },
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
];

function nf(n: number): string {
  return new Intl.NumberFormat().format(n);
}

// Monotone cubic (Fritsch–Carlson) interpolation → smooth SVG path that never
// overshoots below the data, so the curve can't dip under zero on flat runs.
function smoothPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0].x.toFixed(2)},${pts[0].y.toFixed(2)}`;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    slope[i] = (ys[i + 1] - ys[i]) / dx[i];
  }
  const m: number[] = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  let d = `M${xs[0].toFixed(2)},${ys[0].toFixed(2)}`;
  for (let i = 0; i < n - 1; i++) {
    const cx1 = xs[i] + dx[i] / 3;
    const cy1 = ys[i] + (m[i] * dx[i]) / 3;
    const cx2 = xs[i + 1] - dx[i] / 3;
    const cy2 = ys[i + 1] - (m[i + 1] * dx[i]) / 3;
    d += ` C${cx1.toFixed(2)},${cy1.toFixed(2)} ${cx2.toFixed(2)},${cy2.toFixed(2)} ${xs[i + 1].toFixed(2)},${ys[i + 1].toFixed(2)}`;
  }
  return d;
}

function UsageChart({
  buckets,
  gran,
  weekAxis,
}: {
  buckets: { t: number; n: number }[];
  gran: "hour" | "day";
  weekAxis: boolean;
}) {
  const [hover, setHover] = useState<number | null>(null);
  // Hour labels are formatted in the viewer's local timezone (below), which the
  // server can't know — so we render them only after mount to keep the first
  // client render identical to the server's and avoid a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // Smaller viewBox → the whole drawing (line, text, spacing) scales up to fill
  // the now half-width card instead of shrinking.
  const W = 470;
  const H = 250;
  const padL = 34;
  const padR = 14;
  const padT = 20;
  const padB = 34;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = Math.max(1, ...buckets.map((b) => b.n));
  const n = buckets.length;
  const x = (i: number) =>
    padL + (n <= 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const baseY = padT + innerH;

  const pts = buckets.map((b, i) => ({ x: x(i), y: y(b.n) }));
  const line = smoothPath(pts);
  const area = pts.length
    ? `${line} L${x(n - 1).toFixed(2)},${baseY.toFixed(2)} L${x(0).toFixed(2)},${baseY.toFixed(2)} Z`
    : "";

  // 24h → "6 AM" / "12 PM" / "12 AM". Uses the viewer's local timezone.
  const hour12 = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
  const fmt = (t: number) => {
    const d = new Date(t);
    return gran === "hour"
      ? hour12(d.getHours())
      : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  const fmtFull = (t: number) => {
    const d = new Date(t);
    return gran === "hour"
      ? `${d.getMonth() + 1}/${d.getDate()} ${hour12(d.getHours())}`
      : `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  };
  const ticks = n <= 1 ? [0] : [0, Math.floor((n - 1) / 2), n - 1];
  // For month presets, label the x-axis by week of the range ("Week 1", "Week 2",
  // …) instead of dates — one tick centered under each 7-day band.
  const weekTicks: { i: number; label: string }[] = [];
  if (weekAxis) {
    for (let w = 0; w * 7 < n; w++) {
      const a = w * 7;
      const b = Math.min(a + 6, n - 1);
      weekTicks.push({ i: Math.floor((a + b) / 2), label: `Week ${w + 1}` });
    }
  }
  const yTicks = [0, Math.round(max / 2), max].filter(
    (v, i, a) => a.indexOf(v) === i,
  );

  const onMove = (e: MouseEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = ((e.clientX - rect.left) / rect.width) * W;
    let idx = n <= 1 ? 0 : Math.round(((rx - padL) / innerW) * (n - 1));
    idx = Math.max(0, Math.min(n - 1, idx));
    setHover(idx);
  };

  // Tooltip placement. Vertically it sits above the point, flipping below only
  // when the point is too high to fit above. Horizontally it clamps at the
  // edges (anchors its left/right edge to the point) so it never clips.
  const hx = hover !== null ? x(hover) / W : 0.5;
  const placeBelow =
    hover !== null && buckets[hover] && y(buckets[hover].n) < H * 0.32;
  const tipTx = hx > 0.78 ? "-100%" : hx < 0.22 ? "0%" : "-50%";
  const tipTy = placeBelow ? "12px" : "calc(-100% - 12px)";

  return (
    <div style={{ position: "relative", width: "100%" }}>
      <div
        style={{ width: "100%", overflowX: "auto" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          role="img"
          aria-label="Filter usage over time"
          style={{ minWidth: 280, display: "block" }}
        >
          <defs>
            {/* blue area fill under the curve */}
            <linearGradient id="pfUsageArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
            </linearGradient>
            {/* blue gradient for the line itself (left→right) */}
            <linearGradient id="pfUsageLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
            {/* soft glow around the line */}
            <filter
              id="pfUsageGlow"
              x="-20%"
              y="-20%"
              width="140%"
              height="140%"
            >
              <feGaussianBlur
                in="SourceGraphic"
                stdDeviation="1.2"
                result="blur"
              />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* horizontal gridlines + y labels */}
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={padL}
                y1={y(v)}
                x2={W - padR}
                y2={y(v)}
                stroke="#f1f2f3"
                strokeWidth="1"
              />
              <text
                x={padL - 8}
                y={y(v) + 4}
                textAnchor="end"
                fontSize="11"
                fill="#8c9196"
              >
                {v}
              </text>
            </g>
          ))}

          {area && <path d={area} fill="url(#pfUsageArea)" />}
          {line && (
            <path
              d={line}
              fill="none"
              stroke="url(#pfUsageLine)"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              filter="url(#pfUsageGlow)"
            />
          )}

          {/* hover guide + marker */}
          {hover !== null && buckets[hover] && (
            <g>
              <line
                x1={x(hover)}
                y1={padT}
                x2={x(hover)}
                y2={baseY}
                stroke="#c9cccf"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={x(hover)}
                cy={y(buckets[hover].n)}
                r="6"
                fill="#2563eb"
                fillOpacity="0.05"
              />
              <circle
                cx={x(hover)}
                cy={y(buckets[hover].n)}
                r="3.5"
                fill="#2563eb"
                stroke="#fff"
                strokeWidth="0.5"
              />
            </g>
          )}

          {/* x tick labels — weeks for month presets; otherwise dates, or
            local-time hours once mounted (see `mounted` above) */}
          {weekAxis
            ? weekTicks.map((w) => (
                <text
                  key={w.label}
                  x={x(w.i)}
                  y={H - 10}
                  textAnchor="middle"
                  fontSize="11"
                  fill="#8c9196"
                >
                  {w.label}
                </text>
              ))
            : gran !== "hour" || mounted
              ? ticks.map((i) => (
                  <text
                    key={i}
                    x={x(i)}
                    y={H - 10}
                    textAnchor="middle"
                    fontSize="11"
                    fill="#8c9196"
                  >
                    {fmt(buckets[i].t)}
                  </text>
                ))
              : null}
        </svg>
      </div>

      {/* floating tooltip */}
      {hover !== null && buckets[hover] && (
        <div
          style={{
            position: "absolute",
            left: `${(x(hover) / W) * 100}%`,
            top: `${(y(buckets[hover].n) / H) * 100}%`,
            transform: `translate(${tipTx}, ${tipTy})`,
            pointerEvents: "none",
            background: "#1a1a1a",
            color: "#fff",
            padding: "6px 10px",
            borderRadius: 8,
            fontSize: 12,
            lineHeight: 1.35,
            whiteSpace: "nowrap",
            boxShadow: "0 4px 12px rgba(0,0,0,0.18)",
            zIndex: 20,
          }}
        >
          <div style={{ opacity: 0.7, fontSize: 11 }}>
            {fmtFull(buckets[hover].t)}
          </div>
          <div style={{ fontWeight: 600 }}>
            {nf(buckets[hover].n)} filter actions
          </div>
        </div>
      )}
    </div>
  );
}

// A single stat box: centered label, a large value, and an optional sub-line.
// `value` is a node so it takes numbers or strings.
function StatBox({
  label,
  value,
  sub,
  emphasize = false,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  // Larger label + value, for the plain-number tiles.
  emphasize?: boolean;
}) {
  return (
    <Card padding="400">
      <BlockStack gap="200" inlineAlign="center">
        <Text
          as="span"
          variant={emphasize ? "bodyMd" : "bodySm"}
          fontWeight="bold"
          tone="subdued"
          alignment="center"
        >
          {label}
        </Text>
        <Text
          as="p"
          variant={emphasize ? "heading2xl" : "headingLg"}
          alignment="center"
        >
          {value}
        </Text>
        {sub ? <Badge tone="info">{sub}</Badge> : null}
      </BlockStack>
    </Card>
  );
}

function uses(n: number): string {
  return `${nf(n)} ${n === 1 ? "use" : "uses"}`;
}

// A Polaris icon for each filter type (keys match app.settings.tsx: available,
// price, type, vendor, tag, and variant options as opt_<name>).
function filterIcon(key: string): IconSource {
  switch (key) {
    case "vendor":
      return StoreIcon;
    case "tag":
      return DiscountIcon;
    case "type":
      return CategoriesIcon;
    case "price":
      return CashDollarIcon;
    case "available":
      return InventoryIcon;
  }
  if (key.startsWith("opt_")) {
    const name = key.slice(4).toLowerCase();
    if (name.includes("color") || name.includes("colour")) return ColorIcon;
    if (name.includes("size")) return MeasurementSizeIcon;
    return VariantIcon;
  }
  return FilterIcon;
}

// Rounded chip: a filter icon + its label, as in the "usually filtered together" rows.
function FilterChip({
  filterKey,
  label,
}: {
  filterKey: string;
  label: string;
}) {
  return (
    <Box
      background="bg-surface-secondary"
      borderRadius="full"
      paddingInline="200"
      paddingBlock="100"
    >
      <InlineStack gap="100" blockAlign="center" wrap={false}>
        <Icon source={filterIcon(filterKey)} tone="info" />
        <Text as="span" variant="bodySm">
          {label}
        </Text>
      </InlineStack>
    </Box>
  );
}

// Distinct categorical palette for the per-filter donut (cycles if there are
// more filters than colours).
const PIE_COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#db2777",
  "#7c3aed",
  "#0891b2",
  "#dc2626",
  "#65a30d",
  "#ea580c",
  "#0d9488",
  "#9333ea",
  "#e11d48",
];

// Donut chart of "total uses per filter" with a colour-coded legend. Slices are
// drawn as dash segments of a single stroked circle, which handles a lone 100%
// slice cleanly (a filled arc path can't draw a full circle).
function PieChart({
  data,
}: {
  data: { key: string; label: string; n: number }[];
}) {
  const size = 172;
  const stroke = 26;
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.n, 0);

  let offset = 0;
  const slices = data.map((d, i) => {
    const frac = total > 0 ? d.n / total : 0;
    const seg = {
      ...d,
      color: PIE_COLORS[i % PIE_COLORS.length],
      dash: frac * circ,
      offset,
      pct: Math.round(frac * 100),
    };
    offset += frac * circ;
    return seg;
  });

  return (
    <InlineStack gap="500" blockAlign="center" wrap>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label="Total uses per filter"
      >
        <g transform={`rotate(-90 ${c} ${c})`}>
          {total === 0 ? (
            <circle
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke="#eef0f1"
              strokeWidth={stroke}
            />
          ) : (
            slices.map((s) => (
              <circle
                key={s.key}
                cx={c}
                cy={c}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={stroke}
                strokeDasharray={`${s.dash} ${circ}`}
                strokeDashoffset={-s.offset}
              />
            ))
          )}
        </g>
        <text
          x={c}
          y={c - 6}
          textAnchor="middle"
          fontSize="24"
          fontWeight="700"
          fill="#202223"
        >
          {nf(total)}
        </text>
        <text x={c} y={c + 14} textAnchor="middle" fontSize="11" fill="#8c9196">
          total uses
        </text>
      </svg>

      <BlockStack gap="150">
        {slices.map((s) => (
          <InlineStack key={s.key} gap="200" blockAlign="center" wrap={false}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: s.color,
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <Text as="span" variant="bodySm">
              {s.label || s.key}
            </Text>
            <Text
              as="span"
              variant="bodySm"
              fontWeight="semibold"
              tone="subdued"
            >
              {s.pct}%
            </Text>
          </InlineStack>
        ))}
      </BlockStack>
    </InlineStack>
  );
}

function StatBoxSkeleton({ emphasize = false }: { emphasize?: boolean }) {
  return (
    <Card padding="400">
      <BlockStack gap="200" inlineAlign="center">
        <SkeletonDisplayText size="small" />
        <SkeletonDisplayText size={emphasize ? "large" : "medium"} />
      </BlockStack>
    </Card>
  );
}

function AnalyticsSkeleton({ label }: { label: string }) {
  return (
    <BlockStack gap="400">
      {/* 5 Summary stat skeleton tiles */}
      <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 5 }} gap="400">
        <StatBoxSkeleton emphasize />
        <StatBoxSkeleton emphasize />
        <StatBoxSkeleton emphasize />
        <StatBoxSkeleton />
        <StatBoxSkeleton />
      </InlineGrid>

      {/* Row 1 Skeletons: Chart + Pie */}
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="start">
              <Text as="h2" variant="headingMd">
                Filter usage over time
              </Text>
              <Badge tone="info">{label}</Badge>
            </InlineStack>
            <Box
              padding="600"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <BlockStack gap="300">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={6} />
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Total uses per filter
            </Text>
            <Box
              padding="600"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <BlockStack gap="300">
                <SkeletonDisplayText size="small" />
                <SkeletonBodyText lines={6} />
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>
      </InlineGrid>

      {/* Row 2 Skeletons: Together + Top Products */}
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Usually filtered together
            </Text>
            <Box padding="400">
              <SkeletonBodyText lines={4} />
            </Box>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Most clicked products
            </Text>
            <Box padding="400">
              <SkeletonBodyText lines={4} />
            </Box>
          </BlockStack>
        </Card>
      </InlineGrid>
    </BlockStack>
  );
}

function AnalyticsContent({
  data,
  agg,
}: {
  data: {
    shop: string;
    range: RangeKey;
    label: string;
    from: string;
    to: string;
    granularity: "hour" | "day";
  };
  agg: {
    buckets: { t: number; n: number }[];
    totals: { applies: number; selections: number; clicks: number };
    perFilter: { key: string; label: string; n: number }[];
    perOption: { key: string; label: string; value: string; n: number }[];
    together: FilterPair[];
    priceRanges: { label: string; n: number }[];
    topCategory: { value: string; n: number }[];
    topProducts: {
      productId: string;
      title: string;
      handle: string;
      image: string;
      n: number;
    }[];
    configured: boolean;
    queryError: string | null;
  };
}) {
  const LIST_MAX = 4;
  const buckets = agg.buckets;
  const hasData = agg.totals.applies > 0 || agg.totals.clicks > 0;
  const togetherShown = agg.together.slice(0, LIST_MAX);
  const clickedShown = agg.topProducts.slice(0, LIST_MAX);

  return (
    <BlockStack gap="400">
      {agg.queryError && (
        <Banner tone="critical" title="Couldn’t load analytics">
          <Text as="p">{agg.queryError}</Text>
        </Banner>
      )}

      {/* Summary metrics — five equal tiles on one row from lg up */}
      <InlineGrid columns={{ xs: 1, sm: 2, md: 3, lg: 5 }} gap="400">
        <StatBox
          label="Filter actions"
          value={nf(agg.totals.applies)}
          emphasize
        />
        <StatBox
          label="Filter selections"
          value={nf(agg.totals.selections)}
          emphasize
        />
        <StatBox
          label="Product clicks"
          value={nf(agg.totals.clicks)}
          emphasize
        />
        <StatBox
          label="Most filtered category"
          value={agg.topCategory.length ? agg.topCategory[0].value : "—"}
          sub={agg.topCategory.length ? uses(agg.topCategory[0].n) : undefined}
        />
        <StatBox
          label="Most filtered price"
          value={agg.priceRanges.length ? agg.priceRanges[0].label : "—"}
          sub={agg.priceRanges.length ? uses(agg.priceRanges[0].n) : undefined}
        />
      </InlineGrid>

      {/* Row 1: chart + total uses per filter, side by side */}
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="start">
              <Text as="h2" variant="headingMd">
                Filter usage over time
              </Text>
              <Badge tone="info">{data.label}</Badge>
            </InlineStack>

            {hasData ? (
              <UsageChart
                buckets={buckets}
                gran={data.granularity}
                weekAxis={
                  data.range === "this_month" || data.range === "last_month"
                }
              />
            ) : (
              <Box
                padding="800"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" fontWeight="semibold">
                    No filter activity in this range yet
                  </Text>
                  <Text as="p" tone="subdued">
                    Data appears here once shoppers use the Collection or Search
                    filter on your storefront.
                  </Text>
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Total uses per filter
            </Text>
            {agg.perFilter.length ? (
              <PieChart data={agg.perFilter} />
            ) : (
              <Box
                padding="800"
                background="bg-surface-secondary"
                borderRadius="200"
              >
                <BlockStack gap="200" inlineAlign="center">
                  <Text as="p" fontWeight="semibold">
                    No filter activity in this range yet
                  </Text>
                  <Text as="p" tone="subdued">
                    Data appears here once shoppers use the Collection or Search
                    filter on your storefront.
                  </Text>
                </BlockStack>
              </Box>
            )}
          </BlockStack>
        </Card>
      </InlineGrid>

      {/* Row 2: usually filtered together + most clicked products */}
      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">
              Usually filtered together
            </Text>
            {agg.together.length ? (
              <BlockStack gap="200">
                {togetherShown.map((pair) => (
                  <Box
                    key={`${pair.aKey}|${pair.bKey}`}
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 8,
                        minHeight: 36,
                      }}
                    >
                      <InlineStack gap="200" blockAlign="center">
                        <FilterChip filterKey={pair.aKey} label={pair.aLabel} />
                        <Text as="span" tone="subdued">
                          +
                        </Text>
                        <FilterChip filterKey={pair.bKey} label={pair.bLabel} />
                      </InlineStack>
                      <div style={{ flexShrink: 0 }}>
                        <Badge tone="info">{`${nf(pair.n)} ${pair.n === 1 ? "time" : "times"}`}</Badge>
                      </div>
                    </div>
                  </Box>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" tone="subdued">
                Not enough data to find filter combinations yet.
              </Text>
            )}
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Most clicked products
            </Text>
            {agg.topProducts.length ? (
              <BlockStack gap="200">
                {clickedShown.map((p, i) => (
                  <Box
                    key={p.productId}
                    padding="300"
                    background="bg-surface-secondary"
                    borderRadius="200"
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "auto auto minmax(0, 1fr) auto",
                        gap: 12,
                        alignItems: "center",
                        minHeight: 36,
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          minWidth: 24,
                          height: 24,
                          padding: "0 6px",
                          borderRadius: 6,
                          background: "#eaf0fb",
                          color: "#1f5199",
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {i + 1}
                      </span>
                      {p.image ? (
                        <Thumbnail
                          source={p.image}
                          alt={p.title || p.handle}
                          size="small"
                        />
                      ) : (
                        <Box
                          background="bg-surface-tertiary"
                          borderRadius="200"
                          minWidth="40px"
                          minHeight="40px"
                        />
                      )}
                      <div style={{ minWidth: 0, overflow: "hidden" }}>
                        <Link
                          url={`https://${data.shop}/products/${p.handle}`}
                          target="_blank"
                          removeUnderline
                        >
                          <Text as="span" variant="bodyMd" truncate>
                            {p.title || p.handle}
                          </Text>
                        </Link>
                      </div>
                      <div style={{ flexShrink: 0 }}>
                        <Badge tone="success">{`${nf(p.n)} ${p.n === 1 ? "click" : "clicks"}`}</Badge>
                      </div>
                    </div>
                  </Box>
                ))}
              </BlockStack>
            ) : (
              <Text as="p" tone="subdued">
                No product clicks recorded yet.
              </Text>
            )}
          </BlockStack>
        </Card>
      </InlineGrid>
    </BlockStack>
  );
}

export default function AnalyticsPage() {
  // The page render only ever sees the navigation payload (data requests are
  // served to the fetcher below), so narrow away the ?data=1 shape.
  const data = useLoaderData<typeof loader>() as unknown as {
    shop: string;
    range: RangeKey;
    label: string;
    from: string;
    to: string;
    start: string;
    end: string;
    granularity: "hour" | "day";
  };
  const navigate = useNavigate();
  const fetcher = useFetcher<AnalyticsPayload>();

  const go = useCallback(
    (params: Record<string, string>) => {
      navigate(`/app/analytics?${new URLSearchParams(params).toString()}`);
    },
    [navigate],
  );

  const rangeKey = `${data.range}|${data.from}|${data.to}`;
  const dataUrl = `/app/analytics?data=1&range=${data.range}&from=${encodeURIComponent(data.from)}&to=${encodeURIComponent(data.to)}`;
  // Range whose numbers fetcher.data holds. A background refresh re-requests
  // the same range, so the shown numbers stay up (no skeleton flash); only a
  // range change shows the skeleton.
  const requestedKeyRef = useRef(rangeKey);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [refreshTries, setRefreshTries] = useState(0);

  // Background fetch of analytics data whenever the selected range changes
  useEffect(() => {
    requestedKeyRef.current = rangeKey;
    setRefreshTries(0);
    fetcher.load(dataUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      setLoadedKey(requestedKeyRef.current);
    }
  }, [fetcher.state, fetcher.data]);

  // Stale cached numbers: the server is refreshing from PostHog. Ask again
  // shortly (a few times at most) so fresh numbers replace them on their own.
  const refreshing =
    fetcher.data?.refreshing === true && loadedKey === rangeKey;
  useEffect(() => {
    if (!refreshing || fetcher.state !== "idle" || refreshTries >= 5) return;
    const t = setTimeout(() => {
      setRefreshTries((n) => n + 1);
      fetcher.load(dataUrl);
    }, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing, fetcher.state, refreshTries, dataUrl]);

  const isLoading = !fetcher.data || loadedKey !== rangeKey;

  // Custom-range calendar state.
  const initialStart = parseYmd(data.from) ?? new Date();
  const [{ month, year }, setMonth] = useState({
    month: initialStart.getMonth(),
    year: initialStart.getFullYear(),
  });
  const [selected, setSelected] = useState({
    start: parseYmd(data.from) ?? new Date(),
    end: parseYmd(data.to) ?? new Date(),
  });
  const [calOpen, setCalOpen] = useState(false);

  const customLabel =
    data.range === "custom" ? `${data.from} → ${data.to}` : "Custom range";

  return (
    <Page>
      <TitleBar title="Analytics" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            {/* Date range selector — controls every box on the page, interactive immediately */}
            <Card>
              <InlineStack align="space-between" blockAlign="center" gap="300">
                <ButtonGroup variant="segmented">
                  {PRESETS.map((p) => (
                    <Button
                      key={p.key}
                      pressed={data.range === p.key}
                      onClick={() => go({ range: p.key })}
                    >
                      {p.label}
                    </Button>
                  ))}
                </ButtonGroup>

                <InlineStack gap="200" blockAlign="center">
                  {refreshing ? (
                    <Badge tone="attention">Updating…</Badge>
                  ) : null}
                  <Popover
                    active={calOpen}
                    onClose={() => setCalOpen(false)}
                    preferredAlignment="right"
                    activator={
                      <Button
                        disclosure
                        pressed={data.range === "custom"}
                        onClick={() => setCalOpen((v) => !v)}
                      >
                        {customLabel}
                      </Button>
                    }
                  >
                    <Box padding="400">
                      <BlockStack gap="300">
                        <DatePicker
                          month={month}
                          year={year}
                          onChange={setSelected}
                          onMonthChange={(m, y) =>
                            setMonth({ month: m, year: y })
                          }
                          selected={selected}
                          allowRange
                        />
                        <InlineStack align="end">
                          <Button
                            variant="primary"
                            onClick={() => {
                              setCalOpen(false);
                              go({
                                range: "custom",
                                from: ymd(selected.start),
                                to: ymd(selected.end),
                              });
                            }}
                          >
                            Apply range
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  </Popover>
                </InlineStack>
              </InlineStack>
            </Card>

            {/* Instant Skeleton display while background query runs */}
            {isLoading || !fetcher.data ? (
              <AnalyticsSkeleton label={data.label} />
            ) : (
              <AnalyticsContent data={data} agg={fetcher.data} />
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
