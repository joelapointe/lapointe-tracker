-- =====================================================================
-- ÉTAPE 9b — Fonctions serveur : passes, arrêts, position, fermetures
--            automatiques, liste des employés et export de paie
-- =====================================================================
-- À EXÉCUTER APRÈS L'ÉTAPE 9a. À n'exécuter qu'UNE SEULE FOIS.
--
-- FONCTIONS OFFERTES À L'APPLICATION (employés connectés seulement)
--   debuter_passe(...)        « Débuter la passe » : archive la précédente, numéro suivant,
--                              chauffeur + équipage confirmés, quart ouvert au besoin
--   terminer_passe(...)       bouton « Terminer » (passe non complétée à 100 %)
--   completer_arret(...)      arrêt complété ; à 100 % la passe se ferme TOUTE SEULE
--   annuler_arret(...)        annule un arrêt complété par erreur (10 min pour le chauffeur,
--                              sans limite pour l'administrateur) ; rouvre la passe si elle
--                              s'était fermée à cause de cet arrêt
--   envoyer_position(...)     position du véhicule (le téléphone du CHAUFFEUR seulement)
--   admin_lister_utilisateurs()  la liste avec les numéros de téléphone (administrateur seulement)
--   admin_export_paie(...)    heures par employé, réparties par véhicule et par route.
--                              REFUSE de se faire tant qu'un quart est « à valider » ou encore ouvert.
--
-- AUTOMATIQUE (aucune action humaine)
--   • Toutes les 5 minutes : une passe encore ouverte après 12 h et un quart encore ouvert
--     après 16 h sont fermés (réglages modifiables). La fin est ESTIMÉE (dernière activité
--     connue) et le quart est marqué « à valider ».
--   • À chaque ajout, archivage ou changement de route d'un arrêt : le total et le
--     pourcentage des passes en cours sont recalculés (et la passe se ferme si tout est fait).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- OUTILS INTERNES
-- ---------------------------------------------------------------------

-- Recalcule le total et le nombre d'arrêts faits d'une passe, et la ferme si tout est complété.
-- Pour une passe déjà terminée, le total n'est pas modifié (l'historique reste tel quel).
create or replace function public._recalculer_passe(p_passe_id uuid, p_moment timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_p      public.passes%rowtype;
  v_total  integer;
  v_faits  integer;
  v_ferme  boolean := false;
begin
  select * into v_p from public.passes where id = p_passe_id;
  if not found then
    return null;
  end if;

  select count(*)::int into v_faits
    from public.passe_arrets pa
    join public.stops s on s.id = pa.stop_id
   where pa.passe_id = p_passe_id and s.route_id = v_p.route_id and s.actif;

  if v_p.statut = 'en_cours' then
    select count(*)::int into v_total from public.stops s where s.route_id = v_p.route_id and s.actif;
  else
    v_total := v_p.nb_arrets_total;
  end if;

  if v_p.nb_arrets_total is distinct from v_total or v_p.nb_arrets_faits is distinct from v_faits then
    update public.passes set nb_arrets_total = v_total, nb_arrets_faits = v_faits where id = p_passe_id;
  end if;

  if v_p.statut = 'en_cours' and v_total > 0 and v_faits >= v_total then
    perform public._fermer_passe(p_passe_id, p_moment, 'complete');
    v_ferme := true;
  end if;

  return jsonb_build_object('total', v_total, 'faits', v_faits,
    'pourcentage', case when v_total > 0 then least(100, (100 * v_faits) / v_total) else 0 end,
    'passe_fermee', v_ferme);
end;
$$;

-- Rouvre une passe fermée (utilisée quand on annule le dernier arrêt qui l'avait fermée)
create or replace function public._rouvrir_passe(p_passe_id uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_p public.passes%rowtype;
  r   record;
begin
  select * into v_p from public.passes where id = p_passe_id for update;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_p.statut = 'en_cours' then
    return;
  end if;
  begin
    update public.passes set statut = 'en_cours', fin = null, fin_type = null, fin_estimee = false
     where id = p_passe_id;
  exception when unique_violation then
    raise exception 'impossible_de_rouvrir';     -- le chauffeur ou le véhicule a déjà une autre passe en cours
  end;
  -- les personnes sorties par la fermeture reviennent à bord, sauf si elles ont été placées ailleurs depuis
  for r in select e.id from public.equipage_periodes e where e.passe_id = p_passe_id and e.fin = v_p.fin loop
    begin
      update public.equipage_periodes set fin = null where id = r.id;
    exception when exclusion_violation then
      null;
    end;
  end loop;
end;
$$;

-- Déclencheur : quand un arrêt est ajouté, archivé ou change de route, les passes en cours sont recalculées
create or replace function public._trg_stops_recalcul()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_r1 uuid;
  v_r2 uuid;
  r    record;
begin
  if tg_op = 'DELETE' then
    v_r1 := old.route_id; v_r2 := old.route_id;
  elsif tg_op = 'INSERT' then
    v_r1 := new.route_id; v_r2 := new.route_id;
  else
    v_r1 := new.route_id; v_r2 := old.route_id;
  end if;
  for r in select p.id from public.passes p
            where p.statut = 'en_cours' and (p.route_id = v_r1 or p.route_id = v_r2) loop
    perform public._recalculer_passe(r.id, now());
  end loop;
  return null;
end;
$$;

drop trigger if exists stops_recalcul_passes on public.stops;
create trigger stops_recalcul_passes
  after insert or update of actif, route_id or delete on public.stops
  for each row execute function public._trg_stops_recalcul();

-- ---------------------------------------------------------------------
-- PASSES
-- ---------------------------------------------------------------------

create or replace function public.debuter_passe(
  p_id uuid,
  p_route_id uuid,
  p_equipe_id uuid,
  p_equipage jsonb default '[]'::jsonb,
  p_moment timestamptz default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_precision real default null)
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
begin
  v_uid := public._exiger_actif();

  select * into v_exist from public.passes where id = p_id;
  if found then
    if v_exist.chauffeur_id <> v_uid then
      raise exception 'non_autorise';
    end if;
    return jsonb_build_object('statut', 'deja_enregistre', 'passe_id', v_exist.id, 'numero', v_exist.numero);   -- geste renvoyé
  end if;

  if not exists (select 1 from public.routes r where r.id = p_route_id and r.actif) then
    raise exception 'route_inactive';
  end if;
  if not exists (select 1 from public.equipes e where e.id = p_equipe_id and e.actif) then
    raise exception 'equipe_inactive';
  end if;

  v_moment := public._moment_valide(p_moment);

  -- « Débuter la passe » ARCHIVE la précédente (celle du chauffeur et celle du véhicule)
  for v_prev in select p.id from public.passes p
                 where p.statut = 'en_cours' and (p.chauffeur_id = v_uid or p.equipe_id = p_equipe_id) loop
    perform public._fermer_passe(v_prev, v_moment, 'remplacee');
    v_fermees := v_fermees || to_jsonb(v_prev);
  end loop;

  -- Numéro suivant pour cette route (verrou pour éviter deux passes simultanées avec le même numéro)
  perform pg_advisory_xact_lock(hashtextextended(p_route_id::text, 0));
  select coalesce(max(p.numero), 0) + 1 into v_numero from public.passes p where p.route_id = p_route_id;
  select count(*)::int into v_total from public.stops s where s.route_id = p_route_id and s.actif;

  begin
    insert into public.passes (id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total)
    values (p_id, p_route_id, p_equipe_id, v_uid, v_numero, v_moment, v_total);
  exception when unique_violation then
    raise exception 'passe_deja_en_cours';
  end;

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

  return jsonb_build_object('statut', 'debutee', 'passe_id', p_id, 'numero', v_numero,
                            'nb_arrets_total', v_total, 'passes_archivees', v_fermees, 'equipage', v_resultats);
end;
$$;

create or replace function public.terminer_passe(p_passe_id uuid, p_moment timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid;
  v_p      public.passes%rowtype;
  v_moment timestamptz;
  v_stats  jsonb;
begin
  v_uid := public._exiger_actif();
  select * into v_p from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_p.chauffeur_id <> v_uid and not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  if v_p.statut = 'terminee' then
    return jsonb_build_object('statut', 'deja_terminee', 'fin', v_p.fin, 'fin_type', v_p.fin_type);   -- geste renvoyé
  end if;

  v_moment := public._moment_valide(p_moment);
  perform public._fermer_passe(p_passe_id, v_moment, case when v_p.chauffeur_id = v_uid then 'manuelle' else 'admin' end);
  select jsonb_build_object('pourcentage', p.pourcentage, 'faits', p.nb_arrets_faits, 'total', p.nb_arrets_total)
    into v_stats from public.passes p where p.id = p_passe_id;
  return jsonb_build_object('statut', 'terminee', 'fin', v_moment) || v_stats;
end;
$$;

-- ---------------------------------------------------------------------
-- ARRÊTS COMPLÉTÉS
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
  v_nb      integer;
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

  v_moment := greatest(public._moment_valide(p_moment), v_p.debut);
  -- Geste hors réseau reçu après la fin de la passe : accepté seulement s'il date d'avant sa fin
  if v_p.fin is not null and v_moment >= v_p.fin then
    return jsonb_build_object('statut', 'passe_terminee');
  end if;

  insert into public.passe_arrets (passe_id, stop_id, complete_le, complete_par, mode, lat, lon)
  values (p_passe_id, p_stop_id, v_moment, v_uid, p_mode, p_lat, p_lon)
  on conflict (passe_id, stop_id) do nothing;
  get diagnostics v_nb = row_count;

  v_stats := public._recalculer_passe(p_passe_id, v_moment);
  return jsonb_build_object('statut', case when v_nb = 0 then 'deja_complete' else 'complete' end) || v_stats;
end;
$$;

create or replace function public.annuler_arret(p_passe_id uuid, p_stop_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid;
  v_admin  boolean;
  v_p      public.passes%rowtype;
  v_pa     public.passe_arrets%rowtype;
  v_rouverte boolean := false;
  v_stats  jsonb;
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
  select * into v_pa from public.passe_arrets where passe_id = p_passe_id and stop_id = p_stop_id;
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

  delete from public.passe_arrets where id = v_pa.id;

  -- La passe s'était fermée parce que tout était complété : elle se rouvre
  if v_p.statut = 'terminee' and v_p.fin_type = 'complete' then
    perform public._rouvrir_passe(p_passe_id);
    v_rouverte := true;
  end if;

  v_stats := public._recalculer_passe(p_passe_id, now());
  return jsonb_build_object('statut', 'annule', 'passe_rouverte', v_rouverte) || v_stats;
end;
$$;

-- ---------------------------------------------------------------------
-- POSITION DU VÉHICULE (téléphone du chauffeur seulement)
-- ---------------------------------------------------------------------

create or replace function public.envoyer_position(
  p_passe_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_precision real default null,
  p_moment timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid;
  v_p      public.passes%rowtype;
  v_moment timestamptz;
begin
  v_uid := public._exiger_actif();
  select * into v_p from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_p.chauffeur_id <> v_uid then
    raise exception 'non_autorise';           -- seul le téléphone du chauffeur envoie la position
  end if;
  if v_p.statut <> 'en_cours' then
    return jsonb_build_object('statut', 'passe_terminee');
  end if;
  if p_lat is null or p_lon is null or p_lat not between -90 and 90 or p_lon not between -180 and 180 then
    raise exception 'position_invalide';
  end if;

  v_moment := public._moment_valide(p_moment);
  insert into public.positions as pos (passe_id, equipe_id, chauffeur_id, lat, lon, precision_m, maj_le)
  values (p_passe_id, v_p.equipe_id, v_uid, p_lat, p_lon, p_precision, v_moment)
  on conflict (passe_id) do update
     set lat = excluded.lat, lon = excluded.lon, precision_m = excluded.precision_m, maj_le = excluded.maj_le
   where pos.maj_le < excluded.maj_le;         -- une position plus ancienne (envoi hors réseau) n'écrase jamais une plus récente
  return jsonb_build_object('statut', 'ok');
end;
$$;

-- ---------------------------------------------------------------------
-- ADMINISTRATEUR : liste des employés (avec téléphones) et export de paie
-- ---------------------------------------------------------------------

create or replace function public.admin_lister_utilisateurs()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
            'id', u.id, 'nom', u.nom, 'telephone', u.telephone, 'role', u.role, 'actif', u.actif, 'cree_le', u.cree_le)
            order by u.nom)
          from public.utilisateurs u), '[]'::jsonb);
end;
$$;

-- Heures par employé pour une période, réparties par véhicule et par route.
-- REFUSE tant qu'un quart de la période est « à valider » ou encore ouvert : aucune heure n'est alors renvoyée.
create or replace function public.admin_export_paie(p_debut timestamptz, p_fin timestamptz)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_a_valider jsonb;
  v_ouverts   jsonb;
  v_employes  jsonb;
  v_a_verifier integer;
begin
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  if p_debut is null or p_fin is null or p_fin <= p_debut then
    raise exception 'periode_invalide';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('quart_id', q.id, 'employe', u.nom, 'debut', q.debut,
                                               'fin', q.fin, 'raison', q.raison_a_valider) order by q.debut), '[]'::jsonb)
    into v_a_valider
    from public.quarts q join public.utilisateurs u on u.id = q.utilisateur_id
   where q.a_valider and q.debut < p_fin and coalesce(q.fin, 'infinity'::timestamptz) > p_debut;
  if jsonb_array_length(v_a_valider) > 0 then
    return jsonb_build_object('statut', 'refuse', 'raison', 'quarts_a_valider', 'quarts', v_a_valider);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('quart_id', q.id, 'employe', u.nom, 'debut', q.debut) order by q.debut), '[]'::jsonb)
    into v_ouverts
    from public.quarts q join public.utilisateurs u on u.id = q.utilisateur_id
   where q.fin is null and q.debut < p_fin;
  if jsonb_array_length(v_ouverts) > 0 then
    return jsonb_build_object('statut', 'refuse', 'raison', 'quarts_ouverts', 'quarts', v_ouverts);
  end if;

  with qq as (
    select q.utilisateur_id, greatest(q.debut, p_debut) as a, least(q.fin, p_fin) as b
      from public.quarts q
     where q.fin is not null and q.debut < p_fin and q.fin > p_debut),
  tot as (
    select utilisateur_id, sum(extract(epoch from (b - a))) / 3600.0 as h, count(*) as n
      from qq group by utilisateur_id),
  rep as (
    select e.utilisateur_id, eq.nom as vehicule, r.nom as route,
           sum(extract(epoch from (least(coalesce(e.fin, qq.b), qq.b) - greatest(e.debut, qq.a)))) / 3600.0 as h
      from public.equipage_periodes e
      join qq on qq.utilisateur_id = e.utilisateur_id
      join public.passes p on p.id = e.passe_id
      join public.equipes eq on eq.id = p.equipe_id
      join public.routes r on r.id = p.route_id
     where e.debut < qq.b and coalesce(e.fin, 'infinity'::timestamptz) > qq.a
     group by e.utilisateur_id, eq.nom, r.nom),
  rep_tot as (select utilisateur_id, sum(h) as h from rep group by utilisateur_id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'utilisateur_id', t.utilisateur_id,
           'nom', u.nom,
           'heures', round(t.h::numeric, 2),
           'quarts', t.n,
           'repartition', coalesce((select jsonb_agg(jsonb_build_object('vehicule', rp.vehicule, 'route', rp.route,
                                                                      'heures', round(rp.h::numeric, 2))
                                                     order by rp.vehicule, rp.route)
                                      from rep rp where rp.utilisateur_id = t.utilisateur_id), '[]'::jsonb),
           'hors_equipage', round(greatest(t.h - coalesce(rt.h, 0), 0)::numeric, 2)
         ) order by u.nom), '[]'::jsonb)
    into v_employes
    from tot t
    join public.utilisateurs u on u.id = t.utilisateur_id
    left join rep_tot rt on rt.utilisateur_id = t.utilisateur_id;

  select count(*)::int into v_a_verifier from public.equipage_periodes e
   where e.a_verifier and e.debut < p_fin and coalesce(e.fin, 'infinity'::timestamptz) > p_debut;

  return jsonb_build_object('statut', 'ok',
    'periode', jsonb_build_object('debut', p_debut, 'fin', p_fin),
    'employes', v_employes,
    'avertissements', jsonb_build_object('periodes_equipage_a_verifier', v_a_verifier));
