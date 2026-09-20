-- =====================================================================
-- ÉTAPE 14c — LE DERNIER TOUR TERMINÉ RESTE VISIBLE (décision de Joé, 19 septembre 2026)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 14. Ce fichier ne modifie AUCUNE donnée : il remplace seulement la fonction de lecture
-- tours_en_cours(). Il peut être exécuté plusieurs fois sans problème.
--
-- CE QUE DÉCIDE JOÉ
--   • Quand une passe est complétée (100 %), la route RESTE VERTE jusqu'à ce qu'une nouvelle passe débute
--     sur la même route et la même tâche (« Débuter la passe » remet à zéro). Aucun bouton de remise à zéro.
--   • Une passe terminée avant 100 % garde aussi ses arrêts faits en vert (les autres restent jaunes).
--
-- CE QUI CHANGE : tours_en_cours() (lecture pour l'application ; tous les employés actifs voient la même chose)
--   • chaque élément a maintenant  « en_cours » (vrai/faux), « fin », « fin_type », « fin_estimee » ;
--   • pour chaque (route, tâche) qui n'a PLUS de tour en cours, elle renvoie aussi le DERNIER tour terminé
--     (en_cours = faux, « passes » vide : plus aucun camion dessus) ;
--   • « faits_il_y_a » : pour chaque arrêt fait, son âge en secondes calculé par le SERVEUR — l'application s'en sert
--     pour offrir « Annuler » pendant 10 minutes sans dépendre de l'horloge du téléphone ;
--   • « mes_passes_annulables » (tour terminé seulement) : les passes de la personne connectée, terminées à 100 %,
--     par lesquelles elle peut annuler un arrêt (ce qui rouvre le tour). Personne d'autre ne les voit.
--   Rien d'autre ne change : mêmes noms, mêmes paramètres, mêmes droits (employés actifs seulement, jamais le visiteur).
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'passes' and column_name = 'tache') then
    raise exception 'le fichier 13 n''a pas été exécuté (la colonne passes.tache n''existe pas). Rien n''a été modifié.';
  end if;
end $$;

begin;

create or replace function public.tours_en_cours()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := public._exiger_actif();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
        'route_id',     t.route_id,
        'tache',        t.tache,
        'numero',       t.numero,
        'en_cours',     t.en_cours,
        'debut',        t.debut,
        'fin',          t.fin,
        'fin_type',     t.fin_type,
        'fin_estimee',  t.fin_estimee,
        'total',        t.total,
        'faits',        t.faits,
        'pourcentage',  case when t.total > 0 then least(100, (100 * t.faits) / t.total) else 0 end,
        'arrets_faits', (select coalesce(jsonb_agg(x.stop_id order by x.stop_id), '[]'::jsonb)
                           from (select distinct pa.stop_id
                                   from public.passe_arrets pa
                                   join public.passes q on q.id = pa.passe_id
                                   join public.stops  s on s.id = pa.stop_id
                                  where q.route_id = t.route_id and q.numero = t.numero
                                    and s.route_id = t.route_id and s.service = t.tache and s.actif) x),
        -- âge (en secondes, selon l'horloge du serveur) du dernier « Complété » de chaque arrêt
        'faits_il_y_a', (select coalesce(jsonb_object_agg(y.stop_id, y.age), '{}'::jsonb)
                           from (select pa.stop_id,
                                        greatest(0, floor(extract(epoch from (now() - max(pa.complete_le)))))::int as age
                                   from public.passe_arrets pa
                                   join public.passes q on q.id = pa.passe_id
                                   join public.stops  s on s.id = pa.stop_id
                                  where q.route_id = t.route_id and q.numero = t.numero
                                    and s.route_id = t.route_id and s.service = t.tache and s.actif
                                  group by pa.stop_id) y),
        -- les camions encore sur ce tour (vide pour un tour terminé)
        'passes', case when t.en_cours then
                    (select coalesce(jsonb_agg(jsonb_build_object(
                                 'passe_id', p2.id, 'equipe_id', p2.equipe_id, 'chauffeur_id', p2.chauffeur_id,
                                 'je_suis_chauffeur', p2.chauffeur_id = v_uid,
                                 'je_suis_a_bord', exists (select 1 from public.equipage_periodes e
                                                            where e.passe_id = p2.id and e.utilisateur_id = v_uid and e.fin is null))
                               order by p2.debut), '[]'::jsonb)
                       from public.passes p2
                      where p2.route_id = t.route_id and p2.numero = t.numero and p2.statut = 'en_cours')
                  else '[]'::jsonb end,
        -- tour terminé : MES passes terminées à 100 % (par elles, annuler un arrêt rouvre le tour)
        'mes_passes_annulables', case when t.en_cours then '[]'::jsonb else
                    (select coalesce(jsonb_agg(p3.id order by p3.debut), '[]'::jsonb)
                       from public.passes p3
                      where p3.route_id = t.route_id and p3.numero = t.numero
                        and p3.chauffeur_id = v_uid and p3.statut = 'terminee' and p3.fin_type = 'complete')
                  end
      ) order by t.route_id, t.tache)
      from (
        select u.*,
               (select count(*)::int from public.stops s
                 where s.route_id = u.route_id and s.service = u.tache and s.actif) as total,
               public._faits_du_tour(u.route_id, u.numero, u.tache) as faits
          from (
            -- 1. les tours EN COURS
            select p.route_id, p.tache, p.numero, true as en_cours, min(p.debut) as debut,
                   null::timestamptz as fin, null::text as fin_type, false as fin_estimee
              from public.passes p
             where p.statut = 'en_cours'
             group by p.route_id, p.tache, p.numero
            union all
            -- 2. le DERNIER tour terminé de chaque (route, tâche) qui n'a plus aucun tour en cours
            select d.route_id, d.tache, d.numero, false as en_cours,
                   (select min(q.debut) from public.passes q where q.route_id = d.route_id and q.numero = d.numero),
                   (select max(q.fin)   from public.passes q where q.route_id = d.route_id and q.numero = d.numero),
                   (select q.fin_type    from public.passes q where q.route_id = d.route_id and q.numero = d.numero order by q.fin desc nulls last, q.id limit 1),
                   (select q.fin_estimee from public.passes q where q.route_id = d.route_id and q.numero = d.numero order by q.fin desc nulls last, q.id limit 1)
              from (select distinct on (p.route_id, p.tache) p.route_id, p.tache, p.numero
                      from public.passes p
                     where p.statut = 'terminee'
                       and not exists (select 1 from public.passes e
                                        where e.route_id = p.route_id and e.tache = p.tache and e.statut = 'en_cours')
                     order by p.route_id, p.tache, p.numero desc) d
          ) u
      ) t
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.tours_en_cours() from public, anon;
grant execute on function public.tours_en_cours() to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'tours_en_cours_versions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'tours_en_cours'),
  'visiteur_peut_lire_les_tours', has_function_privilege('anon', 'public.tours_en_cours()', 'execute'),
  'employe_peut_lire_les_tours',  has_function_privilege('authenticated', 'public.tours_en_cours()', 'execute'),
  'fonction_verrouillee_search_path', (select coalesce(bool_and(proconfig::text like '%search_path%'), false) from pg_proc
                                        where pronamespace = 'public'::regnamespace and proname = 'tours_en_cours'),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'passes_existantes', (select count(*) from public.passes)
) as verification;
