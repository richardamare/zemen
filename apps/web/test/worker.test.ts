import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, expect, test } from "vitest"
import { unstable_startWorker } from "wrangler"

const persistTo = mkdtempSync(join(tmpdir(), "zemen-web-"))
let worker: Awaited<ReturnType<typeof unstable_startWorker>>

beforeAll(async () => {
  execFileSync("pnpm", ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo])
  worker = await unstable_startWorker({
    config: "wrangler.jsonc",
    dev: {
      persist: persistTo,
      testScheduled: true,
      server: { port: 0 },
      inspector: false,
      logLevel: "none"
    }
  })
}, 60_000)

afterAll(async () => {
  await worker?.dispose()
  rmSync(persistTo, { recursive: true, force: true })
})

test("the root route answers on workerd", async () => {
  const response = await worker.fetch("http://local/")
  expect(response.status).toBe(200)
  expect(await response.text()).toBe("zemen")
})

test("each cron run adds a heartbeat row", async () => {
  const before = await worker.fetch("http://local/heartbeats")
  expect(await before.json()).toEqual({ count: 0, lastRanAt: null })

  await (await worker.fetch("http://local/__scheduled?cron=*/2+*+*+*+*")).text()
  await (await worker.fetch("http://local/__scheduled?cron=*/2+*+*+*+*")).text()

  await expect
    .poll(async () => ((await (await worker.fetch("http://local/heartbeats")).json()) as { count: number }).count)
    .toBe(2)
  const after = (await (await worker.fetch("http://local/heartbeats")).json()) as { lastRanAt: string }
  expect(after.lastRanAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
})

const callConnector = async (method: string, params: object = {}) => {
  const response = await worker.fetch("http://local/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": method,
      ...("name" in params ? { "mcp-name": String(params.name) } : {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
          "io.modelcontextprotocol/clientCapabilities": {}
        }
      }
    })
  })
  return { status: response.status, body: (await response.json()) as { result: Record<string, unknown> } }
}

test("the connector lists its read-only tool", async () => {
  const { status, body } = await callConnector("tools/list")
  expect(status).toBe(200)
  expect(body.result.tools).toMatchObject([
    { name: "heartbeats", annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }
  ])
})

test("the connector tool reports the same heartbeats as the API", async () => {
  const api = await (await worker.fetch("http://local/heartbeats")).json()
  const { status, body } = await callConnector("tools/call", { name: "heartbeats", arguments: {} })
  expect(status).toBe(200)
  expect(body.result.isError).toBe(false)
  expect(body.result.structuredContent).toEqual(api)
})

test("the connector refuses a request without the protocol version", async () => {
  const response = await worker.fetch("http://local/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
  })
  expect(response.status).toBe(400)
})
