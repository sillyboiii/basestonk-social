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

async function jfetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) throw new Error(`Upstream ${res.status}`)
  return res.json() as Promise<T>
}

// tiny per-instance cache + stale fallback: keeps upstream API from being hammered
const upstreamCache = new Map<string, { at: number; data: unknown }>()
async function jfetchCached<T>(path: string, ttl = 12000): Promise<T> {
  const hit = upstreamCache.get(path)
  if (hit && Date.now() - hit.at < ttl) return hit.data as T
  try {
    const data = await jfetch<T>(path)
    upstreamCache.set(path, { at: Date.now(), data })
    return data
  } catch (e) {
    if (hit) return hit.data as T
    throw e
  }
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
      if (!/^0x[0-9a-f]{40}$/.test(wallet)) return res.json({ positions: [], trades: [] })
      const data = await jfetchCached<any>(`/api/launchpad/tokens?chain=base&limit=80&sort=volume`, 30000).catch(() => null)
      const top = (data?.tokens || []).slice(0, 80)
      if (!top.length) return res.json({ positions: [], trades: [] })
      const byTok = new Map<string, any>()
      const raw: any[] = []
      await poolMap(top, 6, async (t: any) => {
        try {
          const tr = await jfetchCached<any>(`/api/launchpad/tokens/${t.address}/trades?chain=base&limit=60&trader=${wallet}`, 15000).catch(() => null)
          const mine = (tr?.trades || []).filter((x: any) => String(x?.trader || '').toLowerCase() === wallet)
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
          })
          byTok.set(key, acc)
          mine.forEach((x: any) => raw.push({ trade: x, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl || t.logoUrl }))
        } catch { /* skip */ }
      })
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
      return res.json({ positions, trades })
    }

    // ─── /api/tokens ─────────────────────────────────────────
    if (url.includes('/api/tokens') && !url.match(/\/api\/tokens\/0x/)) {
      const u = new URL(url, 'http://x')
      const limit = u.searchParams.get('limit') || '50'
      const sort = u.searchParams.get('sort') || 'trending'
      const data = await jfetchCached<any>(`/api/launchpad/tokens?chain=base&limit=${limit}&sort=${sort}`, 5000)
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
      const data = await jfetchCached<any>(`/api/launchpad/tokens?chain=base&limit=40&sort=volume`)
      const top = (data.tokens || []).slice(0, 40)
      const map = new Map<string, { volumeUsd: number; buys: number; sells: number; createdAt?: string }>()
      await poolMap(top, 6, async (t: any) => {
        try {
          const tr = await jfetchCached<any>(`/api/launchpad/tokens/${t.address}/trades?chain=base&limit=60`, 15000)
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
        return res.json(rows.map((p) => ({ ...p, handle: accMap.get(p.author)?.handle || null, avatar: accMap.get(p.author)?.avatar || null })))
      }

      // POST { author, body, tokenSymbol?, tokenImage? }
      if (req.method === 'POST') {
        const { author, body, tokenSymbol, tokenImage } = req.body || {}
        const clean = String(body || '').trim()
        if (!author || !clean) return res.status(400).json({ error: 'author and body are required' })
        if (clean.length > 280) return res.status(400).json({ error: 'body too long (max 280)' })
        const { data, error } = await sb.from('posts').insert({
          author: String(author),
          body: clean,
          token_symbol: tokenSymbol ? String(tokenSymbol) : null,
          token_image: tokenImage ? String(tokenImage) : null,
        }).select().single()
        if (error) return res.status(500).json({ error: error.message })
        return res.json(data)
      }
    }

    // ─── /api/accounts ───────────────────────────────────────
    if (url.includes('/api/accounts')) {
      const sb = getSupabase()
      if (!sb) return res.status(500).json({ error: 'accounts not configured' })

      // GET ?wallet=
      if (req.method === 'GET') {
        const u = new URL(url, 'http://x')
        const wallet = u.searchParams.get('wallet') || ''
        if (!wallet) return res.json({ account: null })
        const { data, error } = await sb.from('accounts').select('wallet, handle, avatar').eq('wallet', wallet).maybeSingle()
        if (error) return res.status(500).json({ error: error.message })
        return res.json({ account: data || null })
      }

      // POST { wallet, handle, avatar? } — upsert
      if (req.method === 'POST') {
        const { wallet, handle, avatar } = req.body || {}
        if (!wallet) return res.status(400).json({ error: 'wallet is required' })
        const clean = String(handle || '').trim()
        if (clean.length > 24) return res.status(400).json({ error: 'handle too long (max 24)' })
        const { data, error } = await sb.from('accounts').upsert({
          wallet: String(wallet),
          handle: clean || null,
          avatar: avatar ? String(avatar) : null,
        }).select().single()
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
