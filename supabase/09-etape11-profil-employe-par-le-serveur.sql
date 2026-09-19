-- =====================================================================
-- ÉTAPE 11 (correction) — Le serveur crée lui-même le profil d'un employé
-- =====================================================================
-- LE PROBLÈME (constaté sur la vraie base le 19 septembre 2026)
--   Quand la fonction admin-employes crée un compte, Supabase Auth crée d'abord le compte,
--   puis ajoute les données « nom » et « téléphone » dans une DEUXIÈME écriture. Le déclencheur
--   de l'étape 6 (qui agit à la création) ne les voit donc pas : le profil n'était pas créé et la
--   fonction annulait la création (sans laisser de compte). Rien de dangereux : c'était refusé.
--
-- CE QUE ÇA FAIT
--   Ajoute _creer_profil_employe(id, nom, téléphone), réservée au serveur (service_role) :
--     • le rôle est TOUJOURS « employe » (écrit ici, jamais fourni par l'appelant) ;
--     • si le profil existe déjà (créé par le déclencheur), elle ne change rien ;
--     • les règles de la table restent en vigueur (téléphone à 10 chiffres, unique, nom non vide).
--   Ni le visiteur, ni un employé, ni Joé depuis l'application ne peuvent l'appeler.
--
-- Aucune donnée n'est modifiée par ce fichier. Peut être exécuté plusieurs fois sans danger.
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

begin;

create or replace function public._creer_profil_employe(p_id uuid, p_nom text, p_telephone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from auth.users where id = p_id) then
    raise exception 'compte_introuvable';
  end if;
  insert into public.utilisateurs (id, nom, telephone, role, actif)
  values (p_id, trim(p_nom), p_telephone, 'employe', true)
  on conflict (id) do nothing;
end;
$$;

revoke all on function public._creer_profil_employe(uuid, text, text) from public, anon, authenticated;
grant execute on function public._creer_profil_employe(uuid, text, text) to service_role;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'appelable_par_un_visiteur', has_function_privilege('anon', 'public._creer_profil_employe(uuid, text, text)', 'execute'),
  'appelable_par_un_employe',  has_function_privilege('authenticated', 'public._creer_profil_employe(uuid, text, text)', 'execute'),
  'appelable_par_le_serveur',  has_function_privilege('service_role', 'public._creer_profil_employe(uuid, text, text)', 'execute'),
  'comptes_auth', (select count(*) from auth.users),
  'profils', (select count(*) from public.utilisateurs)
) as verification;
