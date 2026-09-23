-- =====================================================================
-- ÉTAPE 19 (SUITE) — LES TYPES DE SERVICE DEVIENNENT MODIFIABLES (morceau 4 du panneau administrateur)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 22. Ne modifie AUCUNE donnée existante : elle crée seulement une nouvelle table,
-- pré-remplie avec les 8 types déjà utilisés aujourd'hui (figés dans index.html).
-- Peut être exécuté plusieurs fois sans problème (la table et son contenu ne sont jamais effacés ; les règles sont remises à l'identique).
--
-- POURQUOI : la liste des types de service (« Déneigement mécanique », « Épandage de sel »…) était une liste FIGÉE dans le code
-- de l'application (le menu déroulant « ＋ Nouveau stop »). Joé veut pouvoir l'ajuster lui-même, comme les employés et les véhicules.
--
-- CE QUE FAIT CE FICHIER :
--   • la table types_service : un type = un nom (unique) et « actif » (un type désactivé n'apparaît plus dans le menu déroulant
--     d'un NOUVEL arrêt, mais les arrêts déjà créés avec ce type ne changent pas : stops.service reste un simple texte, sans lien
--     avec cette table — comme aujourd'hui) ;
--   • pré-remplie avec les 8 types déjà utilisés (les mêmes options que le menu déroulant actuel) ;
--   • LECTURE : tout employé actif voit les types actifs (l'administrateur voit aussi les désactivés). ÉCRITURE (créer, renommer,
--     désactiver/réactiver) : l'administrateur seulement — comme les véhicules (equipes), aucune fonction serveur nécessaire.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regclass('public.stops') is null then
    raise exception 'la table stops n''existe pas : les fichiers précédents n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_actif()') is null then
    raise exception 'la fonction est_actif() (fichier 03) n''existe pas. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_admin()') is null then
    raise exception 'la fonction est_admin() (fichier 03) n''existe pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

create table if not exists public.types_service (
  id      uuid primary key default gen_random_uuid(),
  nom     text not null unique,
  actif   boolean not null default true,
  cree_le timestamptz not null default now()
);

comment on table public.types_service is
  'Les types de service proposés au menu « ＋ Nouveau stop » (étape 19) : une liste modifiable par l''administrateur. stops.service reste un simple texte, sans clé étrangère vers cette table (renommer ou désactiver un type ne change jamais les arrêts déjà créés).';

insert into public.types_service (nom) values
  ('Déneigement mécanique'),
  ('Déneigement manuel'),
  ('Épandage de sel'),
  ('Entretien paysager'),
  ('Coupe de gazon'),
  ('Engrais'),
  ('Ramassage de feuilles'),
  ('Autre')
on conflict (nom) do nothing;

alter table public.types_service enable row level security;

revoke all on public.types_service from public, anon, authenticated;
grant select, insert, update, delete on public.types_service to authenticated;

drop policy if exists types_service_lecture on public.types_service;
create policy types_service_lecture on public.types_service for select to authenticated
  using ((select public.est_actif()) and (actif or (select public.est_admin())));

drop policy if exists types_service_admin on public.types_service;
create policy types_service_admin on public.types_service for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'table_existe', to_regclass('public.types_service') is not null,
  'regles_actives', (select relrowsecurity from pg_class where oid = 'public.types_service'::regclass),
  'regles', (select coalesce(jsonb_agg(policyname || ' (' || cmd || ')' order by policyname), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename = 'types_service'),
  'visiteur_peut_lire', has_table_privilege('anon', 'public.types_service', 'select'),
  'types', (select coalesce(jsonb_agg(nom order by nom), '[]'::jsonb) from public.types_service where actif),
  'nombre_types', (select count(*) from public.types_service)
) as verification;
