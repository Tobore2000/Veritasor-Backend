import { Client } from 'pg';
import { db } from '../../db/client.js';
import type { AuditLog } from '../../repositories/auditLogRepository.js';

export const AUDIT_LOG_NOTIFY_CHANNEL = 'veritasor_audit_log';
const MAX_SUBSCRIBER_BUFFER = 100;

export type AuditLogEvent = Pick<AuditLog, 'id' | 'userId' | 'action' | 'resource' | 'resourceId' | 'metadata' | 'timestamp' | 'chainHash' | 'seq'> & {
  tenantId?: string;
};

type Listener = {
  tenantId?: string;
  queue: AuditLogEvent[];
  waiting?: { resolve: (result: IteratorResult<AuditLogEvent>) => void; reject: (error: unknown) => void };
  closed: boolean;
};

const listeners = new Set<Listener>();
let notificationClient: Client | undefined;

export function publishAuditLog(log: AuditLog): void {
  const event = { ...log } as AuditLogEvent;
  for (const listener of listeners) {
    if (listener.closed || (listener.tenantId && listener.tenantId !== event.tenantId)) continue;
    if (listener.waiting) {
      const waiting = listener.waiting;
      listener.waiting = undefined;
      waiting.resolve({ value: event, done: false });
      continue;
    }
    if (listener.queue.length >= MAX_SUBSCRIBER_BUFFER) {
      listener.queue.shift();
    }
    listener.queue.push(event);
  }
}

export function createAuditLogAsyncIterator(tenantId?: string): AsyncIterableIterator<AuditLogEvent> {
  const listener: Listener = { tenantId, queue: [], closed: false };
  listeners.add(listener);

  const iterator: AsyncIterableIterator<AuditLogEvent> = {
    next: () => {
      if (listener.closed) return Promise.resolve({ value: undefined, done: true });
      const event = listener.queue.shift();
      if (event) return Promise.resolve({ value: event, done: false });
      return new Promise<IteratorResult<AuditLogEvent>>((resolve, reject) => {
        listener.waiting = { resolve, reject };
      });
    },
    return: () => {
      listener.closed = true;
      listener.waiting?.resolve({ value: undefined, done: true });
      listener.waiting = undefined;
      listener.queue.length = 0;
      listeners.delete(listener);
      return Promise.resolve({ value: undefined, done: true });
    },
    throw: (error?: unknown) => {
      listener.closed = true;
      listener.waiting?.reject(error);
      listener.waiting = undefined;
      listeners.delete(listener);
      return Promise.reject(error);
    },
    [Symbol.asyncIterator]() { return this; },
  };
  return iterator;
}

export async function startAuditLogListener(): Promise<void> {
  if (notificationClient || process.env.NODE_ENV === 'test') return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query(`LISTEN ${AUDIT_LOG_NOTIFY_CHANNEL}`);
  client.on('notification', (message) => {
    if (!message.payload) return;
    try {
      publishAuditLog(JSON.parse(message.payload) as AuditLog);
    } catch {
      // Ignore malformed notifications; the source record remains durable.
    }
  });
  notificationClient = client;
}

export async function stopAuditLogListener(): Promise<void> {
  const client = notificationClient;
  notificationClient = undefined;
  if (client) await client.end();
}

export function getAuditLogSubscriberCount(): number {
  return listeners.size;
}

export async function notifyAuditLog(log: AuditLog): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;
  try {
    await db.query('SELECT pg_notify($1, $2)', [AUDIT_LOG_NOTIFY_CHANNEL, JSON.stringify(log)]);
  } catch {
    // Local subscribers still receive the event; durable audit storage is independent.
  }
}