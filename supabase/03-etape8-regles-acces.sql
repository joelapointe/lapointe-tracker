-- =====================================================================
-- ÉTAPE 8 — Règles d'accès par table et par rôle (remplacent « Accès public »)
-- =====================================================================
-- À EXÉCUTER APRÈS L'ÉTAPE 7. À n'exécuter qu'UNE SEULE FOIS.
--
-- CE QUE ÇA FAIT
--   1. Supprime toutes les anciennes règles « Accès public ».
--   2. Retire TOUS les droits au visiteur non connecté (« anon »). La clé publique
--      qui se trouve dans l'app ne donne plus accès à rien sans connexion.
--   3. Donne à chaque rôle uniquement ce dont il a besoin :
--        ADMINISTRATEUR : tout gérer (arrêts, routes, équipes, quarts, corrections).
--        EMPLOYÉ ACTIF  : lire ce qui est utile, signaler un problème.
--        EMPLOYÉ DÉSACTIVÉ ou visiteur : rien.
--   4. Les gestes de l'employé (débuter une passe, compléter un arrêt, gérer
--      l'équipage, faire « Je commence / Je termine », envoyer sa position) ne
--      passent PAS par des écritures directes : ils passeront par des fonctions
--      serveur qui vérifient tout (étape 9). D'ici là, l'employé ne peut
--      qu'observer et signaler un problème.
--   5. Active le temps réel pour les tables utiles (il était désactivé).
--
-- CE QUE VOIT CHAQUE RÔLE
--   • Employé : routes et arrêts actifs, équipes, les noms des collègues (PAS leur
--     téléphone), les passes en cours (avec pourcentage), l'équipage à bord de
--     chaque véhicule, la position de chaque véhicule, ses propres quarts et ses
--     propres passes terminées, les problèmes non lus.
--   • Il ne voit JAMAIS : les quarts ou heures d'un collègue, les journaux,
--     les numéros de téléphone.
-- =====================================================================

begin;

