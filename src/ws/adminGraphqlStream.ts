import type { IncomingMessage, Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { verifyToken } from '../utils/jwt.js';
import { findUserById } from '../repositories/userRepository.js';
import { businessRepository } from '../repositories/business.js';
import { gatewaySchema } from '../graphql/gateway.js';

const WS_PATH = '/api/v1/admin/graphql';

function tokenFromRequest(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice(7);
  }
  return new URL(request.url ?? '', 'ws://localhost').searchParams.get('token') ?? undefined;
}

async function authenticate(request: IncomingMessage, connectionParams?: Record<string, unknown>) {
  const paramsToken = connectionParams?.authorization ?? connectionParams?.Authorization;
  const token = typeof paramsToken === 'string' && paramsToken.startsWith('Bearer ')
    ? paramsToken.slice(7)
    : typeof paramsToken === 'string' ? paramsToken : tokenFromRequest(request);
  const payload = token ? verifyToken(token) : null;
  if (!payload) throw new Error('Unauthorized');
  const user = await findUserById(payload.userId);
  if (!user || user.role !== 'admin') throw new Error('Forbidden');
  const business = await businessRepository.getByUserId(payload.userId);
  return { user: { userId: payload.userId, role: user.role, tenantId: business?.id } };
}

export function attachAdminGraphqlStream(server: Server): WebSocketServer {
  const wsServer = new WebSocketServer({ server, path: WS_PATH });
  useServer({
    schema: gatewaySchema,
    context: async (ctx) => authenticate(ctx.extra.request, ctx.connectionParams as Record<string, unknown> | undefined),
  }, wsServer);
  return wsServer;
}