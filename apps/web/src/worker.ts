import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Clock, DateTime, Effect, Layer, Schema } from "effect"
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"

const Db = D1Client.layer({ db: (env as unknown as { DB: D1Database }).DB })

const HeartbeatSummary = Schema.Struct({
  count: Schema.Int,
  lastRanAt: Schema.NullOr(Schema.String)
})

const recordHeartbeat = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const now = yield* Clock.currentTimeMillis
  const ranAt = DateTime.formatIso(DateTime.makeUnsafe(now))
  yield* sql`INSERT INTO heartbeats (ran_at) VALUES (${ranAt})`
})

const readHeartbeats = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql`SELECT COUNT(*) AS count, MAX(ran_at) AS lastRanAt FROM heartbeats`
  return yield* Schema.decodeUnknownEffect(HeartbeatSummary)(rows[0])
})

const HeartbeatsTool = Tool.make("heartbeats", {
  description: "Reports how many heartbeats the cron has written and when the last one ran.",
  success: HeartbeatSummary
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, false)

const ConnectorTools = Toolkit.make(HeartbeatsTool)

const Connector = McpServer.layerHttpRequestScoped({
  name: "zemen",
  version: "0.0.0",
  path: "/mcp",
  protocols: [McpProtocol.v2026_07_28],
  registrations: McpServer.toolkit(ConnectorTools).pipe(
    Layer.provide(
      ConnectorTools.toLayer({
        heartbeats: () => readHeartbeats.pipe(Effect.provide(Db), Effect.orDie)
      })
    )
  )
})

const Routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.text("zemen")),
  HttpRouter.add(
    "GET",
    "/heartbeats",
    Effect.flatMap(readHeartbeats, (summary) => HttpServerResponse.json(summary))
  ),
  Connector
).pipe(HttpRouter.provideRequest(Db), Layer.provide(HttpServer.layerServices))

const app = HttpRouter.toWebHandler(Routes, { disableLogger: true })

export default {
  fetch: (request: Request) => app.handler(request),
  scheduled: (_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) => {
    ctx.waitUntil(Effect.runPromise(recordHeartbeat.pipe(Effect.provide(Db))))
  }
} satisfies ExportedHandler
