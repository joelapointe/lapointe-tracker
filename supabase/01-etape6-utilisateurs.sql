-- =====================================================================
-- ÉTAPE 6 — Table « utilisateurs » refaite + fonctions de rôle
-- =====================================================================
-- CE QUE ÇA FAIT
--   1. Supprime les anciennes tables positions, problemes et utilisateurs
--      (données de TEST seulement : 2 positions, 2 problèmes, 2 utilisateurs).
--      Les tables stops, routes, equipes et zones ne sont PAS touchées.
--   2. Recrée « utilisateurs » comme un profil lié à un compte Supabase Auth
--      (plus de colonne « pin » : le NIP devient le mot de passe Supabase Auth,
--      stocké chiffré, jamais lisible).
--   3. Crée automatiquement le profil quand un compte est créé dans Auth.
--      Le rôle (admin/employé) vient d'une donnée que SEUL le serveur peut écrire.
--   4. Crée les fonctions est_admin() et est_actif(), utilisées par les
--      règles d'accès de l'étape 8.
--
-- CONSÉQUENCE : l'ancienne app (connexion par NIP) ne fonctionnera plus.
--   C'est voulu : elle est remplacée aux étapes 12 et 13.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

begin;

-- 1. Ancien système de comptes (données de test)
drop table if exists public.positions;
drop table if exists public.problemes;
drop table if exists public.utilisateurs;

-- 2. Nouveau profil, lié à Supabase Auth
create table public.utilisateurs (
  id         uuid primary key references auth.users(id) on delete cascade,
  nom        text not null check (length(trim(nom)) > 0),
  telephone  text unique check (telephone ~ '^[0-9]{10}$'),
  role       text not null default 'employe' check (role in ('admin', 'employe')),
  actif      boolean not null default true,
  cree_le    timestamptz not null default now(),
  constraint employe_a_un_telephone check (role = 'admin' or telephone is not null)
);

comment on table public.utilisateurs is
  'Profil de chaque compte Supabase Auth. actif = false désactive un employé sans effacer son historique.';

-- Verrouillée dès la création : aucune règle d'accès = personne (sauf le serveur)
-- n'y touche, en attendant l'étape 8.
alter table public.utilisateurs enable row level security;
revoke all on public.utilisateurs from anon, authenticated;

-- 3. Création automatique du profil quand un compte Auth est créé.
--    On lit raw_app_meta_data (écrit seulement par le serveur), jamais
--    raw_user_meta_data (modifiable par l'utilisateur lui-même).
create or replace function public.creer_profil_depuis_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.utilisateurs (id, nom, telephone, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_app_meta_data ->> 'nom'), ''), split_part(coalesce(new.email, 'inconnu'), '@', 1)),
    nullif(new.raw_app_meta_data ->> 'telephone', ''),
    coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'employe')
  );
  return new;
end;
$$;

drop trigger if exists apres_creation_utilisateur_auth on auth.users;
create trigger apres_creation_utilisateur_auth
  after insert on auth.users
  for each row execute function public.creer_profil_depuis_auth();

-- 4. Fonctions de rôle (utilisées par les règles d'accès)
create or replace function public.est_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.role = 'admin' and u.actif from public.utilisateurs u where u.id = (select auth.uid())),
    false);
$$;

create or replace function public.est_actif()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select u.actif from public.utilisateurs u where u.id = (select auth.uid())),
    false);
$$;

revoke all on function public.est_admin() from public, anon;
revoke all on function public.est_actif() from public, anon;
grant execute on function public.est_admin() to authenticated;
grant execute on function public.est_actif() to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'colonnes_utilisateurs', (select jsonb_agg(column_name order by ordinal_position)
                             from information_schema.columns
                             where table_schema = 'public' and table_name = 'utilisateurs'),
  'rls_active', (select relrowsecurity from pg_class where oid = 'public.utilisateurs'::regclass),
  'declencheur_auth', (select count(*) from pg_trigger where tgname = 'apres_creation_utilisateur_auth' and not tgisinternal),
  'fonctions', (select jsonb_agg(proname order by proname) from pg_proc where pronamespace = 'public'::regnamespace),
  'tables_public', (select jsonb_agg(relname order by relname) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'),
  'pg_cron_installe', exists (select 1 from pg_extension where extname = 'pg_cron')
) as verification;
