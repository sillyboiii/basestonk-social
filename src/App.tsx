import { useEffect, useMemo, useState } from 'react'
import {
  fetchTokens, fetchFeed, fetchLeaderboard,
  fmtUsd,
} from './lib/api'
import type { Token, FeedItem, LeaderRow } from './lib/api'
import { derivePosts, initials, relativeTime, shortAddr } from './lib/social'
import type { Post } from './lib/social'

// ─── Sparkline ─────────────────────────────────────────────────────────────

function Sparkline({ data, up, w = 170, h = 40 }: { data: number[]; up: boolean; w?: number; h?: number }) {
  if (!data || data.length < 2) return <div style={{ width: w, height: h }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * (w - 4) + 2
    const y = h - 3 - ((v - min) / span) * (h - 6)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
  const stroke = up ? '#45d68f' : '#ea6055'
  const fill = up ? 'rgba(69,214,143,0.18)' : 'rgba(234,96,85,0.18)'
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      <polygon points={`2,${h - 2} ${pts} ${w - 2},${h - 2}`} fill={fill} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.split(' ').at(-1)!.split(',')[0]} cy={pts.split(' ').at(-1)!.split(',')[1]} r="2.6" fill={stroke} />
    </svg>
  )
}

// ─── Feed post card (pump.fun-style) ───────────────────────────────────────

