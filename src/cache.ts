type CacheEntry<T> = {
  expiresAt: number;
  storedAt: number;
  value: T;
};

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      return undefined;
    }
    return entry.value;
  }

  getStale(key: string): CacheEntry<T> | undefined {
    return this.entries.get(key);
  }

  set(key: string, value: T): void {
    const storedAt = Date.now();
    this.entries.set(key, {
      expiresAt: storedAt + this.ttlMs,
      storedAt,
      value
    });
  }

  get size(): number {
    return this.entries.size;
  }
}
