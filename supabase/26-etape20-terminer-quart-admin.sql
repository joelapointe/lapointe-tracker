-- =====================================================================
-- ÉTAPE 20 — L'ADMINISTRATEUR PEUT TERMINER LE QUART D'UN EMPLOYÉ
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 24. Ne modifie AUCUNE donnée existante : elle ajoute seulement une fonction.
-- Peut être exécuté plusieurs fois sans problème (create or replace).
--
-- POURQUOI : retour de Joé après un essai réel (23 sept. 2026) — un employé retiré d'un véhicule (transfert, ou passe qui se
-- termine) sans avoir touché lui-même « Je termine » reste « en service » indéfiniment. admin_corriger_quart (fichier 24)
-- REFUSE exprès un quart encore ouvert (elle ne sert qu'à corriger un quart déjà fermé) : jusqu'ici, rien ne permettait à
-- l'administrateur de le fermer plus tôt que la fermeture automatique (16 h) — bloquant l'export de paie tout ce temps.
--
-- CE QUE FAIT CE FICHIER :
--   • admin_terminer_quart(quart_id, note) : réservé à l'administrateur ; le quart doit exister et être encore OUVERT (fin
--     manquante) ; le ferme À L'INSTANT PRÉSENT (comme un « Je termine » fait par l'administrateur à la place de l'employé) ;
--     directement validé (jamais à revalider ensuite) ; la note s'AJOUTE à celle déjà là (jamais remplacée), comme
--     admin_corriger_quart. Les contraintes déjà en place sur la table (chevauchement, etc.) s'appliquent toujours.
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
  if to_regprocedure('public.admin_corriger_quart(uuid, timestamptz, timestamptz, text)') is null then
    raise exception 'la fonction admin_corriger_quart() (fichier 24) n''existe pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

create or replace function public.admin_terminer_quart(p_quart_id uuid, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_q public.quarts%rowtype; v_fin timestamptz;
begin
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  select * into v_q from public.quarts where id = p_quart_id;
  if not found then
    raise exception 'quart_introuvable';
  end if;
  if v_q.fin is not null then
    raise exception 'quart_deja_termine';
  end if;
  v_fin := now();
  if v_fin <= v_q.debut then
    raise exception 'periode_invalide';   -- horloges du serveur incohérentes (jamais vu en pratique) : refuser plutôt qu'un quart à l'envers
  end if;
  update public.quarts
     set fin = v_fin, fin_source = 'admin', fin_estimee = false,
         a_valider = false,
         valide_par = (select auth.uid()),
         valide_le = now(),
         note = coalesce(nullif(concat_ws(' | ', note, p_note), ''), note)
   where id = p_quart_id;
  return jsonb_build_object('statut', 'termine', 'quart_id', p_quart_id, 'fin', v_fin);
end;
$$;

revoke all on function public.admin_terminer_quart(uuid, text) from public, anon;
grant execute on function public.admin_terminer_quart(uuid, text) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'fonction_existe', to_regprocedure('public.admin_terminer_quart(uuid, text)') is not null,
  'employe_peut_appeler', has_function_privilege('authenticated', 'public.admin_terminer_quart(uuid, text)', 'execute'),
  'visiteur_peut_appeler', has_function_privilege('anon', 'public.admin_terminer_quart(uuid, text)', 'execute')
) as verification;
