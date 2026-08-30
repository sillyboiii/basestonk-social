// Local dev runner for the Vercel serverless function.
// Lets you develop the API without a Vercel account/login.
// Usage: npx tsx server/local.ts  (serves on :3000)
import http from 'http'
import handler from '../api/index'

const PORT = Number(process.env.PORT || 3000)

const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const vercelReq: any = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: body ? (() => { try { return JSON.parse(body) } catch { return {} } })() : {},
      query: {},
    }
    const vercelRes: any = {
      statusCode: 200,
      headers: {},
      setHeader(k: string, v: string) { this.headers[k] = v },
      status(c: number) { this.statusCode = c; return this },
      json(obj: any) { this.send(obj) },
      send(out: any) {
        const ct = this.headers['Content-Type'] || 'application/json'
        res.writeHead(this.statusCode, { 'Content-Type': ct, ...this.headers })
        res.end(typeof out === 'string' ? out : JSON.stringify(out))
      },
      end(code?: number) { if (code) this.statusCode = code; res.writeHead(this.statusCode, this.headers); res.end() },
    }
    handler(vercelReq, vercelRes as any).catch((e) => {
      res.writeHead(502, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: String(e.message || e) }))
    })
  })
})

server.listen(PORT, () => console.log(`API dev server on http://localhost:${PORT}`))
