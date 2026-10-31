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
