-- 調べる (lookup) persistence — run once in the Supabase SQL editor.
-- Access is server-only: api/store.js uses the service-role key, gated by ACCESS_CODE.
-- RLS is on with no policies, so the anon/public key can't read or write anything.

-- One row per answer received, so a repeat lookup costs nothing.
create table lookup_entries (
  id          bigint generated always as identity primary key,
  query       text not null,   -- cache key: the word / "補償・報酬" for cmp / a single character for jiten
  mode        text not null check (mode in ('dict','kanji','sentence','thes','cmp','jiten')),
  level       text not null default 'standard' check (level in ('standard','gakusei')),  -- 小6モード gets its own answers
  entry       jsonb not null,  -- the parsed object the UI renders (sentence = array that grows on regenerate)
  model       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (query, mode, level)
);

-- One row per word looked up.
create table lookup_history (
  id               bigint generated always as identity primary key,
  query            text not null unique,
  context          jsonb,           -- {reading, meaning} when opened from a 類義語/使い分け chip; null when typed
  modes            text[] not null default '{}',
  lookup_count     int not null default 1,
  first_looked_at  timestamptz not null default now(),
  last_looked_at   timestamptz not null default now()
);
create index lookup_history_recent on lookup_history (last_looked_at desc);

alter table lookup_entries enable row level security;
alter table lookup_history enable row level security;

-- Records a lookup in one call: inserts the word, or bumps its count and adds the mode.
-- p_bump = false when only switching modes on a word already open (adds the mode, no count).
create or replace function record_lookup(
  p_query   text,
  p_mode    text,
  p_context jsonb   default null,
  p_bump    boolean default true
) returns void
language sql
set search_path = public
as $$
  insert into lookup_history (query, context, modes)
  values (p_query, p_context, array[p_mode])
  on conflict (query) do update set
    lookup_count   = lookup_history.lookup_count + case when p_bump then 1 else 0 end,
    last_looked_at = case when p_bump then now() else lookup_history.last_looked_at end,
    context        = coalesce(excluded.context, lookup_history.context),
    modes          = case when p_mode = any(lookup_history.modes) then lookup_history.modes
                          else lookup_history.modes || p_mode end;
$$;

revoke execute on function record_lookup(text, text, jsonb, boolean) from public, anon, authenticated;
