import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchTokens, fetchFeed, fetchLeaderboard, fetchPosts, createPost, likePost,
  fetchAccount, saveAccount,
  fmtUsd, fmtNum,
} from './lib/api'
import type { Token, FeedItem, LeaderRow, UserPost } from './lib/api'
import { derivePosts, avatarGradient, initials, relativeTime, shortAddr } from './lib/social'
import type { Post } from './lib/social'

type View = 'home' | 'trending' | 'degens' | 'portfolio'

const NAV: { key: View; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'trending', label: 'Trending' },
  { key: 'degens', label: 'Degens' },
  { key: 'portfolio', label: 'Portfolio' },
]

const AVATARS = ['💎', '🐸', '🦅', '🚀', '🔥', '🧠', '👑', '😈', '🫘', '📈']

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

function Avatar({ wallet, avatar, size = 40, className = '' }: { wallet: string; avatar?: string | null; size?: number; className?: string }) {
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-full text-white ${className}`}
      style={{ width: size, height: size, background: avatarGradient(wallet), fontSize: size * 0.46 }}
    >
      {avatar || initials(wallet)}
    </div>
  )
}

// ─── Copy-to-clipboard address ─────────────────────────────────────────────

function CopyAddr({ addr, short, className = '' }: { addr: string; short?: number; className?: string }) {
  const [copied, setCopied] = useState(false)
  const text = short ? shortAddr(addr, short) : shortAddr(addr)
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(addr)
          setCopied(true)
          setTimeout(() => setCopied(false), 1400)
        } catch { /* clipboard unavailable */ }
      }}
      title={`Copy ${addr}`}
      className={`inline-flex items-center gap-1.5 font-mono transition-colors group-hover/deg:text-white hover:text-white ${className}`}
    >
      {copied ? (
        <span className="rounded bg-[#45d68f]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#45d68f]">copied ✓</span>
      ) : (
        <>
          <span>{text}</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="opacity-50 group-hover/deg:opacity-100">
            <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" strokeWidth="2" />
          </svg>
        </>
      )}
    </button>
  )
}

// ─── Candlestick sparkline ─────────────────────────────────────────────────

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
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible spark-anim">
      <polygon points={`2,${h - 2} ${pts} ${w - 2},${h - 2}`} fill={fill} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.split(' ').at(-1)!.split(',')[0]} cy={pts.split(' ').at(-1)!.split(',')[1]} r="2.6" fill={stroke}>
        <animate attributeName="opacity" values="0;1;1;0" dur="2.5s" repeatCount="indefinite" />
      </circle>
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
      className={`shrink-0 rounded-full object-cover coin-hover ${ring ? 'ring-2 ring-white/10' : ''}`}
    />
  )
}

// ─── Caret-coordinate helper for the inline $ ticker dropdown ──────────────

function caretCoords(textarea: HTMLTextAreaElement): { x: number; y: number } {
  const pos = textarea.selectionStart ?? textarea.value.length
  const cs = getComputedStyle(textarea)
  const div = document.createElement('div')
  for (const p of ['boxSizing', 'width', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'tabSize'] as const) {
    div.style[p] = cs[p] as any
  }
  div.style.position = 'absolute'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordBreak = 'break-word'
  div.style.visibility = 'hidden'
  div.style.top = '0px'
  div.style.left = '-9999px'
  const a = document.createElement('span')
  const b = document.createElement('span')
  a.textContent = textarea.value.slice(0, pos)
  b.textContent = textarea.value.slice(pos) || '.'
  div.appendChild(a)
  div.appendChild(b)
  document.body.appendChild(div)
  const bb = b.getBoundingClientRect()
  const tb = textarea.getBoundingClientRect()
  document.body.removeChild(div)
  return { x: bb.left - tb.left, y: bb.top - tb.top }
}

// Find the active "$tick" being typed right before the caret.
function probeTicker(body: string, caret: number): { start: number; query: string } | null {
  const before = body.slice(0, caret)
  const m = before.match(/(^|\s)\$([a-zA-Z0-9]+)$/)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

// ─── Composer: actually post, with inline $ ticker autocomplete ────────────

function Composer({ identity, tokens, onPosted }: { identity: string; tokens: Token[]; onPosted: () => void }) {
  const [body, setBody] = useState('')
  const [tag, setTag] = useState<Token | null>(null)
  const [caret, setCaret] = useState(0)
  const [tickPos, setTickPos] = useState<{ x: number; y: number } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [handle, setHandle] = useState(() => localStorage.getItem('bstonk_handle') || '')
  const [avatar, setAvatar] = useState(() => localStorage.getItem('bstonk_avatar') || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const ticker = useMemo(() => probeTicker(body, caret), [body, caret])
  const matches = useMemo(() => {
    if (!ticker || !ticker.query) return []
    const q = ticker.query.toLowerCase()
    return tokens.filter((t) => t.symbol.toLowerCase().startsWith(q) || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)).slice(0, 6)
  }, [ticker, tokens])
  const showTick = !!ticker && ticker.query.length >= 1 && matches.length > 0

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setTickPos(null)
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function pickToken(t: Token) {
    if (!taRef.current || !ticker) return
    const next = body.slice(0, ticker.start) + `$${t.symbol}` + body.slice(caret)
    const nextCaret = ticker.start + t.symbol.length + 1
    setBody(next)
    setTag(t)
    setTickPos(null)
    requestAnimationFrame(() => {
      taRef.current!.focus()
      taRef.current!.setSelectionRange(nextCaret, nextCaret)
    })
  }

  async function submit() {
    const clean = body.trim()
    if (!clean || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await createPost({ author: identity, body: clean, tokenSymbol: tag?.symbol, tokenImage: tag?.imageUrl })
      setBody('')
      setTag(null)
      setTickPos(null)
      onPosted()
    } catch (e: any) {
      setError(e.message || 'Post failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function saveProfile() {
    setSavingProfile(true)
    try {
      const acc = await saveAccount({ wallet: identity, handle: handle.trim(), avatar })
      localStorage.setItem('bstonk_handle', acc.handle || '')
      localStorage.setItem('bstonk_avatar', acc.avatar || '')
      setHandle(acc.handle || '')
      setAvatar(acc.avatar || '')
      setShowProfile(false)
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <div className="card p-4 pop-in">
      <div className="flex items-start gap-3">
        <button onClick={() => setShowProfile((v) => !v)} title="Edit profile" className="group relative">
          <Avatar wallet={identity} avatar={avatar} size={44} className="ring-2 ring-[#0052ff]/40 transition-transform group-hover:scale-105" />
          {handle && <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-[#0052ff] text-[9px] text-white">✓</span>}
        </button>
        <div className="min-w-0 flex-1">
          {showProfile && (
            <div className="pop-in mb-3 rounded-xl border border-[#0052ff]/40 bg-[#0c1531] p-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Your @handle</div>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/[^\w0-9_]/g, '').slice(0, 24))}
                placeholder="degensapiens"
                className="mt-1.5 w-full rounded-lg border border-[#1f2740] bg-[#050a1e]/60 px-3 py-1.5 text-[13px] text-white placeholder-[#3a4a75] outline-none focus:border-[#0052ff]"
              />
              <div className="mt-2.5 text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Avatar</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {AVATARS.map((a) => (
                  <button
                    key={a}
                    onClick={() => setAvatar(a)}
                    className={`grid h-8 w-8 place-items-center rounded-full text-[16px] transition-all ${avatar === a ? 'bg-[#0052ff] ring-2 ring-white/40' : 'bg-[#0d142b] hover:bg-[#1f2740]'}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <div className="mt-2.5 flex gap-2">
                <button onClick={saveProfile} disabled={savingProfile} className="btn-gem px-4 py-1.5 text-[12px] font-bold disabled:opacity-50">
                  {savingProfile ? 'Saving…' : 'Save profile'}
                </button>
                <button onClick={() => { setAvatar(''); setHandle(''); handle.trim() && saveProfile() }} className="btn-ghost px-3 py-1.5 text-[12px]">Clear</button>
              </div>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate font-mono text-[11px] text-[#b3bdd4]">{handle ? `@${handle}` : shortAddr(identity)}</span>
            <span className="shrink-0 text-[12px] font-bold text-[#45d68f]">on Base · live</span>
          </div>

          <div ref={wrapRef} className="relative mt-2">
            <textarea
              ref={taRef}
              value={body}
              onChange={(e) => { setBody(e.target.value.slice(0, 280)); setCaret(e.target.selectionStart ?? 0) }}
              onSelect={() => setCaret(taRef.current!.selectionStart ?? 0)}
              onKeyUp={() => setCaret(taRef.current!.selectionStart ?? 0)}
              onClick={() => setTickPos(taRef.current ? caretCoords(taRef.current) : null)}
              onFocus={() => setTickPos(taRef.current ? caretCoords(taRef.current) : null)}
              rows={3}
              placeholder={'Type your call… try $ instead of a symbol to tag a token'}
              className="w-full resize-none rounded-xl border border-[#1f2740] bg-[#050a1e]/60 p-3 text-[14px] text-white placeholder-[#3a4a75] outline-none transition-colors focus:border-[#0052ff]"
            />
            {showTick && tickPos && (
              <div
                className="drop-panel absolute z-50 w-64 overflow-hidden rounded-xl border border-[#1f2740] bg-[#0c1531] shadow-2xl"
                style={{ left: Math.min(tickPos.x, 240), top: tickPos.y + 10 }}
              >
                <div className="border-b border-[#1f2740] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#3a4a75]">Tag a token</div>
                {matches.map((t) => (
                  <button
                    key={t.address}
                    onMouseDown={(e) => { e.preventDefault(); pickToken(t) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[#1f2740]"
                  >
                    <CoinGlyph src={t.imageUrl || t.logoUrl} symbol={t.symbol} size={24} ring={false} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-bold text-[#0052ff]">${t.symbol}</span>
                      <span className="block truncate text-[10px] text-[#b3bdd4]">{t.name}</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-semibold text-[#b3bdd4]">{fmtUsd(t.marketcapUsd)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {tag && (
                <button onClick={() => setTag(null)} className="flex items-center gap-1.5 rounded-full bg-[#0d142b] px-2 py-1 text-[11px] text-[#b3bdd4] hover:text-white">
                  <CoinGlyph src={tag.imageUrl || tag.logoUrl} symbol={tag.symbol} size={16} ring={false} />
                  <span className="font-bold text-[#0052ff]">${tag.symbol}</span>
                  ✕
                </button>
              )}
              <span className="text-[10px] text-[#3a4a75]">$ = tag token</span>
            </div>
            <span className={`shrink-0 text-[11px] font-semibold ${body.length >= 240 ? 'text-[#ea6055]' : 'text-[#3a4a75]'}`}>{body.length}/280</span>
          </div>
          {error && <div className="mt-2 rounded-lg border border-[#ea6055]/40 bg-[#ea6055]/10 p-2 text-[12px] text-[#ea6055]">{error}</div>}
          <div className="mt-3 flex justify-end">
            <button
              onClick={submit}
              disabled={!body.trim() || submitting}
              className="btn-gem shimmer-btn px-6 py-2 text-[13px] font-bold disabled:opacity-40"
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

function UserPostCard({ post, onLike, delay = 0 }: { post: UserPost; onLike: (id: number) => void; delay?: number }) {
  const [liked, setLiked] = useState(false)
  return (
    <article className="card p-4 fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3">
        <Avatar wallet={post.author} avatar={post.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {post.handle ? (
              <span className="truncate text-[13px] font-bold text-white">@{post.handle}</span>
            ) : (
              <span className="group"><CopyAddr addr={post.author} short={6} className="text-[13px] font-semibold text-white/90" /></span>
            )}
          </div>
          <div className="text-[11px] text-[#b3bdd4]">{relativeTime(post.created_at)} · {shortAddr(post.author, 8)}</div>
        </div>
        {post.token_symbol && (
          <div className="flex items-center gap-1.5 rounded-full border border-[#0052ff]/40 bg-[#0d142b] px-2.5 py-1 pop-in">
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

// ─── On-chain trade card (used in Portfolio trades stream) ─────────────────

function TradeCard({ post, delay = 0 }: { post: Post; delay?: number }) {
  const buy = post.side === 'buy'
  const up = (post.change24hPct ?? 0) >= 0
  const actionColor = buy ? 'text-[#45d68f]' : 'text-[#ea6055]'
  return (
    <article className="card overflow-hidden p-4 fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3">
        <CoinGlyph src={post.tokenImageUrl} symbol={post.tokenSymbol} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CopyAddr addr={post.trader} short={6} className="text-[12px] font-medium text-white" />
            {post.streak && post.streak > 2 && <span className="shrink-0 text-[10px] font-bold text-[#f5c847]">🔥 {post.streak}</span>}
          </div>
          <div className="text-[11px] text-[#b3bdd4]">
            <span className={actionColor}>{buy ? 'bought' : 'sold'} {fmtUsd(post.volumeUsd)}</span>
            <span> of </span>
            <span className="font-bold text-[#0052ff]">${post.tokenSymbol}</span>
            <span> · {relativeTime(post.createdAt)}</span>
          </div>
        </div>
        {post.spark && post.spark.length >= 2 && <div className="hidden shrink-0 sm:block"><Sparkline data={post.spark} up={up} w={110} h={30} /></div>}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-[#b3bdd4]">
        <a href={`https://basescan.org/address/${post.trader}`} target="_blank" rel="noreferrer" className="font-mono transition-colors hover:text-white">basescan</a>
        <a href={`https://basescan.org/tx/${post.txn}`} target="_blank" rel="noreferrer" className="font-mono transition-colors hover:text-white">tx {post.txn.slice(0, 8)}…</a>
      </div>
    </article>
  )
}

// ─── P&L card builder ──────────────────────────────────────────────────────

function PnlBuilder({ identity, tokens, onPosted }: { identity: string; tokens: Token[]; onPosted: () => void }) {
  const [tag, setTag] = useState<Token | null>(null)
  const [entry, setEntry] = useState('')
  const [exit, setExit] = useState('')
  const [size, setSize] = useState('')
  const [posting, setPosting] = useState(false)

  const entryN = parseFloat(entry)
  const exitN = parseFloat(exit)
  const sizeN = parseFloat(size)
  const valid = !!tag && entryN > 0 && exitN > 0 && sizeN > 0
  const pnlPct = valid ? ((exitN - entryN) / entryN) * 100 : 0
  const pnlUsd = valid ? (exitN - entryN) * (sizeN / entryN) : 0
  const up = pnlPct >= 0

  async function postCard() {
    if (!valid || posting) return
    setPosting(true)
    try {
      const dir = up ? 'flipped' : 'got rekt on'
      const line = `I ${dir} $${tag!.symbol} ${up ? '+' : ''}${pnlPct.toFixed(1)}% ${up ? '📈' : '📉'} on Base`
      await createPost({ author: identity, body: line, tokenSymbol: tag!.symbol, tokenImage: tag!.imageUrl })
      setEntry(''); setExit(''); setSize(''); setTag(null)
      onPosted()
    } catch (e: any) {
      console.error(e)
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-[#1f2740] px-5 py-4">
        <h2 className="font-display text-lg font-black text-white">Build your P&L card</h2>
        <p className="mt-0.5 text-[12px] text-[#b3bdd4]">Pick a token, plug in your fills, and flex or cope. Post it to the wall.</p>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2">
        {/* inputs */}
        <div className="space-y-3">
          {!tag && (
            <select
              value=""
              onChange={(e) => setTag(tokens.find((t) => t.address === e.target.value) || null)}
              className="w-full appearance-none rounded-xl border border-[#1f2740] bg-[#0d142b] px-3 py-2.5 text-[13px] font-semibold text-white outline-none focus:border-[#0052ff]"
            >
              <option value="">Select token…</option>
              {tokens.map((t) => (
                <option key={t.address} value={t.address}>${t.symbol} · {t.name}</option>
              ))}
            </select>
          )}
          {tag && (
            <div className="flex items-center justify-between rounded-xl border border-[#0052ff]/40 bg-[#0d142b] px-3 py-2.5">
              <span className="flex items-center gap-2">
                <CoinGlyph src={tag.imageUrl || tag.logoUrl} symbol={tag.symbol} size={24} ring={false} />
                <span className="font-bold text-[#0052ff]">${tag.symbol}</span>
              </span>
              <button onClick={() => setTag(null)} className="text-[12px] text-[#b3bdd4] hover:text-white">✕ change</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Entry</span>
              <input value={entry} onChange={(e) => setEntry(e.target.value)} placeholder="0.000023" inputMode="decimal" className="mt-1 w-full rounded-xl border border-[#1f2740] bg-[#050a1e]/60 px-3 py-2.5 text-[13px] text-white placeholder-[#3a4a75] outline-none focus:border-[#0052ff]" />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Exit</span>
              <input value={exit} onChange={(e) => setExit(e.target.value)} placeholder="0.000034" inputMode="decimal" className="mt-1 w-full rounded-xl border border-[#1f2740] bg-[#050a1e]/60 px-3 py-2.5 text-[13px] text-white placeholder-[#3a4a75] outline-none focus:border-[#0052ff]" />
            </label>
          </div>
          <label className="block">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Position size (USDC)</span>
            <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="500" inputMode="decimal" className="mt-1 w-full rounded-xl border border-[#1f2740] bg-[#050a1e]/60 px-3 py-2.5 text-[13px] text-white placeholder-[#3a4a75] outline-none focus:border-[#0052ff]" />
          </label>
          <button onClick={postCard} disabled={!valid || posting} className="btn-gem shimmer-btn w-full px-4 py-2.5 text-[13px] font-bold disabled:opacity-40">
            {posting ? 'Posting…' : 'Post P&L card 🚀'}
          </button>
        </div>

        {/* live preview */}
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Preview</div>
          <div className={`mt-1.5 relative overflow-hidden rounded-2xl border p-5 ${up ? 'border-[#45d68f]/50' : 'border-[#ea6055]/50'} ${up ? 'bg-gradient-to-br from-[#0c2a1f] to-[#0c1531]' : 'bg-gradient-to-br from-[#2a1010] to-[#0c1531]'}`}>
            <div className="absolute right-3 top-3"><img src="/bstonk.webp" alt="" className="h-7 w-7 opacity-70" /></div>
            {tag ? (
              <CoinGlyph src={tag.imageUrl || tag.logoUrl} symbol={tag.symbol} size={48} />
            ) : (
              <div className="grid h-12 w-12 place-items-center rounded-full bg-[#0d142b] text-[10px] text-[#3a4a75]">?</div>
            )}
            <div className="mt-3 text-[12px] text-[#b3bdd4]">{tag ? tag.name : 'token'}</div>
            <div className={`font-display text-4xl font-black ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '▲' : '▼'} {valid ? Math.abs(pnlPct).toFixed(1) : '0.0'}%</div>
            <div className={`mt-1 font-display text-xl font-bold ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '+' : ''}{valid ? pnlUsd.toFixed(2) : '0.00'} USDC</div>
            <div className="mt-4 flex items-center justify-between text-[10px] text-[#b3bdd4]">
              <span className="font-mono">{shortAddr(identity)}</span>
              <span>BASESTONK · DEGEN TERMINAL</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Portfolio view: your trades + P&L cards ───────────────────────────────

function PortfolioView({ identity, tokens, posts, onPosted }: { identity: string; tokens: Token[]; posts: Post[]; onPosted: () => void }) {
  const stream = useMemo(() => {
    const mine = posts.filter((p) => p.trader === identity)
    return (mine.length ? mine : posts).slice(0, 30)
  }, [posts, identity])
  return (
    <div className="fade-in flex gap-6">
      <section className="min-w-0 flex-1 space-y-6">
        <PnlBuilder identity={identity} tokens={tokens} onPosted={onPosted} />
        <div>
          <h2 className="mb-2 px-1 font-display text-lg font-black text-white">Recent trades</h2>
          <div className="space-y-3">
            {stream.map((p, i) => <TradeCard key={p.id} post={p} delay={i * 30} />)}
          </div>
        </div>
      </section>
      <aside className="hidden w-72 shrink-0 flex-col gap-6 self-start xl:flex">
        <TrendingStonks tokens={tokens} />
        <TopDegens rows={[]} />
      </aside>
    </div>
  )
}

// ─── Trending rail card ────────────────────────────────────────────────────

function TrendingStonks({ tokens }: { tokens: Token[] }) {
  const hot = [...tokens].sort((a, b) => b.change24hPct - a.change24hPct).slice(0, 6)
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Trending stonks</h3>
      <div className="space-y-2">
        {hot.map((t, i) => {
          const up = t.change24hPct >= 0
          return (
            <button key={t.address} className="card flex w-full items-center gap-3 px-3 py-2 text-left fade-up" style={{ animationDelay: `${i * 50}ms` }}>
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
        {rows.map((r, i) => {
          const pct = r.volumeUsd > 0 ? (r.volumeUsd / Math.max(rows[0]?.volumeUsd || 1, r.volumeUsd)) * 100 : 0
          const medal = i === 0 ? 'text-[#f5c847]' : i === 1 ? 'text-[#b3bdd4]' : i === 2 ? 'text-[#d9904f]' : 'text-[#3a4a75]'
          return (
            <div key={r.trader} className="group/deg flex items-center gap-2.5 border-b border-[#1f2740] px-3 py-2.5 last:border-0 transition-colors hover:bg-[#0d142b]/60 fade-up" style={{ animationDelay: `${i * 40}ms` }}>
              <span className={`w-4 shrink-0 text-center font-display text-[12px] font-bold ${medal}`}>{i + 1}</span>
              <Avatar wallet={r.trader} size={28} />
              <div className="min-w-0 flex-1">
                <CopyAddr addr={r.trader} short={6} className="text-[12px] font-medium text-white" />
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#1f2740]">
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
    <button className="card card-hover group w-full p-4 text-left fade-up">
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

// ─── Trending view ─────────────────────────────────────────────────────────

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
        {tokens.map((t, i) => <div key={t.address} style={{ animationDelay: `${i * 40}ms` }}><TokenCard t={t} /></div>)}
      </div>
    </div>
  )
}

// ─── Degens view ───────────────────────────────────────────────────────────

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
            <div key={r.trader} className="group/deg flex items-center gap-3 border-b border-[#1f2740] px-4 py-3 last:border-0 transition-colors hover:bg-[#0d142b]/50 fade-up" style={{ animationDelay: `${i * 35}ms` }}>
              <span className={`w-6 shrink-0 text-center font-display text-[14px] font-bold ${medal(i)}`}>{i + 1}</span>
              <Avatar wallet={r.trader} size={36} />
              <div className="min-w-0 flex-1">
                <CopyAddr addr={r.trader} short={8} className="text-[13px] font-medium text-white" />
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

  const loadAll = useCallback(async () => {
    const [tokRes, feedRes, leadRes, postsRes] = await Promise.all([
      fetchTokens(60, 'trending').catch(() => null),
      fetchFeed(40).catch(() => null),
      fetchLeaderboard(20).catch(() => null),
      fetchPosts(50).catch(() => null),
    ])
    if (tokRes) setTokens(tokRes.tokens)
    if (feedRes) setFeed(feedRes)
    if (leadRes) setLeader(leadRes.rows)
    if (Array.isArray(postsRes)) setUserPosts(postsRes)
    setErr(null)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    const t = setInterval(async () => {
      const p = await Promise.all([fetchFeed(40).catch(() => null), fetchPosts(50).catch(() => null)])
      if (p[0]) setFeed(p[0])
      if (Array.isArray(p[1])) setUserPosts(p[1])
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
        <div className="relative z-10 text-center pop-in">
          <img src="/bstonk.webp" alt="" className="mx-auto h-14 w-14 gem-glow loading-spin" />
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
            <img src="/bstonk.webp" alt="" className="h-9 w-9 gem-glow hover:rotate-12" style={{ transition: 'transform .3s ease' }} />
            <span className="font-display text-[17px] font-black tracking-tight text-white">BASE<span className="text-[#0052ff]">STONK</span></span>
          </div>

          <nav className="pill-nav row hidden gap-1 p-1 md:flex">
            {NAV.map((item) => (
              <button key={item.key} onClick={() => setView(item.key)} data-active={view === item.key} className="pill-nav-item px-4 py-1.5">
                {item.label}
              </button>
            ))}
          </nav>

          <button className="btn-gem shimmer-btn px-5 py-2 text-[13px] font-bold" onClick={() => { setView('home'); setTimeout(() => composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80) }}>
            Post
          </button>
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
        {view === 'portfolio' && <PortfolioView identity={identity} tokens={tokens} posts={posts} onPosted={loadAll} />}

        {view === 'home' && (
          <div className="flex gap-6">
            <section className="min-w-0 flex-1">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <h1 className="font-display text-4xl font-black tracking-tight text-white">The <span className="text-[#0052ff]">feed</span></h1>
                  <p className="mt-1 text-[14px] font-medium text-[#b3bdd4]">Degens call their shots, flex their bags, shill their coins.</p>
                </div>
                <div className="hidden gap-2 sm:flex">
                  <div className="card px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">24h vol</div><div className="font-display text-lg font-black stat-grad number-anim">{fmtUsd(stats.vol24)}</div></div>
                  <div className="card px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">Top</div><div className="font-display text-lg font-black stat-grad-cyan number-anim">${stats.topSymbol} {stats.topPct}%</div></div>
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
                  <div className="card p-8 text-center pop-in">
                    <div className="text-2xl">🗣️</div>
                    <div className="mt-2 text-[14px] font-semibold text-white">No posts yet — be the first to speak.</div>
                    <div className="mt-1 text-[12px] text-[#b3bdd4]">Call a 100x, flex a bag, or shill a BaseStonk token.</div>
                  </div>
                )}
                {userPosts.map((p, i) => (
                  <UserPostCard key={p.id} post={p} onLike={handleLike} delay={i * 35} />
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