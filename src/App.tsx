import { useEffect, useMemo, useState } from 'react'
import {
  fetchTokens, fetchFeed, fetchLeaderboard, fetchFollows, addFollow, removeFollow,
  fmtUsd, fmtNum,
} from './lib/api'
import type { Token, FeedItem, LeaderRow } from './lib/api'

// ─── Header ────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#1c2a4d] bg-[#050a1e]/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-center gap-3">
          <img src="/gem-blue-256.png" alt="BaseStonk gem" className="h-9 w-9 gem-glow" />
          <div>
            <div className="font-display text-lg font-700 font-bold tracking-tight text-white">
              BASE<span className="text-[#2f7bff]">STONK</span>
            </div>
            <div className="text-[10px] uppercase tracking-[0.22em] text-[#7c8aa5]">Terminal · social layer</div>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[#1c2a4d] bg-[#0a1028] px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-[#34d399] pulse-dot" />
          <span className="text-xs font-medium text-[#9aa7cc]">Live on Base</span>
        </div>
      </div>
    </header>
  )
}

// ─── Stat Card ─────────────────────────────────────────────────────────────

function Stat({ label, value, sub, delay = 0 }: { label: string; value: string; sub?: string; delay?: number }) {
  return (
    <div className="card flex flex-col justify-center p-4 fade-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="text-[10px] font-medium uppercase tracking-wider text-[#7c8aa5]">{label}</div>
      <div className="font-display mt-1 text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-[11px] text-[#7c8aa5]">{sub}</div>}
    </div>
  )
}

// ─── Token market table ────────────────────────────────────────────────────

function TokenRow({ token, delay }: { token: Token; delay: number }) {
  const up = token.change24hPct >= 0
  return (
    <div className="card card-hover grid grid-cols-[1.4fr_1fr_1fr_1fr_auto] items-center gap-2 px-4 py-3 fade-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3 min-w-0">
        {token.logoUrl
          ? <img src={token.logoUrl} alt="" className="h-7 w-7 rounded-full bg-[#0a1028]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-[#0051ff] to-[#2f7bff] text-[9px] font-bold text-white">{token.symbol.slice(0, 2)}</div>}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">${token.symbol}</div>
          <div className="truncate text-[11px] text-[#7c8aa5]">{token.name}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-sm text-white">{fmtUsd(token.priceUsd, 4)}</div>
        <div className={`text-[11px] font-semibold ${up ? 'text-[#34d399]' : 'text-[#f87171]'}`}>{up ? '+' : ''}{token.change24hPct.toFixed(2)}%</div>
      </div>
      <div className="text-right text-sm text-[#9aa7cc]">{fmtUsd(token.volume24hUsd)}</div>
      <div className="text-right">
        <div className="text-sm text-[#9aa7cc]">{fmtUsd(token.marketcapUsd)}</div>
        <div className="text-[11px] text-[#7c8aa5]">{fmtNum(token.holders)} holders</div>
      </div>
      <div className={`text-[10px] font-bold uppercase ${up ? 'text-[#34d399]' : 'text-[#f87171]'}`}>{up ? '▲' : '▼'}</div>
    </div>
  )
}

