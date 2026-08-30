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

    // ─── /api/tokens ─────────────────────────────────────────
    if (url.includes('/api/tokens') && !url.match(/\/api\/tokens\/0x/)) {
      const u = new URL(url, 'http://x')
      const limit = u.searchParams.get('limit') || '50'
      const sort = u.searchParams.get('sort') || 'trending'
      const data = await jfetch<any>(`/api/launchpad/tokens?chain=base&limit=${limit}&sort=${sort}`)
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
      const data = await jfetch<any>(`/api/launchpad/tokens?chain=base&limit=30&sort=trending`)
      const top = (data.tokens || []).slice(0, 12)
      const all: { trade: any; symbol: string; name: string; imageUrl?: string; change24hPct: number; marketcapUsd: number; spark: number[] }[] = []
      await Promise.all(top.map(async (t: any) => {
        try {
          const [tr, cdl] = await Promise.all([
            jfetch<any>(`/api/launchpad/tokens/${t.address}/trades?chain=base&limit=8`).catch(() => null),
            jfetch<any>(`/api/launchpad/tokens/${t.address}/candles?chain=base&interval=5m&limit=24`).catch(() => null),
          ])
          const spark = Array.isArray(cdl?.candles) ? cdl.candles.map((c: any) => c.c) : []
          ;(tr?.trades || []).forEach((trade: any) => all.push({
            trade, symbol: t.symbol, name: t.name, imageUrl: t.imageUrl || t.logoUrl,
            change24hPct: t.change24hPct || 0, marketcapUsd: t.marketcapUsd || 0, spark,
          }))
        } catch { /* skip */ }
      }))
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
      const data = await jfetch<any>(`/api/launchpad/tokens?chain=base&limit=40&sort=volume`)
      const top = (data.tokens || []).slice(0, 40)
      const map = new Map<string, { volumeUsd: number; buys: number; sells: number; createdAt?: string }>()
      await Promise.all(top.map(async (t: any) => {
        try {
          const tr = await jfetch<any>(`/api/launchpad/tokens/${t.address}/trades?chain=base&limit=60`)
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
      }))
      let maxVol = 0
      const rows = Array.from(map.entries()).map(([trader, v]) => {
        maxVol = Math.max(maxVol, v.volumeUsd)
        return { trader, traderShort: shortAddr(trader), volumeUsd: v.volumeUsd, buys: v.buys, sells: v.sells, score: v.volumeUsd }
      }).sort(sortTrades).slice(0, 20)
      return res.json({ maxScore: maxVol, rows })
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
