/**
 * 简单信号量：限制 AI 并发请求数（规划 4.5「并发限制 + 失败重试」）。
 * FIFO 排队；release 唤醒队首。
 */
export class Semaphore {
  private queue: (() => void)[] = [];
  private active = 0;

  constructor(public readonly limit: number) {}

  get running(): number {
    return this.active;
  }

  get waiting(): number {
    return this.queue.length;
  }

  /** 占用一个槽；超限时挂起直到有空位 */
  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  /** 包装执行 fn，自动 acquire/release；异常也保证释放 */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
