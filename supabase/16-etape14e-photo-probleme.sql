-- =====================================================================
-- ÉTAPE 14e — UNE PHOTO PAR PROBLÈME SIGNALÉ (décision de Joé, 19 septembre 2026)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 15. Ne supprime AUCUNE donnée. Peut être exécuté plusieurs fois sans problème.
--
-- CE QUE DÉCIDE JOÉ : l'employé peut prendre UNE photo quand il signale un problème (zone orange), en plus du texte.
--
-- COMMENT ÇA MARCHE (l'application fait ces 3 gestes dans l'ordre ; si la photo échoue, le texte du problème est déjà envoyé)
--   1. le problème est enregistré (comme aujourd'hui) ;
--   2. la photo (JPEG réduit sur le téléphone, moins de 2 Mo) est envoyée dans l'espace privé « photos-problemes »,
--      au chemin IMPOSÉ  « numéro-de-l'employé / numéro-du-problème .jpg » ;
--   3. la fonction probleme_attacher_photo(numéro-du-problème) relie la photo au problème (colonne problemes.photo_chemin).
--
-- CE QUI EST PROTÉGÉ
--   • l'espace « photos-problemes » est PRIVÉ (aucune adresse publique) : on lit une photo par un lien temporaire signé ;
--   • un employé ne peut envoyer une photo QUE dans son propre dossier, QUE pour un problème qui est à SON nom,
--     et seulement au chemin exact (jamais un autre nom, jamais un autre format que JPEG, jamais plus de 2 Mo) ;
--   • personne ne peut remplacer ni effacer une photo, sauf l'administrateur (qui peut la supprimer) ;
--   • une photo se voit exactement comme le problème auquel elle est reliée : les employés voient les photos des problèmes
--     non lus (et les leurs) ; l'administrateur voit tout ; un problème marqué « lu » cache sa photo aux autres employés ;
--   • un employé ne peut pas écrire lui-même problemes.photo_chemin : seule la fonction le fait, et seulement pour SON problème,
--     seulement si la photo est bien arrivée dans l'espace privé.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    raise exception 'le stockage de fichiers de Supabase (Storage) n''est pas disponible dans ce projet. Rien n''a été modifié.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'problemes' and column_name = 'utilisateur_id') then
    raise exception 'la table des problèmes n''existe pas comme prévu. Rien n''a été modifié.';
  end if;
end $$;

begin;

-- ---------------------------------------------------------------------
-- 1. LA COLONNE : où est la photo d'un problème (le chemin est imposé, il ne peut pas pointer ailleurs)
-- ---------------------------------------------------------------------
alter table public.problemes add column if not exists photo_chemin text;
alter table public.problemes drop constraint if exists problemes_photo_chemin_coherent;
alter table public.problemes add constraint problemes_photo_chemin_coherent
  check (photo_chemin is null or photo_chemin = utilisateur_id::text || '/' || id::text || '.jpg');
comment on column public.problemes.photo_chemin is 'Photo du problème dans l''espace privé photos-problemes : « numéro-employé/numéro-problème.jpg ». Écrite seulement par probleme_attacher_photo().';

-- ---------------------------------------------------------------------
-- 2. L'ESPACE DE STOCKAGE : privé, JPEG seulement, 2 Mo au maximum
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos-problemes', 'photos-problemes', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg'];

-- ---------------------------------------------------------------------
-- 3. LES RÈGLES D'ACCÈS AUX PHOTOS (elles ne touchent que cet espace, jamais un autre)
-- ---------------------------------------------------------------------
drop policy if exists photos_problemes_ajout       on storage.objects;
drop policy if exists photos_problemes_lecture     on storage.objects;
drop policy if exists photos_problemes_suppression on storage.objects;

-- Envoyer : dans SON dossier, au chemin exact « numéro-employé/numéro-problème.jpg », pour un problème qui est à SON nom
create policy photos_problemes_ajout on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos-problemes'
    and (select public.est_actif())
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (select 1 from public.problemes p
                 where p.utilisateur_id = (select auth.uid())
                   and p.id::text || '.jpg' = split_part(name, '/', 2))
  );

-- Lire : une photo se voit comme le problème auquel elle est reliée (les règles d'accès de la table des problèmes s'appliquent)
create policy photos_problemes_lecture on storage.objects for select to authenticated
  using (
    bucket_id = 'photos-problemes'
    and (select public.est_actif())
    and exists (select 1 from public.problemes p where p.photo_chemin = name)
  );

-- Supprimer : l'administrateur seulement (aucune règle de modification : impossible de remplacer une photo)
create policy photos_problemes_suppression on storage.objects for delete to authenticated
  using (bucket_id = 'photos-problemes' and (select public.est_admin()));

-- ---------------------------------------------------------------------
-- 4. LA FONCTION QUI RELIE LA PHOTO AU PROBLÈME
-- ---------------------------------------------------------------------
create or replace function public.probleme_attacher_photo(p_probleme_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid;
  v_p      public.problemes%rowtype;
  v_chemin text;
begin
  v_uid := public._exiger_actif();
  select * into v_p from public.problemes where id = p_probleme_id;
  if not found then
    raise exception 'probleme_introuvable';
  end if;
  if v_p.utilisateur_id is distinct from v_uid then
    raise exception 'non_autorise';                        -- seulement SON propre signalement
  end if;
  v_chemin := v_p.utilisateur_id::text || '/' || v_p.id::text || '.jpg';
  if v_p.photo_chemin is not null then
    return jsonb_build_object('statut', 'deja_attachee', 'chemin', v_p.photo_chemin);   -- geste renvoyé : rien à refaire
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'photos-problemes' and o.name = v_chemin) then
    raise exception 'photo_introuvable';                   -- la photo n'est pas arrivée dans l'espace privé
  end if;
  update public.problemes set photo_chemin = v_chemin where id = p_probleme_id;
  return jsonb_build_object('statut', 'attachee', 'chemin', v_chemin);
end;
$$;

revoke all on function public.probleme_attacher_photo(uuid) from public, anon;
grant execute on function public.probleme_attacher_photo(uuid) to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'espace_photos', (select jsonb_build_object('prive', not b.public, 'limite_octets', b.file_size_limit, 'formats', b.allowed_mime_types)
                      from storage.buckets b where b.id = 'photos-problemes'),
  'colonne_photo_chemin', exists (select 1 from information_schema.columns
                                   where table_schema = 'public' and table_name = 'problemes' and column_name = 'photo_chemin'),
  'regles_sur_les_photos', (select coalesce(jsonb_agg(policyname order by policyname), '[]'::jsonb) from pg_policies
                             where schemaname = 'storage' and tablename = 'objects' and policyname like 'photos_problemes_%'),
  'fonction_visiteur_peut_appeler',  has_function_privilege('anon', 'public.probleme_attacher_photo(uuid)', 'execute'),
  'fonction_employe_peut_appeler',   has_function_privilege('authenticated', 'public.probleme_attacher_photo(uuid)', 'execute'),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'problemes_existants', (select count(*) from public.problemes),
  'photos_existantes', (select count(*) from storage.objects where bucket_id = 'photos-problemes')
) as verification;
