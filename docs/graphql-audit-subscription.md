# GraphQL audit-log subscription

The admin GraphQL endpoint exposes `auditLogStream(tenantId: ID)` over the existing HTTP server at `/api/v1/admin/graphql` using the `graphql-transport-ws` protocol.

Connections must authenticate with an admin JWT using either `connectionParams.authorization` or a `Bearer` authorization header. The optional `tenantId` filter is checked server-side; events are never delivered outside the selected tenant. A connection without a tenant filter receives events for the authenticated tenant.

Audit inserts publish in-process immediately and also issue a Postgres `NOTIFY veritasor_audit_log`. Each process listens on that channel so events can be observed across application instances. The per-connection queue is bounded at 100 events; when a consumer falls behind, the oldest buffered event is discarded and the client should reconnect and resynchronize from the `auditLogs` query.

The subscription is read-only and inherits the admin GraphQL endpoint's persisted-operation and authentication controls for HTTP requests. The WebSocket handshake performs its own JWT and admin-role checks.