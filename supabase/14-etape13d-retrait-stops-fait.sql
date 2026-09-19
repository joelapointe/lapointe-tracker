-- =====================================================================
-- ÉTAPE 13d — RETRAIT DE LA COLONNE stops.fait
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 13. À n'exécuter qu'UNE SEULE FOIS (il refuse de s'exécuter une 2e fois).
--
-- POURQUOI
--   Autrefois, « fait » était une case cochée sur l'arrêt lui-même (donc la même pour tous, et remise à zéro à chaque
--   « nouvelle passe »). Depuis l'étape 13, un arrêt est « fait » s'il a été complété dans le TOUR en cours
--   (table passe_arrets, fonction tours_en_cours). L'application ne lit ni n'écrit plus cette colonne (vérifié : tests
--   et essais réels des étapes 13a à 13c). Cette suppression est DÉFINITIVE : les anciennes valeurs (aucune n'avait de
--   sens pour les passes) sont perdues. Le reste des arrêts (adresse, client, service, coordonnées, route, zone, ordre,
--   actif) n'est pas touché.
--
-- PROTECTIONS (il REFUSE et ne change RIEN si) :
--   • la colonne n'existe déjà plus (fichier déjà exécuté) ;
--   • une fonction du serveur mentionne encore stops.fait (elle se casserait sans le dire) ;
--   • un déclencheur s'y rapporte ;
--   • une règle d'accès, une vue ou un index en dépend (la suppression se fait SANS « cascade » : la base refuse d'elle-même).
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
declare
  v_fonctions    text[];
  v_declencheurs text[];
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'stops' and column_name = 'fait') then
    raise exception 'ce fichier a déjà été exécuté (la colonne stops.fait n''existe plus). Rien n''a été modifié.';
  end if;

  -- Fonctions qui liraient ou écriraient la colonne (« s.fait », « set fait », « fait = »)
  select coalesce(array_agg(p.proname order by p.proname), '{}') into v_fonctions
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosrc ~ '(\.fait\M|\mset\s+fait\M|\mfait\s*=)';
  if cardinality(v_fonctions) > 0 then
    raise exception 'ces fonctions utilisent encore stops.fait : %. Rien n''a été modifié.', v_fonctions;
  end if;

  -- Déclencheurs de la table stops qui se rapportent à la colonne
  select coalesce(array_agg(t.tgname order by t.tgname), '{}') into v_declencheurs
    from pg_trigger t
   where t.tgrelid = 'public.stops'::regclass and not t.tgisinternal
     and pg_get_triggerdef(t.oid) ~ '\mfait\M';
  if cardinality(v_declencheurs) > 0 then
    raise exception 'ces déclencheurs se rapportent encore à stops.fait : %. Rien n''a été modifié.', v_declencheurs;
  end if;
end $$;

begin;

-- Pas de « cascade » : si une règle d'accès, une vue ou un index dépend de la colonne, la base REFUSE et rien ne change.
alter table public.stops drop column fait;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'colonne_fait_supprimee', not exists (select 1 from information_schema.columns
                                         where table_schema = 'public' and table_name = 'stops' and column_name = 'fait'),
  'colonnes_de_stops', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns
                         where table_schema = 'public' and table_name = 'stops'),
  'arrets', (select count(*) from public.stops),
  'arrets_actifs', (select count(*) from public.stops where actif),
  'declencheur_recalcul_arrets', (select count(*) from pg_trigger where tgname = 'stops_recalcul_passes' and not tgisinternal),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute'))
) as verification;
