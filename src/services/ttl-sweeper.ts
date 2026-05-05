import { logger } from './logger';
import type { PinningService } from './pinning-service';

export interface TtlSweeperOptions {
  intervalMs: number;
  batchSize?: number;
}

export class TtlSweeper {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private readonly batchSize: number;

  constructor(
    private readonly pinningService: PinningService,
    private readonly options: TtlSweeperOptions
  ) {
    this.batchSize = options.batchSize ?? 100;
  }

  start(): void {
    if (this.timer || this.stopped) {
      return;
    }
    this.scheduleNext();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  async runOnce(): Promise<{ swept: number; failed: number }> {
    if (this.running) {
      return { swept: 0, failed: 0 };
    }

    this.running = true;
    let swept = 0;
    let failed = 0;

    try {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const batch = this.pinningService.findPinsExpiringBefore(nowSeconds, this.batchSize);

      for (const pin of batch) {
        try {
          await this.pinningService.expirePin(pin.requestid);
          swept += 1;
        } catch (error) {
          failed += 1;
          logger.error(
            { err: error, requestid: pin.requestid, cid: pin.cid },
            'ttl sweeper failed to expire pin'
          );
        }
      }

      if (swept > 0 || failed > 0) {
        logger.info({ swept, failed }, 'ttl sweeper batch complete');
      }
    } finally {
      this.running = false;
    }

    return { swept, failed };
  }

  private scheduleNext(): void {
    if (this.stopped) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      this.runOnce()
        .catch((error) => {
          logger.error({ err: error }, 'ttl sweeper tick failed');
        })
        .finally(() => {
          this.scheduleNext();
        });
    }, this.options.intervalMs);

    if (typeof this.timer.unref === 'function') {
      this.timer.unref();
    }
  }
}
