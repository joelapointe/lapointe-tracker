-- =====================================================================
-- ÉTAPE 10 (partie base de données) — Outils pour les fonctions d'administration des employés
-- =====================================================================
-- CONTEXTE
--   Créer un employé, le désactiver, le supprimer ou changer son NIP demande la clé secrète
--   du serveur (service_role). Cette clé ne se met JAMAIS dans l'application : ces gestes sont
--   faits par une « Edge Function » Supabase (dossier supabase/functions/admin-employes).
--   Cette fonction a besoin de deux petites choses dans la base, que ce fichier ajoute.
--
-- CE QUE ÇA FAIT
--   1. _utilisateur_a_de_l_historique(id) : dit si un compte est mentionné quelque part
--      (quarts, passes, équipage, arrêts complétés, problèmes, journaux, positions...).
--      Elle regarde TOUTES les tables qui pointent vers « utilisateurs » (via les clés
--      étrangères) : si une table est ajoutée plus tard, elle est comptée automatiquement.
--      Sert à décider : supprimer (aucun historique) ou seulement désactiver.
--   2. Droits du serveur (service_role) : lire les profils et changer « actif ».
--      (Sur Supabase, service_role a déjà tous les droits par défaut : ces lignes ne font
--      que rendre le besoin explicite. Ce qui empêche la fonction de toucher au rôle d'un
--      compte, c'est son code : elle n'écrit jamais « role », voir functions/admin-employes.)
--
-- SÉCURITÉ
--   • La fonction est réservée au serveur : ni le visiteur, ni un employé, ni Joé depuis
--     l'application ne peuvent l'appeler (vérifié par la requête « vérification » ci-dessous).
--   • Aucune donnée n'est modifiée par ce fichier. Il peut être exécuté plusieurs fois sans danger.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

begin;

create or replace function public._utilisateur_a_de_l_historique(p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r        record;
  v_existe boolean;
begin
  -- Chaque clé étrangère (une seule colonne) qui pointe vers public.utilisateurs.
  for r in
    select c.conrelid::regclass::text as la_table, a.attname as la_colonne
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.utilisateurs'::regclass
      and c.conrelid <> c.confrelid
      and array_length(c.conkey, 1) = 1
  loop
    execute format('select exists (select 1 from %s where %I = $1)', r.la_table, r.la_colonne)
      into v_existe using p_id;
    if v_existe then
      return true;
    end if;
  end loop;
  return false;
end;
$$;

revoke all on function public._utilisateur_a_de_l_historique(uuid) from public, anon, authenticated;
grant execute on function public._utilisateur_a_de_l_historique(uuid) to service_role;

-- Le serveur lit les profils et change « actif ».
grant select on public.utilisateurs to service_role;
grant update (actif) on public.utilisateurs to service_role;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'appelable_par_un_visiteur',  has_function_privilege('anon', 'public._utilisateur_a_de_l_historique(uuid)', 'execute'),
  'appelable_par_un_employe',   has_function_privilege('authenticated', 'public._utilisateur_a_de_l_historique(uuid)', 'execute'),
  'appelable_par_le_serveur',   has_function_privilege('service_role', 'public._utilisateur_a_de_l_historique(uuid)', 'execute'),
  'tables_qui_pointent_vers_utilisateurs', (select jsonb_agg(distinct c.conrelid::regclass::text order by c.conrelid::regclass::text)
                                             from pg_constraint c
                                             where c.contype = 'f' and c.confrelid = 'public.utilisateurs'::regclass and c.conrelid <> c.confrelid),
  'serveur_peut_lire_utilisateurs',  has_table_privilege('service_role', 'public.utilisateurs', 'select'),
  'serveur_peut_changer_actif',      has_column_privilege('service_role', 'public.utilisateurs', 'actif', 'update'),
  'visiteur_et_employe_sans_droit_sur_utilisateurs', not has_table_privilege('anon', 'public.utilisateurs', 'select')
                                                     and not has_table_privilege('authenticated', 'public.utilisateurs', 'insert, update, delete')
) as verification;
