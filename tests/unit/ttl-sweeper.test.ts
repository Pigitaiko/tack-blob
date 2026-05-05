import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb } from '../../src/db';
import { PinRepository } from '../../src/repositories/pin-repository';
import type { IpfsClient } from '../../src/services/ipfs-rpc-client';
import { PinningService } from '../../src/services/pinning-service';
import { TtlSweeper } from '../../src/services/ttl-sweeper';

describe('TtlSweeper', () => {
  const wallet = '0x1111111111111111111111111111111111111111';

  let db: Database.Database;
  let repository: PinRepository;
  let ipfsClient: IpfsClient & {
    pinAdd: ReturnType<typeof vi.fn>;
    pinRm: ReturnType<typeof vi.fn>;
    addContent: ReturnType<typeof vi.fn>;
    cat: ReturnType<typeof vi.fn>;
  };
  let service: PinningService;

  beforeEach(() => {
    db = createDb(':memory:');
    repository = new PinRepository(db);
    ipfsClient = {
      pinAdd: vi.fn().mockResolvedValue(undefined),
      pinRm: vi.fn().mockResolvedValue(undefined),
      addContent: vi.fn().mockResolvedValue('bafy-upload'),
      cat: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer)
    };

    service = new PinningService(repository, ipfsClient, 'http://localhost:8080/ipfs', {
      ttlBounds: { minSeconds: 1, maxSeconds: 30 * 24 * 60 * 60 }
    });
  });

  it('expires only pins whose ttl has elapsed', async () => {
    const due = await service.createPin({ cid: 'bafy-due', owner: wallet, ttlSeconds: 1 });
    const future = await service.createPin({ cid: 'bafy-future', owner: wallet, ttlSeconds: 86400 });

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const sweeper = new TtlSweeper(service, { intervalMs: 60_000 });
    const result = await sweeper.runOnce();

    expect(result.swept).toBe(1);
    expect(ipfsClient.pinRm).toHaveBeenCalledWith('bafy-due');
    expect(ipfsClient.pinRm).not.toHaveBeenCalledWith('bafy-future');

    const dueRow = service.getPin(due.requestid, wallet);
    expect(dueRow.expiredAt).not.toBeNull();

    const futureRow = service.getPin(future.requestid, wallet);
    expect(futureRow.expiredAt).toBeNull();
  });

  it('counts a failed unpin without re-trying the same row forever', async () => {
    ipfsClient.pinRm.mockRejectedValueOnce(new Error('kubo down'));

    const due = await service.createPin({ cid: 'bafy-flaky', owner: wallet, ttlSeconds: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const sweeper = new TtlSweeper(service, { intervalMs: 60_000 });
    await sweeper.runOnce();

    const row = service.getPin(due.requestid, wallet);
    expect(row.expiredAt).not.toBeNull();
  });

  it('runOnce is a no-op while another runOnce is in flight', async () => {
    let resolveExpire!: () => void;
    const blocker = new Promise<void>((resolve) => {
      resolveExpire = resolve;
    });

    ipfsClient.pinRm.mockImplementationOnce(async () => {
      await blocker;
    });

    await service.createPin({ cid: 'bafy-block', owner: wallet, ttlSeconds: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1100));

    const sweeper = new TtlSweeper(service, { intervalMs: 60_000 });
    const first = sweeper.runOnce();
    const second = await sweeper.runOnce();

    expect(second).toEqual({ swept: 0, failed: 0 });

    resolveExpire();
    await first;
  });
});
