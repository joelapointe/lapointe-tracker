-- =====================================================================
-- ÉTAPE 17 (MORCEAU 2) — « JE TERMINE » : LE QUART SANS NUMÉRO, LE QUART D'UN PASSAGER, « CE N'EST PAS EXACT », DEUX RÉGLAGES
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 19. Ne modifie AUCUNE donnée existante (il ajoute des règles, une colonne vide et deux réglages).
-- Peut être exécuté plusieurs fois sans problème (une valeur de réglage que tu as changée n'est jamais remise à zéro).
--
-- POURQUOI (décisions de Joé, 20 et 21 septembre 2026) : un passager n'a pas toujours son téléphone en main, ou n'en a pas.
-- Sans ce fichier, quand le chauffeur termine sa journée, le quart des passagers reste ouvert jusqu'à la fermeture
-- automatique (16 heures plus tard, « à valider »).
--
-- CE QUE FAIT CE FICHIER
--   1. quart_terminer accepte « mon quart ouvert » SANS numéro de quart. Nécessaire : un quart ouvert automatiquement par une passe
--      débutée sans réseau n'a pas de numéro connu du téléphone. AVEC un numéro, rien ne change.
--   2. quart_terminer_equipier : le CHAUFFEUR d'une passe termine le quart d'une personne qui était À BORD de SA passe. Jamais celui
--      d'une autre personne, jamais celui d'un quart déjà terminé. La trace : qui l'a fait (nouvelle colonne quarts.fin_par) et
--      l'origine « equipage » (fin_source). La personne sort aussi du camion.
--   3. quart_signaler_erreur : la personne dont le quart a été terminé par quelqu'un d'autre peut dire « ce n'est pas exact » : son
--      quart passe « à valider » (raison « fin_contestee »). L'export de paie le refuse alors, jusqu'à ce que l'administrateur le règle.
--   4. Deux réglages (lisibles par les employés, modifiables par l'administrateur) :
--        rappel_en_service_heures = 12   (rappel « tu es encore en service » dans l'application)
--        suggestion_pause_heures  = 4    (suggestion, JAMAIS une obligation, de prendre une pause ; rien n'est enregistré)
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.quart_terminer(uuid, timestamptz, double precision, double precision, real)') is null
     or to_regprocedure('public._fermer_periodes_ouvertes(uuid, timestamptz, uuid)') is null then
    raise exception 'les fonctions de quart (fichier 04) n''existent pas : les fichiers précédents n''ont pas tous été exécutés. Rien n''a été modifié.';
  end if;
end $$;

begin;

-- ---------------------------------------------------------------------
-- 1. Qui a terminé le quart (une colonne vide pour tous les quarts existants) et deux valeurs permises de plus
-- ---------------------------------------------------------------------
alter table public.quarts add column if not exists fin_par uuid references public.utilisateurs(id);
comment on column public.quarts.fin_par is 'Le CHAUFFEUR qui a terminé ce quart à la place de la personne (fin_source = equipage). Vide dans tous les autres cas.';

-- Les deux règles « valeurs permises » sont remplacées par les mêmes, avec une valeur de plus chacune.
-- (Retrouvées par leur contenu plutôt que par leur nom : le nom automatique pourrait différer d'une base à l'autre.)
do $$
declare r record;
begin
  for r in select conname from pg_constraint
            where conrelid = 'public.quarts'::regclass and contype = 'c'
              and (pg_get_constraintdef(oid) like '%''delai_max''%' or pg_get_constraintdef(oid) like '%''ouvert_par_equipage''%') loop
    execute format('alter table public.quarts drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.quarts add constraint quarts_fin_source_check
  check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin', 'equipage'));
alter table public.quarts add constraint quarts_raison_a_valider_check
  check (raison_a_valider in ('ouvert_par_equipage', 'ouvert_par_passe', 'fin_estimee', 'fin_contestee'));

-- ---------------------------------------------------------------------
-- 2. « Je termine » : avec un numéro de quart (comme avant) OU sans numéro (= mon quart ouvert à l'heure du geste)
-- ---------------------------------------------------------------------
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

  if p_quart_id is not null then
    -- Un quart précis : exactement comme avant
    select * into v_q from public.quarts where id = p_quart_id and utilisateur_id = v_uid;
    if not found then
      raise exception 'quart_introuvable';
    end if;
    if v_q.fin is not null then
      return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé
    end if;
    v_moment := public._moment_valide(p_moment);
  else
    -- « Mon quart ouvert » : celui qui couvrait l'heure du geste. Un geste ANCIEN renvoyé après un nouveau « Je commence »
    -- ne ferme donc jamais le nouveau quart (il ne couvre pas cette heure-là).
    v_moment := public._moment_valide(p_moment);
    select * into v_q from public.quarts q
     where q.utilisateur_id = v_uid and q.debut <= v_moment and (q.fin is null or q.fin >= v_moment)
     order by q.debut desc limit 1;
    if not found then
      return jsonb_build_object('statut', 'pas_en_quart');   -- rien à terminer (déjà fermé automatiquement, par exemple) : pas une erreur
    end if;
    if v_q.fin is not null then
      return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé
    end if;
  end if;

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
-- 3. Le chauffeur termine le quart d'une personne à bord de SA passe
-- ---------------------------------------------------------------------
-- Règles (chacune est vérifiée ici, pas seulement à l'écran) :
--   • seulement le chauffeur de la passe, et jamais pour lui-même (il a « Je termine ») ;
--   • la personne doit avoir été à bord de CETTE passe à l'heure donnée, ou en être descendue depuis moins de 10 minutes
--     (le chauffeur répond à la question « a-t-il terminé sa journée ? » quelques instants après l'avoir fait descendre) ;
--   • son quart prend fin à l'heure où elle est descendue (ou à l'heure donnée si elle est encore à bord), jamais avant son début ;
--   • un quart déjà terminé (renvoi du geste, ou la personne l'a terminé elle-même) n'est jamais modifié : « deja_termine » ;
--   • si elle est MAINTENANT à bord d'un autre camion, elle travaille encore : refusé (« a_bord_ailleurs »).
create or replace function public.quart_terminer_equipier(
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
  v_uid      uuid;
  v_passe    public.passes%rowtype;
  v_moment   timestamptz;
  v_per      public.equipage_periodes%rowtype;
  v_ailleurs public.equipage_periodes%rowtype;
  v_q        public.quarts%rowtype;
  v_fin      timestamptz;
begin
  v_uid := public._exiger_actif();
  if p_utilisateur_id is null or p_utilisateur_id = v_uid then
    raise exception 'non_autorise';   -- pour son propre quart : quart_terminer
  end if;

  select * into v_passe from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_passe.chauffeur_id <> v_uid then
    raise exception 'non_autorise';
  end if;

  v_moment := public._moment_valide(p_moment);

  -- À bord de MA passe à cette heure-là (ou descendu depuis moins de 10 minutes) ?
  select * into v_per from public.equipage_periodes e
   where e.passe_id = p_passe_id and e.utilisateur_id = p_utilisateur_id
     and e.debut <= v_moment
     and (e.fin is null or e.fin >= v_moment - interval '10 minutes')
   order by e.debut desc limit 1;
  if not found then
    return jsonb_build_object('statut', 'refuse', 'raison', 'pas_a_bord');
  end if;

  -- Son quart prend fin quand il est descendu (ou à l'heure du geste s'il est encore à bord)
  v_fin := least(v_moment, coalesce(v_per.fin, v_moment));

  select * into v_q from public.quarts q
   where q.utilisateur_id = p_utilisateur_id and q.debut <= v_fin and (q.fin is null or q.fin >= v_fin)
   order by q.debut desc limit 1;
  if not found then
    return jsonb_build_object('statut', 'pas_en_quart');
  end if;
  if v_q.fin is not null then
    return jsonb_build_object('statut', 'deja_termine', 'quart_id', v_q.id, 'fin', v_q.fin);   -- geste renvoyé, ou terminé par la personne
  end if;

  -- Elle est MAINTENANT à bord d'un autre camion : elle travaille encore, ce n'est pas au chauffeur d'ici de terminer son quart
  select * into v_ailleurs from public.equipage_periodes e
   where e.utilisateur_id = p_utilisateur_id and e.passe_id <> p_passe_id and e.fin is null
   limit 1;
  if found then
    return jsonb_build_object('statut', 'refuse', 'raison', 'a_bord_ailleurs',
      'vehicule', (select eq.nom from public.passes ps join public.equipes eq on eq.id = ps.equipe_id where ps.id = v_ailleurs.passe_id));
  end if;

  if v_fin <= v_q.debut then
    v_fin := v_q.debut + interval '1 second';
  end if;

  update public.quarts
     set fin = v_fin, fin_source = 'equipage', fin_par = v_uid,
         fin_lat = p_lat, fin_lon = p_lon, fin_precision_m = p_precision
   where id = v_q.id;

  -- La personne sort du camion (si elle y est encore)
  perform public._fermer_periodes_ouvertes(p_utilisateur_id, v_fin, v_uid);

  return jsonb_build_object('statut', 'termine', 'quart_id', v_q.id, 'fin', v_fin, 'utilisateur_id', p_utilisateur_id);
end;
$$;

-- ---------------------------------------------------------------------
-- 4. « Ce n'est pas exact » : la personne conteste la fin de son quart faite par quelqu'un d'autre
-- ---------------------------------------------------------------------
-- Seulement SON quart, terminé par quelqu'un d'autre, et pas encore validé par l'administrateur. Le quart passe « à valider »
-- (l'export de paie le refuse alors) ; l'heure de fin n'est PAS changée : c'est l'administrateur qui tranche (étape 19).
create or replace function public.quart_signaler_erreur(p_quart_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_q   public.quarts%rowtype;
begin
  v_uid := public._exiger_actif();
  select * into v_q from public.quarts where id = p_quart_id and utilisateur_id = v_uid;
  if not found then
    raise exception 'quart_introuvable';
  end if;
  if v_q.fin is null or v_q.fin_source is distinct from 'equipage' then
    return jsonb_build_object('statut', 'refuse', 'raison', 'pas_termine_par_un_autre');
  end if;
  if v_q.valide_le is not null then
    return jsonb_build_object('statut', 'refuse', 'raison', 'deja_valide');   -- l'administrateur l'a déjà examiné : lui parler directement
  end if;
  if v_q.a_valider and v_q.raison_a_valider = 'fin_contestee' then
    return jsonb_build_object('statut', 'deja_signale', 'quart_id', v_q.id);   -- geste renvoyé
  end if;

  update public.quarts
     set a_valider = true,
         raison_a_valider = 'fin_contestee',
         note = nullif(concat_ws(' | ', note, coalesce(nullif(left(trim(p_note), 200), ''), 'Fin contestée par l''employé')), '')
   where id = v_q.id;
  return jsonb_build_object('statut', 'signale', 'quart_id', v_q.id);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Deux réglages (une valeur déjà changée par l'administrateur n'est jamais remise à zéro)
-- ---------------------------------------------------------------------
insert into public.reglages (cle, valeur, description) values
  ('rappel_en_service_heures', '12', 'Rappel dans l''application : « Tu es encore en service depuis N heures : as-tu oublié de terminer ton quart ? » (aucune action automatique).'),
  ('suggestion_pause_heures',  '4',  'Suggestion (jamais une obligation) de prendre une pause après ce nombre d''heures en service. Rien n''est enregistré.')
on conflict (cle) do nothing;

-- ---------------------------------------------------------------------
-- 6. Droits : réservés aux employés connectés (jamais un visiteur)
-- ---------------------------------------------------------------------
revoke all on function public.quart_terminer(uuid, timestamptz, double precision, double precision, real) from public, anon;
revoke all on function public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real) from public, anon;
revoke all on function public.quart_signaler_erreur(uuid, text) from public, anon;

grant execute on function public.quart_terminer(uuid, timestamptz, double precision, double precision, real) to authenticated;
grant execute on function public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real) to authenticated;
grant execute on function public.quart_signaler_erreur(uuid, text) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'quart_terminer_versions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'quart_terminer'),
  'quart_terminer_accepte_sans_numero', (select coalesce(bool_and(pg_get_functiondef(oid) like '%p_quart_id is not null%'), false) from pg_proc
                                          where pronamespace = 'public'::regnamespace and proname = 'quart_terminer'),
  'fonctions_du_quart_appelables_par_un_employe', (select coalesce(jsonb_agg(proname order by proname), '[]'::jsonb) from pg_proc
                                                    where pronamespace = 'public'::regnamespace and proname like 'quart\_%'
                                                      and has_function_privilege('authenticated', oid, 'execute')),
  'fonctions_du_quart_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname order by proname), '[]'::jsonb) from pg_proc
                                                     where pronamespace = 'public'::regnamespace and proname like 'quart\_%'
                                                       and has_function_privilege('anon', oid, 'execute')),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'colonne_fin_par', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'quarts' and column_name = 'fin_par'),
  'origines_de_fin_permises', (select pg_get_constraintdef(oid) from pg_constraint
                                where conrelid = 'public.quarts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''delai_max''%'),
  'raisons_a_valider_permises', (select pg_get_constraintdef(oid) from pg_constraint
                                  where conrelid = 'public.quarts'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%''ouvert_par_equipage''%'),
  'reglages', (select jsonb_object_agg(cle, valeur) from public.reglages),
  'quarts_existants', (select count(*) from public.quarts)
) as verification;
