-- =====================================================================
-- ÉTAPE 15a — L'ÉQUIPAGE PRÉCÉDENT DU CHAUFFEUR (décision de Joé, 20 septembre 2026 : « l'équipage précédent = les personnes
-- qui étaient à bord avec MOI à ma dernière passe »)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 16. Ne modifie AUCUNE donnée : il ajoute seulement une fonction de LECTURE.
-- Peut être exécuté plusieurs fois sans problème.
--
-- POURQUOI : un chauffeur ne peut pas lire l'équipage de sa passe terminée (les règles d'accès ne montrent aux employés que les
-- personnes à bord MAINTENANT et leurs propres périodes). Sans cette fonction, l'écran « Débuter la passe » ne pourrait pas
-- afficher les noms de l'équipage précédent en gros pour que le chauffeur les confirme (jamais pré-cochés en silence).
--
-- CE QUE FAIT equipage_precedent()  (pour la personne connectée, jamais pour quelqu'un d'autre)
--   • prend SA dernière passe TERMINÉE comme chauffeur (la plus récente) ;
--   • renvoie les personnes qui étaient à bord (passagers) à la FIN de cette passe — celles qui étaient déjà descendues avant
--     (retirées, transférées ailleurs, quart terminé) n'y sont pas ;
--   • jamais elle-même, jamais un employé désactivé ; en ordre alphabétique ;
--   • si elle n'a encore aucune passe terminée : aucun nom.
--   Forme de la réponse : { "passe_id": …, "fin": …, "membres": [ { "utilisateur_id": …, "nom": … }, … ] }
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regprocedure('public._exiger_actif()') is null or to_regclass('public.equipage_periodes') is null then
    raise exception 'les fichiers précédents (équipage, étape 9a) n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
end $$;

begin;

create or replace function public.equipage_precedent()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_p   public.passes%rowtype;
begin
  v_uid := public._exiger_actif();

  select * into v_p from public.passes p
   where p.chauffeur_id = v_uid and p.statut = 'terminee'
   order by p.debut desc, p.id
   limit 1;
  if not found then
    return jsonb_build_object('passe_id', null, 'fin', null, 'membres', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'passe_id', v_p.id,
    'fin',      v_p.fin,
    'membres',  coalesce((
      select jsonb_agg(jsonb_build_object('utilisateur_id', u.id, 'nom', u.nom) order by u.nom, u.id)
        from (select distinct e.utilisateur_id
                from public.equipage_periodes e
               where e.passe_id = v_p.id
                 and e.role = 'passager'
                 and (e.fin is null or e.fin >= v_p.fin)) x          -- encore à bord quand la passe s'est terminée
        join public.utilisateurs u on u.id = x.utilisateur_id and u.actif and u.id <> v_uid
    ), '[]'::jsonb));
end;
$$;

revoke all on function public.equipage_precedent() from public, anon;
grant execute on function public.equipage_precedent() to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'equipage_precedent_versions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'equipage_precedent'),
  'visiteur_peut_appeler', has_function_privilege('anon', 'public.equipage_precedent()', 'execute'),
  'employe_peut_appeler',  has_function_privilege('authenticated', 'public.equipage_precedent()', 'execute'),
  'fonction_verrouillee_search_path', (select coalesce(bool_and(proconfig::text like '%search_path%'), false) from pg_proc
                                        where pronamespace = 'public'::regnamespace and proname = 'equipage_precedent'),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'passes_existantes', (select count(*) from public.passes)
) as verification;
