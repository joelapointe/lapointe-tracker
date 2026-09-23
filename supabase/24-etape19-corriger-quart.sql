-- =====================================================================
-- ÉTAPE 19 (SUITE, MORCEAU 5) — CORRIGER L'HEURE D'UN QUART À LA MAIN
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 23. Ne modifie AUCUNE donnée existante : elle ajoute seulement une fonction.
-- Peut être exécuté plusieurs fois sans problème (create or replace).
--
-- POURQUOI : le panneau administrateur (onglet « Quarts ») doit pouvoir corriger l'heure de début/fin d'un quart « à valider »
-- (ex : fermé automatiquement à une heure estimée, mais l'employé a vraiment fini plus tôt). admin_valider_quart (étape 9a)
-- confirme un quart TEL QUEL, sans pouvoir changer ses heures. Comme pour valider/annuler un transfert, cette correction passe
-- par une fonction serveur (jamais une écriture directe sur « quarts » depuis l'application — voir le principe déjà en place
-- pour equipage_periodes/equipage_journal/quarts : une fonction serveur applique toujours les MÊMES règles, avec le MÊME
-- journal, où qu'on l'appelle).
--
-- CE QUE FAIT CE FICHIER :
--   • admin_corriger_quart(quart_id, nouveau_debut, nouvelle_fin, note) : réservé à l'administrateur ; le quart doit exister et
--     être déjà FERMÉ (comme admin_valider_quart) ; la fin doit être après le début ; les contraintes déjà en place sur la
--     table (chevauchement avec un autre quart du même employé, etc.) s'appliquent toujours ; la note s'AJOUTE à celle déjà là
--     (jamais remplacée) ; le quart sort de « à valider », marqué comme corrigé par l'administrateur (comme admin_valider_quart).
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regclass('public.quarts') is null then
    raise exception 'la table quarts n''existe pas : les fichiers précédents n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_admin()') is null then
    raise exception 'la fonction est_admin() (fichier 03) n''existe pas. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.admin_valider_quart(uuid, text)') is null then
    raise exception 'la fonction admin_valider_quart() (fichier 04) n''existe pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

create or replace function public.admin_corriger_quart(p_quart_id uuid, p_debut timestamptz, p_fin timestamptz, p_note text default null)
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
  if p_debut is null or p_fin is null or p_fin <= p_debut then
    raise exception 'periode_invalide';
  end if;
  update public.quarts
     set debut = p_debut, debut_source = 'admin',
         fin = p_fin, fin_source = 'admin', fin_estimee = false,
         a_valider = false,
         valide_par = (select auth.uid()),
         valide_le = now(),
         note = coalesce(nullif(concat_ws(' | ', note, p_note), ''), note)
   where id = p_quart_id;
  return jsonb_build_object('statut', 'corrige', 'quart_id', p_quart_id);
end;
$$;

revoke all on function public.admin_corriger_quart(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.admin_corriger_quart(uuid, timestamptz, timestamptz, text) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'fonction_existe', to_regprocedure('public.admin_corriger_quart(uuid, timestamptz, timestamptz, text)') is not null,
  'employe_peut_appeler', has_function_privilege('authenticated', 'public.admin_corriger_quart(uuid, timestamptz, timestamptz, text)', 'execute'),
  'visiteur_peut_appeler', has_function_privilege('anon', 'public.admin_corriger_quart(uuid, timestamptz, timestamptz, text)', 'execute')
) as verification;
