import crypto from "crypto"
import express from "express"
import cors from "cors"
import { WikiDataService } from "./wiki-api"
import { createApiRouter } from "./src/api/index"
import { resolveProjectRoot } from "./src/api/utils"

export interface ServerOptions {
  accessToken?: string
  projectRoot?: string
  port?: number
}

export function createApp(opts: ServerOptions = {}) {
  const accessToken = opts.accessToken ?? process.env.UNDERSTAND_ACCESS_TOKEN ?? crypto.randomBytes(16).toString("hex")
  const projectRoot = opts.projectRoot ?? resolveProjectRoot()
  let wikiService: WikiDataService | null = null
  const getWikiService = () => {
    if (!wikiService) wikiService = new WikiDataService(projectRoot)
    return wikiService
  }
  const router = createApiRouter()
  const app = express()
  app.use(cors())
  app.use(async (req, res, next) => {
    const url = new URL(req.url, `http://127.0.0.1`)
    const apiRes = await router.handle(
      { pathname: url.pathname, searchParams: url.searchParams },
      { accessToken, getWikiService },
    )
    if (apiRes === null) { next(); return }
    res.status(apiRes.statusCode)
    if (apiRes.headers) {
      for (const [k, v] of Object.entries(apiRes.headers)) res.setHeader(k, v)
    }
    res.json(apiRes.body)
  })
  return app
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3001)
  const accessToken = process.env.UNDERSTAND_ACCESS_TOKEN ?? crypto.randomBytes(16).toString("hex")
  const app = createApp({ accessToken })
  app.listen(port, () => {
    console.log(`\n  API Server: http://127.0.0.1:${port}/?token=${accessToken}\n`)
  })
}
