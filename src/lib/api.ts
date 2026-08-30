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
  return get(`/api/tokens?limit=${limit}&sort=${sort}`)
}

export async function fetchFeed(limit = 40): Promise<FeedItem[]> {
  return get(`/api/feed?limit=${limit}`)
}

export async function fetchLeaderboard(limit = 20): Promise<{ maxScore: number; rows: LeaderRow[] }> {
  return get(`/api/leaderboard?limit=${limit}`)
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

export function fmtUsd(n: number, decimals = 2): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(decimals)}`
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
