import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types'

const BASE = 'https://api.basestonk.io'

let supabase: ReturnType<typeof createClient<Database>> | null = null
function getSupabase() {
  if (supabase) return supabase
  const url = process.env.VITE_SUPABASE_URL || ''
  const anon = process.env.VITE_SUPABASE_ANON_KEY || ''
  if (!url || !anon) return null
  supabase = createClient<Database>(url, anon)
  return supabase
}

function shortAddr(a: unknown): string {
  const s = String(a || '')
  if (s.length < 12) return s
  return `${s.slice(0, 6)}…${s.slice(-4)}`
}

async function jfetch<T>(path: string, attempt = 0, retries = 4, timeoutMs = 8000): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(timeoutMs) })
  if ((res.status === 429 || res.status === 502 || res.status === 503) && attempt < retries) {
    const sleep = path.includes('/trades') ? 400 * Math.pow(2, attempt) + Math.floor(Math.random() * 150) : 300 * Math.pow(2, attempt)
    await new Promise((r) => setTimeout(r, sleep))
    return jfetch<T>(path, attempt + 1, retries, timeoutMs)
  }
  if (!res.ok) throw new Error(`Upstream ${res.status}`)
  return res.json() as Promise<T>
}

// tiny per-instance cache + stale fallback: keeps upstream API from being hammered
const upstreamCache = new Map<string, { at: number; data: unknown }>()
const inflight = new Map<string, Promise<unknown>>()
async function jfetchCached<T>(path: string, ttl = 12000, retries = 4, timeoutMs = 8000): Promise<T> {
  const hit = upstreamCache.get(path)
  if (hit && Date.now() - hit.at < ttl) return hit.data as T
  const pending = inflight.get(path)
  if (pending) return pending as Promise<T>
  const run = (async () => {
    try {
      const data = await jfetch<T>(path, 0, retries, timeoutMs)
      upstreamCache.set(path, { at: Date.now(), data })
      return data
    } catch (e) {
      if (hit) return hit.data as T
      throw e
    } finally {
      inflight.delete(path)
    }
  })()
  inflight.set(path, run)
  return run
}

async function poolMap<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = i++
      if (idx >= items.length) return
      out[idx] = await fn(items[idx])
    }
  }))
  return out
}

