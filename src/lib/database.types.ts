// Supabase database schema types for BaseStonk Terminal
// Regenerate/expand this when the public schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  public: {
    Tables: {
      follows: {
        Row: {
          id: number
          follower: string
          target: string
          created_at: string
        }
        Insert: {
          id?: number
          follower: string
          target: string
          created_at?: string
        }
        Update: {
          id?: number
          follower?: string
          target?: string
          created_at?: string
        }
        Relationships: []
      }
      posts: {
        Row: {
          id: number
          author: string
          body: string
          token_symbol: string | null
          token_image: string | null
          likes: number
          created_at: string
          kind: string
          token_address: string | null
          entry_price: number | null
          entry_mcap: number | null
        }
        Insert: {
          id?: number
          author: string
          body: string
          token_symbol?: string | null
          token_image?: string | null
          likes?: number
          created_at?: string
          kind?: string
          token_address?: string | null
          entry_price?: number | null
          entry_mcap?: number | null
        }
        Update: {
          id?: number
          author?: string
          body?: string
          token_symbol?: string | null
          token_image?: string | null
          likes?: number
          created_at?: string
          kind?: string
          token_address?: string | null
          entry_price?: number | null
          entry_mcap?: number | null
        }
        Relationships: []
      }
      accounts: {
        Row: {
          wallet: string
          handle: string | null
          avatar: string | null
          bio: string | null
          created_at: string
        }
        Insert: {
          wallet: string
          handle?: string | null
          avatar?: string | null
          bio?: string | null
          created_at?: string
        }
        Update: {
          wallet?: string
          handle?: string | null
          avatar?: string | null
          bio?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {}
    Functions: {}
    Enums: {}
    CompositeTypes: {}
  }
}
