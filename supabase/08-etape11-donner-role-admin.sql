-- =====================================================================
-- ÉTAPE 11 (2 de 2) — Donner le rôle « administrateur » au compte de Joé
-- =====================================================================
-- À EXÉCUTER APRÈS : le fichier 07, ET la création du compte dans
--   Supabase > Authentication > Users > Add user > Create new user.
--
-- CE QUE ÇA FAIT
--   Crée le profil « administrateur » du compte dont le courriel est indiqué à la ligne
--   « v_courriel » ci-dessous (UNE seule ligne à modifier).
--
-- SÉCURITÉ
--   • C'est le SEUL endroit où le rôle administrateur s'écrit. L'application ne le fait jamais.
--   • Refuse si le compte n'existe pas.
--   • Refuse si un AUTRE compte est déjà administrateur (un seul administrateur pour l'instant :
--     ce fichier ne peut pas servir à en ajouter un deuxième par erreur).
--   • Refuse un compte d'employé (identifiant du genre 8191234567@tel.entretienlapointe.ca).
--   • Peut être ré-exécuté sans danger pour le même compte.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run.
-- =====================================================================

do $$
declare
  v_courriel text := 'TON-COURRIEL@EXEMPLE.CA';   -- <== LA SEULE LIGNE À MODIFIER : le courriel du compte créé dans Authentication
  v_nom      text := 'Joé';
  v_id       uuid;
begin
  select id into v_id from auth.users where lower(email) = lower(trim(v_courriel));
  if v_id is null then
    raise exception 'compte_introuvable : aucun compte Authentication avec le courriel « % ». Vérifie l''orthographe, ou crée le compte d''abord.', v_courriel;
  end if;
  if lower(trim(v_courriel)) like '%@tel.entretienlapointe.ca' then
    raise exception 'refuse : c''est un identifiant d''employé, pas un compte administrateur';
  end if;
  if exists (select 1 from public.utilisateurs where role = 'admin' and id <> v_id) then
    raise exception 'refuse : un autre compte est déjà administrateur';
  end if;

  insert into public.utilisateurs (id, nom, role, actif)
  values (v_id, v_nom, 'admin', true)
  on conflict (id) do update set role = 'admin', actif = true;
end $$;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'administrateurs', (select coalesce(jsonb_agg(jsonb_build_object('nom', u.nom, 'courriel', a.email, 'role', u.role, 'actif', u.actif,
                                                                   'courriel_confirme', a.email_confirmed_at is not null)), '[]'::jsonb)
                      from public.utilisateurs u join auth.users a on a.id = u.id where u.role = 'admin'),
  'comptes_auth', (select count(*) from auth.users),
  'profils', (select count(*) from public.utilisateurs)
) as verification;
