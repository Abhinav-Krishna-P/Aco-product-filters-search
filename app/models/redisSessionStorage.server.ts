import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import type Redis from "ioredis";
import { getRedis } from "../redis.server";

const KEY_PREFIX = "shopify_sessions";

/**
 * Shopify SessionStorage backed by the shared ioredis client (REDIS_URL).
 * Avoids @shopify/shopify-app-session-storage-redis / node-redis, which break
 * Remix Vite SSR builds inside Alpine Docker images.
 */
export class IoredisSessionStorage implements SessionStorage {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  private sessionKey(id: string): string {
    return `${KEY_PREFIX}:${id}`;
  }

  private shopKey(shop: string): string {
    return `${KEY_PREFIX}:shop:${shop}`;
  }

  private async addKeyToShopList(shop: string, key: string): Promise<void> {
    const listKey = this.shopKey(shop);
    const raw = await this.redis.get(listKey);
    const keys: string[] = raw ? JSON.parse(raw) : [];
    if (!keys.includes(key)) {
      keys.push(key);
      await this.redis.set(listKey, JSON.stringify(keys));
    }
  }

  private async removeKeyFromShopList(
    shop: string,
    key: string,
  ): Promise<void> {
    const listKey = this.shopKey(shop);
    const raw = await this.redis.get(listKey);
    if (!raw) return;
    const keys: string[] = JSON.parse(raw).filter((k: string) => k !== key);
    if (keys.length) {
      await this.redis.set(listKey, JSON.stringify(keys));
    } else {
      await this.redis.del(listKey);
    }
  }

  async storeSession(session: Session): Promise<boolean> {
    const key = this.sessionKey(session.id);
    await this.redis.set(key, JSON.stringify(session.toPropertyArray(true)));
    await this.addKeyToShopList(session.shop, key);
    return true;
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const raw = await this.redis.get(this.sessionKey(id));
    if (!raw) return undefined;
    return Session.fromPropertyArray(JSON.parse(raw), true);
  }

  async deleteSession(id: string): Promise<boolean> {
    const session = await this.loadSession(id);
    if (session) {
      const key = this.sessionKey(id);
      await this.removeKeyFromShopList(session.shop, key);
      await this.redis.del(key);
    }
    return true;
  }

  async deleteSessions(ids: string[]): Promise<boolean> {
    await Promise.all(ids.map((sessionId) => this.deleteSession(sessionId)));
    return true;
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const listRaw = await this.redis.get(this.shopKey(shop));
    if (!listRaw) return [];

    const keys: string[] = JSON.parse(listRaw);
    const sessions: Session[] = [];
    for (const key of keys) {
      const raw = await this.redis.get(key);
      if (!raw) continue;
      sessions.push(Session.fromPropertyArray(JSON.parse(raw), true));
    }
    return sessions;
  }
}

function assertRedis(): Redis {
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      "[shopify] REDIS_URL is required for Redis session storage but was not set.",
    );
  }
  return redis;
}

export function createRedisSessionStorage(): SessionStorage {
  return new IoredisSessionStorage(assertRedis());
}
