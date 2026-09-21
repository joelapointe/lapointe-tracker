-- =====================================================================
-- ÉTAPE 17 (SUITE) — TERMINER L'ÉQUIPE MÊME QUAND LA PASSE S'EST DÉJÀ FERMÉE (décision de Joé, 21 septembre 2026)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 20. Ne modifie AUCUNE donnée existante (une fonction remplacée par la même avec un cas de plus,
-- et un réglage ajouté). Peut être exécuté plusieurs fois sans problème (une valeur de réglage que tu as changée n'est jamais
-- remise à zéro).
--
-- POURQUOI : quand le dernier arrêt d'une passe est fait (100 %), le serveur FERME LA PASSE TOUT SEUL et fait descendre l'équipage
-- du camion. L'équipe rentre ensuite au garage, et le chauffeur fait « JE TERMINE » quelques minutes plus tard. Avec le fichier 20,
-- le chauffeur ne pouvait plus terminer le quart de ses passagers dans ce cas (il n'acceptait que les personnes à bord, ou
-- descendues depuis moins de 10 minutes) : les passagers sans téléphone restaient en service. C'est un cas très fréquent.
--
-- CE QUE FAIT CE FICHIER : quart_terminer_equipier accepte AUSSI une personne qui était encore à bord quand la passe du chauffeur
-- s'est TERMINÉE (100 %, fermeture automatique ou terminée par le chauffeur), à condition que la passe se soit terminée il y a
-- moins de N heures (réglage « fin_equipe_apres_passe_heures », 3 h par défaut). Le quart de la personne prend alors fin à
-- l'heure du geste (« JE TERMINE » du chauffeur : toute l'équipe rentre ensemble). Tout le reste est identique au fichier 20 :
--   • seulement le chauffeur de la passe, jamais pour lui-même ;
--   • la personne était à bord de CETTE passe (jamais une autre) ; sinon « pas_a_bord » ;
--   • un quart déjà terminé n'est jamais modifié (« deja_termine ») ;
--   • si la personne est MAINTENANT à bord d'un autre camion, elle travaille encore : refusé (« a_bord_ailleurs ») ;
--   • la trace : quarts.fin_par et fin_source = 'equipage' ; la personne peut dire « ce n'est pas exact ».
-- Une personne descendue du camion AVANT la fin de la passe (retirée par le chauffeur) reste régie par la règle des 10 minutes.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regprocedure('public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real)') is null then
    raise exception 'la fonction quart_terminer_equipier (fichier 20) n''existe pas : le fichier 20 n''a pas été exécuté. Rien n''a été modifié.';
  end if;
end $$;

begin;

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
  v_ok       boolean;
  v_heures   numeric;
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

  -- (a) À bord de MA passe à cette heure-là (ou descendu depuis moins de 10 minutes) : son quart prend fin quand il est descendu
  --     (ou à l'heure du geste s'il est encore à bord)
  select * into v_per from public.equipage_periodes e
   where e.passe_id = p_passe_id and e.utilisateur_id = p_utilisateur_id
     and e.debut <= v_moment
     and (e.fin is null or e.fin >= v_moment - interval '10 minutes')
   order by e.debut desc limit 1;
  v_ok := found;
  if v_ok then
    v_fin := least(v_moment, coalesce(v_per.fin, v_moment));
  else
    -- (b) NOUVEAU : encore à bord quand la passe s'est TERMINÉE (100 %, fermeture automatique, terminée par le chauffeur), et la passe
    --     s'est terminée il y a peu : l'équipe rentre ensemble, la journée se termine à l'heure du geste
    select (r.valeur #>> '{}')::numeric into v_heures from public.reglages r where r.cle = 'fin_equipe_apres_passe_heures';
    v_heures := coalesce(v_heures, 3);
    if v_passe.fin is not null and v_moment >= v_passe.fin and v_moment <= v_passe.fin + (v_heures * interval '1 hour') then
      select * into v_per from public.equipage_periodes e
       where e.passe_id = p_passe_id and e.utilisateur_id = p_utilisateur_id
         and e.debut <= v_passe.fin and (e.fin is null or e.fin >= v_passe.fin)
       order by e.debut desc limit 1;
      v_ok := found;
      if v_ok then
        v_fin := v_moment;
      end if;
    end if;
  end if;
  if not v_ok then
    return jsonb_build_object('statut', 'refuse', 'raison', 'pas_a_bord');
  end if;

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

-- Le réglage (une valeur déjà changée par l'administrateur n'est jamais remise à zéro)
insert into public.reglages (cle, valeur, description) values
  ('fin_equipe_apres_passe_heures', '3', 'Le chauffeur peut terminer le quart de son équipe (« JE TERMINE ») tant que sa dernière passe s''est terminée il y a moins de ce nombre d''heures.')
on conflict (cle) do nothing;

-- Droits : réservés aux employés connectés (jamais un visiteur)
revoke all on function public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real) from public, anon;
grant execute on function public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'quart_terminer_equipier_versions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'quart_terminer_equipier'),
  'gere_la_passe_terminee', (select coalesce(bool_and(pg_get_functiondef(oid) like '%fin_equipe_apres_passe_heures%'), false) from pg_proc
                              where pronamespace = 'public'::regnamespace and proname = 'quart_terminer_equipier'),
  'employe_peut_appeler', has_function_privilege('authenticated', 'public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real)', 'execute'),
  'visiteur_peut_appeler', has_function_privilege('anon', 'public.quart_terminer_equipier(uuid, uuid, timestamptz, double precision, double precision, real)', 'execute'),
  'fonction_verrouillee_search_path', (select coalesce(bool_and(proconfig::text like '%search_path%'), false) from pg_proc
                                        where pronamespace = 'public'::regnamespace and proname = 'quart_terminer_equipier'),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'reglages', (select jsonb_object_agg(cle, valeur) from public.reglages),
  'quarts_existants', (select count(*) from public.quarts)
) as verification;
