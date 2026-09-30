-- =====================================================================
-- DEMANDE 6 DE JOÉ (29 SEPTEMBRE 2026) — LE CAMION DANS LA ZONE D'UN CLIENT : le TEMPS PASSÉ chez chaque client (arrivée, départ) et le « COMPLÉTÉ AUTOMATIQUE »
-- =====================================================================
-- À EXÉCUTER APRÈS LES FICHIERS PRÉCÉDENTS (01 à 28). Ne modifie AUCUNE donnée existante, AUCUNE règle d'accès existante et AUCUNE fonction existante : elle ajoute une table
-- (vide au départ), une fonction, et UN réglage. Peut être exécuté plusieurs fois sans problème (les présences déjà notées ne sont jamais effacées ; un réglage que Joé a
-- déjà changé n'est jamais remis à 60).
--
-- POURQUOI : Joé veut savoir combien de TEMPS l'équipe passe chez chaque client (les clients sont presque tous à forfait : il fait lui-même le calcul de rentabilité avec le temps
-- et le nombre de visites). L'application ne garde AUCUNE trace GPS (seulement la dernière position de chaque camion) : le téléphone du CHAUFFEUR repère lui-même l'entrée et la
-- sortie de la zone d'un client (www/js/presence.js) et envoie DEUX heures par visite : l'arrivée et le départ. Rien d'autre du trajet n'est gardé.
--
-- CE QUE FAIT CE FICHIER :
--   • crée la table arret_presences : une présence = une passe, un client (stop_id), une arrivée, un départ (vide tant que le camion n'est pas parti). Lisible par l'ADMINISTRATEUR
--     seulement (le Suivi est un écran d'administrateur) ; AUCUNE écriture directe : tout passe par la fonction ci-dessous.
--   • crée la fonction arret_presence(passe, arrêt, arrivée, départ) : réservée au CHAUFFEUR de la passe (ou à l'administrateur) ; l'arrêt doit être de la route ET de la tâche de la
--     passe ; les heures sont celles du téléphone si elles sont raisonnables (comme les autres gestes : 3 jours au plus, le futur = maintenant) ; le départ ne peut pas précéder l'arrivée
--     et la visite ne dure pas plus de 12 heures. Répétable sans doublon (un geste renvoyé après une panne de réseau ne crée rien de plus, et le départ ne recule jamais).
--   • ajoute le réglage presence_complete_auto_s = 60 : après ce nombre de SECONDES passées dans la zone d'un client, l'arrêt est complété tout seul (mode « auto » de completer_arret,
--     qui existe déjà). 0 = jamais (le chauffeur touche « Complété »). Joé le change dans Admin > Réglages.
--   • NE CHANGE PAS completer_arret : le complété automatique passe par la fonction existante.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run (ou : Claude l'exécute lui-même avec l'accord de Joé). Le résultat « verification » du bas est à contrôler.
-- =====================================================================

do $$
begin
  if to_regclass('public.passes') is null or to_regclass('public.stops') is null or to_regclass('public.utilisateurs') is null or to_regclass('public.reglages') is null then
    raise exception 'les tables passes, stops, utilisateurs et reglages n''existent pas : les fichiers précédents n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_admin()') is null or to_regprocedure('public._exiger_actif()') is null or to_regprocedure('public._moment_valide(timestamptz)') is null then
    raise exception 'les fonctions de base (est_admin, _exiger_actif, _moment_valide : fichiers 03 et 04) n''existent pas. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.completer_arret(uuid, uuid, timestamptz, text, double precision, double precision)') is null then
    raise exception 'la fonction completer_arret (fichier 13) n''existe pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

-- Les présences : le temps passé chez un client, pendant une passe
create table if not exists public.arret_presences (
  id          uuid primary key default gen_random_uuid(),
  passe_id    uuid not null references public.passes(id),
  stop_id     uuid not null references public.stops(id),
  arrivee_le  timestamptz not null,
  depart_le   timestamptz,
  signale_par uuid references public.utilisateurs(id),
  cree_le     timestamptz not null default now(),
  maj_le      timestamptz not null default now(),
  constraint arret_presences_une_arrivee unique (passe_id, stop_id, arrivee_le),
  constraint arret_presences_depart_apres_arrivee check (depart_le is null or depart_le >= arrivee_le),
  constraint arret_presences_duree_plausible check (depart_le is null or depart_le - arrivee_le <= interval '12 hours')
);

comment on table public.arret_presences is
  'Le temps passé chez un client pendant une passe (demande 6) : l''heure d''arrivée dans sa zone et l''heure de départ, écrites par le téléphone du CHAUFFEUR (fonction arret_presence). Aucune trace GPS n''est gardée. Le Suivi (administrateur) additionne ces temps pour les visites qui ont un « Complété » (passe_arrets).';

alter table public.arret_presences enable row level security;

revoke all on public.arret_presences from public, anon, authenticated;
grant select on public.arret_presences to authenticated;

drop policy if exists arret_presences_admin_lecture on public.arret_presences;
create policy arret_presences_admin_lecture on public.arret_presences for select to authenticated
  using ((select public.est_admin()));

-- Noter une présence (arrivée seule, ou arrivée + départ). Renvoie {statut: 'enregistree', presence_id}.
create or replace function public.arret_presence(
  p_passe_id uuid,
  p_stop_id uuid,
  p_arrivee timestamptz,
  p_depart timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid;
  v_p       public.passes%rowtype;
  v_arrivee timestamptz;
  v_depart  timestamptz;
  v_id      uuid;
begin
  v_uid := public._exiger_actif();
  select * into v_p from public.passes where id = p_passe_id;
  if not found then
    raise exception 'passe_introuvable';
  end if;
  if v_p.chauffeur_id <> v_uid and not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  if p_arrivee is null then
    raise exception 'arrivee_requise';
  end if;
  if not exists (select 1 from public.stops s where s.id = p_stop_id and s.route_id = v_p.route_id) then
    raise exception 'arret_hors_route';
  end if;
  if not exists (select 1 from public.stops s where s.id = p_stop_id and s.service = v_p.tache) then
    raise exception 'arret_hors_tache';
  end if;

  v_arrivee := public._moment_valide(p_arrivee);
  v_depart  := case when p_depart is null then null else public._moment_valide(p_depart) end;
  if v_arrivee < v_p.debut - interval '10 minutes' then
    raise exception 'presence_avant_passe';
  end if;
  if v_depart is not null and v_depart < v_arrivee then
    raise exception 'presence_incoherente';
  end if;
  if v_depart is not null and v_depart - v_arrivee > interval '12 hours' then
    raise exception 'presence_trop_longue';
  end if;

  -- Répétable : la même arrivée pour la même passe et le même client ne fait qu'ajouter (ou avancer) le départ ; il ne recule jamais et ne s'efface jamais
  insert into public.arret_presences as ap (passe_id, stop_id, arrivee_le, depart_le, signale_par)
  values (p_passe_id, p_stop_id, v_arrivee, v_depart, v_uid)
  on conflict (passe_id, stop_id, arrivee_le) do update
    set depart_le = case when excluded.depart_le is null then ap.depart_le
                         when ap.depart_le is null then excluded.depart_le
                         else greatest(ap.depart_le, excluded.depart_le) end,
        maj_le = now()
  returning ap.id into v_id;

  return jsonb_build_object('statut', 'enregistree', 'presence_id', v_id);
end;
$$;

revoke all on function public.arret_presence(uuid, uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.arret_presence(uuid, uuid, timestamptz, timestamptz) to authenticated;

-- Le réglage du complété automatique (les employés le lisent, l'administrateur le change ; jamais remis à 60 s'il existe déjà)
insert into public.reglages (cle, valeur, description)
values ('presence_complete_auto_s', to_jsonb(60),
        'Complété automatique : après ce nombre de SECONDES passées dans la zone d''un client (selon le GPS du téléphone du chauffeur), l''arrêt est complété tout seul. 0 = jamais : le chauffeur touche « Complété ».')
on conflict (cle) do nothing;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à contrôler.
-- =====================================================================
select jsonb_build_object(
  'table_existe', to_regclass('public.arret_presences') is not null,
  'regles_actives', (select relrowsecurity from pg_class where oid = 'public.arret_presences'::regclass),
  'regles', (select coalesce(jsonb_agg(policyname || ' (' || cmd || ')' order by policyname), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename = 'arret_presences'),
  'visiteur_peut_lire', has_table_privilege('anon', 'public.arret_presences', 'select'),
  'connecte_peut_ecrire_directement', has_table_privilege('authenticated', 'public.arret_presences', 'insert') or has_table_privilege('authenticated', 'public.arret_presences', 'update') or has_table_privilege('authenticated', 'public.arret_presences', 'delete'),
  'fonction_presence_existe', to_regprocedure('public.arret_presence(uuid, uuid, timestamptz, timestamptz)') is not null,
  'visiteur_peut_appeler_la_fonction', has_function_privilege('anon', 'public.arret_presence(uuid, uuid, timestamptz, timestamptz)', 'execute'),
  'reglage_delai', (select valeur from public.reglages where cle = 'presence_complete_auto_s'),
  'presences_notees', (select count(*) from public.arret_presences)
) as verification;
