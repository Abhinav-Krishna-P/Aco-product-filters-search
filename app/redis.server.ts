import Redis from "ioredis";

declare global {
  var redisGlobal: Redis | null | undefined;
}

/** Hide password in logs: redis://user:secret@host:6379 → redis://user:***@host:6379 */
function redactRedisUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "[invalid REDIS_URL]";
  }
}

export function getRedis(): Redis | null {
  if (global.redisGlobal !== undefined) return global.redisGlobal;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.info(
      "[redis] REDIS_URL not set — analytics cache off; Shopify sessions use Prisma.",
    );
    global.redisGlobal = null;
    return null;
  }

  console.info("[redis] connecting (analytics cache)…", redactRedisUrl(url));

  const client = new Redis(url, {
    // Fail fast instead of hanging the loader when Redis is unreachable; the
    // cache layer catches the error and degrades to a direct PostHog query.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });

  client.on("connect", () => {
    console.info("[redis] TCP connected");
  });

  client.on("ready", () => {
    console.info("[redis] ready — analytics caching enabled");
    // Shopify auth sessions use a separate RedisSessionStorage client on REDIS_URL.
  });

  client.on("close", () => {
    console.warn("[redis] connection closed");
  });

  client.on("reconnecting", () => {
    console.warn("[redis] reconnecting…");
  });

  client.on("error", (err) => {
    console.error("[redis] connection error:", err.message);
  });

  global.redisGlobal = client;

  const cleanup = () => {
    if (global.redisGlobal) {
      global.redisGlobal.quit().catch(() => {});
      global.redisGlobal = undefined;
    }
  };

  process.once("beforeExit", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("SIGINT", cleanup);

  return client;
}

// Connect on first import so docker logs show status at boot (not only on analytics hit).
getRedis();
