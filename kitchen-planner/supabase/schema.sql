-- Kitchen Planner database setup.
-- Paste this whole file into Supabase: SQL Editor -> New query -> Run.
-- Safe to run once on a new project. Every table belongs to one signed-in user (one restaurant account),
-- and Row Level Security makes sure each account can only ever read or change its own rows.

-- 1. Stock: one row per delivery (batch), with its own expiry date and cost
create table if not exists public.stock_batches (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ingredient    text not null check (length(trim(ingredient)) > 0),
  unit          text not null check (length(trim(unit)) > 0),
  qty           numeric not null check (qty > 0),
  expiry        date not null,
  cost_per_unit numeric not null default 0 check (cost_per_unit >= 0),
  received      date not null default current_date,
  created_at    timestamptz not null default now()
);

-- 2. Waste log: what was thrown away and why
create table if not exists public.waste_entries (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  wasted_on     date not null default current_date,
  ingredient    text not null check (length(trim(ingredient)) > 0),
  qty           numeric not null check (qty > 0),
  reason        text not null check (reason in (
                  'Over-prepared', 'Spoiled / expired', 'Plate waste',
                  'Kitchen mistake', 'Returned by customer', 'Other')),
  cost_per_unit numeric check (cost_per_unit is null or cost_per_unit >= 0),
  created_at    timestamptz not null default now()
);

-- 3. Recipes: how much of each ingredient one portion of a dish uses
create table if not exists public.recipe_lines (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  dish       text not null check (length(trim(dish)) > 0),
  ingredient text not null check (length(trim(ingredient)) > 0),
  amount     numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

-- 4. Sales: how many portions of each dish were sold each day
create table if not exists public.sales_rows (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  sold_on    date not null,
  dish       text not null check (length(trim(dish)) > 0),
  qty        numeric not null check (qty >= 0),
  created_at timestamptz not null default now()
);

create index if not exists stock_batches_user_idx on public.stock_batches (user_id, expiry);
create index if not exists waste_entries_user_idx on public.waste_entries (user_id, wasted_on);
create index if not exists recipe_lines_user_idx  on public.recipe_lines  (user_id, dish);
create index if not exists sales_rows_user_idx    on public.sales_rows    (user_id, sold_on);

-- Row Level Security: each account sees and changes only its own rows.
alter table public.stock_batches enable row level security;
alter table public.waste_entries enable row level security;
alter table public.recipe_lines  enable row level security;
alter table public.sales_rows    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['stock_batches', 'waste_entries', 'recipe_lines', 'sales_rows'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