-- 1. Supprimer toutes les anciennes règles
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- 2. Retirer tous les droits, puis redonner au cas par cas
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;
-- Les futures tables ne donneront aucun droit par défaut (chaque table devra l'autoriser explicitement)
alter default privileges in schema public revoke all on tables from anon, authenticated;
-- FONCTIONS : PostgreSQL donne à tout le monde le droit d'exécuter une nouvelle fonction,
-- et une règle « par défaut » ne peut pas l'empêcher. Chaque fonction créée dans ce projet
-- doit donc faire, explicitement : revoke all on function ... from public, anon;
-- (c'est déjà fait pour est_admin() et est_actif(), et fait ici pour les deux fonctions de déclencheur).
revoke all on function public.creer_profil_depuis_auth()     from public, anon, authenticated;
revoke all on function public.journaliser_correction_admin() from public, anon, authenticated;

alter table public.stops     enable row level security;
alter table public.routes    enable row level security;
alter table public.equipes   enable row level security;
alter table public.zones     enable row level security;

-- ---------------------------------------------------------------------
-- ARRÊTS, ROUTES, ÉQUIPES, ZONES : lecture pour tous les actifs, écriture admin
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.stops   to authenticated;
grant select, insert, update, delete on public.routes  to authenticated;
grant select, insert, update, delete on public.equipes to authenticated;
grant select, insert, update, delete on public.zones   to authenticated;

create policy stops_lecture on public.stops for select to authenticated
  using ((select public.est_actif()) and (actif or (select public.est_admin())));
create policy stops_admin on public.stops for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

create policy routes_lecture on public.routes for select to authenticated
  using ((select public.est_actif()) and (actif or (select public.est_admin())));
create policy routes_admin on public.routes for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

create policy equipes_lecture on public.equipes for select to authenticated
  using ((select public.est_actif()) and (actif or (select public.est_admin())));
create policy equipes_admin on public.equipes for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

create policy zones_lecture on public.zones for select to authenticated
  using ((select public.est_actif()));
create policy zones_admin on public.zones for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

-- ---------------------------------------------------------------------
-- UTILISATEURS : les noms sont visibles par les actifs, PAS le téléphone.
--   Colonnes lisibles : id, nom, role, actif, cree_le.
--   L'administrateur voit les téléphones par une fonction dédiée (étape 9/10).
--   Seuls « nom » et « actif » sont modifiables, et seulement par l'administrateur.
--   Le RÔLE ne se change jamais depuis l'application.
-- ---------------------------------------------------------------------
grant select (id, nom, role, actif, cree_le) on public.utilisateurs to authenticated;
grant update (nom, actif) on public.utilisateurs to authenticated;

create policy utilisateurs_lecture on public.utilisateurs for select to authenticated
  using ((select public.est_actif()));
create policy utilisateurs_admin_modif on public.utilisateurs for update to authenticated
  using ((select public.est_admin()))
  with check ((select public.est_admin()) and (id <> (select auth.uid()) or actif));   -- l'admin ne peut pas se désactiver lui-même

-- ---------------------------------------------------------------------
-- RÉGLAGES : lecture pour les actifs, modification de la valeur par l'administrateur
-- ---------------------------------------------------------------------
grant select on public.reglages to authenticated;
grant update (valeur) on public.reglages to authenticated;
create policy reglages_lecture on public.reglages for select to authenticated
  using ((select public.est_actif()));
create policy reglages_admin on public.reglages for update to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

-- ---------------------------------------------------------------------
-- PASSES : l'employé voit les passes en cours (tous les véhicules) et ses propres
--   passes terminées ; l'administrateur voit tout et peut corriger.
--   Aucune écriture directe par l'employé (fonctions serveur, étape 9).
-- ---------------------------------------------------------------------
grant select, update on public.passes to authenticated;
create policy passes_lecture on public.passes for select to authenticated
  using ((select public.est_actif())
         and ((select public.est_admin()) or statut = 'en_cours' or chauffeur_id = (select auth.uid())));
create policy passes_admin_correction on public.passes for update to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

-- ARRÊTS COMPLÉTÉS : mêmes personnes que la passe correspondante (la règle de « passes » s'applique dans la sous-requête)
grant select on public.passe_arrets to authenticated;
create policy passe_arrets_lecture on public.passe_arrets for select to authenticated
  using ((select public.est_actif())
         and exists (select 1 from public.passes p where p.id = passe_id));

-- ---------------------------------------------------------------------
-- PROBLÈMES : tout actif peut en signaler (à SON nom seulement) ; il voit les
--   problèmes non lus et les siens ; seul l'administrateur les marque comme lus.
-- ---------------------------------------------------------------------
alter table public.problemes alter column utilisateur_id set default auth.uid();

grant select on public.problemes to authenticated;
grant insert (id, stop_id, passe_id, utilisateur_id, note) on public.problemes to authenticated;
grant update (lu, lu_par, lu_le) on public.problemes to authenticated;

create policy problemes_lecture on public.problemes for select to authenticated
  using ((select public.est_actif())
         and ((select public.est_admin()) or not lu or utilisateur_id = (select auth.uid())));
create policy problemes_signalement on public.problemes for insert to authenticated
  with check ((select public.est_actif()) and utilisateur_id = (select auth.uid()));
create policy problemes_admin_marquage on public.problemes for update to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

-- ---------------------------------------------------------------------
-- POSITIONS : tous les actifs voient tous les véhicules ; écriture par fonction serveur (étape 9)
-- ---------------------------------------------------------------------
grant select on public.positions to authenticated;
create policy positions_lecture on public.positions for select to authenticated
  using ((select public.est_actif()));

-- ---------------------------------------------------------------------
-- QUARTS (paie) : l'employé voit SEULEMENT les siens ; l'administrateur gère tout
--   (corrections journalisées automatiquement).
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.quarts to authenticated;
create policy quarts_lecture on public.quarts for select to authenticated
  using ((select public.est_actif())
         and ((select public.est_admin()) or utilisateur_id = (select auth.uid())));
create policy quarts_admin on public.quarts for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

-- ---------------------------------------------------------------------
-- ÉQUIPAGE : tout actif voit qui est À BORD de chaque véhicule (périodes ouvertes)
--   et ses propres périodes passées ; l'administrateur voit et corrige tout.
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.equipage_periodes to authenticated;
create policy equipage_lecture on public.equipage_periodes for select to authenticated
  using ((select public.est_actif())
         and ((select public.est_admin()) or fin is null or utilisateur_id = (select auth.uid())));
create policy equipage_admin on public.equipage_periodes for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));

-- ---------------------------------------------------------------------
-- JOURNAUX : lecture par l'administrateur seulement, jamais modifiables depuis l'app
-- ---------------------------------------------------------------------
grant select on public.equipage_journal      to authenticated;
grant select on public.journal_modifications to authenticated;
create policy equipage_journal_admin on public.equipage_journal for select to authenticated
  using ((select public.est_admin()));
create policy journal_modifications_admin on public.journal_modifications for select to authenticated
  using ((select public.est_admin()));

-- ---------------------------------------------------------------------
-- TEMPS RÉEL : les changements sont envoyés en direct, mais chaque abonné ne
-- reçoit que ce que les règles ci-dessus l'autorisent à voir.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['stops', 'passes', 'passe_arrets', 'positions', 'equipage_periodes', 'problemes'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'regles_par_table', (select jsonb_object_agg(tablename, n)
                         from (select tablename, count(*) as n from pg_policies where schemaname = 'public' group by tablename) x),
  'anciennes_regles_public_restantes', (select count(*) from pg_policies where schemaname = 'public' and 'public'::name = any(roles)),
  'nombre_de_droits_pour_anon', (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon'),
  'tables_sans_regles_actives', (select coalesce(jsonb_agg(relname), '[]'::jsonb) from pg_class
                                  where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity),
  'fonctions_appelables_par_un_visiteur', (select coalesce(jsonb_agg(proname), '[]'::jsonb) from pg_proc
                                            where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')),
  'temps_reel', (select jsonb_agg(tablename order by tablename) from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public')
) as verification;
