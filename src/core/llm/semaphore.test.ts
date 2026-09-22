import { describe, it, expect } from 'vitest';
import { Semaphore } from './semaphore';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

describe('Semaphore', () => {
  it('限制并发数', async () => {
    const sem = new Semaphore(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 20));
      running--;
    };
    await Promise.all(Array.from({ length: 6 }, () => sem.run(task)));
    expect(peak).toBe(2);
  });

  it('FIFO 排队顺序', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const d1 = deferred();
    const job = (n: number, gate = Promise.resolve()) =>
      sem.run(async () => {
        await gate;
        order.push(n);
      });
    const p1 = job(1, d1.promise);
    const p2 = job(2);
    const p3 = job(3);
    await new Promise((r) => setTimeout(r, 10));
    // job1 占着槽等门闩，2/3 被阻塞
    expect(order).toEqual([]);
    d1.resolve();
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('异常也释放槽位', async () => {
    const sem = new Semaphore(1);
    const boom = sem.run(async () => {
      throw new Error('boom');
    });
    await expect(boom).rejects.toThrow('boom');
    // 槽位已释放，下一个任务可立即执行
    let ran = false;
    await sem.run(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('running/waiting 计数', async () => {
    const sem = new Semaphore(1);
    const gate = deferred();
    const p = sem.run(async () => {
      await gate.promise;
    });
    await new Promise((r) => setTimeout(r, 5));
    const second = sem.run(async () => {});
    await new Promise((r) => setTimeout(r, 5));
    expect(sem.running).toBe(1);
    expect(sem.waiting).toBe(1);
    gate.resolve();
    await Promise.all([p, second]);
    expect(sem.running).toBe(0);
    expect(sem.waiting).toBe(0);
  });
});
