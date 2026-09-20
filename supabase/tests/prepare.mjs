import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/ (chemin relatif : fonctionne depuis n'importe où)
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'fs';

const dir = SQL_DIR;

// Reproduit ton schéma d'avant l'étape 6 (d'après l'inventaire), puis exécute les étapes demandées.
export async function prepare(fichiers) {
  const db = new PGlite({ extensions: { btree_gist } });
  await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, extensions, public to anon, authenticated;

-- Le stockage de fichiers de Supabase (Storage), imité : mêmes tables, même fonction, mêmes droits (les règles d'accès filtrent)
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text,
  owner uuid, created_at timestamptz default now(), metadata jsonb, unique (bucket_id, name));
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language plpgsql as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;

create table public.equipes (id uuid primary key default gen_random_uuid(), nom text not null, operateur text, couleur text default '#c8e63c', created_at timestamp default now());
create table public.zones   (id uuid primary key default gen_random_uuid(), nom text not null, equipe_id uuid references public.equipes(id), created_at timestamp default now());
create table public.routes  (id uuid primary key default gen_random_uuid(), nom text not null, couleur text default '#c8e63c', created_at timestamp default now());
create table public.stops   (id uuid primary key default gen_random_uuid(), adresse text not null, client text, service text default 'Déneigement mécanique',
  lat double precision, lon double precision, fait boolean default false, ordre integer default 0,
  equipe_id uuid references public.equipes(id), zone_id uuid references public.zones(id), created_at timestamp default now(),
  route_nom text, route_id uuid references public.routes(id), zone_points jsonb);
create table public.utilisateurs (id uuid primary key default gen_random_uuid(), nom text not null, telephone text not null unique, pin text not null,
  role text default 'employe' check (role in ('admin','employe')), created_at timestamp default now(), approuve boolean default false);
create table public.positions (id uuid primary key default gen_random_uuid(), utilisateur_id uuid references public.utilisateurs(id) on delete cascade, nom text, lat float8, lon float8, updated_at timestamp default now());
create unique index positions_user_idx on public.positions(utilisateur_id);
create table public.problemes (id uuid primary key default gen_random_uuid(), stop_id uuid references public.stops(id) on delete cascade, utilisateur_id uuid references public.utilisateurs(id), note text, lu boolean default false, created_at timestamp default now());
-- comme chez toi : politique « Accès public » (ALL, rôle public) sur chaque table + tous les droits
alter table public.equipes enable row level security; alter table public.zones enable row level security; alter table public.routes enable row level security;
alter table public.stops enable row level security; alter table public.utilisateurs enable row level security; alter table public.positions enable row level security; alter table public.problemes enable row level security;
create policy "Accès public equipes" on public.equipes for all to public using (true) with check (true);
create policy "Accès public zones" on public.zones for all to public using (true) with check (true);
create policy "Accès public routes" on public.routes for all to public using (true) with check (true);
create policy "Accès public stops" on public.stops for all to public using (true) with check (true);
create policy "Accès public utilisateurs" on public.utilisateurs for all to public using (true) with check (true);
create policy "Accès public positions" on public.positions for all to public using (true) with check (true);
create policy "Accès public problemes" on public.problemes for all to public using (true) with check (true);
grant all on all tables in schema public to anon, authenticated;
insert into public.routes(nom) values ('Route Nord'), ('Route Sud');
insert into public.stops(adresse, route_id, fait) select 'Adresse ' || g, (select id from public.routes order by nom limit 1), (g % 3 = 0) from generate_series(1, 13) g;
insert into public.utilisateurs(nom, telephone, pin) values ('Test A','8195550001','1234'), ('Test B','8195550002','5678');
`);
  for (const f of fichiers) await db.exec(fs.readFileSync(dir + f, 'utf8'));
  return db;
}
