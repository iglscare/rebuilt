/**
 * Rebuilt Web Cloner — Supabase Admin Client
 * Handles persistence for Clones and Authorized Target Sessions in Supabase.
 * Enforces Admin-Only privileges (via service_role key) with Row Level Security (RLS) denying public access.
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';

let supabaseAdmin = null;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return supabaseAdmin;
}

function isSupabaseConfigured() {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Saves clone metadata to Supabase 'clones' table
 */
async function saveCloneToSupabase(metadata) {
  const client = getSupabaseAdmin();
  if (!client) return false;

  try {
    const row = {
      id: metadata.id,
      title: metadata.title || 'Untitled Clone',
      original_url: metadata.originalUrl,
      final_url: metadata.finalUrl,
      status: metadata.status || 'completed',
      page_count: metadata.pageCount || (Array.isArray(metadata.pages) ? metadata.pages.length : 1),
      size: metadata.size || 0,
      pages: metadata.pages || [],
      tech_stack: metadata.techStack || [],
      audit_report: metadata.auditReport || {},
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from('clones')
      .upsert(row, { onConflict: 'id' });

    if (error) {
      console.error('[Supabase] Error saving clone to Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] Exception saving clone:', err.message);
    return false;
  }
}

/**
 * Retrieves a single clone metadata record from Supabase
 */
async function getCloneFromSupabase(id) {
  const client = getSupabaseAdmin();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('clones')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      title: data.title,
      originalUrl: data.original_url,
      finalUrl: data.final_url,
      status: data.status,
      pageCount: data.page_count,
      size: data.size,
      pages: data.pages,
      techStack: data.tech_stack,
      auditReport: data.audit_report,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (err) {
    console.error('[Supabase] Exception fetching clone:', err.message);
    return null;
  }
}

/**
 * Lists all clone records from Supabase
 */
async function listClonesFromSupabase() {
  const client = getSupabaseAdmin();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('clones')
      .select('*')
      .order('created_at', { ascending: false });

    if (error || !Array.isArray(data)) return [];

    return data.map(d => ({
      id: d.id,
      title: d.title,
      originalUrl: d.original_url,
      finalUrl: d.final_url,
      status: d.status,
      pageCount: d.page_count,
      size: d.size,
      pages: d.pages,
      techStack: d.tech_stack,
      auditReport: d.audit_report,
      createdAt: d.created_at,
      updatedAt: d.updated_at
    }));
  } catch (err) {
    console.error('[Supabase] Exception listing clones:', err.message);
    return [];
  }
}

/**
 * Deletes a clone record from Supabase
 */
async function deleteCloneFromSupabase(id) {
  const client = getSupabaseAdmin();
  if (!client) return false;

  try {
    const { error } = await client
      .from('clones')
      .delete()
      .eq('id', id);

    return !error;
  } catch (err) {
    console.error('[Supabase] Exception deleting clone:', err.message);
    return false;
  }
}

/**
 * Saves or updates an authorized session record in Supabase 'authorized_sessions' table
 */
async function saveSessionToSupabase({ domain, encryptedCredentials, cookieKeys = [], headerKeys = [], notes = '', enabled = true }) {
  const client = getSupabaseAdmin();
  if (!client) return false;

  try {
    const row = {
      domain,
      encrypted_credentials: encryptedCredentials,
      cookie_keys: cookieKeys,
      header_keys: headerKeys,
      notes: notes || '',
      enabled: enabled !== false,
      updated_at: new Date().toISOString()
    };

    const { error } = await client
      .from('authorized_sessions')
      .upsert(row, { onConflict: 'domain' });

    if (error) {
      console.error('[Supabase] Error saving session to Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] Exception saving session:', err.message);
    return false;
  }
}

/**
 * Retrieves an authorized session record from Supabase
 */
async function getSessionFromSupabase(domain) {
  const client = getSupabaseAdmin();
  if (!client) return null;

  try {
    const { data, error } = await client
      .from('authorized_sessions')
      .select('*')
      .eq('domain', domain)
      .single();

    if (error || !data) return null;

    return {
      domain: data.domain,
      encryptedCredentials: data.encrypted_credentials,
      cookieKeys: data.cookie_keys,
      headerKeys: data.header_keys,
      notes: data.notes,
      enabled: data.enabled,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (err) {
    console.error('[Supabase] Exception fetching session:', err.message);
    return null;
  }
}

/**
 * Deletes an authorized session record from Supabase
 */
async function deleteSessionFromSupabase(domain) {
  const client = getSupabaseAdmin();
  if (!client) return false;

  try {
    const { error } = await client
      .from('authorized_sessions')
      .delete()
      .eq('domain', domain);

    return !error;
  } catch (err) {
    console.error('[Supabase] Exception deleting session:', err.message);
    return false;
  }
}

module.exports = {
  getSupabaseAdmin,
  isSupabaseConfigured,
  saveCloneToSupabase,
  getCloneFromSupabase,
  listClonesFromSupabase,
  deleteCloneFromSupabase,
  saveSessionToSupabase,
  getSessionFromSupabase,
  deleteSessionFromSupabase
};
