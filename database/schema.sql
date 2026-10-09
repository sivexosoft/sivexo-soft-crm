
-- Sivexo Soft CRM
-- Run this script in Supabase SQL Editor.

create extension if not exists pgcrypto;

-- 1. Personal CRM profile
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

-- 2. Business leads
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  business_name text not null,
  contact text,
  contact_2 text,
  website_url text,
  email text,

  country text,
  category text,
  address text,
  optional_details text,
  lead_source text,

  stage text not null default 'new'
    check (stage in (
      'new',
      'first_message_sent',
      'follow_up',
      'call_done',
      'interested',
      'not_interested',
      'future_opportunity',
      'proposal_sent',
      'won',
      'lost'
    )),

  next_follow_up_at timestamptz,
  last_contacted_at timestamptz,
  is_archived boolean not null default false,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_user_created_idx
  on public.leads (user_id, created_at desc);

create index if not exists leads_user_stage_idx
  on public.leads (user_id, stage);

create index if not exists leads_follow_up_idx
  on public.leads (user_id, next_follow_up_at)
  where is_archived = false;

-- 3. Services offered to a lead
create table if not exists public.lead_services (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  service_name text not null,
  created_at timestamptz not null default now(),
  unique (lead_id, service_name)
);

-- 4. Activity history
create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  activity_type text not null,
  description text,
  services text[] not null default '{}',
  outcome text,
  created_at timestamptz not null default now()
);

-- 5. Message templates
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  channel text not null default 'whatsapp',
  subject text,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 6. Proposals
create table if not exists public.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  title text not null,
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'USD',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'cancelled')),
  proposal_notes text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- 7. Payments
create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  proposal_id uuid references public.proposals(id) on delete set null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'USD',
  payment_type text not null default 'upfront'
    check (payment_type in ('upfront', 'milestone', 'after_work', 'other')),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'overdue', 'cancelled')),
  due_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

-- 8. Saved categories and service preferences
create table if not exists public.crm_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  categories text[] not null default '{}',
  services text[] not null default array[
    'Web Development',
    'App Development',
    'Digital Marketing',
    'Graphic Design',
    'SEO & Automation',
    'Branding',
    'AI Solutions',
    'Social Media Management'
  ],
  updated_at timestamptz not null default now()
);

-- Automatic updated_at maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
before update on public.leads
for each row execute function public.set_updated_at();

drop trigger if exists templates_set_updated_at on public.message_templates;
create trigger templates_set_updated_at
before update on public.message_templates
for each row execute function public.set_updated_at();

-- Automatically create a profile and default settings for new accounts
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', '')
  );

  insert into public.crm_settings (user_id)
  values (new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Enable Row Level Security on every personal-data table
alter table public.profiles enable row level security;
alter table public.leads enable row level security;
alter table public.lead_services enable row level security;
alter table public.activities enable row level security;
alter table public.message_templates enable row level security;
alter table public.proposals enable row level security;
alter table public.payments enable row level security;
alter table public.crm_settings enable row level security;

-- Profiles
create policy "Users manage own profile"
on public.profiles for all
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Leads
create policy "Users manage own leads"
on public.leads for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Services
create policy "Users manage own lead services"
on public.lead_services for all
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = (select auth.uid())
  )
);

-- Activities
create policy "Users manage own activities"
on public.activities for all
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = (select auth.uid())
  )
);

-- Templates
create policy "Users manage own templates"
on public.message_templates for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- Proposals
create policy "Users manage own proposals"
on public.proposals for all
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = (select auth.uid())
  )
);

-- Payments
create policy "Users manage own payments"
on public.payments for all
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.leads l
    where l.id = lead_id and l.user_id = (select auth.uid())
  )
);

-- Settings
create policy "Users manage own settings"
on public.crm_settings for all
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
