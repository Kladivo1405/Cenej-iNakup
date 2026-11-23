create schema if not exists shopping_private;
revoke all on schema shopping_private from public;
grant usage on schema shopping_private to authenticated;

create table public.shared_lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create table shopping_private.shared_list_members (
  list_id uuid not null references public.shared_lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (list_id, user_id)
);
create table shopping_private.shared_list_invites (
  token uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shared_lists(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);
create table public.shared_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shared_lists(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  qty integer not null default 1 check (qty between 1 and 999),
  bought boolean not null default false,
  created_at timestamptz not null default now()
);
create index shared_list_items_list_id_idx on public.shared_list_items(list_id);

create function shopping_private.is_member(target uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from shopping_private.shared_list_members m
    where m.list_id = target and m.user_id = auth.uid()
  );
$$;
revoke all on function shopping_private.is_member(uuid) from public;
grant execute on function shopping_private.is_member(uuid) to authenticated;

alter table public.shared_lists enable row level security;
alter table public.shared_list_items enable row level security;
revoke all on public.shared_lists, public.shared_list_items from anon, authenticated;
grant select on public.shared_lists to authenticated;
grant select, delete on public.shared_list_items to authenticated;
grant insert (list_id, name, qty), update (bought) on public.shared_list_items to authenticated;
create policy shared_lists_read on public.shared_lists
  for select to authenticated using (shopping_private.is_member(id));
create policy shared_list_items_read on public.shared_list_items
  for select to authenticated using (shopping_private.is_member(list_id));
create policy shared_list_items_create on public.shared_list_items
  for insert to authenticated with check (shopping_private.is_member(list_id));
create policy shared_list_items_check on public.shared_list_items
  for update to authenticated using (shopping_private.is_member(list_id))
  with check (shopping_private.is_member(list_id));
create policy shared_list_items_delete on public.shared_list_items
  for delete to authenticated using (shopping_private.is_member(list_id));

create function public.create_shared_list(list_name text, initial_items jsonb default '[]') returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  created uuid;
begin
  if caller is null then raise exception 'Prijava je potrebna'; end if;
  if pg_catalog.jsonb_array_length(initial_items) > 250 then raise exception 'Preveč postavk'; end if;
  insert into public.shared_lists(owner_id, name) values (caller, btrim(list_name)) returning id into created;
  insert into shopping_private.shared_list_members values (created, caller);
  insert into public.shared_list_items(list_id, name, qty)
    select created, btrim(item.name), item.qty
    from pg_catalog.jsonb_to_recordset(initial_items) as item(name text, qty integer);
  return created;
end;
$$;
create function public.invite_to_shared_list(target uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare invite uuid;
begin
  perform 1 from public.shared_lists where id = target and owner_id = auth.uid() for update;
  if not found then raise exception 'Povabilo lahko ustvari lastnik'; end if;
  delete from shopping_private.shared_list_invites where list_id = target;
  insert into shopping_private.shared_list_invites(list_id) values (target) returning token into invite;
  return invite;
end;
$$;
create function public.join_shared_list(invitation uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  joined uuid;
begin
  if caller is null then raise exception 'Prijava je potrebna'; end if;
  delete from shopping_private.shared_list_invites
    where token = invitation and expires_at > now() returning list_id into joined;
  if joined is null then raise exception 'Povabilo je poteklo ali je že uporabljeno'; end if;
  insert into shopping_private.shared_list_members values (joined, caller) on conflict do nothing;
  return joined;
end;
$$;
revoke all on function public.create_shared_list(text,jsonb), public.invite_to_shared_list(uuid), public.join_shared_list(uuid) from public, anon;
grant execute on function public.create_shared_list(text,jsonb), public.invite_to_shared_list(uuid), public.join_shared_list(uuid) to authenticated;
