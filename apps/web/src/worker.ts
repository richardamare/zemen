import { D1Client } from "@effect/sql-d1"
import { env } from "cloudflare:workers"
import { Clock, DateTime, Effect, Layer, Schema } from "effect"
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http"
import { SqlClient } from "effect/sql"

const Db = D1Client.layer({ db: (env as unknown as { DB: D1Database }).DB })

const HeartbeatSummary = Schema.Struct({
  count: Schema.Number,
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

const Routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", HttpServerResponse.text("zemen")),
  HttpRouter.add(
    "GET",
    "/heartbeats",
    Effect.flatMap(readHeartbeats, (summary) => HttpServerResponse.json(summary))
  )
).pipe(HttpRouter.provideRequest(Db), Layer.provide(HttpServer.layerServices))

const app = HttpRouter.toWebHandler(Routes, { disableLogger: true })

export default {
  fetch: (request: Request) => app.handler(request),
  scheduled: (_controller: ScheduledController, _env: unknown, ctx: ExecutionContext) => {
    ctx.waitUntil(Effect.runPromise(recordHeartbeat.pipe(Effect.provide(Db))))
  }
} satisfies ExportedHandler