function PostCard({ post }: { post: Post }) {
  const buy = post.side === 'buy'
  const up = (post.change24hPct ?? 0) >= 0
  const actionColor = buy ? 'text-[#45d68f]' : 'text-[#ea6055]'

  return (
    <article className="card overflow-hidden p-5">
      {/* author row */}
      <div className="flex items-center gap-3">
        {post.tokenImageUrl
          ? <img src={post.tokenImageUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover ring-2 ring-white/10" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0052ff] to-[#2d7cff] text-[13px] font-bold text-white">{post.tokenSymbol.slice(0, 2)}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] font-medium text-white">{post.traderShort}</span>
            {post.streak && post.streak > 2 && (
              <span className="shrink-0 text-[11px] font-bold text-[#f5c847]">🔥 {post.streak}</span>
            )}
          </div>
          <div className="text-[11px] text-[#b3bdd4]">
            <span className={actionColor}>{buy ? 'bought' : 'sold'} {fmtUsd(post.volumeUsd)}</span>
            <span> of </span>
            <span className="font-bold text-[#0052ff]">${post.tokenSymbol}</span>
            <span> · {relativeTime(post.createdAt)}</span>
          </div>
        </div>
        {post.spark && post.spark.length >= 2 && (
          <div className="hidden shrink-0 sm:block"><Sparkline data={post.spark} up={up} /></div>
        )}
      </div>

      {/* info strip */}
      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-[#1f2740] bg-[#1f2740]">
        <div className="bg-[#0d142b] px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-[#b3bdd4]">Market cap</div>
          <div className="font-display text-[13px] font-black text-white">{fmtUsd(post.marketcapUsd ?? 0)}</div>
        </div>
        <div className="bg-[#0d142b] px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-[#b3bdd4]">24h</div>
          <div className={`font-display text-[13px] font-black ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '▲' : '▼'} {Math.abs(post.change24hPct ?? 0).toFixed(1)}%</div>
        </div>
        <div className="bg-[#0d142b] px-3 py-2">
          <div className="text-[9px] uppercase tracking-wider text-[#b3bdd4]">Price</div>
          <div className="font-display text-[13px] font-black text-white">{fmtUsd(post.priceUsd, 6)}</div>
        </div>
      </div>

      {/* footer actions */}
      <div className="mt-3 flex items-center justify-between text-[11px] text-[#b3bdd4]">
        <a href={`https://basescan.org/address/${post.trader}`} target="_blank" rel="noreferrer" className="font-mono transition-colors hover:text-white">{shortAddr(post.trader, 6)} · view</a>
        <a href={`https://basescan.org/tx/${post.txn}`} target="_blank" rel="noreferrer" className="font-mono transition-colors hover:text-white">tx {post.txn.slice(0, 8)}…</a>
      </div>
    </article>
  )
}

// ─── Trending stonks (token cards) ─────────────────────────────────────────

function TrendingStonks({ tokens }: { tokens: Token[] }) {
  const hot = [...tokens].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 6)
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Trending stonks</h3>
      <div className="space-y-2">
        {hot.map((t) => {
          const up = t.change24hPct >= 0
          return (
            <div key={t.address} className="card flex items-center gap-3 px-3 py-2">
              {t.logoUrl || t.imageUrl
                ? <img src={t.imageUrl || t.logoUrl} alt="" className="h-8 w-8 rounded-full bg-[#0d142b] object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                : <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#0052ff] to-[#2d7cff] text-[10px] font-bold text-white">{t.symbol.slice(0, 2)}</div>}
              <div className="min-w-0 flex-1">
                <div className="truncate font-extrabold text-[#0052ff]">${t.symbol}</div>
                <div className="text-[11px] font-black text-white">{fmtUsd(t.marketcapUsd)}</div>
                <div className="text-[10px] text-[#b3bdd4]">Vol {fmtUsd(t.volume24hUsd)}</div>
              </div>
              <span className={`shrink-0 font-mono text-[12px] font-extrabold ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '▲' : '▼'} {Math.abs(t.change24hPct).toFixed(1)}%</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Top degens (leaderboard) ──────────────────────────────────────────────

function TopDegens({ rows }: { rows: LeaderRow[] }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Top degens this hour</h3>
      <div className="card overflow-hidden">
        {rows.slice(0, 8).map((r, i) => {
          const pct = r.volumeUsd > 0 ? (r.volumeUsd / Math.max(rows[0]?.volumeUsd || 1, r.volumeUsd)) * 100 : 0
          const medal = i === 0 ? 'text-[#f5c847]' : i === 1 ? 'text-[#b3bdd4]' : i === 2 ? 'text-[#d9904f]' : 'text-[#3a4a75]'
          return (
            <div key={r.trader} className="flex items-center gap-2.5 border-b border-[#1f2740] px-3 py-2.5 last:border-0">
              <span className={`w-4 shrink-0 text-center font-display text-[12px] font-bold ${medal}`}>{i + 1}</span>
              <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0052ff] to-[#2d7cff] text-[9px] font-bold text-white">{initials(r.trader)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] font-medium text-white">{shortAddr(r.trader)}</div>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-[#1f2740]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#0052ff] to-[#2d7cff]" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <span className="shrink-0 font-mono text-[12px] font-semibold text-white">{fmtUsd(r.volumeUsd)}</span>
            </div>
          )
        })}
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
  const [draft, setDraft] = useState('')

  const posts = useMemo(() => derivePosts(feed), [feed])

  const stats = useMemo(() => {
    const vol24 = tokens.reduce((s, t) => s + t.volume24hUsd, 0)
    const top = [...tokens].sort((a, b) => b.change24hPct - a.change24hPct)[0]
    return {
      vol24,
      tokens: tokens.length,
      moves: posts.length,
      topSymbol: top?.symbol ?? '—',
      topPct: top ? top.change24hPct.toFixed(1) : '0.0',
    }
  }, [tokens, posts])

  async function loadAll() {
    try {
      const [tokRes, feedRes, leadRes] = await Promise.all([
        fetchTokens(50, 'trending'),
        fetchFeed(40),
        fetchLeaderboard(20),
      ])
      setTokens(tokRes.tokens)
      setFeed(feedRes)
      setLeader(leadRes.rows)
      setErr(null)
    } catch (e: any) {
      setErr(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadAll() }, [])
  useEffect(() => {
    const t = setInterval(async () => {
      try { setFeed(await fetchFeed(40)) } catch { /* keep old */ }
    }, 12000)
    return () => clearInterval(t)
  }, [])

  if (loading) {
    return (
      <div className="bg-grid grid min-h-screen place-items-center">
        <div className="text-center">
          <img src="/gem-blue-256.png" alt="" className="mx-auto h-12 w-12 gem-glow" />
          <div className="mt-3 animate-pulse text-sm text-[#b3bdd4]">live on base…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-grid min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[#1f2740] bg-[#050a1e]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-2.5">
          <div className="flex items-center gap-2.5">
            <img src="/gem-blue-256.png" alt="" className="h-8 w-8" />
            <span className="font-display text-base font-bold tracking-tight text-white">BASE<span className="text-[#0052ff]">STONK</span></span>
          </div>

          <nav className="pill-nav row max-md:hidden">
            <a href="#" data-active="true" className="pill-nav-item px-4 py-1.5">Home</a>
            <a href="#" className="pill-nav-item px-4 py-1.5">Trending</a>
            <a href="#" className="pill-nav-item px-4 py-1.5">Degens</a>
            <a href="#" className="pill-nav-item px-4 py-1.5">P&L wall</a>
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-[#1f2740] bg-[#0d142b] px-3 py-1.5 sm:flex">
              <span className="h-2 w-2 rounded-full bg-[#45d68f] pulse-dot" />
              <span className="text-xs font-medium text-[#b3bdd4]">Live</span>
            </div>
            <button className="btn-gem px-5 py-1.5 text-[12px] font-semibold">Post</button>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-7xl gap-6 px-4 py-6">
        {/* CENTER: the feed */}
        <section className="min-w-0 flex-1">
          {/* hero */}
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <h1 className="font-display text-4xl font-black tracking-tight text-white">
                The <span className="text-[#0052ff]">feed</span>
              </h1>
              <p className="mt-1 text-[14px] font-medium text-[#b3bdd4]">Real moves from BaseStonk degens, live on Base.</p>
            </div>
            <div className="hidden gap-2 sm:flex">
              <div className="card px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">24h vol</div><div className="font-display text-lg font-black stat-grad">{fmtUsd(stats.vol24)}</div></div>
              <div className="card px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">Top</div><div className="font-display text-lg font-black stat-grad-cyan">${stats.topSymbol} {stats.topPct}%</div></div>
            </div>
          </div>

          <div className="space-y-4">
            {err && (
              <div className="rounded-xl border border-[#ea6055]/40 bg-[#ea6055]/10 p-3 text-sm text-[#ea6055]">
                Some data is temporarily unavailable ({err}). Retrying automatically…
              </div>
            )}
            {posts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </section>

        {/* RIGHT rail: community */}
        <aside className="hidden w-72 shrink-0 flex-col gap-6 self-start xl:flex">
          <TrendingStonks tokens={tokens} />
          <TopDegens rows={leader} />
        </aside>
      </main>

      <footer className="border-t border-[#1f2740] py-8 text-center">
        <div className="mx-auto max-w-xl px-4 text-[11px] text-[#b3bdd4]">
          An independent community layer for the BaseStonk launchpad on Base.
          Not affiliated with Coinbase or Base. Informational only.
        </div>
      </footer>
    </div>
  )
}