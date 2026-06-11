import path from "path"
import express from "express"
import { createApp } from "./server"

const port = Number(process.env.PORT ?? 3001)
const staticDir = process.env.SERVE_STATIC ?? path.resolve(import.meta.dirname, "dist")

const app = createApp({ port })

app.use(express.static(staticDir))

app.use((_req, res) => {
  res.sendFile(path.join(staticDir, "index.html"))
})

const host = process.env.HOST ?? "0.0.0.0"

app.listen(port, host, () => {
  console.log(`\n  Production server running:`)
  console.log(`  Bind:    ${host}:${port}`)
  console.log(`  Static:  ${staticDir}`)
  console.log(`  Data:    ${process.env.GRAPH_DIR ?? process.cwd()}\n`)
})
