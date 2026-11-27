-- Iscrizioni alla newsletter settimanale.
-- Idempotente. Da eseguire nel SQL Editor di Supabase.
-- Non usa la service_role. L'anonimo può iscriversi e disiscriversi, non leggere l'elenco.
-- Un indirizzo già presente non viene segnalato: newsletter_iscrivi termina senza errore.
-- L'invio non è in questo file: la chiave per leggere i destinatari sta in forum_private.

create schema if not exists forum_private;

create table if not exists public.newsletter_iscritti (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  consenso_gdpr boolean not null,
  creato_il timestamptz not null default now(),
  revocato_il timestamptz,
  origine text not null default 'sito',
  token_disiscrizione uuid not null default gen_random_uuid(),
  constraint newsletter_iscritti_consenso_check check (consenso_gdpr),
  constraint newsletter_iscritti_email_check check (
    email = lower(email)
    and char_length(email) between 6 and 320
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint newsletter_iscritti_origine_check check (origine in ('sito', 'lista_iniziale'))
);

alter table public.newsletter_iscritti add column if not exists origine text not null default 'sito';
alter table public.newsletter_iscritti add column if not exists token_disiscrizione uuid default gen_random_uuid();
update public.newsletter_iscritti
set token_disiscrizione = gen_random_uuid()
where token_disiscrizione is null;
alter table public.newsletter_iscritti alter column token_disiscrizione set not null;
alter table public.newsletter_iscritti alter column token_disiscrizione set default gen_random_uuid();

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'newsletter_iscritti_origine_check'
  ) then
    alter table public.newsletter_iscritti
      add constraint newsletter_iscritti_origine_check
      check (origine in ('sito', 'lista_iniziale'));
  end if;
end $$;

create unique index if not exists newsletter_iscritti_email_idx
  on public.newsletter_iscritti (lower(email));
create unique index if not exists newsletter_iscritti_token_idx
  on public.newsletter_iscritti (token_disiscrizione);

alter table public.newsletter_iscritti enable row level security;

revoke all on public.newsletter_iscritti from public, anon, authenticated;
grant insert on public.newsletter_iscritti to anon, authenticated;
grant select, delete on public.newsletter_iscritti to authenticated;

drop policy if exists newsletter_inserisci on public.newsletter_iscritti;
create policy newsletter_inserisci on public.newsletter_iscritti
  for insert to anon, authenticated
  with check (
    consenso_gdpr = true
    and origine = 'sito'
    and email = lower(email)
    and char_length(email) between 6 and 320
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

drop policy if exists newsletter_admin_leggi on public.newsletter_iscritti;
create policy newsletter_admin_leggi on public.newsletter_iscritti
  for select to authenticated
  using (public.forum_e_admin());

drop policy if exists newsletter_admin_cancella on public.newsletter_iscritti;
create policy newsletter_admin_cancella on public.newsletter_iscritti
  for delete to authenticated
  using (public.forum_e_admin());

create or replace function public.newsletter_iscrivi(indirizzo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  pulita text;
begin
  pulita := lower(btrim(coalesce(indirizzo, '')));
  if char_length(pulita) < 6
     or char_length(pulita) > 320
     or pulita !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'email non valida' using errcode = '22023';
  end if;
  insert into public.newsletter_iscritti (email, consenso_gdpr, origine)
  values (pulita, true, 'sito')
  on conflict do nothing;
end;
$$;

-- Sempre vuota di informazioni: un token sconosciuto o già usato non produce un errore.
create or replace function public.newsletter_disiscrivi(token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if token is null or token !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return;
  end if;
  update public.newsletter_iscritti
  set revocato_il = now()
  where token_disiscrizione = token::uuid
    and revocato_il is null;
end;
$$;

-- Hash della chiave di lettura. Non è esposto dall'API.
-- Il valore iniziale non corrisponde a nessuna chiave: va sostituito prima di usare newsletter_destinatari.
-- Genera chiave e hash, poi aggiorna solo l'hash (la chiave in chiaro resta fuori dal database):
--   python3 -c "import hashlib,secrets; k=secrets.token_urlsafe(32); print('CHIAVE '+k); print('HASH '+hashlib.sha256(k.encode()).hexdigest())"
--   update forum_private.newsletter_chiave set hash_sha256 = 'HASH_HEX' where id = 1;
create table if not exists forum_private.newsletter_chiave (
  id integer primary key check (id = 1),
  hash_sha256 text not null check (hash_sha256 ~ '^[0-9a-f]{64}$')
);

insert into forum_private.newsletter_chiave (id, hash_sha256)
values (1, '0000000000000000000000000000000000000000000000000000000000000000')
on conflict (id) do nothing;

revoke all on forum_private.newsletter_chiave from public, anon, authenticated;
alter table forum_private.newsletter_chiave enable row level security;

create or replace function public.newsletter_destinatari(chiave text)
returns table (email text, token uuid)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  atteso text;
  calcolato text;
begin
  select c.hash_sha256 into atteso
  from forum_private.newsletter_chiave c
  where c.id = 1;
  if atteso is null or chiave is null or btrim(chiave) = '' then
    return;
  end if;
  calcolato := encode(extensions.digest(convert_to(chiave, 'UTF8'), 'sha256'), 'hex');
  if calcolato is distinct from lower(atteso) then
    return;
  end if;
  return query
  select i.email, i.token_disiscrizione
  from public.newsletter_iscritti i
  where i.revocato_il is null
  order by i.creato_il;
end;
$$;

revoke all on function public.newsletter_iscrivi(text) from public;
revoke all on function public.newsletter_disiscrivi(text) from public;
revoke all on function public.newsletter_destinatari(text) from public;
grant execute on function public.newsletter_iscrivi(text) to anon, authenticated;
grant execute on function public.newsletter_disiscrivi(text) to anon, authenticated;
grant execute on function public.newsletter_destinatari(text) to anon, authenticated;
