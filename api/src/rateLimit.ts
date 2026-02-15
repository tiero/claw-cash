export class KVRateLimiter {
  constructor(private readonly kv: KVNamespace) {}

  async allow(key: string, limit: number, windowMs: number): Promise<boolean> {
    const windowKey = `rl:${key}:${Math.floor(Date.now() / windowMs)}`;
    const current = await this.kv.get(windowKey);
    const count = current ? parseInt(current, 10) : 0;

    if (count >= limit) return false;

    await this.kv.put(windowKey, String(count + 1), {
      expirationTtl: Math.ceil(windowMs / 1000) + 60,
    });
    return true;
  }
}
