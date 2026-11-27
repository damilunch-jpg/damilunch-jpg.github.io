-- Macroaree del forum, dentro ogni sezione.
-- Idempotente. Da eseguire nel SQL Editor di Supabase.
-- Le policy riusano l'accesso della sezione (forum_puo_leggere).
-- Nessuna funzione è eseguibile da anon.

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.sections (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nome text not null check (char_length(nome) between 2 and 80),
  descrizione text not null default '' check (char_length(descrizione) <= 240),
  ordine integer not null default 0,
  created_at timestamptz not null default now(),
  unique (section_id, slug)
);

alter table public.threads add column if not exists category_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'threads_category_id_fkey'
  ) then
    alter table public.threads
      add constraint threads_category_id_fkey
      foreign key (category_id) references public.categories (id) on delete restrict;
  end if;
end $$;

create index if not exists categories_section_idx on public.categories (section_id, ordine, nome);
create index if not exists threads_category_idx on public.threads (category_id, created_at desc);

insert into public.categories (section_id, slug, nome, descrizione, ordine)
select s.id, 'generale', 'Generale', 'Discussioni generali di questa sezione.', 1
from public.sections s
where not exists (
  select 1 from public.categories c
  where c.section_id = s.id and c.slug = 'generale'
);

update public.threads t
set category_id = c.id
from public.categories c
where t.category_id is null
  and c.section_id = t.section_id
  and c.slug = 'generale';

do $$
begin
  if exists (select 1 from public.threads where category_id is null) then
    raise exception 'restano discussioni senza macroarea';
  end if;
  alter table public.threads alter column category_id set not null;
end $$;

revoke all on public.categories from anon, public;
grant select, insert, update, delete on public.categories to authenticated;

alter table public.categories enable row level security;

drop policy if exists categories_leggi on public.categories;
create policy categories_leggi on public.categories
  for select to authenticated
  using (
    exists (
      select 1 from public.sections s
      where s.id = categories.section_id
        and public.forum_puo_leggere(s.visibilita)
    )
  );

drop policy if exists categories_staff_crea on public.categories;
create policy categories_staff_crea on public.categories
  for insert to authenticated
  with check (
    public.forum_e_staff()
    and exists (
      select 1 from public.sections s
      where s.id = section_id
        and public.forum_puo_leggere(s.visibilita)
    )
  );

drop policy if exists categories_staff_aggiorna on public.categories;
create policy categories_staff_aggiorna on public.categories
  for update to authenticated
  using (
    public.forum_e_staff()
    and exists (
      select 1 from public.sections s
      where s.id = categories.section_id
        and public.forum_puo_leggere(s.visibilita)
    )
  )
  with check (
    public.forum_e_staff()
    and exists (
      select 1 from public.sections s
      where s.id = section_id
        and public.forum_puo_leggere(s.visibilita)
    )
  );

drop policy if exists categories_staff_cancella on public.categories;
create policy categories_staff_cancella on public.categories
  for delete to authenticated
  using (
    public.forum_e_staff()
    and exists (
      select 1 from public.sections s
      where s.id = categories.section_id
        and public.forum_puo_leggere(s.visibilita)
    )
  );

drop policy if exists threads_crea on public.threads;
create policy threads_crea on public.threads
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.categories c
      join public.sections s on s.id = c.section_id
      where c.id = category_id
        and c.section_id = threads.section_id
        and public.forum_puo_scrivere(s.visibilita)
    )
  );

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

revoke all on function public.forum_etichetta(uuid) from public, anon;
grant execute on function public.forum_etichetta(uuid) to authenticated;
