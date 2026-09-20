-- =====================================================================
-- ÉTAPE 16d — L'HEURE DES GESTES FAITS SANS RÉSEAU : « ANNULER UN ARRÊT » ET « SIGNALER UN PROBLÈME »
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 17. Ne modifie AUCUNE donnée existante. Peut être exécuté plusieurs fois sans problème.
--
-- POURQUOI : sans réseau, un geste est gardé sur le téléphone puis envoyé au retour du signal. Les autres gestes (compléter, débuter,
-- terminer, équipage) reçoivent déjà l'heure OÙ ILS ONT ÉTÉ FAITS (paramètre p_moment). Deux gestes ne la recevaient pas encore :
--
--   1. annuler_arret : « Annuler » est permis 10 minutes après le « Complété ». Ces 10 minutes se comptaient depuis l'heure de
--      l'ENVOI. Un « Annuler » fait hors réseau 2 minutes après le « Complété », mais envoyé une heure plus tard, était donc refusé
--      (« trop tard »). Maintenant elles se comptent depuis l'heure du GESTE (nouveau paramètre p_moment).
--        • Sans p_moment (appel en ligne, comme avant) : rien ne change, c'est l'heure actuelle qui compte.
--        • NOUVEAU garde-fou : si l'arrêt a été complété APRÈS l'heure de l'annulation (de plus de 2 minutes), l'annulation ne vise
--          pas ce « Complété »-là (par exemple une annulation renvoyée après une réponse perdue, alors qu'un autre camion a refait
--          l'arrêt entre-temps) : elle est IGNORÉE (« pas_complete ») et n'annule jamais un « Complété » plus récent.
--        • Un geste de plus de 3 jours est refusé (« geste_trop_ancien »), une heure dans le futur compte comme maintenant :
--          mêmes règles que tous les autres gestes.
--
--   2. problemes.cree_le : l'heure d'un problème signalé sans réseau était celle de l'ENVOI. L'application peut maintenant la donner
--      (colonne cree_le ajoutée aux colonnes qu'un employé a le droit d'écrire à l'insertion), et un déclencheur la BORNE : absente
--      ou dans le futur = maintenant ; de plus de 3 jours = refusée (« geste_trop_ancien »). Un employé ne peut toujours pas la
--      modifier après coup (seul « lu / lu_par / lu_le » est modifiable, et seulement par l'administrateur).
--
-- SÉCURITÉ : chaque fonction se verrouille elle-même (search_path fixé, aucun droit pour un visiteur non connecté). Le déclencheur
-- n'est appelable par personne d'autre que la base. Aucune donnée n'est modifiée ; les problèmes déjà signalés gardent leur heure.
--
-- ⚠ ORDRE : exécuter CE FICHIER AVANT de mettre à jour l'application (l'application enverra p_moment et cree_le ; une base qui ne
-- les connaît pas les refuserait).
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.annuler_arret(uuid, uuid)') is null and to_regprocedure('public.annuler_arret(uuid, uuid, timestamptz)') is null then
    raise exception 'la fonction annuler_arret n''existe pas : les fichiers précédents (étape 13) n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public._moment_valide(timestamptz)') is null or to_regclass('public.problemes') is null then
    raise exception 'les fichiers précédents (étapes 9a et 7) n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
end $$;

begin;

-- ---------------------------------------------------------------------
-- 1. ANNULER UN ARRÊT : avec l'heure du geste
-- ---------------------------------------------------------------------
-- (l'ancienne version à 2 paramètres est retirée : deux versions côte à côte rendraient l'appel ambigu)
drop function if exists public.annuler_arret(uuid, uuid);

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
    return jsonb_build_object('statut', 'pas_complete');
  end if;

  -- Un « Complété » PLUS RÉCENT que ce geste d'annulation n'est pas celui qu'on voulait annuler (annulation renvoyée après une
  -- réponse perdue, arrêt refait entre-temps) : on l'ignore. (2 minutes de tolérance : l'horloge d'un autre téléphone peut avancer.)
  if v_pa.complete_le > v_moment + interval '2 minutes' then
    return jsonb_build_object('statut', 'pas_complete');
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

-- ---------------------------------------------------------------------
-- 2. PROBLÈMES : l'heure du signalement, donnée par l'application et bornée par le serveur
-- ---------------------------------------------------------------------
-- L'employé peut écrire cree_le À L'INSERTION seulement (jamais après : la modification reste limitée à lu / lu_par / lu_le)
grant insert (cree_le) on public.problemes to authenticated;

create or replace function public._trg_problemes_borner_cree_le()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.cree_le := public._moment_valide(new.cree_le);   -- absente ou dans le futur : maintenant ; de plus de 3 jours : « geste_trop_ancien »
  return new;
end;
$$;

revoke all on function public._trg_problemes_borner_cree_le() from public, anon, authenticated;

drop trigger if exists problemes_borner_cree_le on public.problemes;
create trigger problemes_borner_cree_le
  before insert on public.problemes
  for each row execute function public._trg_problemes_borner_cree_le();

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'annuler_arret_versions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'annuler_arret'),
  'annuler_arret_parametres', (select pg_get_function_arguments(oid) from pg_proc
                                where pronamespace = 'public'::regnamespace and proname = 'annuler_arret' limit 1),
  'annuler_arret_visiteur_peut_appeler', has_function_privilege('anon', 'public.annuler_arret(uuid, uuid, timestamptz)', 'execute'),
  'annuler_arret_employe_peut_appeler',  has_function_privilege('authenticated', 'public.annuler_arret(uuid, uuid, timestamptz)', 'execute'),
  'annuler_arret_verrouillee_search_path', (select coalesce(bool_and(proconfig::text like '%search_path%'), false) from pg_proc
                                             where pronamespace = 'public'::regnamespace and proname = 'annuler_arret'),
  'declencheur_problemes_present', (select count(*) from pg_trigger
                                     where tgname = 'problemes_borner_cree_le' and tgrelid = 'public.problemes'::regclass and not tgisinternal),
  'employe_peut_ecrire_cree_le_a_linsertion', has_column_privilege('authenticated', 'public.problemes', 'cree_le', 'insert'),
  'employe_peut_modifier_cree_le', has_column_privilege('authenticated', 'public.problemes', 'cree_le', 'update'),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'passes_existantes', (select count(*) from public.passes),
  'problemes_existants', (select count(*) from public.problemes)
) as verification;