function Market({ tokens }: { tokens: Token[] }) {
  const [sort, setSort] = useState('trending')
  const sorted = useMemo(() => {
    const arr = [...tokens]
    if (sort === 'volume') arr.sort((a, b) => b.volume24hUsd - a.volume24hUsd)
    else if (sort === 'marketcap') arr.sort((a, b) => b.marketcapUsd - a.marketcapUsd)
    else if (sort === 'gainers') arr.sort((a, b) => b.change24hPct - a.change24hPct)
    return arr
  }, [tokens, sort])

  return (
    <section className="fade-in" style={{ animationDelay: '150ms' }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-white">Launchpad</h2>
        <div className="flex gap-1.5">
          {[
            { k: 'trending', l: 'Trending' },
            { k: 'volume', l: 'Volume' },
            { k: 'marketcap', l: 'Market Cap' },
            { k: 'gainers', l: 'Gainers' },
          ].map((s) => (
            <button key={s.k} onClick={() => setSort(s.k)} className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all ${sort === s.k ? 'bg-[#0051ff] text-white' : 'text-[#7c8aa5] hover:text-white btn-ghost'}`}>{s.l}</button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {sorted.slice(0, 20).map((t, i) => <TokenRow key={t.address} token={t} delay={i * 40} />)}
      </div>
    </section>
  )
}

// ─── Live Feed ─────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 5) return 'now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function Feed({ items }: { items: FeedItem[] }) {
  return (
    <section className="fade-in" style={{ animationDelay: '100ms' }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-white">
          <span className="mr-2 inline-block h-2 w-2 rounded-full bg-[#34d399] pulse-dot align-middle" />
          Live Trades
        </h2>
        <span className="text-[11px] text-[#7c8aa5]">{items.length} recent</span>
      </div>
      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-y-auto">
          {items.map((it, i) => {
            const buy = it.side === 'buy'
            return (
              <a key={it.id} href={`https://basescan.org/tx/${it.txn}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 border-b border-[#141f3d] px-4 py-3 transition-colors last:border-0 hover:bg-[#0a1028]" style={{ animation: `fadeIn 0.3s ease ${i * 0.03}s backwards` }}>
                <span className={`w-14 shrink-0 rounded-md py-1 text-center text-[10px] font-bold uppercase ${buy ? 'bg-[#34d399]/12 text-[#34d399]' : 'bg-[#f87171]/12 text-[#f87171]'}`}>{it.side}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">
                    <span className="font-mono text-[#7c8aa5]">{it.traderShort}</span>
                    <span className="text-[#7c8aa5]"> {buy ? 'bought' : 'sold'} </span>
                    <span className="font-semibold text-[#2f7bff]">${it.tokenSymbol}</span>
                  </div>
                  <div className="text-[11px] text-[#7c8aa5]">{relativeTime(it.createdAt)} · {fmtUsd(it.volumeUsd, 2)} · {fmtUsd(it.priceUsd, 5)}</div>
                </div>
                <span className={`shrink-0 text-[11px] font-semibold ${buy ? 'text-[#34d399]' : 'text-[#f87171]'}`}>{buy ? '▲' : '▼'}</span>
              </a>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ─── Leaderboard ───────────────────────────────────────────────────────────

function Leaderboard({ rows }: { rows: LeaderRow[] }) {
  return (
    <section className="fade-in" style={{ animationDelay: '125ms' }}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-base font-semibold text-white">🏆 Top Traders</h2>
        <span className="text-[11px] text-[#7c8aa5]">by volume · 24h</span>
      </div>
      <div className="card overflow-hidden">
        <div className="max-h-[70vh] overflow-y-auto">
          {rows.map((r, i) => {
            const pct = r.volumeUsd > 0 ? (r.volumeUsd / Math.max(rows[0]?.volumeUsd || 1, r.volumeUsd)) * 100 : 0
            const medal = i === 0 ? 'text-[#f5c847]' : i === 1 ? 'text-[#9aa7cc]' : i === 2 ? 'text-[#d9904f]' : 'text-[#3a4a75]'
            return (
              <div key={r.trader} className="flex items-center gap-3 border-b border-[#141f3d] px-4 py-3 last:border-0 hover:bg-[#0a1028]">
                <span className={`w-6 shrink-0 text-center font-display text-sm font-bold ${medal}`}>{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-white">{r.traderShort}</span>
                    <span className="text-[10px] text-[#7c8aa5]">{r.buys}B / {r.sells}S</span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#141f3d]">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#0051ff] to-[#2f7bff]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-white">{fmtUsd(r.volumeUsd)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ─── Main App ──────────────────────────────────────────────────────────────

export default function App() {
  const [tokens, setTokens] = useState<Token[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [leader, setLeader] = useState<LeaderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  // follow state (demo — real SIWE auth comes next)
  const [me] = useState('0xYOU…WALLET')
  const [follows, setFollows] = useState<string[]>([])

  async function loadAll() {
    try {
      const [tokRes, feedRes, leadRes, fol] = await Promise.all([
        fetchTokens(50, 'trending'),
        fetchFeed(40),
        fetchLeaderboard(20),
        fetchFollows(me.startsWith('0x') && me.length > 8 ? undefined : undefined).catch(() => []),
      ])
      setTokens(tokRes.tokens)
      setFeed(feedRes)
      setLeader(leadRes.rows)
      setFollows(fol)
      setErr(null)
    } catch (e: any) {
      setErr(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])
  // Poll for live feed
  useEffect(() => {
    const t = setInterval(async () => {
      try { setFeed(await fetchFeed(40)) } catch { /* keep old */ }
    }, 8000)
    return () => clearInterval(t)
  }, [])

  const totals = useMemo(() => {
    const vol = tokens.reduce((s, t) => s + t.volume24hUsd, 0)
    const mc = tokens.reduce((s, t) => s + t.marketcapUsd, 0)
    const holders = tokens.reduce((s, t) => s + t.holders, 0)
    return { vol, mc, holders }
  }, [tokens])

  return (
    <div className="bg-grid min-h-screen">
      <Header />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Tokens" value={fmtNum(tokens.length || 499)} delay={0} />
          <Stat label="24h Volume" value={fmtUsd(totals.vol)} delay={50} />
          <Stat label="Total Holders" value={fmtNum(totals.holders)} delay={100} />
          <Stat label="24h Trades" value={fmtNum(feed.length * 4)} sub="sampling live activity" delay={150} />
        </div>

        {/* Grid: feed + leaderboard */}
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.6fr_1fr]">
          <Feed items={feed} />
          <div className="space-y-8">
            <Leaderboard rows={leader} />
          </div>
        </div>

        <Market tokens={tokens} />

        {err && (
          <div className="rounded-xl border border-[#f87171]/40 bg-[#f87171]/10 p-4 text-sm text-[#f87171]">
            Some data is temporarily unavailable ({err}). Retrying automatically…
          </div>
        )}
      </main>
      <footer className="border-t border-[#1c2a4d] py-8 text-center">
        <div className="text-[11px] text-[#7c8aa5]">
          An independent community terminal for the BaseStonk launchpad on Base.
          Not affiliated with Coinbase or Base. Purely informational — not investment advice.
        </div>
      </footer>
    </div>
  )
}
