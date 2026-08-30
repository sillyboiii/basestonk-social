import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchTokens, fetchFeed, fetchLeaderboard, fetchPosts, createPost, likePost,
  fetchAccount, saveAccount, fetchPositions,
  fetchFollows, addFollow, removeFollow,
  fmtUsd, fmtNum,
} from './lib/api'
import type { Token, FeedItem, LeaderRow, UserPost, Position, Account } from './lib/api'
import { derivePosts, avatarGradient, initials, relativeTime, shortAddr } from './lib/social'
import type { Post } from './lib/social'

type View = 'home' | 'trending' | 'degens' | 'portfolio' | 'profile'

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

function isImgAvatar(a?: string | null): boolean {
  return !!a && (a.startsWith('data:image') || a.startsWith('http'))
}

// ─── Interactive photo cropper (pan + zoom, bakes a 96px avatar) ───────────

function CropPicker({ file, onDone, onCancel }: { file: File; onDone: (dataUrl: string) => void; onCancel: () => void }) {
  const [img, setImg] = useState<{ url: string; el: HTMLImageElement; w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1.3)
  const [off, setOff] = useState({ x: 0, y: 0 })
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const box = 224

  useEffect(() => {
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => {
      setImg({ url, el, w: el.naturalWidth, h: el.naturalHeight })
      setOff({ x: 0, y: 0 })
      setZoom(1.3)
    }
    el.src = url
    return () => URL.revokeObjectURL(url)
  }, [file])

  if (!img) return <div className="py-6 text-center text-[12px] text-[#3a4a75]">Loading photo…</div>
  const imgEl = img

  const fit = Math.max(box / img.w, box / img.h)
  const scale = fit * zoom
  const dw = img.w * scale
  const dh = img.h * scale
  const maxX = Math.max(0, (dw - box) / 2)
  const maxY = Math.max(0, (dh - box) / 2)
  const ox = Math.min(maxX, Math.max(-maxX, off.x))
  const oy = Math.min(maxY, Math.max(-maxY, off.y))

  function bake() {
    const c = document.createElement('canvas')
    c.width = 96
    c.height = 96
    const ctx = c.getContext('2d')
    if (!ctx) return
    const sx = (box / 2 - dw / 2 + ox) / scale * -1
    const sy = (box / 2 - dh / 2 + oy) / scale * -1
    const ssize = box / scale
    ctx.drawImage(imgEl.el, Math.max(0, sx), Math.max(0, sy), Math.min(ssize, imgEl.w - Math.max(0, sx)), Math.min(ssize, imgEl.h - Math.max(0, sy)), 0, 0, 96, 96)
    onDone(c.toDataURL('image/jpeg', 0.85))
  }

  return (
    <div className="rounded-xl border border-[#0052ff]/40 bg-[#050a1e] p-3">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Crop your photo</div>
      <div
        className="relative mt-2 touch-none select-none overflow-hidden rounded-2xl border border-[#1f2740]"
        style={{ width: box, height: box, cursor: 'grab' }}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, ox: off.x, oy: off.y } }}
        onPointerMove={(e) => {
          if (!drag.current) return
          setOff({ x: drag.current.ox + e.clientX - drag.current.x, y: drag.current.oy + e.clientY - drag.current.y })
        }}
        onPointerUp={() => { drag.current = null }}
        onPointerLeave={() => { drag.current = null }}
      >
        <img
          src={img.url}
          alt="" draggable={false}
          className="absolute max-w-none"
          style={{ width: dw, height: dh, left: box / 2 - dw / 2 + ox, top: box / 2 - dh / 2 + oy }}
        />
        <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-white/20" />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase text-[#b3bdd4]">Zoom</span>
        <input type="range" min={1} max={4} step={0.05} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} className="flex-1 accent-[#0052ff]" />
        <span className="font-mono text-[10px] text-[#b3bdd4]">{zoom.toFixed(1)}×</span>
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={bake} className="btn-gem px-4 py-1.5 text-[12px] font-bold">Use this photo</button>
        <button onClick={onCancel} className="btn-ghost px-3 py-1.5 text-[12px]">Cancel</button>
      </div>
    </div>
  )
}

