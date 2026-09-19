-- =====================================================================
-- ÉTAPE 13a — TÂCHE D'UNE PASSE ET « TOUR » PARTAGÉ ENTRE CAMIONS (décisions de Joé, 19 septembre 2026)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 12. À n'exécuter qu'UNE SEULE FOIS (il refuse de s'exécuter une 2e fois).
--
-- LES RÈGLES (voir le cahier, section 10, MISE À JOUR 6)
--   • La « tâche » d'une passe = le type de service des arrêts (déneigement mécanique, épandage de sel…).
--     La passe ne compte que les arrêts de sa route qui ont CE type de service.
--   • Deux camions sur la même route avec la même tâche partagent le même TOUR : le 2e qui démarre pendant
--     qu'un tour est en cours le REJOINT (mêmes arrêts faits, même pourcentage, même numéro de passe).
--     Chaque camion garde sa propre passe : son équipage, ses heures et sa position ne changent pas.
--   • Un camion avec une autre tâche démarre son propre tour. Un tour = (route, numéro).
--   • Le tour se ferme à 100 % (tous les camions en cours s'y terminent en même temps).
--     « Terminer » ne ferme que la passe du camion qui termine ; le tour continue pour les autres.
--
-- CE QUI CHANGE
--   passes.tache            colonne nouvelle (obligatoire)
--   debuter_passe(...)      reçoit la tâche (dernier paramètre, facultatif) et rejoint le tour en cours s'il y en a un.
--                           Sans tâche : acceptée seulement si la route n'a qu'UN type de service (sinon « tache_requise »).
--   completer_arret(...)    l'arrêt doit être de la tâche de la passe ; déjà fait dans le tour = « deja_complete »
--   annuler_arret(...)      trouve l'arrêt dans tout le tour ; rouvre le tour s'il s'était fermé à 100 %
--   tours_en_cours()        NOUVELLE lecture pour l'application : chaque tour en cours, son pourcentage,
--                           ses arrêts faits (visibles de tous les employés) et ses camions
--   le numéro de passe n'est plus unique par route : il identifie un tour (un déclencheur garde la cohérence)
--
-- Aucune donnée n'est effacée. Vérifié sur la vraie base le 19 septembre 2026 : aucune passe n'existe.
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'passes' and column_name = 'tache') then
    raise exception 'ce fichier a déjà été exécuté (la colonne passes.tache existe). Rien n''a été modifié.';
  end if;
end $$;

begin;

-- ---------------------------------------------------------------------
-- 1. LA TÂCHE ET LE TOUR
-- ---------------------------------------------------------------------
alter table public.passes add column tache text;
update public.passes set tache = 'Déneigement mécanique' where tache is null;    -- (aucune passe n'existe aujourd'hui ; valeur par défaut des arrêts)
alter table public.passes alter column tache set not null;
alter table public.passes add constraint passes_tache_non_vide check (length(trim(tache)) > 0);
comment on column public.passes.tache is 'Type de service de la passe (= stops.service). Les camions qui ont la même route et la même tâche partagent un tour.';

-- Un tour = (route, numéro) : plusieurs passes (une par camion) peuvent partager le même numéro.
alter table public.passes drop constraint passes_numero_unique_par_route;
create index passes_par_tour on public.passes (route_id, numero);

-- Cohérence : un même tour n'a jamais deux tâches différentes.
create or replace function public._trg_passes_tour_coherent()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.passes p
              where p.route_id = new.route_id and p.numero = new.numero and p.id <> new.id and p.tache <> new.tache) then
    raise exception 'tour_incoherent';
  end if;
  return new;
end;
$$;
drop trigger if exists passes_tour_coherent on public.passes;
create trigger passes_tour_coherent
  before insert or update of route_id, numero, tache on public.passes
  for each row execute function public._trg_passes_tour_coherent();

-- ---------------------------------------------------------------------
-- 2. OUTILS INTERNES
-- ---------------------------------------------------------------------

-- Nombre d'arrêts DIFFÉRENTS faits dans un tour (par n'importe quel camion), limités aux arrêts actifs
-- de la route qui ont la tâche du tour. p_jusqu_a : seulement ce qui date d'avant ce moment (passe terminée).
create or replace function public._faits_du_tour(
  p_route_id uuid, p_numero integer, p_tache text, p_jusqu_a timestamptz default null)
