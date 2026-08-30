export interface Token {
  address: string
  name: string
  symbol: string
  priceUsd: number
  change24hPct: number
  volume24hUsd: number
  marketcapUsd: number
  holders: number
  creator: string
  imageUrl?: string
  logoUrl?: string
  og?: boolean
  platform?: boolean
  venue?: string
  createdAt?: string
  progressBps?: number
  description?: string
}

export interface FeedItem {
  id: string
  token: string
  tokenSymbol: string
  tokenName: string
  trader: string
  traderShort: string
  side: 'buy' | 'sell'
  priceUsd: number
  volumeUsd: number
  amountToken: string
  createdAt: string
  txn: string
  tokenImageUrl?: string
  change24hPct?: number
  marketcapUsd?: number
  spark?: number[]
}

export interface LeaderRow {
  trader: string
  traderShort: string
  volumeUsd: number
  buys: number
  sells: number
  score: number
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function fetchTokens(limit = 50, sort = 'trending'): Promise<{ total: number; hasNext: boolean; tokens: Token[] }> {
  const j = await get<{ total?: number; hasNext?: boolean; tokens?: Token[] }>(`/api/tokens?limit=${limit}&sort=${sort}`)
  if (!Array.isArray(j.tokens)) throw new Error('bad tokens payload')
  return { total: j.total ?? j.tokens.length, hasNext: !!j.hasNext, tokens: j.tokens }
}

export async function fetchFeed(limit = 40): Promise<FeedItem[]> {
  return get(`/api/feed?limit=${limit}`)
}

export async function fetchLeaderboard(limit = 20): Promise<{ maxScore: number; rows: LeaderRow[] }> {
  return get(`/api/leaderboard?limit=${limit}`)
}

export interface Position {
  symbol: string
  name: string
  token: string
  imageUrl?: string
  buys: number
  sells: number
  buyVolUsd: number
  sellVolUsd: number
  entry: number
  current: number
  exposureUsd: number
  pnlUsd: number
  pnlPct: number
  open: boolean
}

export async function fetchPositions(wallet: string): Promise<{ positions: Position[]; trades: FeedItem[]; scanned: number }> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { positions: [], trades: [], scanned: 0 }
  return get(`/api/positions?wallet=${wallet}`)
}

export async function fetchFollows(follower?: string): Promise<string[]> {
  if (!follower) return []
  return get(`/api/follows?follower=${follower}`)
}

export async function addFollow(follower: string, target: string): Promise<void> {
  await fetch('/api/follows', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ follower, target }) })
}

export async function removeFollow(follower: string, target: string): Promise<void> {
  await fetch(`/api/follows?follower=${follower}&target=${target}`, { method: 'DELETE' })
}

export async function fetchPosts(limit = 50): Promise<UserPost[]> {
  return get(`/api/posts?limit=${limit}`)
}

export async function createPost(input: { author: string; body: string; tokenSymbol?: string; tokenImage?: string }): Promise<UserPost> {
  const res = await fetch('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error(j?.error || `${res.status}`)
  }
  return res.json()
}

export async function likePost(id: number): Promise<UserPost> {
  const res = await fetch(`/api/posts/${id}/like`, { method: 'POST' })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error(j?.error || `${res.status}`)
  }
  return res.json()
}

export async function fetchAccount(wallet: string): Promise<Account | null> {
  if (!wallet) return null
  const j = await get<{ account: Account | null }>(`/api/accounts?wallet=${wallet}`)
  return j.account
}

export async function saveAccount(input: { wallet: string; handle: string; avatar?: string }): Promise<Account> {
  const res = await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })
  if (!res.ok) {
    const j = await res.json().catch(() => null)
    throw new Error(j?.error || `${res.status}`)
  }
  return res.json()
}

export function fmtUsd(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(decimals)}`
}

export interface UserPost {
  id: number
  author: string
  body: string
  token_symbol: string | null
  token_image: string | null
  likes: number
  created_at: string
  handle?: string | null
  avatar?: string | null
}

export interface Account {
  wallet: string
  handle: string | null
  avatar: string | null
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
