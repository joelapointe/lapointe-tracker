-- =====================================================================
-- NOUVELLE SAISON D'UNE ROUTE — repartir le numéro de passe à 1, sans jamais toucher à l'historique (demande de Joé, 22 sept. 2026)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 24. Ne modifie AUCUNE donnée existante (numero_base commence à 0, donc l'affichage ne change pas
-- tant que Joé n'utilise pas le nouveau bouton). Remplace seulement la fonction de lecture tours_en_cours(). Peut être exécuté
-- plusieurs fois sans problème.
--
-- POURQUOI : le numéro d'une passe (passes.numero) grimpe pour toujours, route par route (1, 2, 3… 11…). Joé veut, une fois les
-- passes d'une route vérifiées (le travail fait, les problèmes réglés, les heures validées), pouvoir « repartir à 1 » pour cette
-- route SANS PERDRE l'historique des anciennes passes.
--
-- COMMENT : on ne touche JAMAIS au vrai numero (toute la logique des tours PARTAGÉS entre camions — debuter_passe,
-- completer_arret, tours_en_cours, etc. — s'appuie dessus dans plusieurs fichiers ; le changer serait risqué et inutile).
-- On ajoute plutôt un DÉCALAGE D'AFFICHAGE par route (routes.numero_base) : le numéro montré à l'écran = numero - numero_base.
-- « Nouvelle saison » avance ce décalage jusqu'au dernier numéro utilisé ; la PROCHAINE passe (numero = dernier + 1) s'affichera
-- donc « Passe n° 1 ». Les anciennes passes gardent leur vrai numero en base (rien n'est renommé) : l'écran « Historique » les
-- montre telles quelles.
--
-- CE QUE FAIT CE FICHIER :
--   • routes.numero_base (nouvelle colonne, 0 par défaut : aucun changement d'affichage tant qu'elle n'est pas avancée) ;
--   • tours_en_cours() : le champ « numero » renvoyé est maintenant numero - numero_base de la route (un seul calcul changé,
--     tout le reste de la fonction — les tours partagés, les arrêts faits, etc. — est INCHANGÉ) ;
--   • admin_nouvelle_saison_route(route_id) : réservée à l'administrateur ; REFUSE si une passe de cette route est encore en
--     cours (jamais d'oubli à cheval sur deux saisons) ; avance numero_base au dernier numero utilisé pour cette route.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regclass('public.routes') is null then
    raise exception 'la table routes n''existe pas : les fichiers précédents n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.tours_en_cours()') is null then
    raise exception 'la fonction tours_en_cours() (fichier 15) n''existe pas. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_admin()') is null then
    raise exception 'la fonction est_admin() (fichier 03) n''existe pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

alter table public.routes add column if not exists numero_base integer not null default 0;
comment on column public.routes.numero_base is
  'Décalage d''affichage : le numéro de passe MONTRÀ l''écran = passes.numero - numero_base. Avancé par admin_nouvelle_saison_route() ; le vrai numero, lui, ne change jamais (l''historique reste intact).';

-- tours_en_cours() : copie EXACTE du fichier 15, sauf le champ « numero » renvoyé (une seule ligne changée)
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
        'numero',       t.numero - coalesce((select r.numero_base from public.routes r where r.id = t.route_id), 0),
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

-- Nouvelle fonction : réservée à l'administrateur, refuse si une passe de la route est encore en cours
create or replace function public.admin_nouvelle_saison_route(p_route_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_max integer;
begin
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  if not exists (select 1 from public.routes where id = p_route_id) then
    raise exception 'route_introuvable';
  end if;
  if exists (select 1 from public.passes where route_id = p_route_id and statut = 'en_cours') then
    return jsonb_build_object('statut', 'refuse', 'raison', 'passe_en_cours');
  end if;
  select coalesce(max(numero), 0) into v_max from public.passes where route_id = p_route_id;
  update public.routes set numero_base = v_max where id = p_route_id;
  return jsonb_build_object('statut', 'ok', 'route_id', p_route_id, 'numero_base', v_max);
end;
$$;

revoke all on function public.admin_nouvelle_saison_route(uuid) from public, anon;
grant execute on function public.admin_nouvelle_saison_route(uuid) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'colonne_numero_base_existe', exists (select 1 from information_schema.columns
                                          where table_schema = 'public' and table_name = 'routes' and column_name = 'numero_base'),
  'tours_en_cours_existe', to_regprocedure('public.tours_en_cours()') is not null,
  'nouvelle_saison_existe', to_regprocedure('public.admin_nouvelle_saison_route(uuid)') is not null,
  'employe_peut_appeler_nouvelle_saison', has_function_privilege('authenticated', 'public.admin_nouvelle_saison_route(uuid)', 'execute'),
  'visiteur_peut_appeler_nouvelle_saison', has_function_privilege('anon', 'public.admin_nouvelle_saison_route(uuid)', 'execute')
) as verification;