function sortTrades(a: { volumeUsd: number; buys: number; sells: number }, b: { volumeUsd: number; buys: number; sells: number }) {
  return b.volumeUsd - a.volumeUsd
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const url = req.url || ''

  try {
    // ─── /api/health ─────────────────────────────────────────
    if (url.includes('/api/health')) {
      return res.json({ ok: true })
    }

    // ─── /api/positions ──────────────────────────────────────
    if (url.includes('/api/positions')) {
      const u = new URL(url, 'http://x')
      const wallet = (u.searchParams.get('wallet') || '').toLowerCase()
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) return res.json({ positions: [], trades: [], scanned: 0 })
      const scanKey = `positions:${wallet}`
      const scannedHit = upstreamCache.get(scanKey)
      if (scannedHit && Date.now() - scannedHit.at < 20000) return res.json(scannedHit.data)
      const t0 = Date.now()
      let data: any = null
      for (const path of [
        `/api/launchpad/tokens?chain=base&limit=100&sort=volume`,
        `/api/launchpad/tokens?chain=base&limit=30&sort=trending`,
      ]) {
        data = await jfetchCached<any>(path, 20000, 4, 6000).catch(() => null)
        if (data?.tokens?.length) break
      }
      const top = (data?.tokens || []).slice(0, 20)
      console.error('[positions]', wallet, 'tokensList', data ? 'ok' : 'FAIL', 'top', top.length, 'ms', Date.now() - t0)
      if (!top.length) return res.json({ positions: [], trades: [], scanned: 0 })
      const byTok = new Map<string, any>()
      const raw: any[] = []
      const seenTrades = new Set<string>()
      let scanned = 0
      const ingest = async (t: any) => {
        if (Date.now() - t0 > 6500) return
        try {
          const tr = await jfetchCached<any>(`/api/launchpad/tokens/${t.address}/trades?chain=base&limit=100${wallet ? `&trader=${wallet}` : ''}`, 30000, 3, 3000).catch(() => null)
          const list = tr?.trades || []
          scanned += list.length
          const mine = list.filter((x: any) => String(x?.trader || '').toLowerCase() === wallet)
          if (!mine.length) return
          const key = String(t.symbol || '').toUpperCase()
          if (!key) return
          const acc = byTok.get(key) || {
            symbol: key, name: t.name || '', token: t.address, imageUrl: t.imageUrl || t.logoUrl,
            currentPrice: t.priceUsd || 0, buys: [], sells: [],
          }
          mine.forEach((x: any) => {
            if (x.side === 'buy') acc.buys.push(x)
            else acc.sells.push(x)
            if (!seenTrades.has(x.id)) {
              seenTrades.add(x.id)
              raw.push({ trade: x, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl || t.logoUrl })
            }
          })
          byTok.set(key, acc)
        } catch { /* skip */ }
      }
      await ingest(top[0])
      await poolMap(top.slice(1), 4, ingest)
      console.error('[positions]', wallet, 'scanned', scanned, 'byTokKeys', Array.from(byTok.keys()).join(','), 'ms', Date.now() - t0)
      const positions = Array.from(byTok.values()).map((acc: any) => {
        const buys = acc.buys, sells = acc.sells
        const buyVol = buys.reduce((s: number, x: any) => s + (x.volumeUsd || 0), 0)
        const sellVol = sells.reduce((s: number, x: any) => s + (x.volumeUsd || 0), 0)
        const entry = buyVol > 0 ? buys.reduce((s: number, x: any) => s + (x.priceUsd || 0) * (x.volumeUsd || 0), 0) / buyVol : 0
        const last = [...buys, ...sells].sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0]
        const current = acc.currentPrice > 0 ? acc.currentPrice : (last?.priceUsd || entry)
        const soldShare = buyVol > 0 ? Math.min(1, sellVol / buyVol) : 1
        const exposureUsd = buyVol * (1 - soldShare)
        const pnlPct = entry > 0 ? ((current - entry) / entry) * 100 : 0
        const pnlUsd = exposureUsd * (pnlPct / 100)
        return {
          symbol: acc.symbol, name: acc.name, token: acc.token, imageUrl: acc.imageUrl,
          buys: buys.length, sells: sells.length, buyVolUsd: buyVol, sellVolUsd: sellVol,
          entry, current, exposureUsd, pnlUsd, pnlPct, open: exposureUsd > 0,
        }
      }).sort((a: any, b: any) => Math.abs(b.pnlUsd) - Math.abs(a.pnlUsd)).slice(0, 20)
      const trades = raw.sort((a: any, b: any) => (b.trade.createdAt || '').localeCompare(a.trade.createdAt || '')).slice(0, 30).map(({ trade, symbol, name, imageUrl }) => ({
        id: trade.id, token: trade.token, tokenSymbol: symbol, tokenName: name,
        trader: trade.trader, traderShort: shortAddr(trade.trader),
        side: trade.side, priceUsd: trade.priceUsd || 0, volumeUsd: trade.volumeUsd || 0,
        amountToken: trade.amountToken, createdAt: trade.createdAt, txn: trade.txHash,
        tokenImageUrl: imageUrl, change24hPct: 0, marketcapUsd: 0,
      }))
      const payload = { positions, trades, scanned }
      upstreamCache.set(scanKey, { at: Date.now(), data: payload })
      return res.json(payload)
    }

    // ─── /api/tokens ─────────────────────────────────────────
    if (url.includes('/api/tokens') && !url.match(/\/api\/tokens\/0x/)) {
      const u = new URL(url, 'http://x')
      const limit = u.searchParams.get('limit') || '50'
      const sort = u.searchParams.get('sort') || 'trending'
      const data = await jfetchCached<any>(`/api/launchpad/tokens?chain=base&limit=${limit}&sort=${sort}`, 20000)
      const tokens = (data.tokens || []).map((t: any) => ({
        address: t.address, name: t.name, symbol: t.symbol,
        priceUsd: t.priceUsd || 0, change24hPct: t.change24hPct || 0,
        volume24hUsd: t.volume24hUsd || 0, marketcapUsd: t.marketcapUsd || 0,
        holders: t.holders || 0, creator: t.creator || '',
        imageUrl: t.imageUrl, logoUrl: t.logoUrl,
        og: !!t.og, platform: !!t.platform, venue: t.venue || '',
        createdAt: t.createdAt || '', progressBps: t.progressBps || 0,
        description: t.description || '', links: t.links || {},
      }))
      return res.json({ total: data.total, hasNext: data.hasNext, tokens })
    }

    // ─── /api/tokens/:address ────────────────────────────────
    const tokenMatch = url.match(/\/api\/tokens\/(0x[0-9a-fA-F]{40})/)
    if (tokenMatch) {
      const raw = await jfetch<any>(`/api/launchpad/tokens/${tokenMatch[1]}?chain=base`)
      return res.json(raw.token || raw)
    }

    // ─── /api/feed ───────────────────────────────────────────
    if (url.includes('/api/feed')) {
      const data = await jfetchCached<any>(`/api/launchpad/tokens?chain=base&limit=30&sort=trending`)
      const top = (data.tokens || []).slice(0, 12)
      const all: { trade: any; symbol: string; name: string; imageUrl?: string; change24hPct: number; marketcapUsd: number; spark: number[] }[] = []
      await poolMap(top, 6, async (t: any) => {
        try {
          const [tr, cdl] = await Promise.all([
            jfetchCached<any>(`/api/launchpad/tokens/${t.address}/trades?chain=base&limit=8`, 10000).catch(() => null),
            jfetchCached<any>(`/api/launchpad/tokens/${t.address}/candles?chain=base&interval=5m&limit=24`, 10000).catch(() => null),
          ])
          const spark = Array.isArray(cdl?.candles) ? cdl.candles.map((c: any) => c.c) : []
          ;(tr?.trades || []).forEach((trade: any) => all.push({
            trade, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl || t.logoUrl,
            change24hPct: t.change24hPct || 0, marketcapUsd: t.marketcapUsd || 0, spark,
          }))
        } catch { /* skip */ }
      })
      all.sort((a, b) => (b.trade.createdAt || '').localeCompare(a.trade.createdAt || ''))
      const items = all.slice(0, 40).map(({ trade, symbol, name, imageUrl, change24hPct, marketcapUsd, spark }) => ({
        id: trade.id, token: trade.token, tokenSymbol: symbol, tokenName: name,
        trader: trade.trader, traderShort: shortAddr(trade.trader),
        side: trade.side, priceUsd: trade.priceUsd || 0, volumeUsd: trade.volumeUsd || 0,
        amountToken: trade.amountToken, createdAt: trade.createdAt, txn: trade.txHash,
        tokenImageUrl: imageUrl, change24hPct, marketcapUsd, spark,
      }))
      return res.json(items)
    }

    // ─── /api/leaderboard ────────────────────────────────────
    if (url.includes('/api/leaderboard')) {
      const data = await jfetchCached<any>(`/api/launchpad/tokens?chain=base&limit=24&sort=volume`, 30000)
      const top = (data.tokens || []).slice(0, 24)
      const map = new Map<string, { volumeUsd: number; buys: number; sells: number; createdAt?: string }>()
      await poolMap(top, 5, async (t: any) => {
        try {
          const tr = await jfetchCached<any>(`/api/launchpad/tokens/${t.address}/trades?chain=base&limit=40`, 30000)
          ;(tr.trades || []).forEach((trade: any) => {
            const trader = trade.trader
            const cur = map.get(trader) || { volumeUsd: 0, buys: 0, sells: 0, createdAt: trade.createdAt }
            cur.volumeUsd += trade.volumeUsd || 0
            if (trade.side === 'buy') cur.buys++
            else cur.sells++
            if (!cur.createdAt || (trade.createdAt && trade.createdAt > cur.createdAt)) cur.createdAt = trade.createdAt
            map.set(trader, cur)
          })
        } catch { /* skip */ }
      })
      let maxVol = 0
      const rows = Array.from(map.entries()).map(([trader, v]) => {
        maxVol = Math.max(maxVol, v.volumeUsd)
        return { trader, traderShort: shortAddr(trader), volumeUsd: v.volumeUsd, buys: v.buys, sells: v.sells, score: v.volumeUsd }
      }).sort(sortTrades).slice(0, 20)
      return res.json({ maxScore: maxVol, rows })
    }

    // ─── /api/posts ──────────────────────────────────────────
    if (url.includes('/api/posts')) {
      const sb = getSupabase()
      if (!sb) return res.status(500).json({ error: 'posts not configured' })

      const likeMatch = url.match(/\/api\/posts\/(\d+)\/like/)
      if (likeMatch && req.method === 'POST') {
        const id = Number(likeMatch[1])
        const { data: cur, error: curErr } = await sb.from('posts').select('likes').eq('id', id).single()
        if (curErr) return res.status(500).json({ error: curErr.message })
        const { data, error } = await sb.from('posts').update({ likes: (cur?.likes || 0) + 1 }).eq('id', id).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }

      // GET ?limit=
      if (req.method === 'GET') {
        const u = new URL(url, 'http://x')
        const limit = Math.min(Number(u.searchParams.get('limit')) || 50, 200)
        const { data, error } = await sb.from('posts').select('*').order('created_at', { ascending: false }).limit(limit)
        if (error) return res.status(500).json({ error: error.message })
        const rows = data || []
        // resolve author handle/avatar from accounts
        const authors = [...new Set(rows.map((r) => r.author))]
        let accs: any[] = []
        try {
          const { data } = await sb.from('accounts').select('wallet, handle, avatar').in('wallet', authors)
          accs = data || []
        } catch { /* accounts table may not exist yet */ }
        const accMap = new Map((accs || []).map((a) => [a.wallet, a]))
        return res.json(rows.map((p) => ({ ...p, entry_price: p.entry_price != null ? Number(p.entry_price) : null, entry_mcap: p.entry_mcap != null ? Number(p.entry_mcap) : null, handle: accMap.get(p.author)?.handle || null, avatar: accMap.get(p.author)?.avatar || null })))
      }

      // POST { author, body, tokenSymbol?, tokenImage?, kind?, tokenAddress? }
      if (req.method === 'POST') {
        const { author, body, tokenSymbol, tokenImage, kind, tokenAddress } = req.body || {}
        const clean = String(body || '').trim()
        if (!author || !clean) return res.status(400).json({ error: 'author and body are required' })
        if (clean.length > 280) return res.status(400).json({ error: 'body too long (max 280)' })
        let entryPrice: number | null = null
        let entryMcap: number | null = null
        let shotImage: string | null = tokenImage ? String(tokenImage) : null
        if (kind === 'shot') {
          if (!tokenAddress || !tokenSymbol) return res.status(400).json({ error: 'a shot needs a tagged token' })
          const pr = await jfetchCached<any>(`/api/launchpad/tokens/${tokenAddress}`, 5000, 3, 5000).catch(() => null)
          const tk = pr?.token
          entryPrice = Number(tk?.priceUsd)
          entryMcap = Number(tk?.marketcapUsd) || null
          if (!entryPrice || !isFinite(entryPrice)) return res.status(503).json({ error: 'could not price the token for your call — retry' })
          shotImage = shotImage || (tk?.imageUrl ? String(tk.imageUrl) : tk?.logoUrl ? String(tk.logoUrl) : null)
        }
        const { data, error } = await sb.from('posts').insert({
          author: String(author),
          body: clean,
          token_symbol: tokenSymbol ? String(tokenSymbol) : null,
          token_image: shotImage,
          kind: kind === 'shot' ? 'shot' : 'post',
          token_address: tokenAddress ? String(tokenAddress) : null,
          entry_price: entryPrice,
          entry_mcap: entryMcap,
        }).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ ...data, entry_price: data?.entry_price != null ? Number(data.entry_price) : null, entry_mcap: data?.entry_mcap != null ? Number(data.entry_mcap) : null })
      }
    }

    // ─── /api/callers ────────────────────────────────────────
    if (url.includes('/api/callers')) {
      const sb = getSupabase()
      if (!sb) return res.json({ rows: [], maxHitRate: 1 })
      const cacheKey = 'callers:v1'
      const cacheHit = upstreamCache.get(cacheKey)
      if (cacheHit && Date.now() - cacheHit.at < 15000) return res.json(cacheHit.data)
      const data = await jfetchCached<any>(`/api/launchpad/tokens?chain=base&limit=100&sort=volume`, 20000).catch(() => null)
      const byAddr = new Map<string, number>()
      const bySym = new Map<string, number>()
      for (const t of data?.tokens || []) {
        const mcap = Number(t.marketcapUsd) || Number(t.priceUsd) || 0
        if (t?.address) byAddr.set(String(t.address).toLowerCase(), mcap)
        if (t?.symbol) bySym.set(String(t.symbol).toUpperCase(), mcap)
      }
      const { data: shots, error } = await sb.from('posts').select('*').eq('kind', 'shot').order('created_at', { ascending: false }).limit(500)
      if (error) return res.json({ rows: [], maxHitRate: 1 })
      const agg = new Map<string, any>()
      for (const p of (shots as any[]) || []) {
        const entry = Number(p.entry_mcap) || Number(p.entry_price)
        if (!entry || !p.author) continue
        const cur = byAddr.get(String(p.token_address || '').toLowerCase()) || (p.token_symbol ? bySym.get(String(p.token_symbol).toUpperCase()) || 0 : 0)
        const move = cur > 0 ? ((cur - entry) / entry) * 100 : null
        const a = agg.get(p.author) || { author: p.author, calls: 0, wins: 0, sumMove: 0, best: null, lastAt: '' }
        a.calls++
        if (move !== null) {
          a.sumMove += move
          if (move > 0) a.wins++
          if (!a.best || move > a.best.move) a.best = { symbol: p.token_symbol, move }
        }
        if ((p.created_at || '') > (a.lastAt || '')) a.lastAt = p.created_at
        agg.set(p.author, a)
      }
      const rows = Array.from(agg.values())
        .filter((r: any) => r.calls >= 2)
        .map((r: any) => ({ ...r, hitRate: r.calls ? r.wins / r.calls : 0, avgMove: r.calls ? r.sumMove / r.calls : 0 }))
        .sort((x: any, y: any) => y.hitRate - x.hitRate || y.wins - x.wins || y.avgMove - x.avgMove)
        .slice(0, 24)
      const maxHitRate = rows.length ? Math.max(...rows.map((r: any) => r.hitRate)) : 1
      const payload = { rows, maxHitRate }
      upstreamCache.set(cacheKey, { at: Date.now(), data: payload })
      return res.json(payload)
    }

    // ─── /api/accounts ───────────────────────────────────────
    if (url.includes('/api/accounts')) {
      const sb = getSupabase()
      if (!sb) return res.status(500).json({ error: 'accounts not configured' })

      // GET ?wallet=  or ?limit=
      if (req.method === 'GET') {
        const u = new URL(url, 'http://x')
        const wallet = u.searchParams.get('wallet') || ''
        const limit = u.searchParams.get('limit') || ''
        if (wallet) {
          let { data, error } = await sb.from('accounts').select('wallet, handle, avatar, x_handle').eq('wallet', wallet).maybeSingle()
          if (error) return res.status(500).json({ error: error.message })
          let bioRow: any = null
          try { const r = await sb.from('accounts').select('bio').eq('wallet', wallet).maybeSingle(); bioRow = r.data || null } catch { /* bio column not present */ }
          if (bioRow) data = { ...data, bio: bioRow.bio }
          let xRow: any = null
          try { const r = await sb.from('accounts').select('x_handle').eq('wallet', wallet).maybeSingle(); xRow = r.data || null } catch { /* x_handle column not present */ }
          if (xRow) data = { ...data, x_handle: xRow.x_handle }
          const [{ count: followers }, { count: following }] = await Promise.all([
            sb.from('follows').select('*', { count: 'exact', head: true }).eq('target', wallet),
            sb.from('follows').select('*', { count: 'exact', head: true }).eq('follower', wallet),
          ])
          return res.json({ account: data ? { ...data, followers: followers || 0, following: following || 0 } : null })
        }
        if (limit) {
          const n = Math.min(Number(limit) || 200, 500)
          const { data, error } = await sb.from('accounts').select('wallet, handle, x_handle').limit(n)
          if (error) return res.status(500).json({ error: error.message })
          return res.json({ accounts: data || [] })
        }
        return res.json({ account: null })
      }

      // POST { wallet, handle, avatar?, bio? } — upsert
      if (req.method === 'POST') {
        const { wallet, handle, avatar, bio } = req.body || {}
        if (!wallet) return res.status(400).json({ error: 'wallet is required' })
        const clean = String(handle || '').trim()
        if (clean.length > 24) return res.status(400).json({ error: 'handle too long (max 24)' })
        const payload: any = { wallet: String(wallet), handle: clean || null, avatar: avatar ? String(avatar) : null }
        if (bio !== undefined) payload.bio = String(bio).slice(0, 160)
        if (x_handle !== undefined) payload.x_handle = String(x_handle).replace(/^@/, '').slice(0, 60)
        const { data, error } = await sb.from('accounts').upsert(payload).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }

    // ─── /api/follows ────────────────────────────────────────
    if (url.includes('/api/follows')) {
      const sb = getSupabase()
      if (!sb) return res.json({ targets: [], note: 'follows not configured' })
      // GET ?follower=
      if (req.method === 'GET') {
        const u = new URL(url, 'http://x')
        const follower = u.searchParams.get('follower') || ''
        if (!follower) return res.json({ targets: [] })
        const { data, error } = await sb.from('follows').select('target').eq('follower', follower)
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ targets: (data || []).map((r: any) => r.target) })
      }
      // POST { follower, target }
      if (req.method === 'POST') {
        const { follower, target } = req.body || {}
        if (!follower || !target) return res.status(400).json({ error: 'missing' })
        const { error } = await sb.from('follows').insert({ follower, target })
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ success: true })
      }
      // DELETE ?follower=&target=
      if (req.method === 'DELETE') {
        const u = new URL(url, 'http://x')
        const follower = u.searchParams.get('follower') || ''
        const target = u.searchParams.get('target') || ''
        const { error } = await sb.from('follows').delete().eq('follower', follower).eq('target', target)
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ success: true })
      }
    }

    return res.status(404).json({ error: 'not_found' })
  } catch (e: any) {
    return res.status(502).json({ error: e.message || 'upstream error' })
  }
}