returns integer
language sql stable security definer set search_path = ''
as $$
  select count(distinct pa.stop_id)::int
    from public.passe_arrets pa
    join public.passes q on q.id = pa.passe_id
    join public.stops  s on s.id = pa.stop_id
   where q.route_id = p_route_id and q.numero = p_numero
     and s.route_id = p_route_id and s.service = p_tache and s.actif
     and (p_jusqu_a is null or pa.complete_le <= p_jusqu_a);
$$;

-- Recalcule total et faits du TOUR de la passe, et ferme tous les camions du tour si tout est complété.
-- (même nom et mêmes paramètres qu'à l'étape 9b : le déclencheur des arrêts et les autres fonctions l'appellent déjà)
create or replace function public._recalculer_passe(p_passe_id uuid, p_moment timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p       public.passes%rowtype;
  v_direct  integer;
  v_union   integer;
  v_total   integer;
  v_faits   integer;
  v_ferme   boolean := false;
  r         record;
begin
  select * into v_p from public.passes where id = p_passe_id;
  if not found then
    return null;
  end if;

  select count(*)::int into v_direct
    from public.stops s where s.route_id = v_p.route_id and s.service = v_p.tache and s.actif;
  v_union := public._faits_du_tour(v_p.route_id, v_p.numero, v_p.tache);

  -- Tous les camions encore en cours de ce tour partagent le même total et les mêmes arrêts faits
  update public.passes set nb_arrets_total = v_direct, nb_arrets_faits = v_union
   where route_id = v_p.route_id and numero = v_p.numero and statut = 'en_cours'
     and (nb_arrets_total is distinct from v_direct or nb_arrets_faits is distinct from v_union);

  if v_p.statut = 'en_cours' then
    v_total := v_direct;
    v_faits := v_union;
  else
    -- passe terminée : le total reste celui de son historique ; les faits = ce qui date d'avant sa fin
    v_total := v_p.nb_arrets_total;
    v_faits := public._faits_du_tour(v_p.route_id, v_p.numero, v_p.tache, v_p.fin);
    if v_p.nb_arrets_faits is distinct from v_faits then
      update public.passes set nb_arrets_faits = v_faits where id = p_passe_id;
    end if;
  end if;

  -- 100 % : tous les camions du tour se terminent ensemble
  if v_direct > 0 and v_union >= v_direct
     and exists (select 1 from public.passes where route_id = v_p.route_id and numero = v_p.numero and statut = 'en_cours') then
    for r in select id from public.passes
              where route_id = v_p.route_id and numero = v_p.numero and statut = 'en_cours' loop
      perform public._fermer_passe(r.id, case when v_p.statut = 'en_cours' then p_moment else now() end, 'complete');
    end loop;
    v_ferme := (v_p.statut = 'en_cours');
  end if;

  return jsonb_build_object('total', v_total, 'faits', v_faits,
    'pourcentage', case when v_total > 0 then least(100, (100 * v_faits) / v_total) else 0 end,
    'passe_fermee', v_ferme);
end;
$$;

-- Changer le type de service d'un arrêt recalcule aussi les passes en cours (comme l'archivage ou le changement de route)
drop trigger if exists stops_recalcul_passes on public.stops;
create trigger stops_recalcul_passes
  after insert or update of actif, route_id, service or delete on public.stops
  for each row execute function public._trg_stops_recalcul();

-- ---------------------------------------------------------------------
-- 3. DÉBUTER UNE PASSE (avec tâche ; rejoint le tour en cours s'il existe)
-- ---------------------------------------------------------------------
drop function if exists public.debuter_passe(uuid, uuid, uuid, jsonb, timestamptz, double precision, double precision, real);

create or replace function public.debuter_passe(
  p_id uuid,
  p_route_id uuid,
  p_equipe_id uuid,
  p_equipage jsonb default '[]'::jsonb,
  p_moment timestamptz default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_precision real default null,
  p_tache text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid;
  v_moment     timestamptz;
  v_exist      public.passes%rowtype;
  v_numero     integer;
  v_total      integer;
  v_prev       uuid;
  v_fermees    jsonb := '[]'::jsonb;
  v_membre     jsonb;
  v_res        jsonb;
  v_resultats  jsonb := '[]'::jsonb;
  v_tache      text;
  v_taches     text[];
  v_rejoint    boolean := false;
  v_stats      jsonb;
begin
  v_uid := public._exiger_actif();

  select * into v_exist from public.passes where id = p_id;
  if found then
    if v_exist.chauffeur_id <> v_uid then
      raise exception 'non_autorise';
    end if;
    return jsonb_build_object('statut', 'deja_enregistre', 'passe_id', v_exist.id, 'numero', v_exist.numero, 'tache', v_exist.tache);   -- geste renvoyé
  end if;

  if not exists (select 1 from public.routes r where r.id = p_route_id and r.actif) then
    raise exception 'route_inactive';
  end if;
  if not exists (select 1 from public.equipes e where e.id = p_equipe_id and e.actif) then
    raise exception 'equipe_inactive';
  end if;

  -- Tâche : celle qui est demandée (elle doit exister sur la route) ; sinon la seule possible
  select coalesce(array_agg(distinct s.service order by s.service), '{}'::text[]) into v_taches
    from public.stops s where s.route_id = p_route_id and s.actif and s.service is not null;
  if p_tache is null or length(trim(p_tache)) = 0 then
    if cardinality(v_taches) > 1 then
      raise exception 'tache_requise';
    end if;
    v_tache := coalesce(v_taches[1], 'Déneigement mécanique');    -- route sans arrêt : valeur par défaut des arrêts (comportement d'avant)
  else
    v_tache := trim(p_tache);
    if not (v_tache = any(v_taches)) then
      raise exception 'tache_sans_arret';
    end if;
  end if;

  v_moment := public._moment_valide(p_moment);

  -- « Débuter la passe » ARCHIVE la précédente (celle du chauffeur et celle du véhicule)
  for v_prev in select p.id from public.passes p
                 where p.statut = 'en_cours' and (p.chauffeur_id = v_uid or p.equipe_id = p_equipe_id) loop
    perform public._fermer_passe(v_prev, v_moment, 'remplacee');
    v_fermees := v_fermees || to_jsonb(v_prev);
  end loop;

  -- Verrou (deux camions qui démarrent en même temps sur la même route) puis : rejoindre le tour en cours, ou en ouvrir un nouveau
  perform pg_advisory_xact_lock(hashtextextended(p_route_id::text, 0));
  select p.numero into v_numero from public.passes p
   where p.route_id = p_route_id and p.tache = v_tache and p.statut = 'en_cours'
   order by p.numero limit 1;
  if found then
    v_rejoint := true;
  else
    select coalesce(max(p.numero), 0) + 1 into v_numero from public.passes p where p.route_id = p_route_id;
  end if;
  select count(*)::int into v_total from public.stops s where s.route_id = p_route_id and s.actif and s.service = v_tache;

  begin
    insert into public.passes (id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total, tache)
    values (p_id, p_route_id, p_equipe_id, v_uid, v_numero, v_moment, v_total, v_tache);
  exception when unique_violation then
    raise exception 'passe_deja_en_cours';
  end;

  -- Si le tour existait, ce camion reprend ses arrêts déjà faits
  v_stats := public._recalculer_passe(p_id, v_moment);

  -- Le chauffeur est à bord (et son quart s'ouvre au besoin, à valider)
  perform public._equipage_ajouter(p_id, v_uid, v_moment, 'chauffeur', v_uid, true, p_lat, p_lon, p_precision);

  -- Équipage confirmé par le chauffeur : [{"utilisateur_id": "...", "cle_client": "...", "forcer": false}, ...]
  for v_membre in select * from jsonb_array_elements(coalesce(p_equipage, '[]'::jsonb)) loop
    begin
      v_res := public.equipage_ajouter(
        nullif(v_membre ->> 'cle_client', '')::uuid, p_id, (v_membre ->> 'utilisateur_id')::uuid,
        v_moment, p_lat, p_lon, p_precision, coalesce((v_membre ->> 'forcer')::boolean, false));
    exception when others then
      v_res := jsonb_build_object('statut', 'erreur', 'message', sqlerrm);
    end;
    v_resultats := v_resultats || jsonb_build_array(jsonb_build_object('utilisateur_id', v_membre ->> 'utilisateur_id') || v_res);
  end loop;

  -- Le véhicule apparaît tout de suite sur la carte
  if p_lat is not null and p_lon is not null then
    insert into public.positions (passe_id, equipe_id, chauffeur_id, lat, lon, precision_m, maj_le)
    values (p_id, p_equipe_id, v_uid, p_lat, p_lon, p_precision, v_moment)
    on conflict (passe_id) do nothing;
  end if;

  return jsonb_build_object('statut', 'debutee', 'passe_id', p_id, 'numero', v_numero, 'tache', v_tache,
                            'tour_rejoint', v_rejoint,
                            'nb_arrets_total', v_total, 'nb_arrets_faits', v_stats ->> 'faits',
                            'passes_archivees', v_fermees, 'equipage', v_resultats);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. ARRÊTS COMPLÉTÉS : partagés par tout le tour
-- ---------------------------------------------------------------------
create or replace function public.completer_arret(
  p_passe_id uuid,
  p_stop_id uuid,
  p_moment timestamptz default null,
  p_mode text default 'manuel',
  p_lat double precision default null,
  p_lon double precision default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid;
  v_p       public.passes%rowtype;
  v_moment  timestamptz;
  v_nb      integer := 0;
  v_stats   jsonb;
begin
  v_uid := public._exiger_actif();
  select * into v_p from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_p.chauffeur_id <> v_uid and not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  if p_mode not in ('manuel', 'auto') then
    raise exception 'mode_invalide';
  end if;
  if not exists (select 1 from public.stops s where s.id = p_stop_id and s.route_id = v_p.route_id and s.actif) then
    raise exception 'arret_hors_route';
  end if;
  if not exists (select 1 from public.stops s where s.id = p_stop_id and s.service = v_p.tache) then
    raise exception 'arret_hors_tache';
  end if;

  v_moment := greatest(public._moment_valide(p_moment), v_p.debut);
  -- Geste hors réseau reçu après la fin de la passe : accepté seulement s'il date d'avant sa fin
  if v_p.fin is not null and v_moment >= v_p.fin then
    return jsonb_build_object('statut', 'passe_terminee');
  end if;

  -- Déjà fait dans ce tour (par ce camion ou par l'autre) : rien à ajouter
  if not exists (select 1 from public.passe_arrets pa join public.passes q on q.id = pa.passe_id
                  where q.route_id = v_p.route_id and q.numero = v_p.numero and pa.stop_id = p_stop_id) then
    insert into public.passe_arrets (passe_id, stop_id, complete_le, complete_par, mode, lat, lon)
    values (p_passe_id, p_stop_id, v_moment, v_uid, p_mode, p_lat, p_lon)
    on conflict (passe_id, stop_id) do nothing;
    get diagnostics v_nb = row_count;
  end if;

  v_stats := public._recalculer_passe(p_passe_id, v_moment);
  return jsonb_build_object('statut', case when v_nb = 0 then 'deja_complete' else 'complete' end) || v_stats;
end;
$$;

create or replace function public.annuler_arret(p_passe_id uuid, p_stop_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid;
  v_admin    boolean;
  v_p        public.passes%rowtype;
  v_pa       public.passe_arrets%rowtype;
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

  -- L'arrêt est cherché dans tout le tour : il a pu être complété par l'autre camion
  select pa.* into v_pa
    from public.passe_arrets pa join public.passes t on t.id = pa.passe_id
   where t.route_id = v_p.route_id and t.numero = v_p.numero and pa.stop_id = p_stop_id
   order by pa.complete_le desc limit 1;
  if not found then
    return jsonb_build_object('statut', 'pas_complete');
  end if;
  if not v_admin then
    if v_pa.complete_le < now() - interval '10 minutes' then
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

  v_stats := public._recalculer_passe(p_passe_id, now());
  return jsonb_build_object('statut', 'annule', 'passe_rouverte', v_rouverte) || v_stats;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. LECTURE POUR L'APPLICATION : les tours en cours (tous les employés actifs voient les mêmes)
-- ---------------------------------------------------------------------
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
        'route_id',    t.route_id,
        'tache',       t.tache,
        'numero',      t.numero,
        'debut',       t.debut,
        'total',       t.total,
        'faits',       t.faits,
        'pourcentage', case when t.total > 0 then least(100, (100 * t.faits) / t.total) else 0 end,
        'arrets_faits', (select coalesce(jsonb_agg(x.stop_id order by x.stop_id), '[]'::jsonb)
                           from (select distinct pa.stop_id
                                   from public.passe_arrets pa
                                   join public.passes q on q.id = pa.passe_id
                                   join public.stops  s on s.id = pa.stop_id
                                  where q.route_id = t.route_id and q.numero = t.numero
                                    and s.route_id = t.route_id and s.service = t.tache and s.actif) x),
        'passes', (select jsonb_agg(jsonb_build_object(
                             'passe_id', p2.id, 'equipe_id', p2.equipe_id, 'chauffeur_id', p2.chauffeur_id,
                             'je_suis_chauffeur', p2.chauffeur_id = v_uid,
                             'je_suis_a_bord', exists (select 1 from public.equipage_periodes e
                                                        where e.passe_id = p2.id and e.utilisateur_id = v_uid and e.fin is null))
                           order by p2.debut)
                     from public.passes p2
                    where p2.route_id = t.route_id and p2.numero = t.numero and p2.statut = 'en_cours')
      ) order by t.route_id, t.tache)
      from (select p.route_id, p.tache, p.numero, min(p.debut) as debut,
                   (select count(*)::int from public.stops s
                     where s.route_id = p.route_id and s.service = p.tache and s.actif) as total,
                   public._faits_du_tour(p.route_id, p.numero, p.tache) as faits
              from public.passes p where p.statut = 'en_cours'
             group by p.route_id, p.tache, p.numero) t
  ), '[]'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------
-- 6. DROITS (chaque fonction se verrouille elle-même)
-- ---------------------------------------------------------------------
revoke all on function public._trg_passes_tour_coherent()                                      from public, anon, authenticated;
revoke all on function public._faits_du_tour(uuid, integer, text, timestamptz)                 from public, anon, authenticated;
revoke all on function public._recalculer_passe(uuid, timestamptz)                             from public, anon, authenticated;

revoke all on function public.debuter_passe(uuid, uuid, uuid, jsonb, timestamptz, double precision, double precision, real, text) from public, anon;
revoke all on function public.completer_arret(uuid, uuid, timestamptz, text, double precision, double precision)                   from public, anon;
revoke all on function public.annuler_arret(uuid, uuid)                                                                            from public, anon;
revoke all on function public.tours_en_cours()                                                                                     from public, anon;

grant execute on function public.debuter_passe(uuid, uuid, uuid, jsonb, timestamptz, double precision, double precision, real, text) to authenticated;
grant execute on function public.completer_arret(uuid, uuid, timestamptz, text, double precision, double precision)                   to authenticated;
grant execute on function public.annuler_arret(uuid, uuid)                                                                            to authenticated;
grant execute on function public.tours_en_cours()                                                                                     to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'colonne_tache_obligatoire', (select is_nullable = 'NO' from information_schema.columns
                                 where table_schema = 'public' and table_name = 'passes' and column_name = 'tache'),
  'ancien_numero_unique_supprime', not exists (select 1 from pg_constraint where conname = 'passes_numero_unique_par_route'),
  'declencheur_tour_coherent', (select count(*) from pg_trigger where tgname = 'passes_tour_coherent' and not tgisinternal),
  'declencheur_recalcul_arrets', (select count(*) from pg_trigger where tgname = 'stops_recalcul_passes' and not tgisinternal),
  'debuter_passe_versions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'debuter_passe'),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'fonctions_appelables_par_un_employe',  (select jsonb_agg(proname order by proname) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', oid, 'execute')),
  'passes_existantes', (select count(*) from public.passes)
) as verification;
