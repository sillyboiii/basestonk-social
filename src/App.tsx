import { useEffect, useMemo, useState } from 'react'
import {
  fetchTokens, fetchFeed, fetchLeaderboard,
  fmtUsd,
} from './lib/api'
import type { Token, FeedItem, LeaderRow } from './lib/api'
import { derivePosts, avatarGradient, initials, relativeTime, shortAddr } from './lib/social'
import type { Post } from './lib/social'

// ─── Avatar ────────────────────────────────────────────────────────────────

function Avatar({ addr, size = 40 }: { addr: string; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center rounded-full font-display font-bold text-white ring-2 ring-white/10"
      style={{ width: size, height: size, background: avatarGradient(addr), fontSize: size * 0.32 }}
    >
      {initials(addr)}
    </div>
  )
}

// ─── Feed post card ─────────────────────────────────────────────────────────

function PostCard({ post }: { post: Post }) {
  const flexUp = (post.pnlPct || 0) >= 0
  const buy = post.side === 'buy'
  const verb = post.kind === 'flex' ? 'is flexing' : buy ? 'bought' : 'sold'

  return (
    <article className="card overflow-hidden">
      {/* author row */}
      <div className="flex items-start gap-3 px-4 pt-4">
        <Avatar addr={post.trader} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-sm font-bold text-white">{post.traderShort}</span>
            {post.streak && post.streak > 2 && (
              <span className="rounded-full bg-[#f5c847]/15 px-2 py-0.5 text-[10px] font-bold text-[#f5c847]">🔥 {post.streak} streak</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-[#7c8aa5]">
            <a href={`https://basescan.org/address/${post.trader}`} target="_blank" rel="noreferrer" className="font-mono hover:text-[#9aa7cc]">{post.trader}</a>
            <span>·</span>
            <span>{relativeTime(post.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* the move */}
      <div className="mt-3 px-4">
        <p className="text-[15px] leading-relaxed text-white">
          <span className={`font-display font-bold ${buy ? 'text-[#34d399]' : 'text-[#f87171]'}`}>{verb}</span>{' '}
          <span className="font-semibold text-[#2f7bff]">${post.tokenSymbol}</span>{' '}
          <span className="text-[#7c8aa5]">{fmtUsd(post.volumeUsd)} @ {fmtUsd(post.priceUsd, 5)}</span>
        </p>
      </div>

      {/* P&L flex strip */}
      {post.kind === 'flex' && (
        <div className={`mx-4 mt-3 flex items-center justify-between rounded-xl border px-4 py-3 ${flexUp ? 'border-[#34d399]/25 bg-[#34d399]/8' : 'border-[#f87171]/25 bg-[#f87171]/8'}`}>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-[#7c8aa5]">P&L on ${post.tokenSymbol}</div>
            <div className={`font-display text-lg font-black ${flexUp ? 'text-[#34d399]' : 'text-[#f87171]'}`}>{flexUp ? '+' : ''}{post.pnlPct}%</div>
          </div>
        </div>
      )}

      {/* footer actions */}
      <div className="mt-3 flex items-center justify-between border-t border-[#141f3d] px-4 py-2.5 text-[11px] text-[#7c8aa5]">
        <a href={`https://basescan.org/address/${post.trader}`} target="_blank" rel="noreferrer" className="font-mono transition-colors hover:text-[#9aa7cc]">view wallet</a>
        <a href={`https://basescan.org/tx/${post.txn}`} target="_blank" rel="noreferrer" className="font-mono transition-colors hover:text-[#9aa7cc]">tx {post.txn.slice(0, 8)}…</a>
      </div>
    </article>
  )
}

// ─── Left rail / brand ─────────────────────────────────────────────────────

function LeftRail({ crew }: { crew: string[] }) {
  return (
    <div className="sticky top-16 hidden self-start lg:block lg:w-56">
      <div className="mb-6">
        <img src="/gem-blue-256.png" alt="BaseStonk gem" className="h-10 w-10 gem-glow" />
      </div>
      <nav className="space-y-1 text-[13px] font-medium">
        {['Home', 'Trending stonks', 'Top degens', 'Your crew', 'P&L wall'].map((l) => (
          <a key={l} href="#" className="flex items-center gap-3 rounded-lg px-3 py-2 text-[#9aa7cc] transition-colors hover:bg-[#0a1028] hover:text-white">{l}</a>
        ))}
      </nav>

      <div className="mt-8">
        <div className="mb-3 text-[10px] font-bold uppercase tracking-wider text-[#7c8aa5]">Your Crew</div>
        {crew.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#1c2a4d] p-3 text-center text-[11px] text-[#7c8aa5]">
            Follow wallets to build your crew — their moves land here.
          </div>
        ) : (
          <div className="space-y-1">
            {crew.map((c) => (
              <div key={c} className="flex items-center gap-2 text-[12px] text-[#9aa7cc]">
                <Avatar addr={c} size={22} />
                <span className="font-mono">{shortAddr(c)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Trending stonks chips ─────────────────────────────────────────────────

function TrendingStonks({ tokens }: { tokens: Token[] }) {
  const hot = [...tokens].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 5)
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#7c8aa5]">Trending stonks</h3>
      <div className="space-y-2">
        {hot.map((t) => {
          const up = t.change24hPct >= 0
          return (
            <div key={t.address} className="card flex items-center gap-3 px-3 py-2">
              {t.logoUrl
                ? <img src={t.logoUrl} alt="" className="h-8 w-8 rounded-full bg-[#0a1028]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                : <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#0051ff] to-[#2f7bff] text-[10px] font-bold text-white">{t.symbol.slice(0, 2)}</div>}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-white">${t.symbol}</div>
                <div className="text-[10px] text-[#7c8aa5]">{fmtUsd(t.volume24hUsd)} vol</div>
              </div>
              <span className={`font-mono text-[12px] font-semibold ${up ? 'text-[#34d399]' : 'text-[#f87171]'}`}>{up ? '+' : ''}{t.change24hPct.toFixed(1)}%</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Top degens (leaderboard as people) ─────────────────────────────────────

function TopDegens({ rows }: { rows: LeaderRow[] }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#7c8aa5]">Top degens this hour</h3>
      <div className="card overflow-hidden">
        {rows.slice(0, 8).map((r, i) => {
          const pct = r.volumeUsd > 0 ? (r.volumeUsd / Math.max(rows[0]?.volumeUsd || 1, r.volumeUsd)) * 100 : 0
          const medal = i === 0 ? 'text-[#f5c847]' : i === 1 ? 'text-[#9aa7cc]' : i === 2 ? 'text-[#d9904f]' : 'text-[#3a4a75]'
          return (
            <div key={r.trader} className="flex items-center gap-2.5 border-b border-[#141f3d] px-3 py-2.5 last:border-0">
              <span className={`w-4 shrink-0 text-center font-display text-[12px] font-bold ${medal}`}>{i + 1}</span>
              <Avatar addr={r.trader} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12px] font-medium text-white">{shortAddr(r.trader)}</div>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-[#141f3d]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#0051ff] to-[#2f7bff]" style={{ width: `${pct}%` }} />
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

  // feed sorted newest-first with flex moments floated up
  const feedPosts = useMemo(() => {
    const flex = posts.filter((p) => p.kind === 'flex')
    const rest = posts.filter((p) => p.kind !== 'flex')
    return [...flex, ...rest]
  }, [posts])

  if (loading) {
    return (
      <div className="bg-grid grid min-h-screen place-items-center">
        <div className="text-center">
          <img src="/gem-blue-256.png" alt="" className="mx-auto h-12 w-12 gem-glow" />
          <div className="mt-3 animate-pulse text-sm text-[#7c8aa5]">loading the crew…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-grid min-h-screen">
      <header className="sticky top-0 z-40 border-b border-[#1c2a4d] bg-[#050a1e]/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3 lg:hidden">
            <img src="/gem-blue-256.png" alt="" className="h-8 w-8" />
            <span className="font-display text-base font-bold tracking-tight text-white">BASE<span className="text-[#2f7bff]">STONK</span></span>
          </div>
          <div className="hidden font-display text-base font-bold tracking-tight text-white lg:block">
            THE <span className="text-[#2f7bff]">CREW</span>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#1c2a4d] bg-[#0a1028] px-3 py-1.5">
            <span className="h-2 w-2 rounded-full bg-[#34d399] pulse-dot" />
            <span className="text-xs font-medium text-[#9aa7cc]">Live on Base</span>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl gap-8 px-4 py-6">
        <LeftRail crew={[]} />

        {/* CENTER: the feed */}
        <section className="min-w-0 flex-1">
          {/* composer */}
          <div className="card mb-4 p-3">
            <div className="flex items-center gap-3">
              <Avatar addr="0xYOU" size={38} />
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What's the play today? …"
                className="w-full bg-transparent text-sm text-white placeholder-[#5b6b8f] outline-none"
              />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-[#141f3d] pt-2.5">
              <span className="text-[10px] uppercase tracking-wider text-[#7c8aa5]">the crew sees you 👀</span>
              <button className="rounded-full bg-gradient-to-r from-[#0051ff] to-[#2f7bff] px-4 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40" disabled={!draft.trim()}>Post</button>
            </div>
          </div>

          {/* hero line */}
          <div className="mb-4 px-1">
            <h1 className="font-display text-2xl font-black tracking-tight text-white">The feed</h1>
            <p className="text-[13px] text-[#7c8aa5]">Real moves from the BaseStonk crew — buys, sells, and flexes.</p>
          </div>

          <div className="space-y-3">
            {err && (
              <div className="rounded-xl border border-[#f87171]/40 bg-[#f87171]/10 p-3 text-sm text-[#f87171]">
                Some data is temporarily unavailable ({err}). Retrying automatically…
              </div>
            )}
            {feedPosts.map((p) => (
              <PostCard key={p.id} post={p} />
            ))}
          </div>
        </section>

        {/* RIGHT rail: community */}
        <aside className="hidden w-72 shrink-0 flex-col gap-6 self-start lg:flex">
          <TrendingStonks tokens={tokens} />
          <TopDegens rows={leader} />
        </aside>
      </main>

      <footer className="border-t border-[#1c2a4d] py-8 text-center">
        <div className="mx-auto max-w-xl px-4 text-[11px] text-[#7c8aa5]">
          An independent community layer for the BaseStonk launchpad on Base.
          Not affiliated with Coinbase or Base. Informational only.
        </div>
      </footer>
    </div>
  )
}
