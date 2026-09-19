-- =====================================================================
-- NETTOYAGE ciblé : UNE trace du journal des corrections, restée après les essais réels du 19 septembre 2026
-- =====================================================================
-- CONTEXTE
--   Pendant les essais, l'administrateur a annulé un transfert d'équipage : la base a SUPPRIMÉ la ligne
--   d'entrée chez le 2e véhicule et l'a notée dans le journal des corrections (comportement normal).
--   Cette ligne d'équipage n'existait plus quand le nettoyage a été exécuté : il n'a pas pu retrouver sa
--   trace. Elle décrit un employé d'essai et une passe d'essai qui n'existent plus.
--
-- CE QUE ÇA FAIT
--   Supprime CETTE trace (identifiant indiqué ci-dessous), et seulement si TOUT ce qu'elle décrit a disparu :
--     • c'est bien la suppression d'une ligne d'équipage ;
--     • l'employé, la passe et la ligne concernés n'existent plus dans la base.
--   Sinon, il REFUSE et ne supprime rien.
--
-- Aucune autre ligne n'est touchée. Peut être exécuté plusieurs fois (rien à supprimer = aucun effet).
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

do $$
declare
  v_id uuid := '7cea81e6-8098-459c-af41-b5bfcc3e9290';
  n    integer;
begin
  delete from public.journal_modifications j
   where j.id = v_id
     and j.table_cible = 'equipage_periodes'
     and j.action = 'DELETE'
     and not exists (select 1 from public.utilisateurs u where u.id::text = j.avant ->> 'utilisateur_id')
     and not exists (select 1 from public.passes p where p.id::text = j.avant ->> 'passe_id')
     and not exists (select 1 from public.equipage_periodes e where e.id = j.ligne_id);
  get diagnostics n = row_count;
  if n = 0 and exists (select 1 from public.journal_modifications where id = v_id) then
    raise exception 'refuse : cette trace décrit encore des données qui existent. Rien n''a été supprimé.';
  end if;
end $$;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'corrections_journalisees', (select count(*) from public.journal_modifications),
  'trace_encore_presente', exists (select 1 from public.journal_modifications where id = '7cea81e6-8098-459c-af41-b5bfcc3e9290'),
  'comptes_auth', (select count(*) from auth.users),
  'profils', (select count(*) from public.utilisateurs),
  'quarts', (select count(*) from public.quarts),
  'passes', (select count(*) from public.passes)
) as verification;