end;
$$;

-- ---------------------------------------------------------------------
-- FERMETURES AUTOMATIQUES (appelée toutes les 5 minutes par pg_cron ; personne d'autre ne peut l'appeler)
-- ---------------------------------------------------------------------
create or replace function public.fermer_expires()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_max_passe numeric;
  v_max_quart numeric;
  r           record;
  v_act       timestamptz;
  v_fin       timestamptz;
  v_passe     uuid;
  n_passes    integer := 0;
  n_quarts    integer := 0;
begin
  select (valeur #>> '{}')::numeric into v_max_passe from public.reglages where cle = 'duree_max_passe_heures';
  select (valeur #>> '{}')::numeric into v_max_quart from public.reglages where cle = 'duree_max_quart_heures';
  v_max_passe := coalesce(v_max_passe, 12);
  v_max_quart := coalesce(v_max_quart, 16);

  -- Passes oubliées : fin = dernière activité connue (dernier arrêt complété ou dernière position), jamais plus tard que la limite
  for r in select p.id, p.debut from public.passes p
            where p.statut = 'en_cours' and p.debut + (v_max_passe * interval '1 hour') < now() loop
    select greatest(r.debut,
                    coalesce((select max(pa.complete_le) from public.passe_arrets pa where pa.passe_id = r.id), r.debut),
                    coalesce((select ps.maj_le from public.positions ps where ps.passe_id = r.id), r.debut))
      into v_act;
    v_fin := least(v_act, r.debut + (v_max_passe * interval '1 hour'));
    perform public._fermer_passe(r.id, v_fin, 'delai_max', true);
    n_passes := n_passes + 1;
  end loop;

  -- Quarts oubliés : fin ESTIMÉE, marqués « à valider »
  for r in select q.id, q.utilisateur_id, q.debut from public.quarts q
            where q.fin is null and q.debut + (v_max_quart * interval '1 hour') < now() loop
    select greatest(r.debut,
                    coalesce((select max(greatest(e.debut, coalesce(e.fin, e.debut))) from public.equipage_periodes e
                               where e.utilisateur_id = r.utilisateur_id and e.debut >= r.debut), r.debut),
                    coalesce((select max(pa.complete_le) from public.passe_arrets pa
                               where pa.complete_par = r.utilisateur_id and pa.complete_le >= r.debut), r.debut),
                    coalesce((select max(greatest(p.debut, coalesce(p.fin, p.debut))) from public.passes p
                               where p.chauffeur_id = r.utilisateur_id and p.debut >= r.debut), r.debut))
      into v_act;
    v_fin := least(greatest(v_act, r.debut + interval '1 minute'), r.debut + (v_max_quart * interval '1 hour'));
    update public.quarts
       set fin = v_fin, fin_source = 'delai_max', fin_estimee = true,
           a_valider = true, raison_a_valider = coalesce(raison_a_valider, 'fin_estimee')
     where id = r.id;
    perform public._fermer_periodes_ouvertes(r.utilisateur_id, v_fin, null);
    v_passe := null;
    select p.id into v_passe from public.passes p where p.chauffeur_id = r.utilisateur_id and p.statut = 'en_cours';
    if v_passe is not null then
      perform public._fermer_passe(v_passe, v_fin, 'fin_quart', true);
    end if;
    n_quarts := n_quarts + 1;
  end loop;

  return jsonb_build_object('passes_fermees', n_passes, 'quarts_fermes', n_quarts);
end;
$$;

-- État de la tâche planifiée (pour la vérification ci-dessous)
create or replace function public._etat_tache_auto()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v jsonb;
begin
  if to_regclass('cron.job') is null then
    return null;
  end if;
  execute $q$select coalesce(jsonb_agg(jsonb_build_object('nom', jobname, 'horaire', schedule, 'active', active)), '[]'::jsonb)
             from cron.job where jobname = 'fermetures-automatiques'$q$ into v;
  return v;
end;
$$;

-- Planification toutes les 5 minutes (si pg_cron est installé)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.schedule('fermetures-automatiques', '*/5 * * * *', 'select public.fermer_expires()')$q$;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- DROITS
-- ---------------------------------------------------------------------
revoke all on function public._recalculer_passe(uuid, timestamptz)   from public, anon, authenticated;
revoke all on function public._rouvrir_passe(uuid)                   from public, anon, authenticated;
revoke all on function public._trg_stops_recalcul()                  from public, anon, authenticated;
revoke all on function public._etat_tache_auto()                     from public, anon, authenticated;
revoke all on function public.fermer_expires()                       from public, anon, authenticated;

revoke all on function public.debuter_passe(uuid, uuid, uuid, jsonb, timestamptz, double precision, double precision, real) from public, anon;
revoke all on function public.terminer_passe(uuid, timestamptz)                                                             from public, anon;
revoke all on function public.completer_arret(uuid, uuid, timestamptz, text, double precision, double precision)            from public, anon;
revoke all on function public.annuler_arret(uuid, uuid)                                                                      from public, anon;
revoke all on function public.envoyer_position(uuid, double precision, double precision, real, timestamptz)                 from public, anon;
revoke all on function public.admin_lister_utilisateurs()                                                                    from public, anon;
revoke all on function public.admin_export_paie(timestamptz, timestamptz)                                                    from public, anon;

grant execute on function public.debuter_passe(uuid, uuid, uuid, jsonb, timestamptz, double precision, double precision, real) to authenticated;
grant execute on function public.terminer_passe(uuid, timestamptz)                                                             to authenticated;
grant execute on function public.completer_arret(uuid, uuid, timestamptz, text, double precision, double precision)            to authenticated;
grant execute on function public.annuler_arret(uuid, uuid)                                                                      to authenticated;
grant execute on function public.envoyer_position(uuid, double precision, double precision, real, timestamptz)                 to authenticated;
grant execute on function public.admin_lister_utilisateurs()                                                                    to authenticated;
grant execute on function public.admin_export_paie(timestamptz, timestamptz)                                                    to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'fonctions_appelables_par_un_employe',  (select jsonb_agg(proname order by proname) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', oid, 'execute')),
  'fermer_expires_appelable_par_un_employe', has_function_privilege('authenticated', 'public.fermer_expires()', 'execute'),
  'declencheur_recalcul_arrets', (select count(*) from pg_trigger where tgname = 'stops_recalcul_passes' and not tgisinternal),
  'tache_planifiee', public._etat_tache_auto(),
  'pg_cron_installe', exists (select 1 from pg_extension where extname = 'pg_cron')
) as verification;