function Avatar({ wallet, avatar, size = 40, className = '' }: { wallet: string; avatar?: string | null; size?: number; className?: string }) {
  if (isImgAvatar(avatar)) {
    return (
      <div
        className={`grid shrink-0 place-items-center overflow-hidden rounded-full ${className}`}
        style={{ width: size, height: size, background: avatarGradient(wallet) }}
      >
        <img src={avatar!} alt="" className="h-full w-full rounded-full object-cover" />
      </div>
    )
  }
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

function CopyAddr({ addr, short, iconOnly, className = '' }: { addr: string; short?: number; iconOnly?: boolean; className?: string }) {
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
          {!iconOnly && <span>{text}</span>}
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
  for (const p of ['boxSizing', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'fontFamily', 'fontSize', 'fontWeight', 'wordSpacing', 'tabSize'] as const) {
    div.style[p] = cs[p]
  }
  const tr = textarea.getBoundingClientRect()
  div.style.position = 'absolute'
  div.style.whiteSpace = 'pre-wrap'
  div.style.wordBreak = 'break-word'
  div.style.visibility = 'hidden'
  div.style.pointerEvents = 'none'
  div.style.textAlign = 'left'
  div.style.left = `${tr.left}px`
  div.style.top = `${tr.top}px`
  div.style.width = `${textarea.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)}px`
  const caret = document.createElement('span')
  caret.textContent = textarea.value.slice(0, pos)
  const marker = document.createElement('span')
  marker.textContent = textarea.value.slice(pos) || ' '
  div.appendChild(caret)
  div.appendChild(marker)
  document.body.appendChild(div)
  const mr = marker.getBoundingClientRect()
  document.body.removeChild(div)
  return {
    x: Math.max(0, mr.left - tr.left - parseFloat(cs.paddingLeft)),
    y: Math.max(0, mr.top - tr.top - parseFloat(cs.paddingTop) - (cs.boxSizing === 'border-box' ? parseFloat(cs.borderTopWidth) : 0)),
  }
}

// Find the active "$tick" being typed right before the caret.
function probeTicker(body: string, caret: number): { start: number; query: string } | null {
  const before = body.slice(0, caret)
  const m = before.match(/(^|\s)\$([a-zA-Z0-9]*)$/)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

// ─── Composer: actually post, with inline $ ticker autocomplete ────────────

function Composer({ identity, allStonks, tokens, onPosted, onOpenProfile }: { identity: string; allStonks: Token[]; tokens: Token[]; onPosted: () => void; onOpenProfile: (wallet: string) => void }) {
  const [body, setBody] = useState('')
  const [tag, setTag] = useState<Token | null>(null)
  const [caret, setCaret] = useState(0)
  const [tickPos, setTickPos] = useState<{ x: number; y: number; line?: number; flip?: boolean } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProfile, setShowProfile] = useState(false)
  const [handle, setHandle] = useState(() => localStorage.getItem('bstonk_handle') || '')
  const [avatar, setAvatar] = useState(() => localStorage.getItem('bstonk_avatar') || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const escRef = useRef(false)
  const [cropFile, setCropFile] = useState<File | null>(null)

  const ticker = useMemo(() => probeTicker(body, caret), [body, caret])
  const matches = useMemo(() => {
    if (!ticker) return []
    const q = ticker.query.toLowerCase()
    const pool = allStonks.length ? allStonks : tokens
    const list = q
      ? pool.filter((t) => t.symbol.toLowerCase().startsWith(q) || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
      : pool
    const out = list.slice(0, 6)
    if (picked !== null && body === picked) return []
    return out
  }, [ticker, allStonks, tokens, picked, body])
  const showTick = !!ticker && tickPos !== null && matches.length > 0

  function refreshCaret() {
    const r = taRef.current
    if (!r) return
    const c = caretCoords(r)
    const taRect = r.getBoundingClientRect()
    const line = parseFloat(getComputedStyle(r).lineHeight) || 22
    const spaceBelow = window.innerHeight - taRect.bottom
    setCaret(r.selectionStart ?? r.value.length)
    setTickPos({ ...c, line, flip: c.y + line + 320 > spaceBelow })
  }

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
    setPicked(next)
    setTag(t)
    setTickPos(null)
    requestAnimationFrame(() => {
      taRef.current!.focus()
      taRef.current!.setSelectionRange(nextCaret, nextCaret)
      setCaret(nextCaret)
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
      setPicked(null)
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

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !/^image\//.test(f.type)) return
    setCropFile(f)
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
              <div className="mt-2.5 flex items-end justify-between gap-3 text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Avatar<span className="text-[#3a4a75]">96px · auto-cropped</span></div>
              <div className="mt-1.5 flex items-center gap-3">
                <Avatar wallet={identity} avatar={avatar} size={52} className="ring-2 ring-[#0052ff]/40" />
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => fileRef.current?.click()} className="btn-ghost px-3 py-1.5 text-[12px] font-semibold">📷 {isImgAvatar(avatar) ? 'Change photo' : 'Upload photo'}</button>
                  <button onClick={() => { setAvatar(''); setCropFile(null); setHandle(''); saveProfile() }} className="px-3 py-1 text-[11px] text-[#3a4a75] transition-colors hover:text-[#ea6055]">remove photo</button>
                </div>
              </div>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickFile} />
              {cropFile && (
                <div className="mt-3 grid place-items-center">
                  <CropPicker file={cropFile} onDone={(d) => { setAvatar(d); setCropFile(null) }} onCancel={() => setCropFile(null)} />
                </div>
              )}
              <div className="mt-3 text-[10px] font-bold uppercase tracking-wider text-[#3a4a75]">or pick an emoji</div>
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
              </div>
            </div>
          )}

          <div className="flex items-baseline justify-between gap-2">
            <button onClick={() => { setShowProfile(false); onOpenProfile(identity) }} title="View your profile" className="truncate font-mono text-[11px] text-[#b3bdd4] transition-colors hover:text-white">{handle ? `@${handle}` : shortAddr(identity)}</button>
            <span className="shrink-0 text-[12px] font-bold text-[#45d68f]">on Base · live</span>
          </div>

          <div ref={wrapRef} className="relative mt-2">
            <textarea
              ref={taRef}
              value={body}
              onChange={(e) => {
                setBody(e.target.value.slice(0, 280))
                refreshCaret()
              }}
              onSelect={refreshCaret}
              onKeyUp={() => { if (escRef.current) { escRef.current = false; return } refreshCaret() }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { escRef.current = true; setTickPos(null); return }
                if (e.key === 'Enter' && showTick && matches.length > 0) {
                  e.preventDefault()
                  pickToken(matches[0])
                }
              }}
              onClick={refreshCaret}
              onFocus={refreshCaret}
              rows={3}
              placeholder={'Type your call… just type $ then the ticker to tag it'}
              className="w-full resize-none rounded-xl border border-[#1f2740] bg-[#050a1e]/60 p-3 text-[14px] text-white placeholder-[#3a4a75] outline-none transition-colors focus:border-[#0052ff]"
            />
            {showTick && tickPos && (
              <div
                className="drop-panel absolute z-50 w-64 overflow-hidden rounded-xl border border-[#1f2740] bg-[#0c1531] shadow-2xl"
                style={{
                  left: Math.min(tickPos.x, Math.max(8, window.innerWidth - 272)),
                  top: tickPos.flip ? Math.max(0, tickPos.y - 330) : tickPos.y + (tickPos.line || 22),
                }}
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

function UserPostCard({ post, onLike, onOpen, delay = 0 }: { post: UserPost; onLike: (id: number) => void; onOpen?: (wallet: string) => void; delay?: number }) {
  const [liked, setLiked] = useState(false)
  return (
    <article className="card p-4 fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3">
        <button onClick={() => onOpen?.(post.author)} title={`Open ${post.author}`} className="shrink-0 transition-transform hover:scale-105">
          <Avatar wallet={post.author} avatar={post.avatar} size={40} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {post.handle ? (
              <button onClick={() => onOpen?.(post.author)} className="truncate text-[13px] font-bold text-white transition-colors hover:text-[#0052ff]">@{post.handle}</button>
            ) : (
              <span className="group"><CopyAddr addr={post.author} short={6} className="text-[13px] font-semibold text-white/90" /></span>
            )}
          </div>
          <button onClick={() => onOpen?.(post.author)} className="text-[11px] text-[#b3bdd4] transition-colors hover:text-white">{relativeTime(post.created_at)} · {shortAddr(post.author, 8)}</button>
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
          {liked ? '♥' : '♡'} {Math.max(0, post.likes ?? 0) + (liked ? 1 : 0)}
        </button>
      </div>
    </article>
  )
}

// ─── On-chain trade card (used in Portfolio trades stream) ─────────────────

function TradeCard({ post, onOpen, delay = 0 }: { post: Post; onOpen?: (wallet: string) => void; delay?: number }) {
  const buy = post.side === 'buy'
  const up = (post.change24hPct ?? 0) >= 0
  const actionColor = buy ? 'text-[#45d68f]' : 'text-[#ea6055]'
  return (
    <article className="card overflow-hidden p-4 fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-3">
        <button onClick={() => onOpen?.(post.trader)} title={`Open ${post.trader}`} className="shrink-0 transition-transform hover:scale-105">
          <CoinGlyph src={post.tokenImageUrl} symbol={post.tokenSymbol} size={40} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <button onClick={() => onOpen?.(post.trader)} className="truncate text-[12px] font-medium text-white transition-colors hover:text-[#0052ff]">{shortAddr(post.trader, 8)}</button>
              <CopyAddr addr={post.trader} iconOnly className="text-[#3a4a75]" />
            </div>
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

// ─── Portfolio view: your bag → P&L cards (zero fill-typing) ───────────────

function PortfolioView({ identity, tokens, leader, posts, onPosted, onOpen }: { identity: string; tokens: Token[]; leader: LeaderRow[]; posts: Post[]; onPosted: () => void; onOpen: (wallet: string) => void }) {
  const [wallet, setWallet] = useState(identity)
  const [bag, setBag] = useState<{ positions: Position[]; trades: FeedItem[]; scanned: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<Position | null>(null)
  const [posted, setPosted] = useState<string | null>(null)

  const load = useCallback(async (w: string) => {
    const clean = String(w || '').trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) return
    setLoading(true)
    let r = await fetchPositions(clean).catch(() => ({ positions: [], trades: [], scanned: 0 }))
    if (r.scanned === 0) {
      await new Promise((res) => setTimeout(res, 1200))
      r = await fetchPositions(clean).catch(() => r)
    }
    setBag(r)
    setSel((cur) => (r.positions.length ? r.positions.find((p) => cur?.symbol === p.symbol) || r.positions[0] : null))
    setLoading(false)
  }, [])

  useEffect(() => { load(identity) }, [identity, load])

  async function postCard(p: Position) {
    const up = p.pnlPct >= 0
    const closed = p.open ? '' : ' · bag closed'
    const line = `I ${up ? 'flipped' : 'got rekt on'} $${p.symbol} ${up ? '+' : ''}${Math.abs(p.pnlPct).toFixed(1)}%${closed} ${up ? '📈' : '📉'} on Base`
    await createPost({ author: identity, body: line, tokenSymbol: p.symbol, tokenImage: p.imageUrl || undefined }).catch(() => null)
    setPosted(p.symbol)
    setTimeout(() => setPosted((v) => (v === p.symbol ? null : v)), 2500)
    onPosted()
  }

  const stream: (Post | FeedItem)[] = bag && bag.trades.length ? bag.trades : posts.slice(0, 30)
  const displayWallet = wallet || identity

  return (
    <div className="fade-in flex gap-6">
      <section className="min-w-0 flex-1 space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div>
            <h1 className="font-display text-3xl font-black tracking-tight text-white">Your <span className="text-[#0052ff]">bag</span></h1>
            <p className="mt-1 text-[13px] font-medium text-[#b3bdd4]">Trades pulled straight from the wallet — no typing fills. Pick a position, get the card.</p>
          </div>
        </div>

        <div className="card p-4">
          <label className="text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Wallet address</label>
          <div className="mt-1.5 flex gap-2">
            <input
              value={wallet}
              onChange={(e) => setWallet(e.target.value.trim())}
              onKeyDown={(e) => { if (e.key === 'Enter') load(wallet) }}
              placeholder="0x…"
              spellCheck={false}
              className="min-w-0 flex-1 rounded-xl border border-[#1f2740] bg-[#050a1e]/60 px-3 py-2.5 font-mono text-[12px] text-white placeholder-[#3a4a75] outline-none focus:border-[#0052ff]"
            />
            <button onClick={() => load(wallet)} disabled={loading} className="btn-gem shimmer-btn shrink-0 px-5 py-2 text-[12px] font-bold disabled:opacity-50">
              {loading ? 'Pulling…' : 'Pull positions'}
            </button>
          </div>
        </div>

        {bag && bag.positions.length === 0 && (
          <div className="card p-8 text-center pop-in">
            <div className="text-2xl">🪝</div>
            <div className="mt-2 text-[14px] font-semibold text-white">
              {bag.scanned > 0 ? 'No BaseStonk fills on this wallet.' : 'Couldn\'t reach the launchpad just now.'}
            </div>
            <div className="mx-auto mt-1 max-w-sm text-[12px] text-[#b3bdd4]">
              {bag.scanned > 0
                ? `Looked through ${fmtNum(bag.scanned)} recent trades on the launchpad and found nothing for this wallet — it needs to be actively trading BaseStonk tokens. Try any trader from the feed or the Top Degens list instead.`
                : 'The upstream launchpad data timed out mid-scan. Hit Pull positions again — results are cached, so it tends to succeed on retry.'}
            </div>
          </div>
        )}

        {bag && bag.positions.length > 0 && (
          <div className="card overflow-hidden">
            <div className="border-b border-[#1f2740] px-5 py-4">
              <h2 className="font-display text-lg font-black text-white">Your positions</h2>
              <p className="mt-0.5 text-[12px] text-[#b3bdd4]">Pick one to build its P&L card →</p>
            </div>
            <div className="grid gap-1 p-3 sm:grid-cols-2 xl:grid-cols-1">
              {bag.positions.map((p, i) => {
                const up = p.pnlPct >= 0
                const active = sel?.symbol === p.symbol
                return (
                  <button
                    key={p.symbol}
                    onClick={() => setSel(p)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors fade-up ${active ? 'bg-[#0052ff]/15 ring-1 ring-[#0052ff]/40' : 'hover:bg-[#0d142b]/70'}`}
                    style={{ animationDelay: `${i * 30}ms` }}
                  >
                    <CoinGlyph src={p.imageUrl} symbol={p.symbol} size={36} ring={false} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-extrabold text-[#0052ff]">${p.symbol}</span>
                        <span className="text-[10px] text-[#3a4a75]">{p.buys}b · {p.sells}s</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-[#b3bdd4]">entry {fmtUsd(p.entry, 6)} → {fmtUsd(p.current, 6)}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className={`font-mono text-[13px] font-extrabold ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '▲' : '▼'} {Math.abs(p.pnlPct).toFixed(1)}%</div>
                      <div className={`text-[11px] font-bold ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '+' : '−'}{fmtUsd(Math.abs(p.pnlUsd))}{p.open ? '' : ' · closed'}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {sel && (
          <div className="card overflow-hidden pop-in">
            <div className="border-b border-[#1f2740] px-5 py-4">
              <h2 className="font-display text-lg font-black text-white"><span className="text-[#0052ff]">${sel.symbol}</span> P&L card</h2>
              <p className="mt-0.5 text-[12px] text-[#b3bdd4]">Auto-built from the wallet. The barrier to flexing is now zero.</p>
            </div>
            <div className="grid items-center gap-5 p-5 lg:grid-cols-[1fr_auto]">
              <div className={`relative overflow-hidden rounded-2xl border p-6 ${sel.pnlPct >= 0 ? 'border-[#45d68f]/50 bg-gradient-to-br from-[#0c2a1f] to-[#0c1531]' : 'border-[#ea6055]/50 bg-gradient-to-br from-[#2a1010] to-[#0c1531]'}`}>
                <div className="absolute right-3 top-3"><img src="/bstonk.webp" alt="" className="h-7 w-7 opacity-70" /></div>
                <div className="flex items-center gap-3">
                  <CoinGlyph src={sel.imageUrl} symbol={sel.symbol} size={48} />
                  <div>
                    <div className="text-[12px] text-[#b3bdd4]">{sel.name}</div>
                    <div className="font-display text-3xl font-black text-white">${sel.symbol}</div>
                  </div>
                </div>
                <div className={`mt-4 font-display text-5xl font-black ${sel.pnlPct >= 0 ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{sel.pnlPct >= 0 ? '▲' : '▼'} {Math.abs(sel.pnlPct).toFixed(1)}%</div>
                <div className={`mt-1 font-display text-xl font-bold ${sel.pnlPct >= 0 ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{sel.pnlPct >= 0 ? '+' : ''}{fmtUsd(Math.abs(sel.pnlUsd))} {sel.open ? 'USDC' : 'realized'}</div>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-lg bg-black/20 px-2 py-2"><div className="text-[9px] uppercase tracking-wider text-[#b3bdd4]">Entry</div><div className="font-mono text-[13px] font-bold text-white">{fmtUsd(sel.entry, 6)}</div></div>
                  <div className="rounded-lg bg-black/20 px-2 py-2"><div className="text-[9px] uppercase tracking-wider text-[#b3bdd4]">Now</div><div className="font-mono text-[13px] font-bold text-white">{fmtUsd(sel.current, 6)}</div></div>
                  <div className="rounded-lg bg-black/20 px-2 py-2"><div className="text-[9px] uppercase tracking-wider text-[#b3bdd4]">{sel.open ? 'Exposure' : 'Volume'}</div><div className="font-mono text-[13px] font-bold text-white">{fmtUsd(sel.open ? sel.exposureUsd : sel.buyVolUsd)}</div></div>
                </div>
                <div className="mt-4 flex items-center justify-between text-[10px] text-[#b3bdd4]">
                  <span className="font-mono">{shortAddr(displayWallet)}</span>
                  <span>BASESTONK · DEGEN TERMINAL</span>
                </div>
              </div>
              <div className="flex flex-col items-start justify-end gap-2 lg:items-stretch">
                <button onClick={() => postCard(sel)} className="btn-gem shimmer-btn px-8 py-3 text-[13px] font-bold">
                  {posted === sel.symbol ? 'Posted ✓' : 'Get my card 🚀'}
                </button>
                <span className="max-w-[190px] text-[10px] leading-snug text-[#3a4a75]">Posts the P&L card straight to the wall as your wallet.</span>
              </div>
            </div>
          </div>
        )}

        <div>
          <h2 className="mb-2 px-1 font-display text-lg font-black text-white">{bag && bag.trades.length ? 'Your recent trades' : 'Recent trades'}</h2>
          <div className="space-y-3">
            {stream.map((p, i) => <TradeCard key={p.id} post={p as Post} onOpen={onOpen} delay={i * 30} />)}
          </div>
        </div>
      </section>

      <aside className="hidden w-72 shrink-0 flex-col gap-6 self-start xl:flex">
        <TrendingStonks tokens={tokens} />
        <TopDegens rows={leader} onOpen={onOpen} />
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

function TopDegens({ rows, onOpen }: { rows: LeaderRow[]; onOpen?: (wallet: string) => void }) {
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-[#b3bdd4]">Top degens this hour</h3>
      <div className="card overflow-hidden">
        {rows.map((r, i) => {
          const pct = r.volumeUsd > 0 ? (r.volumeUsd / Math.max(rows[0]?.volumeUsd || 1, r.volumeUsd)) * 100 : 0
          const medal = i === 0 ? 'text-[#f5c847]' : i === 1 ? 'text-[#b3bdd4]' : i === 2 ? 'text-[#d9904f]' : 'text-[#3a4a75]'
          return (
            <div key={r.trader} onClick={() => onOpen?.(r.trader)} className="group/deg flex cursor-pointer items-center gap-2.5 border-b border-[#1f2740] px-3 py-2.5 last:border-0 transition-colors hover:bg-[#0d142b]/60 fade-up" style={{ animationDelay: `${i * 40}ms` }}>
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

// ─── Top mover showcase (header) ────────────────────────────────────────────

function TopTokenSpotlight({ t }: { t?: Token }) {
  if (!t) {
    return (
      <div className="card px-4 py-2">
        <div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">Top mover</div>
        <div className="font-display text-lg font-black text-[#3a4a75]">—</div>
      </div>
    )
  }
  const up = t.change24hPct >= 0
  const url = `https://basestonk.io/tokens/${t.address}`
  return (
    <button
      onClick={() => window.open(url, '_blank', 'noopener')}
      className="group min-w-[272px] overflow-hidden rounded-2xl border border-[#0052ff]/30 bg-gradient-to-br from-[#0c1531] via-[#0d142b] to-[#0a0f22] p-3 pl-4 text-left shadow-[0_0_18px_rgba(0,82,255,0.12)] transition-all hover:border-[#0052ff]/70 hover:shadow-[0_0_28px_rgba(0,82,255,0.3)] pop-in"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#f5c847]">🔥 Top mover</div>
        <span className={`font-mono text-[15px] font-extrabold ${up ? 'text-[#45d68f]' : 'text-[#ea6055]'}`}>{up ? '▲' : '▼'} {Math.abs(t.change24hPct).toFixed(1)}%</span>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="relative shrink-0">
          <CoinGlyph src={t.imageUrl || t.logoUrl} symbol={t.symbol} size={46} ring={false} />
          <span className="pointer-events-none absolute inset-0 animate-pulse rounded-full bg-[#0052ff]/20 blur-[6px]" />
        </div>
        <div className="min-w-0">
          <div className="truncate font-display text-[22px] font-black leading-none text-white">${t.symbol}</div>
          <div className="mt-1 truncate text-[12px] font-semibold text-[#b3bdd4]">{t.name}</div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-3 border-t border-[#1f2740]/80 pt-2 text-[11px] text-[#b3bdd4]">
        <span>MCap <b className="font-bold text-white">{fmtUsd(t.marketcapUsd)}</b></span>
        <span>Vol <b className="font-bold text-white">{fmtUsd(t.volume24hUsd)}</b></span>
        <span className="ml-auto font-bold text-[#0052ff] transition-all group-hover:translate-x-0.5 group-hover:underline">Trade ↗</span>
      </div>
    </button>
  )
}

// ─── BaseStonk token card (exact anatomy from basestonk.io) ────────────────

function TokenCard({ t }: { t: Token }) {
  const up = t.change24hPct >= 0
  const age = t.createdAt ? Math.max(0, Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86_400_000)) : 0
  const url = `https://basestonk.io/tokens/${t.address}`
  return (
    <button onClick={() => window.open(url, '_blank', 'noopener')} className="card card-hover group w-full p-4 text-left fade-up">
      <div className="flex flex-wrap items-center gap-1.5">
        {t.platform && <span className="bs-badge bs-badge-gold px-2 py-0.5">PLATFORM</span>}
        {t.og && <span className="bs-badge bs-badge-soft px-2 py-0.5">OG</span>}
        {t.venue && !t.venue.startsWith('0x') && <span className="bs-badge bs-badge-soft px-2 py-0.5">{t.venue.toUpperCase()}</span>}
        <span className="ml-auto text-[10px] font-bold text-[#0052ff] opacity-0 transition-opacity group-hover:opacity-100">Official page ↗</span>
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

function DegensView({ rows, onOpen }: { rows: LeaderRow[]; onOpen?: (wallet: string) => void }) {
  const medal = (i: number) => i === 0 ? 'text-[#f5c847]' : i === 1 ? 'text-[#b3bdd4]' : i === 2 ? 'text-[#d9904f]' : 'text-[#3a4a75]'
  return (
    <div className="fade-in mx-auto max-w-3xl">
      <div className="mb-5 px-1">
        <h1 className="font-display text-3xl font-black tracking-tight text-white">Top <span className="text-[#0052ff]">degens</span></h1>
        <p className="mt-1 text-[13px] font-medium text-[#b3bdd4]">Biggest movers on BaseStonk this hour, by volume. Click any wallet to open their profile.</p>
      </div>
      <div className="card overflow-hidden">
        {rows.map((r, i) => {
          const pct = r.volumeUsd > 0 ? (r.volumeUsd / Math.max(rows[0]?.volumeUsd || 1, r.volumeUsd)) * 100 : 0
          return (
            <div key={r.trader} onClick={() => onOpen?.(r.trader)} className="group/deg flex cursor-pointer items-center gap-3 border-b border-[#1f2740] px-4 py-3 last:border-0 transition-colors hover:bg-[#0d142b]/50 fade-up" style={{ animationDelay: `${i * 35}ms` }}>
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

// ─── Profile view: a wallet's posts + trades, followable ───────────────────

function ProfileView({ identity, wallet, followed, userPosts, feedPosts, tokens, onFollow, onLike, onBack, onOpen }: {
  identity: string; wallet: string; followed: boolean; userPosts: UserPost[]; feedPosts: Post[]; tokens: Token[];
  onFollow: () => void; onLike: (id: number) => void; onBack: () => void; onOpen: (wallet: string) => void;
}) {
  const [acc, setAcc] = useState<Account | null>(null)
  useEffect(() => {
    let on = true
    fetchAccount(wallet).then((a) => { if (on) setAcc(a) }).catch(() => null)
    return () => { on = false }
  }, [wallet])

  const myPosts = useMemo(() => userPosts.filter((p) => p.author === wallet), [userPosts, wallet])
  const theirTrades = useMemo(() => feedPosts.filter((p) => p.trader === wallet), [feedPosts, wallet])
  const handle = acc?.handle || myPosts.find((p) => p.handle)?.handle || null
  const avatar = acc?.avatar || myPosts.find((p) => p.avatar)?.avatar || ''
  const own = wallet === identity

  return (
    <div className="fade-in flex gap-6">
      <section className="min-w-0 flex-1 space-y-6">
        <button onClick={onBack} className="btn-ghost px-3 py-1.5 text-[12px] font-semibold">← back to feed</button>

        <div className="card p-5 pop-in">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar wallet={wallet} avatar={avatar} size={72} className="ring-2 ring-[#0052ff]/40" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {handle && <span className="font-display text-xl font-black text-white">@{handle}</span>}
                <CopyAddr addr={wallet} short={8} className="text-[12px] font-medium text-[#b3bdd4]" />
              </div>
              <div className="mt-1 text-[12px] text-[#b3bdd4]">
                {myPosts.length} post{myPosts.length === 1 ? '' : 's'} · {theirTrades.length} trade{theirTrades.length === 1 ? '' : 's'} in this hour
              </div>
            </div>
            {!own && (
              <button
                onClick={onFollow}
                className={`px-5 py-2 text-[13px] font-bold transition-all shimmer-btn ${followed ? 'btn-ghost' : 'btn-gem'}`}
              >
                {followed ? 'Following ✓' : 'Follow'}
              </button>
            )}
          </div>
        </div>

        <div>
          <h2 className="mb-2 px-1 font-display text-lg font-black text-white">Posts</h2>
          {myPosts.length === 0 ? (
            <div className="card p-6 text-center text-[12px] text-[#3a4a75]">No posts yet — wallet silence.</div>
          ) : (
            <div className="space-y-3">
              {myPosts.map((p, i) => <UserPostCard key={p.id} post={p} onLike={onLike} onOpen={onOpen} delay={i * 30} />)}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-2 px-1 font-display text-lg font-black text-white">Trades</h2>
          {theirTrades.length === 0 ? (
            <div className="card p-6 text-center text-[12px] text-[#3a4a75]">No BaseStonk trades in this hour.</div>
          ) : (
            <div className="space-y-3">
              {theirTrades.slice(0, 20).map((p, i) => <TradeCard key={p.id} post={p} onOpen={onOpen} delay={i * 30} />)}
            </div>
          )}
        </div>
      </section>

      <aside className="hidden w-72 shrink-0 flex-col gap-6 self-start xl:flex">
        <TrendingStonks tokens={tokens} />
      </aside>
    </div>
  )
}

// ─── Main App ──────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView] = useState<View>('home')
  const [profileWallet, setProfileWallet] = useState<string | null>(null)
  const [following, setFollowing] = useState<Set<string>>(new Set())
  const [feedMode, setFeedMode] = useState<'general' | 'following'>('general')
  const [tokens, setTokens] = useState<Token[]>([])
  const [allStonks, setAllStonks] = useState<Token[]>([])
  const [feed, setFeed] = useState<FeedItem[]>([])
  const [leader, setLeader] = useState<LeaderRow[]>([])
  const [userPosts, setUserPosts] = useState<UserPost[]>([])
  const [loading, setLoading] = useState(true)
  const composerRef = useRef<HTMLDivElement>(null)
  const identity = useIdentity()

  const openProfile = useCallback((w: string) => {
    if (!w) return
    setProfileWallet(w)
    setView('profile')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    fetchFollows(identity).then((t) => setFollowing(new Set(t))).catch(() => null)
  }, [identity])

  const toggleFollow = useCallback(async (target: string) => {
    if (target === identity) return
    const willFollow = !following.has(target)
    if (willFollow) addFollow(identity, target).catch(() => null)
    else removeFollow(identity, target).catch(() => null)
    setFollowing((prev) => {
      const next = new Set(prev)
      if (willFollow) next.add(target)
      else next.delete(target)
      return next
    })
  }, [identity, following])

  const visiblePosts = useMemo(
    () => (feedMode === 'following' ? userPosts.filter((p) => following.has(p.author)) : userPosts),
    [userPosts, feedMode, following],
  )

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
      top,
    }
  }, [tokens, posts])

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [tokRes, volRes] = await Promise.all([
      fetchTokens(60, 'trending').catch(() => null),
      fetchTokens(100, 'volume').catch(() => null),
    ])
    const arr = (r: { tokens?: Token[] } | null) => (Array.isArray(r?.tokens) ? r!.tokens : [])
    const trend = arr(tokRes)
    if (trend.length) setTokens(trend)
    if (arr(volRes).length || trend.length) {
      const seen = new Set<string>()
      setAllStonks([...arr(volRes), ...trend].filter((t) => t.symbol && !seen.has(t.symbol) && !!seen.add(t.symbol)))
    }
    const [feedRes, leadRes, postsRes] = await Promise.all([
      fetchFeed(40).catch(() => null),
      fetchLeaderboard(20).catch(() => null),
      fetchPosts(50).catch(() => null),
    ])
    if (Array.isArray(feedRes)) setFeed(feedRes)
    if (Array.isArray(leadRes?.rows)) setLeader(leadRes!.rows)
    if (Array.isArray(postsRes)) setUserPosts(postsRes)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    const t = setInterval(async () => {
      const [feedRes, postsRes] = await Promise.all([fetchFeed(40).catch(() => null), fetchPosts(50).catch(() => null)])
      if (Array.isArray(feedRes)) setFeed(feedRes)
      if (Array.isArray(postsRes)) setUserPosts(postsRes)
      fetchTokens(60, 'trending').then((r) => setTokens(r.tokens)).catch(() => null)
    }, 15000)
    return () => clearInterval(t)
  }, [])

  async function handleLike(id: number) {
    try {
      const updated = await likePost(id)
      setUserPosts((prev) => prev.map((p) => (p.id === id ? { ...p, likes: updated.likes ?? 0 } : p)))
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
            <div className="logo-gem">
              <img src="/bstonk.webp" alt="" className="h-9 w-9 rounded-full gem-glow" />
            </div>
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
        {view === 'degens' && <DegensView rows={leader} onOpen={openProfile} />}
        {view === 'portfolio' && <PortfolioView identity={identity} tokens={tokens} leader={leader} posts={posts} onPosted={loadAll} onOpen={openProfile} />}

        {view === 'profile' && profileWallet && (
          <ProfileView
            identity={identity}
            wallet={profileWallet}
            followed={following.has(profileWallet)}
            userPosts={userPosts}
            feedPosts={posts}
            tokens={tokens}
            onFollow={() => toggleFollow(profileWallet)}
            onLike={handleLike}
            onBack={() => { setProfileWallet(null); setView('home') }}
            onOpen={openProfile}
          />
        )}

        {view === 'home' && (
          <div className="flex gap-6">
            <section className="min-w-0 flex-1">
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3 px-1">
                <div>
                  <h1 className="font-display text-4xl font-black tracking-tight text-white">The <span className="text-[#0052ff]">feed</span></h1>
                  <p className="mt-1 text-[14px] font-medium text-[#b3bdd4]">Degens call their shots, flex their bags, shill their coins.</p>
                </div>
                <div className="hidden sm:block">
                  <div className="card px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-[#b3bdd4]">24h vol</div><div className="font-display text-lg font-black stat-grad number-anim">{fmtUsd(stats.vol24)}</div></div>
                </div>
              </div>

              <div ref={composerRef} className="space-y-3">
                <Composer identity={identity} allStonks={allStonks} tokens={tokens} onPosted={loadAll} onOpenProfile={openProfile} />
              </div>

              <div className="mt-4 flex items-center gap-3">
                <div className="flex items-center gap-1 rounded-full border border-[#1f2740] bg-[#0c1531] p-1">
                  {(['general', 'following'] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setFeedMode(m)}
                      className={`rounded-full px-3.5 py-1.5 text-[12px] font-bold transition-all ${feedMode === m ? 'bg-white text-[#09090b]' : 'text-[#b3bdd4] hover:text-white'}`}
                    >
                      {m === 'general' ? 'General' : `Following · ${following.size}`}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-[#3a4a75]">follow wallets to build your own feed</span>
              </div>

              <div className="mt-4 space-y-4">
                {visiblePosts.length === 0 && (
                  <div className="card p-8 text-center pop-in">
                    <div className="text-2xl">{feedMode === 'following' ? '🫂' : '🗣️'}</div>
                    <div className="mt-2 text-[14px] font-semibold text-white">
                      {feedMode === 'following' ? 'Your followed feed is empty.' : 'No posts yet — be the first to speak.'}
                    </div>
                    <div className="mt-1 text-[12px] text-[#b3bdd4]">
                      {feedMode === 'following' ? 'Follow some degens — click any wallet — and their calls show up here.' : 'Call a 100x, flex a bag, or shill a BaseStonk token.'}
                    </div>
                  </div>
                )}
                {visiblePosts.map((p, i) => (
                  <UserPostCard key={p.id} post={p} onLike={handleLike} onOpen={openProfile} delay={i * 35} />
                ))}
              </div>
            </section>

            <aside className="hidden w-72 shrink-0 flex-col gap-6 self-start xl:flex">
              <TopTokenSpotlight t={stats.top} />
              <TrendingStonks tokens={tokens} />
              <TopDegens rows={leader} onOpen={openProfile} />
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