begin;

create table shopping_private.receipt_usage_global (
  singleton boolean primary key default true check (singleton),
  usage_day date not null,
  calls integer not null check (calls between 0 and 120)
);

create table shopping_private.receipt_usage_by_user (
  user_id uuid primary key references auth.users(id) on delete cascade,
  usage_day date not null,
  calls integer not null check (calls between 1 and 15)
);

revoke all on shopping_private.receipt_usage_global, shopping_private.receipt_usage_by_user
  from public, anon, authenticated, service_role;

-- The global row serializes reservations, including requests sent to different Edge instances.
create function public.reserve_receipt_read(caller uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  today date := (now() at time zone 'Europe/Ljubljana')::date;
  global_calls integer;
begin
  if caller is null then return false; end if;

  insert into shopping_private.receipt_usage_global (usage_day, calls)
    values (today, 0) on conflict (singleton) do nothing;

  select case when usage_day = today then calls else 0 end into global_calls
    from shopping_private.receipt_usage_global where singleton for update;
  if global_calls >= 120 then return false; end if;

  insert into shopping_private.receipt_usage_by_user as usage (user_id, usage_day, calls)
    values (caller, today, 1)
    on conflict (user_id) do update set
      usage_day = today,
      calls = case when usage.usage_day = today then usage.calls + 1 else 1 end
    where usage.usage_day <> today or usage.calls < 15;
  if not found then return false; end if;

  update shopping_private.receipt_usage_global set usage_day = today, calls = global_calls + 1
    where singleton;
  return true;
end;
$$;
revoke all on function public.reserve_receipt_read(uuid) from public, anon, authenticated;
grant execute on function public.reserve_receipt_read(uuid) to service_role;

create function public.shared_list_members_for_owner(target uuid)
returns table (user_id uuid, email text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.shared_lists where id = target and owner_id = auth.uid()) then
    raise exception 'Dostop ima samo lastnik listka' using errcode = '42501';
  end if;
  return query
    select m.user_id, u.email::text
    from shopping_private.shared_list_members m
    join auth.users u on u.id = m.user_id
    where m.list_id = target and m.user_id <> auth.uid()
    order by u.email, m.user_id;
end;
$$;

create function public.remove_shared_list_member(target uuid, member uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
begin
  perform 1 from public.shared_lists where id = target and owner_id = auth.uid() for update;
  if not found or member is null or member = auth.uid() then
    raise exception 'Dostop lahko odvzame samo lastnik listka' using errcode = '42501';
  end if;
  delete from shopping_private.shared_list_members where list_id = target and user_id = member;
  if not found then return false; end if;
  delete from shopping_private.shared_list_invites where list_id = target;
  return true;
end;
$$;

-- Join, invite rotation and removal use the same list lock.
create or replace function public.join_shared_list(invitation uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  joined uuid;
begin
  if caller is null then raise exception 'Prijava je potrebna'; end if;
  select list_id into joined from shopping_private.shared_list_invites
    where token = invitation and expires_at > now();
  if joined is null then raise exception 'Povabilo je poteklo ali je že uporabljeno'; end if;
  perform 1 from public.shared_lists where id = joined for update;
  delete from shopping_private.shared_list_invites
    where token = invitation and list_id = joined and expires_at > now();
  if not found then raise exception 'Povabilo je poteklo ali je že uporabljeno'; end if;
  insert into shopping_private.shared_list_members values (joined, caller) on conflict do nothing;
  return joined;
end;
$$;

revoke all on function public.shared_list_members_for_owner(uuid), public.remove_shared_list_member(uuid, uuid)
  from public, anon;
grant execute on function public.shared_list_members_for_owner(uuid), public.remove_shared_list_member(uuid, uuid)
  to authenticated;

commit;
