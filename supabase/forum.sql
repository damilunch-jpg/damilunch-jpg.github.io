-- Forum del Gruppo Territoriale Lepini Ausoni.
-- Da eseguire nel SQL Editor di Supabase (piano free). Non usa la service_role nel sito.
-- Ruoli: registrato (chi si iscrive), iscritto (iscritto M5S, approvato dallo staff),
-- staff (staff del gruppo territoriale: iniziative, organizzazione e moderazione).
-- Sezioni: Sezione aperta, Area iscritti M5S, Area staff.

-- Primo staff, dopo che Damiano ha confermato l'email:
--   update public.profiles set role = 'staff' where email = 'EMAIL_DI_DAMIANO';

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tabelle
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null default 'registrato' check (role in ('registrato', 'iscritto', 'staff')),
  blocked boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.sections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  nome text not null,
  descrizione text not null default '',
  visibilita text not null check (visibilita in ('aperta', 'iscritti', 'staff')),
  ordine integer not null default 0
);

create table if not exists public.threads (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  titolo text not null check (char_length(titolo) between 3 and 180),
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.threads (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  corpo text not null check (char_length(corpo) between 1 and 8000),
  created_at timestamptz not null default now()
);

create table if not exists public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  messaggio text not null default '',
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'approvata', 'rifiutata')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id)
);

create index if not exists profiles_role_idx on public.profiles (role);
create index if not exists profiles_email_idx on public.profiles (email);
create index if not exists threads_section_idx on public.threads (section_id, created_at desc);
create index if not exists posts_thread_idx on public.posts (thread_id, created_at);
create index if not exists access_requests_stato_idx on public.access_requests (stato, created_at desc);
create unique index if not exists access_requests_una_in_attesa
  on public.access_requests (user_id)
  where stato = 'in_attesa';

-- ---------------------------------------------------------------------------
-- Funzioni helper (security definer, search_path fisso)
-- ---------------------------------------------------------------------------

create or replace function public.forum_ruolo()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.forum_bloccato()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select blocked from public.profiles where id = auth.uid()), true);
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
    where id = auth.uid() and role = 'staff' and blocked = false
  );
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
    when visibilita = 'aperta' then public.forum_ruolo() in ('registrato', 'iscritto', 'staff')
    when visibilita = 'iscritti' then public.forum_ruolo() in ('iscritto', 'staff')
    when visibilita = 'staff' then public.forum_ruolo() = 'staff'
    else false
  end;
$$;

create or replace function public.forum_puo_scrivere(visibilita text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.forum_puo_leggere(visibilita);
$$;

create or replace function public.forum_nome(utente uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select display_name from public.profiles where id = utente;
$$;

create or replace function public.forum_visibilita_thread(discussione uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.visibilita
  from public.threads t
  join public.sections s on s.id = t.section_id
  where t.id = discussione;
$$;

revoke all on function public.forum_ruolo() from public, anon;
revoke all on function public.forum_bloccato() from public, anon;
revoke all on function public.forum_e_staff() from public, anon;
revoke all on function public.forum_puo_leggere(text) from public, anon;
revoke all on function public.forum_puo_scrivere(text) from public, anon;
revoke all on function public.forum_nome(uuid) from public, anon;
revoke all on function public.forum_visibilita_thread(uuid) from public, anon;
grant execute on function public.forum_ruolo() to authenticated;
grant execute on function public.forum_bloccato() to authenticated;
grant execute on function public.forum_e_staff() to authenticated;
grant execute on function public.forum_puo_leggere(text) to authenticated;
grant execute on function public.forum_puo_scrivere(text) to authenticated;
grant execute on function public.forum_nome(uuid) to authenticated;
grant execute on function public.forum_visibilita_thread(uuid) to authenticated;

-- I trigger non stanno in public: anon e authenticated non possono eseguirli.
create schema if not exists forum_private;

create or replace function forum_private.forum_nuovo_utente()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role, blocked)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(coalesce(new.email, 'utente'), '@', 1)),
    'registrato',
    false
  );
  return new;
end;
$$;

create or replace function forum_private.forum_proteggi_profilo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role or new.blocked is distinct from old.blocked or new.id is distinct from old.id then
    if not public.forum_e_staff() then
      raise exception 'solo lo staff del gruppo può cambiare ruolo o blocco';
    end if;
  end if;
  if new.role not in ('registrato', 'iscritto', 'staff') then
    raise exception 'ruolo non valido';
  end if;
  return new;
end;
$$;

revoke all on function forum_private.forum_nuovo_utente() from public, anon, authenticated;
revoke all on function forum_private.forum_proteggi_profilo() from public, anon, authenticated;
grant execute on function forum_private.forum_nuovo_utente() to service_role;
grant execute on function forum_private.forum_proteggi_profilo() to service_role;

drop trigger if exists forum_nuovo_utente on auth.users;
drop trigger if exists forum_proteggi_profilo on public.profiles;
drop function if exists public.forum_nuovo_utente();
drop function if exists public.forum_proteggi_profilo();

create trigger forum_nuovo_utente
  after insert on auth.users
  for each row execute function forum_private.forum_nuovo_utente();

