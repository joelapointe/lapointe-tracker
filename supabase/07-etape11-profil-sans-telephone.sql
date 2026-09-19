-- =====================================================================
-- ÉTAPE 11 (1 de 2) — Permettre de créer le compte de Joé depuis le tableau de bord
-- =====================================================================
-- LE PROBLÈME
--   Quand un compte est créé dans Supabase Auth, un déclencheur (étape 6) crée son profil.
--   Sans données cachées (le tableau de bord n'en permet pas), il le range comme « employé »
--   ... sans téléphone, ce que la base interdit : la création du compte échoue avec
--   « Database error creating new user ».
--
-- CE QUE ÇA CHANGE
--   Un compte créé SANS téléphone et SANS rôle « admin » ne reçoit plus de profil.
--   • Il n'a alors AUCUN accès (pas de profil = ni actif, ni administrateur : la base lui
--     montre et lui permet exactement rien). C'est le côté sûr.
--   • Les comptes d'employés (créés par la fonction admin-employes, avec téléphone) et
--     tout ce qui existait avant se comportent exactement comme avant.
--   • Le compte de Joé recevra son profil « administrateur » par le fichier 08, exécuté
--     par Joé dans le SQL Editor : c'est le SEUL endroit où un rôle administrateur s'écrit.
--
-- Aucune donnée n'est modifiée. Peut être exécuté plusieurs fois sans danger.
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

begin;

create or replace function public.creer_profil_depuis_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role      text := coalesce(nullif(new.raw_app_meta_data ->> 'role', ''), 'employe');
  v_telephone text := nullif(new.raw_app_meta_data ->> 'telephone', '');
begin
  -- Ni téléphone ni rôle administrateur : pas de profil, donc aucun accès.
  if v_telephone is null and v_role <> 'admin' then
    return new;
  end if;
  insert into public.utilisateurs (id, nom, telephone, role)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_app_meta_data ->> 'nom'), ''), split_part(coalesce(new.email, 'inconnu'), '@', 1)),
    v_telephone,
    v_role
  );
  return new;
end;
$$;

-- (la fonction reste inappelable par l'application ; elle ne sert qu'au déclencheur)
revoke all on function public.creer_profil_depuis_auth() from public, anon, authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'declencheur_present', (select count(*) from pg_trigger where tgname = 'apres_creation_utilisateur_auth' and not tgisinternal),
  'fonction_appelable_par_un_employe', has_function_privilege('authenticated', 'public.creer_profil_depuis_auth()', 'execute'),
  'fonction_appelable_par_un_visiteur', has_function_privilege('anon', 'public.creer_profil_depuis_auth()', 'execute'),
  'comptes_auth', (select count(*) from auth.users),
  'profils', (select count(*) from public.utilisateurs)
) as verification;
