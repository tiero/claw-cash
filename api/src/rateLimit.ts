export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, number[]>();

  allow(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const kept = (this.entries.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (kept.length >= limit) {
      this.entries.set(key, kept);
      return false;
    }
    kept.push(now);
    this.entries.set(key, kept);
    return true;
  }
}