create trigger forum_proteggi_profilo
  before update on public.profiles
  for each row execute function forum_private.forum_proteggi_profilo();

-- Approva o rifiuta una richiesta e, se approvata, promuove a iscritto.
create or replace function public.forum_decidi_richiesta(richiesta uuid, approva boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  destinatario uuid;
begin
  if not public.forum_e_staff() then
    raise exception 'solo lo staff può decidere le richieste';
  end if;
  select user_id into destinatario
  from public.access_requests
  where id = richiesta and stato = 'in_attesa';
  if destinatario is null then
    raise exception 'richiesta non trovata o già decisa';
  end if;
  update public.access_requests
  set stato = case when approva then 'approvata' else 'rifiutata' end,
      decided_at = now(),
      decided_by = auth.uid()
  where id = richiesta;
  if approva then
    update public.profiles
    set role = 'iscritto'
    where id = destinatario and role = 'registrato';
  end if;
end;
$$;

revoke all on function public.forum_decidi_richiesta(uuid, boolean) from public, anon;
grant execute on function public.forum_decidi_richiesta(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.sections enable row level security;
alter table public.threads enable row level security;
alter table public.posts enable row level security;
alter table public.access_requests enable row level security;

revoke all on public.profiles from anon, public;
revoke all on public.sections from anon, public;
revoke all on public.threads from anon, public;
revoke all on public.posts from anon, public;
revoke all on public.access_requests from anon, public;

grant select, update on public.profiles to authenticated;
grant select on public.sections to authenticated;
grant select, insert, delete on public.threads to authenticated;
grant select, insert, delete on public.posts to authenticated;
grant select, insert, update on public.access_requests to authenticated;

drop policy if exists profiles_leggi on public.profiles;
create policy profiles_leggi on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.forum_e_staff());

drop policy if exists profiles_staff_aggiorna on public.profiles;
create policy profiles_staff_aggiorna on public.profiles
  for update to authenticated
  using (public.forum_e_staff())
  with check (public.forum_e_staff());

drop policy if exists sections_leggi on public.sections;
create policy sections_leggi on public.sections
  for select to authenticated
  using (public.forum_puo_leggere(visibilita));

drop policy if exists threads_leggi on public.threads;
create policy threads_leggi on public.threads
  for select to authenticated
  using (
    exists (
      select 1 from public.sections s
      where s.id = threads.section_id
        and public.forum_puo_leggere(s.visibilita)
    )
  );

drop policy if exists threads_crea on public.threads;
create policy threads_crea on public.threads
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.sections s
      where s.id = section_id
        and public.forum_puo_scrivere(s.visibilita)
    )
  );

drop policy if exists threads_staff_cancella on public.threads;
create policy threads_staff_cancella on public.threads
  for delete to authenticated
  using (public.forum_e_staff());

drop policy if exists posts_leggi on public.posts;
create policy posts_leggi on public.posts
  for select to authenticated
  using (public.forum_puo_leggere(public.forum_visibilita_thread(thread_id)));

drop policy if exists posts_crea on public.posts;
create policy posts_crea on public.posts
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.forum_puo_scrivere(public.forum_visibilita_thread(thread_id))
  );

drop policy if exists posts_staff_cancella on public.posts;
create policy posts_staff_cancella on public.posts
  for delete to authenticated
  using (public.forum_e_staff());

drop policy if exists richieste_leggi on public.access_requests;
create policy richieste_leggi on public.access_requests
  for select to authenticated
  using (user_id = auth.uid() or public.forum_e_staff());

drop policy if exists richieste_crea on public.access_requests;
create policy richieste_crea on public.access_requests
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and stato = 'in_attesa'
    and public.forum_ruolo() = 'registrato'
    and public.forum_bloccato() = false
  );

drop policy if exists richieste_staff_aggiorna on public.access_requests;
create policy richieste_staff_aggiorna on public.access_requests
  for update to authenticated
  using (public.forum_e_staff())
  with check (public.forum_e_staff());

-- ---------------------------------------------------------------------------
-- Sezioni
-- ---------------------------------------------------------------------------

insert into public.sections (id, slug, nome, descrizione, visibilita, ordine)
values
  (
    '11111111-1111-4111-8111-111111111101',
    'aperta',
    'Sezione aperta',
    'Discussioni visibili a chiunque abbia un account.',
    'aperta',
    1
  ),
  (
    '11111111-1111-4111-8111-111111111102',
    'iscritti',
    'Area iscritti M5S',
    'Solo per gli iscritti al Movimento approvati dallo staff e per lo staff del gruppo.',
    'iscritti',
    2
  ),
  (
    '11111111-1111-4111-8111-111111111103',
    'staff',
    'Area staff',
    'Iniziative e organizzazione dello staff del Gruppo Territoriale Lepini Ausoni. Solo lo staff può leggere e scrivere.',
    'staff',
    3
  )
on conflict (slug) do update
set nome = excluded.nome,
    descrizione = excluded.descrizione,
    visibilita = excluded.visibilita,
    ordine = excluded.ordine;
