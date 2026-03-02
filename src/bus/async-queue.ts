export class AsyncQueue<T> {
  private readonly items: T[] = [];
  private readonly resolvers: Array<(value: T) => void> = [];

  enqueue(item: T): void {
    const resolver = this.resolvers.shift();
    if (resolver) {
      resolver(item);
      return;
    }
    this.items.push(item);
  }

  async dequeue(timeoutMs?: number): Promise<T | null> {
    if (this.items.length > 0) {
      return this.items.shift() ?? null;
    }

    if (timeoutMs === undefined) {
      return new Promise<T>((resolve) => {
        this.resolvers.push(resolve);
      });
    }

    return new Promise<T | null>((resolve) => {
      let done = false;
      const resolver = (value: T) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      this.resolvers.push(resolver);

      const timer = setTimeout(() => {
        if (done) {
          return;
        }
        done = true;
        const idx = this.resolvers.indexOf(resolver);
        if (idx >= 0) {
          this.resolvers.splice(idx, 1);
        }
        resolve(null);
      }, timeoutMs);
    });
  }

  size(): number {
    return this.items.length;
  }
}
