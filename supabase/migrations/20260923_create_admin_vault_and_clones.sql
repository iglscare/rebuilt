-- =============================================================================
-- Rebuilt Web Cloner — Supabase Admin-Only Storage & Vault Schema
-- Security: Strict Row Level Security (RLS) enabled.
-- Public/Anon access: FORBIDDEN (No permissive policies defined).
-- Admin access: SERVICE_ROLE KEY ONLY (bypasses RLS).
-- =============================================================================

-- 1. Clones Table (Stores website mirror metadata, pages, tech stack, and audit reports)
CREATE TABLE IF NOT EXISTS public.clones (
  id TEXT PRIMARY KEY,
  title TEXT,
  original_url TEXT NOT NULL,
  final_url TEXT NOT NULL,
  status TEXT DEFAULT 'completed',
  page_count INTEGER DEFAULT 1,
  size BIGINT DEFAULT 0,
  pages JSONB DEFAULT '[]'::jsonb,
  tech_stack JSONB DEFAULT '[]'::jsonb,
  audit_report JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) on clones
ALTER TABLE public.clones ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke all public privileges to ensure zero public access
REVOKE ALL ON public.clones FROM anon;
REVOKE ALL ON public.clones FROM authenticated;


-- 2. Authorized Sessions Table (Stores AES-256-GCM encrypted credentials for target websites)
CREATE TABLE IF NOT EXISTS public.authorized_sessions (
  domain TEXT PRIMARY KEY,
  encrypted_credentials TEXT NOT NULL, -- AES-256-GCM encrypted payload
  cookie_keys JSONB DEFAULT '[]'::jsonb,
  header_keys JSONB DEFAULT '[]'::jsonb,
  notes TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable Row Level Security (RLS) on authorized_sessions
ALTER TABLE public.authorized_sessions ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke all public privileges to ensure zero public access
REVOKE ALL ON public.authorized_sessions FROM anon;
REVOKE ALL ON public.authorized_sessions FROM authenticated;

-- Comment on tables for Supabase dashboard documentation
COMMENT ON TABLE public.clones IS 'Stores cloned website metadata. Accessible strictly by Supabase Admin / Service Role.';
COMMENT ON TABLE public.authorized_sessions IS 'Stores encrypted target credentials. Accessible strictly by Supabase Admin / Service Role.';
