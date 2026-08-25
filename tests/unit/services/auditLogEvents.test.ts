import { describe, expect, it, beforeEach } from 'vitest';
import {
  createAuditLogAsyncIterator,
  getAuditLogSubscriberCount,
  publishAuditLog,
} from '../../../src/services/audit/auditLogEvents.js';
import type { AuditLog } from '../../../src/repositories/auditLogRepository.js';

function event(id: string, tenantId: string): AuditLog {
  return {
    id,
    userId: 'user-1',
    tenantId,
    action: 'READ',
    resource: 'audit-log',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    chainHash: 'hash',
    seq: Number(id.slice(4)),
  };
}

describe('audit log event broker', () => {
  beforeEach(() => {
    expect(getAuditLogSubscriberCount()).toBe(0);
  });

  it('delivers only events for the requested tenant', async () => {
    const iterator = createAuditLogAsyncIterator('tenant-a');
    const next = iterator.next();
    publishAuditLog(event('log-1', 'tenant-b'));
    publishAuditLog(event('log-2', 'tenant-a'));

    await expect(next).resolves.toMatchObject({ value: { id: 'log-2', tenantId: 'tenant-a' }, done: false });
    await iterator.return?.();
  });

  it('drops the oldest buffered event for a slow consumer', async () => {
    const iterator = createAuditLogAsyncIterator('tenant-a');
    for (let index = 0; index < 101; index += 1) {
      publishAuditLog(event(`log-${index}`, 'tenant-a'));
    }

    expect((await iterator.next()).value?.id).toBe('log-1');
    await iterator.return?.();
  });

  it('removes subscribers when the iterator is returned', async () => {
    const iterator = createAuditLogAsyncIterator('tenant-a');
    expect(getAuditLogSubscriberCount()).toBe(1);
    await iterator.return?.();
    expect(getAuditLogSubscriberCount()).toBe(0);
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });
});