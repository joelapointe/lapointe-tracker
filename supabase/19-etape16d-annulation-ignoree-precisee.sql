-- =====================================================================
-- ÉTAPE 16d (SUITE) — « ANNULATION IGNORÉE » : DIRE POURQUOI (décision de Joé, 20 septembre 2026)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 18. Ne modifie AUCUNE donnée. Peut être exécuté plusieurs fois sans problème.
--
-- POURQUOI : quand une annulation d'arrêt faite sans réseau est renvoyée, le serveur répond « pas_complete » dans DEUX cas très
-- différents, que l'application ne pouvait pas distinguer :
--   (a) l'arrêt a été REFAIT après le geste d'annulation (par exemple par un autre camion) : l'annulation est ignorée et le chauffeur
--       DOIT le savoir (« Cet arrêt avait été refait entre-temps, l'annulation a été ignorée ») : sinon il appuie encore sur « Annuler » ;
--   (b) il n'y a plus rien à annuler (l'annulation avait déjà réussi, la réponse s'était perdue) : aucun message, ce serait FAUX.
-- Désormais le cas (a) répond { "statut": "pas_complete", "raison": "complete_apres" } ; le cas (b) reste { "statut": "pas_complete" }.
--
-- CE QUE FAIT CE FICHIER : il remplace la fonction annuler_arret par la même fonction, avec cette seule précision dans la réponse du
-- cas (a). Rien d'autre ne change (mêmes règles, mêmes droits, même signature). L'application fonctionne avec ou sans ce fichier :
-- sans lui, le cas (a) ne montre simplement pas de message.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.annuler_arret(uuid, uuid, timestamptz)') is null then
    raise exception 'la fonction annuler_arret avec l''heure du geste n''existe pas : le fichier 18 n''a pas été exécuté. Rien n''a été modifié.';
  end if;
end $$;

begin;

create or replace function public.annuler_arret(p_passe_id uuid, p_stop_id uuid, p_moment timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid;
  v_admin    boolean;
  v_p        public.passes%rowtype;
  v_pa       public.passe_arrets%rowtype;
  v_moment   timestamptz;
  v_rouverte boolean := false;
  v_fin_max  timestamptz;
  v_stats    jsonb;
  r          record;
begin
  v_uid := public._exiger_actif();
  v_admin := public.est_admin();
  select * into v_p from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_p.chauffeur_id <> v_uid and not v_admin then
    raise exception 'non_autorise';
  end if;

  -- L'heure du GESTE (celle du téléphone si elle est raisonnable, sinon maintenant ; plus de 3 jours : refusé)
  v_moment := public._moment_valide(p_moment);

  -- L'arrêt est cherché dans tout le tour : il a pu être complété par l'autre camion
  select pa.* into v_pa
    from public.passe_arrets pa join public.passes t on t.id = pa.passe_id
   where t.route_id = v_p.route_id and t.numero = v_p.numero and pa.stop_id = p_stop_id
   order by pa.complete_le desc limit 1;
  if not found then
    return jsonb_build_object('statut', 'pas_complete');           -- (b) plus rien à annuler : aucun message
  end if;

  -- Un « Complété » PLUS RÉCENT que ce geste d'annulation n'est pas celui qu'on voulait annuler (annulation renvoyée après une
  -- réponse perdue, arrêt refait entre-temps) : on l'ignore, ET on le dit (« raison »). (2 minutes de tolérance : l'horloge d'un
  -- autre téléphone peut avancer.)
  if v_pa.complete_le > v_moment + interval '2 minutes' then
    return jsonb_build_object('statut', 'pas_complete', 'raison', 'complete_apres');   -- (a) l'arrêt a été refait : message
  end if;

  if not v_admin then
    if v_pa.complete_le < v_moment - interval '10 minutes' then
      raise exception 'delai_depasse';
    end if;
    if v_p.statut = 'terminee' and v_p.fin_type <> 'complete' then
      raise exception 'passe_terminee';
    end if;
  end if;

  -- Le tour s'était-il fermé parce que tout était complété ? Alors il devra se rouvrir, sauf si un NOUVEAU tour
  -- a déjà commencé sur la même route et la même tâche (jamais deux tours ouverts en même temps).
  select max(t.fin) into v_fin_max from public.passes t
   where t.route_id = v_p.route_id and t.numero = v_p.numero and t.statut = 'terminee' and t.fin_type = 'complete';
  if v_fin_max is not null
     and exists (select 1 from public.passes t
                  where t.route_id = v_p.route_id and t.tache = v_p.tache and t.statut = 'en_cours' and t.numero <> v_p.numero) then
    raise exception 'impossible_de_rouvrir';
  end if;

  delete from public.passe_arrets pa using public.passes t
   where t.id = pa.passe_id and t.route_id = v_p.route_id and t.numero = v_p.numero and pa.stop_id = p_stop_id;

  -- Le tour s'était fermé parce que tout était complété : les camions qu'il avait fermés reprennent
  if v_fin_max is not null then
    for r in select t.id from public.passes t
              where t.route_id = v_p.route_id and t.numero = v_p.numero
                and t.statut = 'terminee' and t.fin_type = 'complete' and t.fin = v_fin_max loop
      begin
        perform public._rouvrir_passe(r.id);
        v_rouverte := true;
      exception when others then
        if r.id = p_passe_id then
          raise;                       -- la passe demandée doit pouvoir se rouvrir ; un autre camion qui a démarré ailleurs est simplement laissé
        end if;
      end;
    end loop;
  end if;

  v_stats := public._recalculer_passe(p_passe_id, v_moment);
  return jsonb_build_object('statut', 'annule', 'passe_rouverte', v_rouverte) || v_stats;
end;
$$;

revoke all on function public.annuler_arret(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.annuler_arret(uuid, uuid, timestamptz) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'annuler_arret_versions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'annuler_arret'),
  'annuler_arret_precise_la_raison', (select coalesce(bool_and(pg_get_functiondef(oid) like '%complete_apres%'), false) from pg_proc
                                       where pronamespace = 'public'::regnamespace and proname = 'annuler_arret'),
  'annuler_arret_visiteur_peut_appeler', has_function_privilege('anon', 'public.annuler_arret(uuid, uuid, timestamptz)', 'execute'),
  'annuler_arret_employe_peut_appeler',  has_function_privilege('authenticated', 'public.annuler_arret(uuid, uuid, timestamptz)', 'execute'),
  'annuler_arret_verrouillee_search_path', (select coalesce(bool_and(proconfig::text like '%search_path%'), false) from pg_proc
                                             where pronamespace = 'public'::regnamespace and proname = 'annuler_arret'),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'passes_existantes', (select count(*) from public.passes),
  'problemes_existants', (select count(*) from public.problemes)
) as verification;
