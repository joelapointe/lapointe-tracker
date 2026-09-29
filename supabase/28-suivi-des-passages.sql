-- =====================================================================
-- DEMANDE 4 DE JOÉ (29 SEPTEMBRE 2026) — SUIVI DES PASSAGES : les dates ajoutées À LA MAIN et le RYTHME de chaque service
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 23 (la table types_service) et les fichiers précédents. Ne modifie AUCUNE donnée existante et AUCUNE règle d'accès existante :
-- elle ajoute une colonne (vide au départ) et une nouvelle table (vide au départ). Peut être exécuté plusieurs fois sans problème (les dates déjà notées
-- ne sont jamais effacées ; les règles sont remises à l'identique).
--
-- POURQUOI : Joé tient aujourd'hui un tableau imprimé (« Suivi des passages par client », les dates écrites au stylo). Le nouvel onglet « Suivi » du panneau
-- d'administration le remplace : les dates viennent toutes seules des « Complété » du camion (table passe_arrets, déjà là). Il reste deux besoins :
--   (1) noter un passage À LA MAIN (le travail fait hors de l'application, ou oublié) ;
--   (2) savoir « quel client doit être fait » : pour cela chaque service a un RYTHME (« tous les 7 jours »).
--
-- CE QUE FAIT CE FICHIER :
--   • crée la table passages_manuels : un passage noté à la main = un client (stop_id : la ligne du client pour CE service), un jour, une note facultative (200 caractères),
--     qui l'a noté et quand. UN SEUL par client et par jour. Lisible et modifiable par l'ADMINISTRATEUR seulement (le Suivi est un écran d'administrateur ;
--     un employé n'y a aucun accès). Un client qui a des dates notées à la main ne peut plus être supprimé (il est ARCHIVÉ, comme un client qui a des passes).
--   • ajoute types_service.frequence_jours : le rythme du service, de 1 à 365 jours, VIDE tant qu'il n'est pas choisi (le Suivi n'indique alors pas « à faire »).
--   • AUCUNE fonction serveur : l'administrateur écrit directement (règles d'accès), comme pour les véhicules et les types de service.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run (ou : Claude l'exécute lui-même avec l'accord de Joé). Le résultat « verification » du bas
-- est à contrôler.
-- =====================================================================

do $$
begin
  if to_regclass('public.types_service') is null then
    raise exception 'la table types_service n''existe pas : le fichier 23 n''a pas été exécuté. Rien n''a été modifié.';
  end if;
  if to_regclass('public.stops') is null or to_regclass('public.utilisateurs') is null then
    raise exception 'les tables stops et utilisateurs n''existent pas : les fichiers précédents n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_admin()') is null then
    raise exception 'la fonction est_admin() (fichier 03) n''existe pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

-- Le rythme d'un service (types_service.frequence_jours)
alter table public.types_service add column if not exists frequence_jours smallint;

alter table public.types_service drop constraint if exists types_service_frequence_plage;
alter table public.types_service add constraint types_service_frequence_plage
  check (frequence_jours is null or frequence_jours between 1 and 365);

comment on column public.types_service.frequence_jours is
  'Le rythme de ce service, en jours (« tous les 7 jours »), de 1 à 365. VIDE = pas de rythme : le Suivi (panneau administrateur) n''indique alors pas « à faire ». Choisi par l''administrateur dans l''onglet Suivi.';

-- Les passages notés à la main
create table if not exists public.passages_manuels (
  id         uuid primary key default gen_random_uuid(),
  stop_id    uuid not null references public.stops(id),
  jour       date not null,
  note       text,
  ajoute_par uuid default auth.uid() references public.utilisateurs(id),
  ajoute_le  timestamptz not null default now(),
  constraint passages_manuels_un_par_jour unique (stop_id, jour),
  constraint passages_manuels_jour_plausible check (jour between date '2000-01-01' and date '2100-12-31'),
  constraint passages_manuels_note_courte check (note is null or char_length(note) <= 200)
);

comment on table public.passages_manuels is
  'Les passages notés À LA MAIN par l''administrateur (onglet Suivi) : le travail fait hors de l''application ou oublié. Un client (stop_id) et un jour ; un seul par client et par jour. Les passages faits avec l''application sont dans passe_arrets (le Suivi montre les deux ensemble).';

alter table public.passages_manuels enable row level security;

revoke all on public.passages_manuels from public, anon, authenticated;
grant select, insert, update, delete on public.passages_manuels to authenticated;

drop policy if exists passages_manuels_admin on public.passages_manuels;
create policy passages_manuels_admin on public.passages_manuels for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à contrôler.
-- =====================================================================
select jsonb_build_object(
  'colonne_rythme', (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'types_service' and column_name = 'frequence_jours'),
  'regle_du_rythme', exists (select 1 from pg_constraint where conname = 'types_service_frequence_plage' and conrelid = 'public.types_service'::regclass),
  'rythmes_deja_choisis', (select count(*) from public.types_service where frequence_jours is not null),
  'table_existe', to_regclass('public.passages_manuels') is not null,
  'regles_actives', (select relrowsecurity from pg_class where oid = 'public.passages_manuels'::regclass),
  'regles', (select coalesce(jsonb_agg(policyname || ' (' || cmd || ')' order by policyname), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename = 'passages_manuels'),
  'visiteur_peut_lire', has_table_privilege('anon', 'public.passages_manuels', 'select'),
  'passages_notes_a_la_main', (select count(*) from public.passages_manuels)
) as verification;
