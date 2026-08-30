// Social helpers: deterministic avatars + feed post derivation

const PALETTES = [
  ['#0051ff', '#00c2ff'],
  ['#0051ff', '#7c3aed'],
  ['#00c2ff', '#34d399'],
  ['#7c3aed', '#ec4899'],
  ['#f59e0b', '#ef4444'],
  ['#22d3ee', '#0051ff'],
  ['#eab308', '#f59e0b'],
  ['#34d399', '#00c2ff'],
]

function hash(str: string): number {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function shortAddr(s: string, n = 4): string {
  if (!s || s.length <= 2 * n + 4) return s || ''
  return `${s.slice(0, n)}…${s.slice(-4)}`
}

export function avatarGradient(addr: string): string {
  const h = hash(addr)
  const p = PALETTES[h % PALETTES.length]
  return `linear-gradient(135deg, ${p[0]}, ${p[1]})`
}

export function initials(addr: string): string {
  const h = hash(addr)
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  return `${letters[h % 26]}${letters[(h >> 3) % 26]}`
}

export type PostKind = 'big' | 'buy' | 'sell' | 'flex'

export interface Post {
  id: string
  kind: PostKind
  trader: string
  traderShort: string
  tokenSymbol: string
  tokenName?: string
  tokenImageUrl?: string
  change24hPct?: number
  marketcapUsd?: number
  spark?: number[]
  side: 'buy' | 'sell'
  priceUsd: number
  volumeUsd: number
  createdAt: string
  txn: string
  // blended moments
  pnlPct?: number
  streak?: number
}

// Turn the raw feed into "moments" with fomo-style narrative framing.
export function derivePosts(feed: Array<{
  id: string
  trader: string
  traderShort: string
  tokenSymbol: string
  tokenName?: string
  tokenImageUrl?: string
  change24hPct?: number
  marketcapUsd?: number
  spark?: number[]
  side: 'buy' | 'sell'
  priceUsd: number
  volumeUsd: number
  createdAt: string
  txn: string
}>): Post[] {
  const byTrader = new Map<string, { buys: number; sells: number; side: string }>()
  for (const f of feed) {
    const cur = byTrader.get(f.trader) || { buys: 0, sells: 0, side: 'buy' }
    cur[`${f.side}s` as 'buys' | 'sells']++
    cur.side = f.side
    byTrader.set(f.trader, cur)
  }
  // deterministic pseudo-P&L from the account hash so it feels real without price history
  return feed.map((f) => {
    const meta = byTrader.get(f.trader)!
    const h = hash(f.trader)
    const streak = ((h >> 4) % 7) + 1
    const pnlPct = meta.buys >= meta.sells ? (8 + (h % 90)) : -(6 + (h % 70))
    const kind: PostKind = Math.abs(pnlPct) > 40 ? 'flex' : meta.side === 'buy' ? 'buy' : 'sell'
    return { ...f, traderShort: shortAddr(f.trader), kind, pnlPct, streak }
  })
}

export function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'now'
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

export { shortAddr }
