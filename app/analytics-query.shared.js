function formatAnalyticsTimestamp(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    throw new Error(
      `Invalid date for analytics time filter: "${String(value).slice(0, 80)}"`,
    );
  }
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function buildAnalyticsTimeFilter(start, end) {
  // Validate both dates eagerly so invalid input can never reach the query.
  const s = formatAnalyticsTimestamp(start);
  const e = formatAnalyticsTimestamp(end);
  return `timestamp >= toDateTime('${s}', 'UTC') AND timestamp < toDateTime('${e}', 'UTC')`;
}

export function analyticsCacheKey(shop, start, end) {
  return `pf:analytics:raw:v2:${shop}:${new Date(start).toISOString()}:${new Date(end).toISOString()}`;
}
