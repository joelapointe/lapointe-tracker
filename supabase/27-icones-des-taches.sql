-- =====================================================================
-- DEMANDE 2 DE JOÉ (29 SEPTEMBRE 2026) — UNE ICÔNE PAR TYPE DE SERVICE (le camion sur la carte montre l'icône de sa TÂCHE)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 23 (la table types_service ; et les fichiers 24 à 26 s'ils ne l'ont pas encore été). Ne modifie AUCUNE donnée
-- existante : elle ajoute seulement une colonne, vide au départ. Peut être exécuté plusieurs fois sans problème (une icône déjà choisie n'est jamais effacée).
--
-- POURQUOI : sur la carte, chaque camion portait le même petit tracteur. Joé veut une icône qui dépend de la TÂCHE (coupe de gazon : tondeuse ;
-- déneigement : tracteur ; épandage de sel : camion ; feuilles : feuille d'érable…), choisie par l'administrateur dans une banque d'icônes (onglet
-- « Services » du panneau d'administration). La banque elle-même est dans l'application (www/js/icones-taches.js) : la base ne garde que la CLÉ
-- de l'icône choisie pour chaque type de service.
--
-- CE QUE FAIT CE FICHIER :
--   • ajoute types_service.icone : la clé de l'icône choisie (« tracteur », « zero-turn », « feuille-erable »…), VIDE tant que rien n'est choisi
--     (l'application déduit alors l'icône du NOM du type de service : « gazon » → zéro-turn, « sel » → camion…) ;
--   • une règle de forme : lettres minuscules sans accent, chiffres et tirets, de 1 à 30 caractères (une clé bizarre est refusée par la base) ;
--   • AUCUN changement des règles d'accès : l'administrateur écrit déjà dans types_service (règle types_service_admin), tout employé actif lit les
--     types ACTIFS (règle types_service_lecture) — donc aussi cette colonne. Aucune fonction serveur.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regclass('public.types_service') is null then
    raise exception 'la table types_service n''existe pas : le fichier 23 n''a pas été exécuté. Rien n''a été modifié.';
  end if;
end $$;

begin;

alter table public.types_service add column if not exists icone text;

alter table public.types_service drop constraint if exists types_service_icone_format;
alter table public.types_service add constraint types_service_icone_format
  check (icone is null or icone ~ '^[a-z0-9-]{1,30}$');

comment on column public.types_service.icone is
  'La clé de l''icône (banque d''icônes de l''application, www/js/icones-taches.js) montrée sur la carte pour un camion qui fait ce type de service. VIDE = l''application déduit l''icône du nom du type. Choisie par l''administrateur (onglet Services).';

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'colonne_existe', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'types_service' and column_name = 'icone'),
  'type_de_la_colonne', (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'types_service' and column_name = 'icone'),
  'regle_de_forme', exists (select 1 from pg_constraint where conname = 'types_service_icone_format' and conrelid = 'public.types_service'::regclass),
  'regles_d_acces', (select coalesce(jsonb_agg(policyname || ' (' || cmd || ')' order by policyname), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename = 'types_service'),
  'nombre_types', (select count(*) from public.types_service),
  'icones_deja_choisies', (select count(*) from public.types_service where icone is not null)
) as verification;
