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
    }
    Views: {}
    Functions: {}
    Enums: {}
    CompositeTypes: {}
  }
}
