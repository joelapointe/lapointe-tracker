-- =====================================================================
-- ÉTAPE 9a — Fonctions serveur : quarts de travail (punch) et équipage
-- =====================================================================
-- À EXÉCUTER APRÈS L'ÉTAPE 8. À n'exécuter qu'UNE SEULE FOIS.
--
-- POURQUOI DES FONCTIONS ?
--   L'employé n'a aucune écriture directe sur les quarts, les passes ou l'équipage
--   (étape 8). Ses gestes passent par ces fonctions, qui vérifient TOUT côté serveur :
--   qui a le droit, les conflits, les chevauchements, les heures. Une personne qui
--   contournerait l'application n'obtiendrait rien de plus.
--
-- FONCTIONS OFFERTES À L'APPLICATION (employés connectés seulement)
--   quart_commencer(...)     « Je commence »   (position GPS enregistrée)
--   quart_terminer(...)      « Je termine »    (ferme aussi sa passe et sa place à bord)
--   equipage_ajouter(...)    ajoute un collègue à bord (avertit ou transfère si conflit)
--   equipage_retirer(...)    retire un collègue (ou ANNULE si fait il y a moins de 2 min)
--   admin_valider_quart(...) l'administrateur valide un quart « à valider »
--   admin_annuler_transfert(...) l'administrateur corrige un transfert fait par erreur
--
-- RÈGLES IMPORTANTES
--   • Chaque geste peut être renvoyé plusieurs fois (mode hors réseau) sans créer de doublon :
--     l'app fournit un identifiant unique, le serveur reconnaît un geste déjà reçu.
--   • L'heure fournie par le téléphone est acceptée (mode hors réseau). Une heure dans le
--     futur est ramenée à maintenant ; une heure de plus de 3 jours est refusée.
--   • Un employé ajouté à bord sans quart ouvert reçoit un quart « ouvert par l'équipage »,
--     marqué À VALIDER dans ton panneau (l'export de paie le refusera tant qu'il n'est pas validé).
--   • Seuls le chauffeur qui a démarré la passe et l'administrateur modifient l'équipage.
--   • On ne peut pas retirer le chauffeur ni transférer un chauffeur qui conduit ailleurs.
--   • Si un employé est déjà à bord d'un autre véhicule : la fonction répond par un
--     AVERTISSEMENT qui nomme le véhicule ; rien ne change tant que le chauffeur n'a pas
--     confirmé (forcer = true). Alors c'est un TRANSFERT : sortie et entrée à la MÊME heure.
--   • Avertissement aussi si l'employé a terminé son quart depuis moins de N heures
--     (réglage « alerte_quart_termine_heures », 4 h par défaut).
-- =====================================================================

begin;

-- Valeur 'remplacee' : passe fermée parce qu'une nouvelle passe a démarré sur le même véhicule (étape 9b)
alter table public.passes drop constraint if exists passes_fin_type_check;
alter table public.passes add constraint passes_fin_type_check
  check (fin_type in ('manuelle', 'complete', 'delai_max', 'fin_quart', 'admin', 'remplacee'));

-- ---------------------------------------------------------------------
-- OUTILS INTERNES (jamais appelables depuis l'application)
-- ---------------------------------------------------------------------

create or replace function public._exiger_actif()
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare v uuid := (select auth.uid());
begin
  if v is null or not public.est_actif() then
    raise exception 'non_autorise';
  end if;
  return v;
end;
$$;

-- Heure d'un geste : celle du téléphone, si elle est raisonnable
create or replace function public._moment_valide(p_moment timestamptz)
returns timestamptz
language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_moment is null or p_moment > now() + interval '2 minutes' then
    return now();
  end if;
  if p_moment < now() - interval '3 days' then
    raise exception 'geste_trop_ancien';
  end if;
  return p_moment;
end;
$$;

create or replace function public._quart_couvrant(p_user uuid, p_moment timestamptz)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select q.id
    from public.quarts q
   where q.utilisateur_id = p_user
     and q.debut <= p_moment
     and (q.fin is null or q.fin > p_moment)
   limit 1;
$$;

-- Ouvre un quart automatique (à valider) si l'employé n'en a pas un qui couvre ce moment.
-- Renvoie l'id du quart, ou NULL si c'est impossible (chevauchement avec un autre quart).
create or replace function public._assurer_quart(
  p_user uuid, p_moment timestamptz, p_source text,
  p_lat double precision, p_lon double precision, p_precision real)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  v_id := public._quart_couvrant(p_user, p_moment);
  if v_id is not null then
    return v_id;
  end if;
  begin
    insert into public.quarts (utilisateur_id, debut, debut_lat, debut_lon, debut_precision_m,
                               debut_source, a_valider, raison_a_valider)
    values (p_user, p_moment, p_lat, p_lon, p_precision, p_source, true,
            case p_source when 'equipage' then 'ouvert_par_equipage' else 'ouvert_par_passe' end)
    returning id into v_id;
    return v_id;
  exception when exclusion_violation then
    return null;
  end;
end;
$$;

create or replace function public._fermer_periodes_ouvertes(p_user uuid, p_moment timestamptz, p_par uuid)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.equipage_periodes
     set fin = greatest(debut, p_moment), retire_par = p_par
   where utilisateur_id = p_user and fin is null;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Ferme une passe : date de fin, équipage sorti à la même heure, position du véhicule effacée
create or replace function public._fermer_passe(
  p_passe_id uuid, p_moment timestamptz, p_type text, p_estimee boolean default false)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_fin timestamptz;
begin
  update public.passes
     set statut = 'terminee', fin = greatest(debut, p_moment), fin_type = p_type, fin_estimee = p_estimee
   where id = p_passe_id and statut = 'en_cours'
  returning fin into v_fin;
  if v_fin is null then
    return;
  end if;
  update public.equipage_periodes set fin = greatest(debut, v_fin)
   where passe_id = p_passe_id and fin is null;
  delete from public.positions where passe_id = p_passe_id;
end;
$$;

-- Cœur de l'ajout à bord (utilisé par equipage_ajouter et, à l'étape 9b, par debuter_passe)
create or replace function public._equipage_ajouter(
  p_passe_id uuid, p_user uuid, p_moment timestamptz, p_role text, p_auteur uuid, p_forcer boolean,
  p_lat double precision, p_lon double precision, p_precision real)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_passe          public.passes%rowtype;
  v_cover          public.equipage_periodes%rowtype;
  v_later          public.equipage_periodes%rowtype;
  v_cover_passe    public.passes%rowtype;
  v_avert          jsonb := '[]'::jsonb;
  v_moment         timestamptz := p_moment;
  v_derniere_fin   timestamptz;
  v_alerte_h       numeric;
  v_tid            uuid := null;
  v_fin_new        timestamptz := null;
  v_verif          boolean := false;
  v_couvert_avant  boolean;
  v_quart          uuid;
  v_id             uuid;
begin
  select * into v_passe from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_moment < v_passe.debut then
    v_moment := v_passe.debut;
  end if;
  if v_passe.fin is not null and v_moment >= v_passe.fin then
    return jsonb_build_object('statut', 'passe_terminee');
  end if;

  -- Déjà à bord de cette passe ?
  if exists (select 1 from public.equipage_periodes e
              where e.passe_id = p_passe_id and e.utilisateur_id = p_user
                and e.debut <= v_moment and (e.fin is null or e.fin > v_moment)) then
    return jsonb_build_object('statut', 'deja_a_bord');
  end if;

  -- À bord d'un AUTRE véhicule à ce moment-là ?
  select * into v_cover from public.equipage_periodes e
   where e.utilisateur_id = p_user and e.passe_id <> p_passe_id
     and e.debut <= v_moment and (e.fin is null or e.fin > v_moment)
   limit 1;
  if found then
    select * into v_cover_passe from public.passes where id = v_cover.passe_id;
    if v_cover.role = 'chauffeur' and v_cover_passe.statut = 'en_cours' then
      return jsonb_build_object('statut', 'refuse', 'raison', 'chauffeur_ailleurs',
        'vehicule', (select e.nom from public.equipes e where e.id = v_cover_passe.equipe_id));
    end if;
    v_avert := v_avert || jsonb_build_array(jsonb_build_object(
      'type', 'conflit_vehicule',
      'vehicule', (select e.nom from public.equipes e where e.id = v_cover_passe.equipe_id),
      'passe_id', v_cover.passe_id,
      'depuis', v_cover.debut));
  end if;

  -- A-t-il terminé son quart il y a peu de temps ? (risque d'embarquer quelqu'un déjà reparti)
  if public._quart_couvrant(p_user, v_moment) is null then
    select max(q.fin) into v_derniere_fin from public.quarts q
     where q.utilisateur_id = p_user and q.fin is not null and q.fin <= v_moment;
    select (r.valeur #>> '{}')::numeric into v_alerte_h from public.reglages r where r.cle = 'alerte_quart_termine_heures';
    if v_derniere_fin is not null
       and v_derniere_fin > v_moment - (coalesce(v_alerte_h, 4) * interval '1 hour') then
      v_avert := v_avert || jsonb_build_array(jsonb_build_object('type', 'quart_termine', 'fin', v_derniere_fin));
    end if;
  end if;

  if jsonb_array_length(v_avert) > 0 and not p_forcer then
    return jsonb_build_object('statut', 'avertissement', 'avertissements', v_avert);
  end if;

  -- Une période plus TARDIVE existe déjà (geste hors réseau reçu en retard) : on s'arrête là où elle commence
  select * into v_later from public.equipage_periodes e
   where e.utilisateur_id = p_user and e.debut > v_moment
   order by e.debut limit 1;
  if found then
    v_fin_new := v_later.debut;
    v_verif := true;
    update public.equipage_periodes set a_verifier = true where id = v_later.id;
  end if;
  -- La passe est déjà terminée (geste reçu en retard) : la période ne peut pas dépasser sa fin
  if v_passe.fin is not null then
    v_fin_new := least(coalesce(v_fin_new, 'infinity'::timestamptz), v_passe.fin);
    if v_fin_new = 'infinity'::timestamptz then v_fin_new := null; end if;
  end if;

  -- Transfert : sortie de l'autre véhicule et entrée ici, à la MÊME heure
  if v_cover.id is not null then
    v_tid := gen_random_uuid();
    update public.equipage_periodes
       set fin = v_moment, retire_par = p_auteur, transfert_id = v_tid
     where id = v_cover.id;
  end if;

  v_couvert_avant := public._quart_couvrant(p_user, v_moment) is not null;

  insert into public.equipage_periodes (passe_id, utilisateur_id, role, debut, fin, ajoute_par, transfert_id, a_verifier)
  values (p_passe_id, p_user, p_role, v_moment, v_fin_new, p_auteur, v_tid, v_verif)
  returning id into v_id;

  v_quart := public._assurer_quart(p_user, v_moment, case when p_role = 'chauffeur' then 'passe' else 'equipage' end,
                                   p_lat, p_lon, p_precision);
  if v_quart is null then
    update public.equipage_periodes set a_verifier = true where id = v_id;
    v_verif := true;
  end if;

  return jsonb_build_object(
    'statut', case when v_tid is null then 'ajoute' else 'transfere' end,
    'periode_id', v_id,
    'debut', v_moment,
    'transfert_id', v_tid,
    'de_passe_id', v_cover.passe_id,
    'quart_id', v_quart,
    'quart_ouvert_automatiquement', (v_quart is not null and not v_couvert_avant),
    'a_verifier', v_verif);
end;
$$;

-- ---------------------------------------------------------------------
-- QUARTS DE TRAVAIL : « Je commence » / « Je termine »
-- ---------------------------------------------------------------------

create or replace function public.quart_commencer(
  p_id uuid,
  p_moment timestamptz default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_precision real default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid;
  v_moment    timestamptz;
  v_couvrant  uuid;
begin
  v_uid := public._exiger_actif();

  if exists (select 1 from public.quarts where id = p_id) then
    if exists (select 1 from public.quarts where id = p_id and utilisateur_id = v_uid) then
      return jsonb_build_object('statut', 'deja_enregistre', 'quart_id', p_id);   -- geste renvoyé (hors réseau)
    end if;
    raise exception 'non_autorise';
  end if;

  v_moment := public._moment_valide(p_moment);
  v_couvrant := public._quart_couvrant(v_uid, v_moment);
  if v_couvrant is not null then
    return jsonb_build_object('statut', 'deja_en_quart', 'quart_id', v_couvrant);
  end if;

  begin
    insert into public.quarts (id, utilisateur_id, debut, debut_lat, debut_lon, debut_precision_m, debut_source)
    values (p_id, v_uid, v_moment, p_lat, p_lon, p_precision, 'manuel');
  exception when exclusion_violation then
    return jsonb_build_object('statut', 'chevauchement');
  end;
  return jsonb_build_object('statut', 'commence', 'quart_id', p_id, 'debut', v_moment);
end;
$$;

create or replace function public.quart_terminer(
  p_quart_id uuid,
  p_moment timestamptz default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_precision real default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid;
  v_q       public.quarts%rowtype;
  v_moment  timestamptz;
  v_passe   uuid;
begin
  v_uid := public._exiger_actif();

  select * into v_q from public.quarts where id = p_quart_id and utilisateur_id = v_uid;
  if not found then
    raise exception 'quart_introuvable';
  end if;
  if v_q.fin is not null then
    return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé
  end if;

  v_moment := public._moment_valide(p_moment);
  if v_moment <= v_q.debut then
    v_moment := v_q.debut + interval '1 second';
  end if;

  update public.quarts
     set fin = v_moment, fin_source = 'manuel', fin_lat = p_lat, fin_lon = p_lon, fin_precision_m = p_precision
   where id = v_q.id;

  -- Il quitte son véhicule
  perform public._fermer_periodes_ouvertes(v_uid, v_moment, v_uid);
  -- S'il conduisait une passe, elle se termine avec son quart
  select p.id into v_passe from public.passes p where p.chauffeur_id = v_uid and p.statut = 'en_cours';
  if v_passe is not null then
    perform public._fermer_passe(v_passe, v_moment, 'fin_quart');
  end if;

  return jsonb_build_object('statut', 'termine', 'quart_id', v_q.id, 'fin', v_moment, 'passe_fermee', v_passe);
end;
$$;

-- ---------------------------------------------------------------------
-- ÉQUIPAGE : ajouter, retirer (ou annuler)
-- ---------------------------------------------------------------------

create or replace function public.equipage_ajouter(
  p_cle_client uuid,
  p_passe_id uuid,
  p_utilisateur_id uuid,
  p_moment timestamptz default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_precision real default null,
  p_forcer boolean default false)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid;
  v_passe     public.passes%rowtype;
  v_moment    timestamptz;
  v_deja      jsonb;
  v_res       jsonb;
begin
  v_uid := public._exiger_actif();

  if p_cle_client is not null then
    select j.details -> 'resultat' into v_deja from public.equipage_journal j where j.cle_client = p_cle_client;
    if v_deja is not null then
      return v_deja || jsonb_build_object('rejoue', true);
    end if;
  end if;

  select * into v_passe from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_passe.chauffeur_id <> v_uid and not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  if not exists (select 1 from public.utilisateurs u where u.id = p_utilisateur_id and u.actif) then
    raise exception 'utilisateur_inactif';
  end if;

  v_moment := public._moment_valide(p_moment);
  v_res := public._equipage_ajouter(p_passe_id, p_utilisateur_id, v_moment, 'passager', v_uid,
                                    coalesce(p_forcer, false), p_lat, p_lon, p_precision);

  if v_res ->> 'statut' in ('ajoute', 'transfere') then
    insert into public.equipage_journal (cle_client, type, moment, passe_id, utilisateur_id,
                                         de_passe_id, vers_passe_id, auteur_id, lat, lon, details)
    values (p_cle_client,
            case when v_res ->> 'statut' = 'transfere' then 'transfert' else 'ajout' end,
            v_moment, p_passe_id, p_utilisateur_id,
            nullif(v_res ->> 'de_passe_id', '')::uuid,
            case when v_res ->> 'statut' = 'transfere' then p_passe_id end,
            v_uid, p_lat, p_lon, jsonb_build_object('resultat', v_res));
  end if;
  return v_res;
end;
$$;

create or replace function public.equipage_retirer(
  p_cle_client uuid,
  p_passe_id uuid,
  p_utilisateur_id uuid,
  p_moment timestamptz default null,
  p_lat double precision default null,
  p_lon double precision default null,
  p_precision real default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid;
  v_passe      public.passes%rowtype;
  v_per        public.equipage_periodes%rowtype;
  v_prec       public.equipage_periodes%rowtype;
  v_prec_passe public.passes%rowtype;
  v_moment     timestamptz;
  v_deja       jsonb;
  v_res        jsonb;
  v_restaure   boolean := false;
  v_quart_supprime boolean := false;
begin
  v_uid := public._exiger_actif();

  if p_cle_client is not null then
    select j.details -> 'resultat' into v_deja from public.equipage_journal j where j.cle_client = p_cle_client;
    if v_deja is not null then
      return v_deja || jsonb_build_object('rejoue', true);
    end if;
  end if;

  select * into v_passe from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_passe.chauffeur_id <> v_uid and not public.est_admin() then
    raise exception 'non_autorise';
  end if;

  select * into v_per from public.equipage_periodes e
   where e.passe_id = p_passe_id and e.utilisateur_id = p_utilisateur_id and e.fin is null;
  if not found then
    return jsonb_build_object('statut', 'pas_a_bord');
  end if;
  if v_per.role = 'chauffeur' then
    raise exception 'chauffeur_ne_peut_etre_retire';
  end if;

  v_moment := greatest(public._moment_valide(p_moment), v_per.debut);

  if v_moment - v_per.debut < interval '2 minutes' then
    -- ANNULATION (« Annuler » juste après un ajout) : on efface l'erreur au lieu de laisser une trace de quelques secondes
    delete from public.equipage_periodes where id = v_per.id;

    if v_per.transfert_id is not null then
      -- C'était un transfert : on remet l'employé dans son véhicule d'origine, si celui-ci roule encore
      select * into v_prec from public.equipage_periodes e
       where e.transfert_id = v_per.transfert_id and e.id <> v_per.id and e.fin = v_per.debut;
      if found then
        select * into v_prec_passe from public.passes where id = v_prec.passe_id;
        if v_prec_passe.statut = 'en_cours' then
          update public.equipage_periodes set fin = null, retire_par = null, transfert_id = null where id = v_prec.id;
          v_restaure := true;
        end if;
      end if;
    end if;

    -- Le quart ouvert automatiquement par CET ajout (même heure de début) est supprimé aussi
    delete from public.quarts q
     where q.utilisateur_id = p_utilisateur_id and q.debut = v_per.debut and q.debut_source = 'equipage'
       and q.fin is null and q.a_valider;
    v_quart_supprime := found;

    v_res := jsonb_build_object('statut', 'annule', 'quart_supprime', v_quart_supprime,
                                'retour_vehicule_precedent', v_restaure);
    insert into public.equipage_journal (cle_client, type, moment, passe_id, utilisateur_id, auteur_id, lat, lon, details)
    values (p_cle_client, 'annulation', v_moment, p_passe_id, p_utilisateur_id, v_uid, p_lat, p_lon,
            jsonb_build_object('resultat', v_res));
    return v_res;
  end if;

  update public.equipage_periodes set fin = v_moment, retire_par = v_uid where id = v_per.id;
  v_res := jsonb_build_object('statut', 'retire', 'fin', v_moment);
  insert into public.equipage_journal (cle_client, type, moment, passe_id, utilisateur_id, auteur_id, lat, lon, details)
  values (p_cle_client, 'retrait', v_moment, p_passe_id, p_utilisateur_id, v_uid, p_lat, p_lon,
          jsonb_build_object('resultat', v_res));
  return v_res;
end;
$$;

-- ---------------------------------------------------------------------
-- ADMINISTRATEUR : valider un quart, corriger un transfert
-- ---------------------------------------------------------------------

create or replace function public.admin_valider_quart(p_quart_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_q public.quarts%rowtype;
begin
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  select * into v_q from public.quarts where id = p_quart_id;
  if not found then
    raise exception 'quart_introuvable';
  end if;
  if v_q.fin is null then
    raise exception 'quart_encore_ouvert';
  end if;
  update public.quarts
     set a_valider = false,
         valide_par = (select auth.uid()),
         valide_le = now(),
         note = coalesce(nullif(concat_ws(' | ', note, p_note), ''), note)
   where id = p_quart_id;
  return jsonb_build_object('statut', 'valide', 'quart_id', p_quart_id);
end;
$$;

-- Annule un transfert : l'entrée dans le nouveau véhicule disparaît et l'employé
-- reste dans l'ancien, comme si le transfert n'avait jamais eu lieu.
-- Ensuite, l'administrateur peut ajouter la BONNE personne avec equipage_ajouter.
create or replace function public.admin_annuler_transfert(p_transfert_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_entree  public.equipage_periodes%rowtype;
  v_sortie  public.equipage_periodes%rowtype;
  v_passe   public.passes%rowtype;
  v_fin     timestamptz;
begin
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;

  -- la sortie : la période dont la fin est l'heure de début de l'autre
  select s.* into v_sortie from public.equipage_periodes s
   where s.transfert_id = p_transfert_id
     and exists (select 1 from public.equipage_periodes e
                  where e.transfert_id = p_transfert_id and e.id <> s.id and e.debut = s.fin and e.passe_id <> s.passe_id);
  if not found then
    raise exception 'transfert_introuvable';
  end if;
  select * into v_entree from public.equipage_periodes e
   where e.transfert_id = p_transfert_id and e.id <> v_sortie.id;

  select * into v_passe from public.passes where id = v_sortie.passe_id;
  v_fin := v_entree.fin;
  if v_passe.fin is not null and (v_fin is null or v_fin > v_passe.fin) then
    v_fin := v_passe.fin;
  end if;

  delete from public.equipage_periodes where id = v_entree.id;
  update public.equipage_periodes set fin = v_fin, retire_par = null, transfert_id = null where id = v_sortie.id;

  insert into public.equipage_journal (type, moment, passe_id, utilisateur_id, de_passe_id, vers_passe_id, auteur_id, details)
  values ('correction_admin', now(), v_sortie.passe_id, v_sortie.utilisateur_id, v_sortie.passe_id, v_entree.passe_id,
          (select auth.uid()), jsonb_build_object('action', 'annulation_transfert', 'transfert_id', p_transfert_id));

  return jsonb_build_object('statut', 'transfert_annule', 'utilisateur_id', v_sortie.utilisateur_id,
                            'reste_dans_passe_id', v_sortie.passe_id);
end;
$$;

-- ---------------------------------------------------------------------
-- DROITS : outils internes fermés à tous ; fonctions publiques réservées aux connectés
-- ---------------------------------------------------------------------
revoke all on function public._exiger_actif()                                            from public, anon, authenticated;
revoke all on function public._moment_valide(timestamptz)                                from public, anon, authenticated;
revoke all on function public._quart_couvrant(uuid, timestamptz)                         from public, anon, authenticated;
revoke all on function public._assurer_quart(uuid, timestamptz, text, double precision, double precision, real) from public, anon, authenticated;
revoke all on function public._fermer_periodes_ouvertes(uuid, timestamptz, uuid)         from public, anon, authenticated;
revoke all on function public._fermer_passe(uuid, timestamptz, text, boolean)            from public, anon, authenticated;
revoke all on function public._equipage_ajouter(uuid, uuid, timestamptz, text, uuid, boolean, double precision, double precision, real) from public, anon, authenticated;

revoke all on function public.quart_commencer(uuid, timestamptz, double precision, double precision, real)   from public, anon;
revoke all on function public.quart_terminer(uuid, timestamptz, double precision, double precision, real)    from public, anon;
revoke all on function public.equipage_ajouter(uuid, uuid, uuid, timestamptz, double precision, double precision, real, boolean) from public, anon;
revoke all on function public.equipage_retirer(uuid, uuid, uuid, timestamptz, double precision, double precision, real)          from public, anon;
revoke all on function public.admin_valider_quart(uuid, text)                            from public, anon;
revoke all on function public.admin_annuler_transfert(uuid)                              from public, anon;

grant execute on function public.quart_commencer(uuid, timestamptz, double precision, double precision, real)   to authenticated;
grant execute on function public.quart_terminer(uuid, timestamptz, double precision, double precision, real)    to authenticated;
grant execute on function public.equipage_ajouter(uuid, uuid, uuid, timestamptz, double precision, double precision, real, boolean) to authenticated;
grant execute on function public.equipage_retirer(uuid, uuid, uuid, timestamptz, double precision, double precision, real)          to authenticated;
grant execute on function public.admin_valider_quart(uuid, text)                         to authenticated;
grant execute on function public.admin_annuler_transfert(uuid)                           to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'fonctions_appelables_par_un_employe',  (select jsonb_agg(proname order by proname) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('authenticated', oid, 'execute')),
  'fonctions_internes_fermees', (select jsonb_agg(proname order by proname) from pg_proc
                                  where pronamespace = 'public'::regnamespace and proname like '\_%' and not has_function_privilege('authenticated', oid, 'execute')),
  'types_de_fin_de_passe', (select pg_get_constraintdef(oid) from pg_constraint where conname = 'passes_fin_type_check')
) as verification;
