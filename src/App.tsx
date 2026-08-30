import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchTokens, fetchFeed, fetchLeaderboard, fetchPosts, createPost, likePost,
  fmtUsd, fmtNum,
} from './lib/api'
import type { Token, FeedItem, LeaderRow, UserPost } from './lib/api'
import { derivePosts, avatarGradient, initials, relativeTime, shortAddr } from './lib/social'
import type { Post } from './lib/social'

type View = 'home' | 'trending' | 'degens' | 'plwall'

const NAV: { key: View; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'trending', label: 'Trending' },
  { key: 'degens', label: 'Degens' },
  { key: 'plwall', label: 'P&L wall' },
]

// ─── Identity: stable pseudo-wallet per browser ────────────────────────────

function useIdentity() {
  return useState(() => {
    let a = localStorage.getItem('bstonk_id')
    if (!a || !/^0x[0-9a-f]{40}$/i.test(a)) {
      a = '0x' + Array.from({ length: 40 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
      localStorage.setItem('bstonk_id', a)
    }
    return a
  })[0]
}

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

// ─── Token image (coin glyph) ──────────────────────────────────────────────

function CoinGlyph({ src, symbol, size = 44, ring = true }: { src?: string; symbol: string; size?: number; ring?: boolean }) {
  const [broken, setBroken] = useState(false)
  const dim = { width: size, height: size }
  if (!src || broken) {
    return (
      <div style={dim} className={`grid shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0052ff] to-[#2d7cff] text-[13px] font-bold text-white ${ring ? 'ring-2 ring-white/10' : ''}`}>
        {symbol.slice(0, 2)}
      </div>
    )
  }
  return (
    <img
      src={src} alt="" style={dim} onError={() => setBroken(true)}
      className={`shrink-0 rounded-full object-cover ${ring ? 'ring-2 ring-white/10' : ''}`}
    />
  )
}

// ─── Composer: actually post ───────────────────────────────────────────────

function Composer({ identity, tokens, onPosted }: { identity: string; tokens: Token[]; onPosted: () => void }) {
  const [body, setBody] = useState('')
  const [tag, setTag] = useState<Token | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const clean = body.trim()
    if (!clean || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await createPost({
        author: identity,
        body: clean,
        tokenSymbol: tag?.symbol,
        tokenImage: tag?.imageUrl,
      })
      setBody('')
      setTag(null)
      onPosted()
    } catch (e: any) {
      setError(e.message || 'Post failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div
          className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white"
          style={{ background: avatarGradient(identity) }}
        >
          {initials(identity)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-[11px] text-[#b3bdd4]">{shortAddr(identity)}</span>
            <span className="text-[12px] font-bold text-[#28a165]">on Base · live</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 280))}
            rows={3}
            placeholder="Call the 100x. Flex the bag. Shill your position…"
            className="mt-2 w-full resize-none rounded-xl border border-[#1f2740] bg-[#050a1e]/60 p-3 text-[14px] text-white placeholder-[#3a4a75] outline-none transition-colors focus:border-[#0052ff]"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="relative">
                <select
                  value={tag?.address ?? ''}
                  onChange={(e) => setTag(tokens.find((t) => t.address === e.target.value) || null)}
                  className={`appearance-none rounded-full border px-3 py-1.5 text-[12px] font-semibold outline-none transition-colors ${tag ? 'border-[#0052ff] bg-[#0d142b] text-white' : 'border-[#1f2740] bg-[#0d142b] text-[#b3bdd4]'}`}
                >
                  <option value="">+ tag token</option>
                  {tokens.slice(0, 20).map((t) => (
                    <option key={t.address} value={t.address}>${t.symbol} · {t.name}</option>
                  ))}
                </select>
              </div>
              {tag && (
                <button onClick={() => setTag(null)} className="flex items-center gap-1.5 rounded-full bg-[#0d142b] px-2 py-1 text-[11px] text-[#b3bdd4] hover:text-white">
                  <CoinGlyph src={tag.imageUrl || tag.logoUrl} symbol={tag.symbol} size={16} ring={false} />
                  <span className="font-bold text-[#0052ff]">${tag.symbol}</span>
                  ✕
                </button>
              )}
            </div>
            <span className={`text-[11px] font-semibold ${body.length >= 240 ? 'text-[#ea6055]' : 'text-[#3a4a75]'}`}>{body.length}/280</span>
          </div>
          {error && <div className="mt-2 rounded-lg border border-[#ea6055]/40 bg-[#ea6055]/10 p-2 text-[12px] text-[#ea6055]">{error}</div>}
          <div className="mt-3 flex justify-end">
            <button
              onClick={submit}
              disabled={!body.trim() || submitting}
              className="btn-gem px-6 py-2 text-[13px] font-bold disabled:opacity-40"
            >
              {submitting ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── User post card (social) ───────────────────────────────────────────────

function UserPostCard({ post, onLike }: { post: UserPost; onLike: (id: number) => void }) {
  const [liked, setLiked] = useState(false)
  return (
    <article className="card p-4">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white" style={{ background: avatarGradient(post.author) }}>
          {initials(post.author)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[13px] font-semibold text-white">{shortAddr(post.author)}</span>
          </div>
          <div className="text-[11px] text-[#b3bdd4]">{relativeTime(post.created_at)}</div>
        </div>
        {post.token_symbol && (
          <div className="flex items-center gap-1.5 rounded-full border border-[#0052ff]/40 bg-[#0d142b] px-2.5 py-1">
            <CoinGlyph src={post.token_image || undefined} symbol={post.token_symbol} size={18} ring={false} />
            <span className="text-[12px] font-bold text-[#0052ff]">${post.token_symbol}</span>
          </div>
        )}
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-white/90">{post.body}</p>
      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={() => { setLiked(true); onLike(post.id) }}
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-all ${liked ? 'border-[#ea6055]/60 bg-[#ea6055]/10 text-[#ea6055]' : 'border-[#1f2740] text-[#b3bdd4] hover:border-[#ea6055]/40 hover:text-[#ea6055]'}`}
        >
          {liked ? '♥' : '♡'} {post.likes + (liked ? 1 : 0)}
        </button>
      </div>
    </article>
  )
}

// ─── Trending rail card ────────────────────────────────────────────────────

function TrendingStonks({ tokens }: { tokens: Token[] }) {
  const hot = [...tokens].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 6)
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Trending stonks</h3>
      <div className="space-y-2">
        {hot.map((t) => {
          const up = t.change24hPct >= 0
          return (
            <button key={t.address} className="card flex w-full items-center gap-3 px-3 py-2 text-left">
              <CoinGlyph src={t.imageUrl || t.logoUrl} symbol={t.symbol} size={30} ring={false} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-extrabold text-[#0052ff]">${t.symbol}</div>
                <div className="text-[11px] font-black text-white">{fmtUsd(t.marketcapUsd)}</div>
                <div className="text-[10px] text-[#b3bdd4]">Vol {fmtUsd(t.volume24hUsd)}</div>
              </div>
              <span className={`shrink-0 font-mono text-[12px] font-extrabold ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '▲' : '▼'} {Math.abs(t.change24hPct).toFixed(1)}%</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

// ─── Top degens rail ───────────────────────────────────────────────────────

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

// ─── BaseStonk token card (exact anatomy from basestonk.io) ────────────────

function TokenCard({ t }: { t: Token }) {
  const up = t.change24hPct >= 0
  const age = t.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86_400_000)) : 0
  return (
    <button className="card card-hover group w-full p-4 text-left">
      <div className="flex flex-wrap items-center gap-1.5">
        {t.platform && <span className="bs-badge bs-badge-gold px-2 py-0.5">PLATFORM</span>}
        {t.og && <span className="bs-badge bs-badge-soft px-2 py-0.5">OG</span>}
        {t.venue && !t.venue.startsWith('0x') && <span className="bs-badge bs-badge-soft px-2 py-0.5">{t.venue.toUpperCase()}</span>}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <CoinGlyph src={t.imageUrl || t.logoUrl} symbol={t.symbol} size={56} ring={false} />
        <div className="min-w-0">
          <div className="font-extrabold leading-none text-[#0052ff]">${t.symbol}</div>
          <div className="mt-1 truncate text-[14px] font-semibold text-[#b3bdd4]">{t.name}</div>
        </div>
      </div>

      <div className="mt-3 flex items-end gap-2">
        <span className="font-display text-[26px] font-black leading-none text-white">{fmtUsd(t.marketcapUsd)}</span>
        <span className="pb-0.5 text-[12px] font-bold text-[#b3bdd4]">{age}d old</span>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[12px]">
        <span className="text-[#b3bdd4]">Paired with</span>
        <span className="font-bold text-white">{t.venue && !t.venue.startsWith('0x') ? t.venue : 'USDC'}</span>
      </div>

      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px] text-[#b3bdd4]">Vol <b className="font-bold text-white">{fmtUsd(t.volume24hUsd)}</b></span>
        <span className={`font-mono text-[12px] font-extrabold ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '▲' : '▼'} {Math.abs(t.change24hPct).toFixed(2)}%</span>
      </div>

      <div className="mt-2 flex items-center justify-between text-[12px]">
        <span className="text-[#b3bdd4]">{fmtNum(t.holders)} holders</span>
        <span className="font-mono text-white/80">{shortAddr(t.creator)}</span>
      </div>
    </button>
  )
}

// ─── Trending view: BaseStonk token grid ───────────────────────────────────

function TrendingView({ tokens }: { tokens: Token[] }) {
  return (
    <div className="fade-in">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight text-white">Trending <span className="text-[#0052ff]">stonks</span></h1>
          <p className="mt-1 text-[13px] font-medium text-[#b3bdd4]">Gainers and movers across the BaseStonk launchpad.</p>
        </div>
        <div className="btn-ghost hidden px-3 py-1.5 text-[12px] sm:block">🔍 Search tokens…</div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {tokens.map((t) => <TokenCard key={t.address} t={t} />)}
      </div>
    </div>
  )
}

// ─── Degens view: leaderboard ──────────────────────────────────────────────

function DegensView({ rows }: { rows: LeaderRow[] }) {
  const medal = (i: number) => i === 0 ? 'text-[#f5c847]' : i === 1 ? 'text-[#b3bdd4]' : i === 2 ? 'text-[#d9904f]' : 'text-[#3a4a75]'
  return (
    <div className="fade-in mx-auto max-w-3xl">
      <div className="mb-5 px-1">
        <h1 className="font-display text-3xl font-black tracking-tight text-white">Top <span className="text-[#0052ff]">degens</span></h1>
        <p className="mt-1 text-[13px] font-medium text-[#b3bdd4]">Biggest movers on BaseStonk this hour, by volume.</p>
      </div>
      <div className="card overflow-hidden">
        {rows.map((r, i) => {
          const pct = r.volumeUsd > 0 ? (r.volumeUsd / Math.max(rows[0]?.volumeUsd || 1, r.volumeUsd)) * 100 : 0
          return (
            <div key={r.trader} className="flex items-center gap-3 border-b border-[#1f2740] px-4 py-3 last:border-0">
              <span className={`w-6 shrink-0 text-center font-display text-[14px] font-bold ${medal(i)}`}>{i + 1}</span>
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#0052ff] to-[#2d7cff] text-[10px] font-bold text-white">{initials(r.trader)}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[13px] font-medium text-white">{shortAddr(r.trader)}</div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#1f2740]">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#0052ff] to-[#2d7cff]" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-1 text-[10px] text-[#b3bdd4]">{r.buys} buys · {r.sells} sells</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-mono text-[14px] font-bold text-white">{fmtUsd(r.volumeUsd)}</div>
                <div className="text-[10px] text-[#f5c847]">score {fmtNum(r.score)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── P&L wall: flex posts ──────────────────────────────────────────────────

function PnlWall({ posts }: { posts: Post[] }) {
  const flex = useMemo(() => posts.filter((p) => p.kind === 'flex').slice(0, 24), [posts])
  if (flex.length === 0) return null
  return (
    <div className="fade-in">
      <div className="mb-5 px-1">
        <h1 className="font-display text-3xl font-black tracking-tight text-white">P&L <span className="text-[#0052ff]">wall</span></h1>
        <p className="mt-1 text-[13px] font-medium text-[#b3bdd4]">Degens flexing their bags. Bragging is a feature.</p>
      </div>
      <div className="space-y-4">
        {flex.map((p) => {
          const up = (p.pnlPct ?? 0) >= 0
          const actionColor = up ? 'text-[#45d68f]' : 'text-[#ea6055]'
          return (
            <article key={p.id} className="card overflow-hidden p-5">
              <div className="flex items-center gap-3">
                <CoinGlyph src={p.tokenImageUrl} symbol={p.tokenSymbol} size={52} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[14px] font-semibold text-white">{p.traderShort}</span>
                    {p.streak && p.streak > 2 && <span className="text-[11px] font-bold text-[#f5c847]">🔥 {p.streak}</span>}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[#b3bdd4]">
                    <span className="font-bold text-[#0052ff]">${p.tokenSymbol}</span>
                    <span> · {relativeTime(p.createdAt)}</span>
                  </div>
                </div>
                {p.spark && p.spark.length >= 2 && <div className="hidden shrink-0 sm:block"><Sparkline data={p.spark} up={up} w={150} h={38} /></div>}
                <div className="shrink-0 text-right">
                  <div className={`font-display text-2xl font-black ${actionColor}`}>{up ? '▲' : '▼'} {Math.abs(p.pnlPct ?? 0)}%</div>
                  <div className="text-[11px] text-[#b3bdd4]">P&L on {fmtUsd(p.volumeUsd)}</div>
                </div>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main App ──────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>('home')
  const [tokens, setTokens] = useState<Token[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [leader, setLeader] = useState<LeaderRow[]>([])
  const [userPosts, setUserPosts] = useState<UserPost[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  const identity = useIdentity()

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
      const [tokRes, feedRes, leadRes, postsRes] = await Promise.all([
        fetchTokens(60, 'trending'),
        fetchFeed(40),
        fetchLeaderboard(20),
        fetchPosts(50).catch(() => [] as UserPost[]),
      ])
      setTokens(tokRes.tokens)
      setFeed(feedRes)
      setLeader(leadRes.rows)
      setUserPosts(Array.isArray(postsRes) ? postsRes : [])
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
      try { setUserPosts(await fetchPosts(50)) } catch { /* keep old */ }
    }, 15000)
    return () => clearInterval(t)
  }, [])

  async function handleLike(id: number) {
    try {
      const updated = await likePost(id)
      setUserPosts((prev) => prev.map((p) => (p.id === id ? { ...p, likes: updated.likes } : p)))
    } catch { /* keep old */ }
  }

  if (loading) {
    return (
      <div className="relative grid min-h-screen place-items-center">
        <div className="bs-backdrop">
          <div className="bs-backdrop__stars bs-backdrop__stars--far" />
          <div className="bs-backdrop__stars bs-backdrop__stars--near" />
        </div>
        <div className="relative z-10 text-center">
          <img src="/bstonk.webp" alt="" className="mx-auto h-14 w-14 gem-glow" />
          <div className="mt-3 animate-pulse text-sm text-[#b3bdd4]">live on base…</div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen">
      <div className="bs-backdrop">
        <div className="bs-backdrop__stars bs-backdrop__stars--far" />
        <div className="bs-backdrop__stars bs-backdrop__stars--near" />
      </div>

      <header className="sticky top-0 z-40 bg-[#050a1e]/80 backdrop-blur-md">
        <div className="mx-auto flex h-[70px] max-w-7xl items-center justify-between gap-4 px-4">
          <div className="flex items-center gap-2.5">
            <img src="/bstonk.webp" alt="" className="h-9 w-9" />
            <span className="font-display text-[17px] font-black tracking-tight text-white">BASE<span className="text-[#0052ff]">STONK</span></span>
          </div>

          <nav className="pill-nav row hidden gap-1 p-1 md:flex">
            {NAV.map((item) => (
              <button key={item.key} onClick={() => setView(item.key)} data-active={view === item.key} className="pill-nav-item px-4 py-1.5">
                {item.label}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 rounded-full border border-[#1f2740] bg-[#0d142b] px-3 py-1.5 sm:flex">
              <span className="h-2 w-2 rounded-full bg-[#45d68f] pulse-dot" />
              <span className="text-xs font-medium text-[#b3bdd4]">Live</span>
            </div>
            <button className="btn-gem px-5 py-2 text-[13px] font-bold" onClick={() => { setView('home'); setTimeout(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80) }}>
              Post
            </button>
          </div>
        </div>
      </header>

      {/* mobile tab bar */}
      <div className="z-30 border-b border-[#1f2740] bg-[#050a1e]/80 md:hidden">
        <div className="mx-auto flex max-w-7xl gap-1 px-3 py-2">
          {NAV.map((item) => (
            <button
              key={item.key} onClick={() => setView(item.key)}
              className={`flex-1 rounded-full px-2 py-1.5 text-[12px] font-semibold transition-colors ${view === item.key ? 'bg-white text-[#09090b]' : 'text-[#b3bdd4]'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <main className="relative z-10 mx-auto max-w-7xl gap-6 px-4 py-6">
        {view === 'trending' && <TrendingView tokens={tokens} />}
        {view === 'degens' && <DegensView rows={leader} />}
        {view === 'plwall' && <PnlWall posts={posts} />}

        {view === 'home' && (
          <div className="flex gap-6">
            <section className="min-w-0 flex-1">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <h1 className="font-display text-4xl font-black tracking-tight text-white">The <span className="text-[#0052ff]">feed</span></h1>
                  <p className="mt-1 text-[14px] font-medium text-[#b3bdd4]">Degens call their shots, flex their bags, shill their coins.</p>
                </div>
                <div className="hidden gap-2 sm:flex">
                  <div className="card px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">24h vol</div><div className="font-display text-lg font-black stat-grad">{fmtUsd(stats.vol24)}</div></div>
                  <div className="card px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">Top</div><div className="font-display text-lg font-black stat-grad-cyan">${stats.topSymbol} {stats.topPct}%</div></div>
                </div>
              </div>

              <div ref={composerRef} className="space-y-3">
                <Composer identity={identity} tokens={tokens} onPosted={loadAll} />
              </div>

              <div className="mt-4 space-y-4">
                {err && (
                  <div className="rounded-xl border border-[#ea6055]/40 bg-[#ea6055]/10 p-3 text-sm text-[#ea6055]">
                    Some data is temporarily unavailable ({err}). Retrying automatically…
                  </div>
                )}
                {userPosts.length === 0 && (
                  <div className="card p-8 text-center">
                    <div className="text-2xl">🗣️</div>
                    <div className="mt-2 text-[14px] font-semibold text-white">No posts yet — be the first to speak.</div>
                    <div className="mt-1 text-[12px] text-[#b3bdd4]">Call a 100x, flex a bag, or shill a BaseStonk token above.</div>
                  </div>
                )}
                {userPosts.map((p) => (
                  <UserPostCard key={p.id} post={p} onLike={handleLike} />
                ))}
              </div>
            </section>

            <aside className="hidden w-72 shrink-0 flex-col gap-6 self-start xl:flex">
              <TrendingStonks tokens={tokens} />
              <TopDegens rows={leader} />
            </aside>
          </div>
        )}
      </main>

      <footer className="relative z-10 border-t border-[#1f2740] py-8 text-center">
        <div className="mx-auto max-w-xl px-4 text-[11px] text-[#b3bdd4]">
          An independent community layer for the BaseStonk launchpad on Base.
          Not affiliated with Coinbase or Base. Informational only.
        </div>
      </footer>
    </div>
  )
}