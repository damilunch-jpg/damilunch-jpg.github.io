-- Ruolo admin, sopra lo staff del Gruppo Territoriale.
-- Idempotente. Da eseguire nel SQL Editor di Supabase.
-- Un solo admin: damilunch@gmail.com. Dal frontend non si può nominare un altro admin.

-- ---------------------------------------------------------------------------
-- Ruolo
-- ---------------------------------------------------------------------------

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('registrato', 'iscritto', 'staff', 'admin'));

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------

create or replace function public.forum_e_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and blocked = false
  );
$$;

create or replace function public.forum_e_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('staff', 'admin') and blocked = false
  );
$$;

create or replace function public.forum_e_admin_id(utente uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = utente and role = 'admin'
  );
$$;

create or replace function public.forum_etichetta(utente uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case role
    when 'admin' then 'Admin'
    when 'staff' then 'Staff'
    when 'iscritto' then 'Iscritto'
    else 'Registrato'
  end
  from public.profiles
  where id = utente;
$$;

create or replace function public.forum_puo_leggere(visibilita text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.forum_bloccato() then false
    when public.forum_ruolo() = 'admin' then true
    when visibilita = 'aperta' then public.forum_ruolo() in ('registrato', 'iscritto', 'staff')
    when visibilita = 'iscritti' then public.forum_ruolo() in ('iscritto', 'staff')
    when visibilita = 'staff' then public.forum_ruolo() = 'staff'
    else false
  end;
$$;

revoke all on function public.forum_e_admin() from public, anon;
revoke all on function public.forum_e_staff() from public, anon;
revoke all on function public.forum_e_admin_id(uuid) from public, anon;
revoke all on function public.forum_etichetta(uuid) from public, anon;
revoke all on function public.forum_puo_leggere(text) from public, anon;
grant execute on function public.forum_e_admin() to authenticated;
grant execute on function public.forum_e_staff() to authenticated;
grant execute on function public.forum_e_admin_id(uuid) to authenticated;
grant execute on function public.forum_etichetta(uuid) to authenticated;
grant execute on function public.forum_puo_leggere(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Chi può modificare un profilo
-- ---------------------------------------------------------------------------

create or replace function forum_private.forum_proteggi_profilo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'id non modificabile';
  end if;

  if new.role = 'admin' and old.role is distinct from 'admin' then
    raise exception 'non si può nominare un admin da qui';
  end if;

  if new.role not in ('registrato', 'iscritto', 'staff', 'admin') then
    raise exception 'ruolo non valido';
  end if;

  if old.role = 'admin' then
    if auth.uid() is distinct from old.id then
      raise exception 'solo l''admin può modificare il proprio profilo';
    end if;
    return new;
  end if;

  if public.forum_e_admin() then
    return new;
  end if;

  if public.forum_e_staff() then
    if old.role not in ('registrato', 'iscritto') or new.role not in ('registrato', 'iscritto') then
      raise exception 'lo staff non può nominare o togliere lo staff, né agire su staff o admin';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role or new.blocked is distinct from old.blocked then
    raise exception 'solo lo staff del gruppo può cambiare ruolo o blocco';
  end if;

  return new;
end;
$$;

revoke all on function forum_private.forum_proteggi_profilo() from public, anon, authenticated;
grant execute on function forum_private.forum_proteggi_profilo() to service_role;

-- ---------------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------------

drop policy if exists profiles_staff_aggiorna on public.profiles;
create policy profiles_staff_aggiorna on public.profiles
  for update to authenticated
  using (
    (public.forum_e_admin() and (id = auth.uid() or role <> 'admin'))
    or (
      public.forum_e_staff()
      and not public.forum_e_admin()
      and role in ('registrato', 'iscritto')
    )
  )
  with check (
    (
      public.forum_e_admin()
      and (
        (id = auth.uid() and role in ('registrato', 'iscritto', 'staff', 'admin'))
        or (id <> auth.uid() and role in ('registrato', 'iscritto', 'staff'))
      )
    )
    or (
      public.forum_e_staff()
      and not public.forum_e_admin()
      and role in ('registrato', 'iscritto')
    )
  );

drop policy if exists threads_staff_cancella on public.threads;
create policy threads_staff_cancella on public.threads
  for delete to authenticated
  using (
    public.forum_e_admin()
    or (
      public.forum_e_staff()
      and not public.forum_e_admin_id(author_id)
      and not exists (
        select 1 from public.posts p
        where p.thread_id = threads.id
          and public.forum_e_admin_id(p.author_id)
      )
    )
  );

drop policy if exists posts_staff_cancella on public.posts;
create policy posts_staff_cancella on public.posts
  for delete to authenticated
  using (
    public.forum_e_admin()
    or (
      public.forum_e_staff()
      and not public.forum_e_admin_id(author_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Promozione dell'unico admin
-- ---------------------------------------------------------------------------

do $$
begin
  alter table public.profiles disable trigger forum_proteggi_profilo;
  update public.profiles
  set role = 'staff'
  where role = 'admin' and lower(email) <> 'damilunch@gmail.com';
  update public.profiles
  set role = 'admin'
  where lower(email) = 'damilunch@gmail.com';
  if not found then
    raise exception 'profilo damilunch@gmail.com non trovato';
  end if;
  alter table public.profiles enable trigger forum_proteggi_profilo;
exception
  when others then
    alter table public.profiles enable trigger forum_proteggi_profilo;
    raise;
end $$;
