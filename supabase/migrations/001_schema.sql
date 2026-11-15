-- CenejsiNakup schema: run in Supabase SQL Editor
create extension if not exists pgcrypto;

create table if not exists public.retailers (
  id text primary key,
  name text not null,
  website text not null,
  enabled boolean not null default true
);

insert into public.retailers(id,name,website) values
('lidl','Lidl','https://www.lidl.si'),
('hofer','Hofer','https://www.hofer.si'),
('spar','SPAR','https://www.spar.si'),
('tus','Tuš','https://www.tus.si'),
('mercator','Mercator','https://www.mercatoronline.si'),
('eurospin','Eurospin','https://www.eurospin.si')
on conflict (id) do nothing;

create table if not exists public.product_offers (
  id uuid primary key default gen_random_uuid(),
  retailer_id text not null references public.retailers(id),
  retailer_product_id text,
  product_name text not null,
  brand text,
  barcode text,
  quantity_value numeric,
  quantity_unit text,
  price_eur numeric(12,4) not null check(price_eur >= 0),
  regular_price_eur numeric(12,4),
  unit_price_eur numeric(12,4),
  product_url text,
  source_url text not null,
  checked_at timestamptz not null default now(),
  raw_fingerprint text,
  created_at timestamptz not null default now()
);

create index if not exists product_offers_name_idx on public.product_offers using gin (to_tsvector('simple', product_name));
create index if not exists product_offers_retailer_checked_idx on public.product_offers(retailer_id, checked_at desc);
create index if not exists product_offers_barcode_idx on public.product_offers(barcode) where barcode is not null;

alter table public.retailers enable row level security;
alter table public.product_offers enable row level security;
create policy "public can read retailers" on public.retailers for select using (true);
create policy "public can read offers" on public.product_offers for select using (true);
-- No public insert/update/delete policies. Writes belong only in Edge Functions using service role.
