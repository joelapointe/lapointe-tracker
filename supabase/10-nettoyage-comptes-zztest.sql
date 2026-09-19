-- =====================================================================
-- NETTOYAGE des comptes d'essai « ZZTEST » (créés par tests/reel-etape-11.mjs)
-- =====================================================================
-- CE QUE ÇA FAIT
--   Supprime DÉFINITIVEMENT les comptes d'essai et tout ce qu'ils ont produit : leur profil, leur compte
--   de connexion, leurs quarts, et — s'ils ont été chauffeur — leurs passes avec les arrêts complétés,
--   problèmes, positions et équipages de ces passes.
--
-- COMMENT IL RECONNAÎT UN COMPTE D'ESSAI (les DEUX conditions à la fois)
--   • le nom commence par « ZZTEST »,
--   • le téléphone est 819 555 019x (numéros fictifs réservés, jamais attribués à un vrai employé).
--   Un compte administrateur n'est jamais touché. Les comptes de connexion orphelins portant ces
--   numéros fictifs (restes d'un essai raté) sont aussi supprimés.
--
-- SÉCURITÉ
--   • REFUSE de rien supprimer (et n'a alors aucun effet) si des données d'un VRAI compte sont mêlées à
--     celles des comptes d'essai (un vrai employé dans une passe d'essai, ou un compte d'essai dans la
--     passe d'un vrai chauffeur) : à examiner à la main.
--   • Tout se fait en une seule opération : une erreur n'en laisse aucune moitié.
--   • Ne fait rien s'il n'y a aucun compte d'essai. Peut être exécuté plusieurs fois.
--   • Il est prévu pour un ménage APRÈS des essais : ne l'exécute pas pendant qu'un essai est en cours.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

do $$
declare
  v_ids     uuid[];
  v_passes  uuid[];
  v_orph    uuid[];
  v_melange integer;
begin
  select coalesce(array_agg(id), '{}') into v_ids
  from public.utilisateurs
  where role = 'employe' and nom like 'ZZTEST%' and telephone ~ '^819555019[0-9]$';

  select coalesce(array_agg(id), '{}') into v_orph
  from auth.users a
  where a.email ~ '^819555019[0-9]@tel\.entretienlapointe\.ca$'
    and not exists (select 1 from public.utilisateurs u where u.id = a.id);

  select coalesce(array_agg(id), '{}') into v_passes from public.passes where chauffeur_id = any (v_ids);

  -- Garde-fou : des données de vrais comptes mêlées à celles des comptes d'essai ?
  select
      (select count(*) from public.equipage_periodes where passe_id = any (v_passes) and not (utilisateur_id = any (v_ids)))
    + (select count(*) from public.equipage_periodes where utilisateur_id = any (v_ids) and not (passe_id = any (v_passes)))
    + (select count(*) from public.passe_arrets where passe_id = any (v_passes) and not (complete_par = any (v_ids)))
    + (select count(*) from public.passe_arrets where complete_par = any (v_ids) and not (passe_id = any (v_passes)))
    + (select count(*) from public.problemes where passe_id = any (v_passes) and not (utilisateur_id = any (v_ids)))
    + (select count(*) from public.problemes where utilisateur_id = any (v_ids) and passe_id is not null and not (passe_id = any (v_passes)))
    + (select count(*) from public.equipage_journal where (passe_id = any (v_passes) or de_passe_id = any (v_passes) or vers_passe_id = any (v_passes))
                                                        and not (coalesce(utilisateur_id, v_ids[1]) = any (v_ids)))
    + (select count(*) from public.equipage_journal where (utilisateur_id = any (v_ids) or auteur_id = any (v_ids))
                                                        and not (coalesce(passe_id, de_passe_id, vers_passe_id) = any (v_passes)))
    + (select count(*) from public.quarts where valide_par = any (v_ids))
  into v_melange;

  if v_melange > 0 then
    raise exception 'refuse : % ligne(s) mêlent des données de vrais comptes à celles des comptes d''essai. Rien n''a été supprimé.', v_melange;
  end if;

  delete from public.equipage_journal   where passe_id = any (v_passes) or de_passe_id = any (v_passes) or vers_passe_id = any (v_passes)
                                            or utilisateur_id = any (v_ids) or auteur_id = any (v_ids);
  delete from public.positions          where passe_id = any (v_passes) or chauffeur_id = any (v_ids);
  delete from public.problemes          where passe_id = any (v_passes) or utilisateur_id = any (v_ids) or lu_par = any (v_ids);
  delete from public.passe_arrets       where passe_id = any (v_passes) or complete_par = any (v_ids);
  delete from public.equipage_periodes  where passe_id = any (v_passes) or utilisateur_id = any (v_ids) or ajoute_par = any (v_ids) or retire_par = any (v_ids);
  delete from public.quarts             where utilisateur_id = any (v_ids);
  delete from public.journal_modifications where auteur_id = any (v_ids);
  delete from public.passes             where id = any (v_passes);
  delete from public.utilisateurs       where id = any (v_ids);                  -- (aussi supprimé en cascade avec le compte)
  delete from auth.users                where id = any (v_ids) or id = any (v_orph);
end $$;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'comptes_zztest_restants', (select count(*) from public.utilisateurs where nom like 'ZZTEST%')
                           + (select count(*) from auth.users where email ~ '^819555019[0-9]@'),
  'administrateurs', (select count(*) from public.utilisateurs where role = 'admin'),
  'comptes_auth', (select count(*) from auth.users),
  'profils', (select count(*) from public.utilisateurs),
  'quarts', (select count(*) from public.quarts),
  'passes', (select count(*) from public.passes),
  'arrets_de_test', (select count(*) from public.stops),
  'routes_de_test', (select count(*) from public.routes)
) as verification;
