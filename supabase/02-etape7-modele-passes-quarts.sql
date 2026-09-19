-- =====================================================================
-- ÉTAPE 7 — Modèle des passes, de l'équipage et des quarts de travail
-- =====================================================================
-- À EXÉCUTER APRÈS L'ÉTAPE 6 (le fichier 01-etape6-utilisateurs.sql).
-- À n'exécuter qu'UNE SEULE FOIS (une deuxième exécution donnerait des erreurs
-- « existe déjà » : sans danger, tout est dans une transaction).
--
-- CE QUE ÇA FAIT
--   • Active l'extension btree_gist (sert à interdire les chevauchements).
--   • Garde tes 13 arrêts, 2 routes, équipes et zones. Convertit leurs dates en
--     « avec fuseau horaire » et ajoute une colonne « actif » (archivage au lieu
--     de suppression). La colonne « operateur » de equipes disparaît : une
--     équipe = un véhicule.
--   • Crée les nouvelles tables :
--       reglages, passes, passe_arrets, problemes, positions, quarts,
--       equipage_periodes, equipage_journal, journal_modifications.
--   • Toutes les nouvelles tables sont VERROUILLÉES dès leur création (règles
--     d'accès actives, aucune permission) : les règles arrivent à l'étape 8.
--
-- GARANTIES DE LA BASE DE DONNÉES
--   • Un employé ne peut pas avoir deux quarts qui se chevauchent.
--   • Un employé ne peut pas être dans deux véhicules en même temps.
--     (Un transfert = sortie et entrée à la MÊME heure : accepté, sans trou
--      ni chevauchement.)
--   • Une équipe (véhicule) n'a qu'une passe en cours à la fois.
--   • Un chauffeur n'a qu'une passe en cours à la fois.
--   • Chaque correction faite par l'administrateur est journalisée
--     automatiquement, sans que l'application puisse l'oublier.
-- =====================================================================

begin;

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Tables existantes conservées (arrêts, routes, équipes, zones)
-- ---------------------------------------------------------------------
alter table public.equipes alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.zones   alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.routes  alter column created_at type timestamptz using created_at at time zone 'UTC';
alter table public.stops   alter column created_at type timestamptz using created_at at time zone 'UTC';

alter table public.equipes drop column if exists operateur;
alter table public.equipes add column actif boolean not null default true;
alter table public.equipes add constraint equipes_nom_unique unique (nom);
comment on table public.equipes is 'Une équipe = un véhicule (nom = nom du véhicule, ex. « Camion 2 »).';

alter table public.routes add column actif boolean not null default true;
alter table public.stops  add column actif boolean not null default true;
comment on column public.stops.actif  is 'false = arrêt archivé (on n''efface jamais un arrêt qui a de l''historique).';
comment on column public.routes.actif is 'false = route archivée.';

-- ---------------------------------------------------------------------
-- 2. Réglages modifiables par l'administrateur
-- ---------------------------------------------------------------------
create table public.reglages (
  cle         text primary key,
  valeur      jsonb not null,
  description text
);
insert into public.reglages (cle, valeur, description) values
  ('duree_max_passe_heures',      '12', 'Une passe encore ouverte après ce nombre d''heures est fermée automatiquement (fin estimée).'),
  ('duree_max_quart_heures',      '16', 'Un quart encore ouvert après ce nombre d''heures est fermé automatiquement (fin estimée, à valider).'),
  ('alerte_quart_termine_heures', '4',  'Avertit le chauffeur si l''employé qu''il ajoute à bord a terminé son quart depuis moins de ce nombre d''heures.');

-- ---------------------------------------------------------------------
-- 3. Passes (une passe = un enregistrement distinct, jamais remis à zéro)
-- ---------------------------------------------------------------------
create table public.passes (
  id              uuid primary key default gen_random_uuid(),   -- l'app peut fournir son propre id (mode hors réseau)
  route_id        uuid not null references public.routes(id),
  equipe_id       uuid not null references public.equipes(id),
  chauffeur_id    uuid not null references public.utilisateurs(id),
  numero          integer not null check (numero > 0),          -- n° de passe pour cette route (1, 2, 3…)
  debut           timestamptz not null default now(),
  fin             timestamptz,
  statut          text not null default 'en_cours' check (statut in ('en_cours', 'terminee')),
  fin_type        text check (fin_type in ('manuelle', 'complete', 'delai_max', 'fin_quart', 'admin')),
  fin_estimee     boolean not null default false,
  nb_arrets_total integer not null default 0 check (nb_arrets_total >= 0),
  nb_arrets_faits integer not null default 0 check (nb_arrets_faits >= 0),
  pourcentage     integer generated always as (
                    case when nb_arrets_total > 0
                         then least(100, (100 * nb_arrets_faits) / nb_arrets_total)
                         else 0 end
                  ) stored,
  cree_le         timestamptz not null default now(),
  constraint passes_numero_unique_par_route unique (route_id, numero),
  constraint passes_fin_coherente check ((statut = 'en_cours') = (fin is null)),
  constraint passes_fin_apres_debut check (fin is null or fin >= debut),
  constraint passes_fin_type_requis check (statut = 'en_cours' or fin_type is not null)
);
create unique index passes_une_en_cours_par_equipe   on public.passes (equipe_id)    where statut = 'en_cours';
create unique index passes_une_en_cours_par_chauffeur on public.passes (chauffeur_id) where statut = 'en_cours';
create index passes_par_route_et_date on public.passes (route_id, debut desc);
create index passes_par_date          on public.passes (debut desc);

-- Arrêts complétés pendant une passe (remplace stops.fait, qui disparaît à l'étape 13)
create table public.passe_arrets (
  id           uuid primary key default gen_random_uuid(),
  passe_id     uuid not null references public.passes(id) on delete cascade,
  stop_id      uuid not null references public.stops(id),       -- pas de suppression d'un arrêt qui a de l'historique
  complete_le  timestamptz not null default now(),
  complete_par uuid not null references public.utilisateurs(id),
  mode         text not null default 'manuel' check (mode in ('manuel', 'auto')),
  lat          double precision,
  lon          double precision,
  constraint un_arret_par_passe unique (passe_id, stop_id)
);
create index passe_arrets_par_arret on public.passe_arrets (stop_id, complete_le);

-- ---------------------------------------------------------------------
-- 4. Problèmes signalés (conservés avec leur passe, jamais effacés par une nouvelle passe)
-- ---------------------------------------------------------------------
create table public.problemes (
  id             uuid primary key default gen_random_uuid(),
  stop_id        uuid not null references public.stops(id),
  passe_id       uuid references public.passes(id),
  utilisateur_id uuid not null references public.utilisateurs(id),
  note           text not null check (length(trim(note)) > 0),
  lu             boolean not null default false,
  lu_par         uuid references public.utilisateurs(id),
  lu_le          timestamptz,
  cree_le        timestamptz not null default now()
);
create index problemes_non_lus on public.problemes (cree_le desc) where not lu;
create index problemes_par_arret on public.problemes (stop_id);

-- ---------------------------------------------------------------------
-- 5. Positions : UNE ligne par véhicule (par passe en cours), envoyée par le chauffeur seulement
-- ---------------------------------------------------------------------
create table public.positions (
  passe_id     uuid primary key references public.passes(id) on delete cascade,
  equipe_id    uuid not null references public.equipes(id),
  chauffeur_id uuid not null references public.utilisateurs(id),
  lat          double precision not null,
  lon          double precision not null,
  precision_m  real,
  maj_le       timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 6. Quarts de travail (base de la paie)
-- ---------------------------------------------------------------------
create table public.quarts (
  id                  uuid primary key default gen_random_uuid(),   -- fourni par l'app (mode hors réseau)
  utilisateur_id      uuid not null references public.utilisateurs(id),
  debut               timestamptz not null,
  debut_lat           double precision,
  debut_lon           double precision,
  debut_precision_m   real,
  debut_source        text not null check (debut_source in ('manuel', 'passe', 'equipage', 'admin')),
  fin                 timestamptz,
  fin_lat             double precision,
  fin_lon             double precision,
  fin_precision_m     real,
  fin_source          text check (fin_source in ('manuel', 'fin_passe', 'delai_max', 'admin')),
  fin_estimee         boolean not null default false,
  -- Liste « À valider » du panneau admin. L'export de paie est refusé tant qu'un quart est à valider.
  a_valider           boolean not null default false,
  raison_a_valider    text check (raison_a_valider in ('ouvert_par_equipage', 'ouvert_par_passe', 'fin_estimee')),
  valide_par          uuid references public.utilisateurs(id),
  valide_le           timestamptz,
  note                text,
  cree_le             timestamptz not null default now(),
  constraint quarts_fin_apres_debut check (fin is null or fin > debut),
  constraint quarts_fin_source_requise check (fin is null or fin_source is not null),
  constraint quarts_validation_coherente check (not (a_valider and valide_le is not null)),
  constraint quarts_sans_chevauchement exclude using gist (
    utilisateur_id with =,
    tstzrange(debut, coalesce(fin, 'infinity'::timestamptz), '[)') with &&
  )
);
create index quarts_par_employe on public.quarts (utilisateur_id, debut desc);
create index quarts_a_valider   on public.quarts (debut) where a_valider;
create index quarts_ouverts     on public.quarts (utilisateur_id) where fin is null;

-- ---------------------------------------------------------------------
-- 7. Équipage : qui est à bord de quelle passe, et pendant quelle période
-- ---------------------------------------------------------------------
create table public.equipage_periodes (
  id             uuid primary key default gen_random_uuid(),
  passe_id       uuid not null references public.passes(id),
  utilisateur_id uuid not null references public.utilisateurs(id),
  role           text not null default 'passager' check (role in ('chauffeur', 'passager')),
  debut          timestamptz not null,
  fin            timestamptz,
  ajoute_par     uuid references public.utilisateurs(id),
  retire_par     uuid references public.utilisateurs(id),
  transfert_id   uuid,                                  -- même valeur sur la sortie et l'entrée d'un transfert
  a_verifier     boolean not null default false,        -- conflit résolu automatiquement hors réseau
  cree_le        timestamptz not null default now(),
  constraint equipage_fin_apres_debut check (fin is null or fin >= debut),
  constraint equipage_sans_chevauchement exclude using gist (
    utilisateur_id with =,
    tstzrange(debut, coalesce(fin, 'infinity'::timestamptz), '[)') with &&
  )
);
create index equipage_par_passe   on public.equipage_periodes (passe_id);
create index equipage_par_employe on public.equipage_periodes (utilisateur_id, debut desc);
create index equipage_a_bord      on public.equipage_periodes (passe_id) where fin is null;
create index equipage_transferts  on public.equipage_periodes (transfert_id) where transfert_id is not null;

-- Journal de chaque geste d'équipage (ne s'efface jamais, jamais de modification)
create table public.equipage_journal (
  id             uuid primary key default gen_random_uuid(),
  cle_client     uuid unique,                           -- id fourni par l'app : évite les doublons quand un geste hors réseau est renvoyé
  type           text not null check (type in ('ajout', 'retrait', 'transfert', 'annulation', 'correction_admin')),
  moment         timestamptz not null,                  -- heure du geste (heure du téléphone)
  recu_le        timestamptz not null default now(),    -- heure de réception par le serveur (détecte une horloge de téléphone fausse)
  passe_id       uuid references public.passes(id),
  utilisateur_id uuid references public.utilisateurs(id),  -- personne concernée
  de_passe_id    uuid references public.passes(id),     -- transfert : passe quittée
  vers_passe_id  uuid references public.passes(id),     -- transfert : passe rejointe
  auteur_id      uuid references public.utilisateurs(id),
  lat            double precision,                      -- position du véhicule au moment du geste
  lon            double precision,
  details        jsonb
);
create index equipage_journal_par_passe   on public.equipage_journal (passe_id, moment);
create index equipage_journal_par_employe on public.equipage_journal (utilisateur_id, moment);

-- ---------------------------------------------------------------------
-- 8. Journal automatique des corrections faites par l'administrateur
-- ---------------------------------------------------------------------
create table public.journal_modifications (
  id           uuid primary key default gen_random_uuid(),
  moment       timestamptz not null default now(),
  auteur_id    uuid references public.utilisateurs(id),
  table_cible  text not null,
  ligne_id     uuid,
  action       text not null check (action in ('UPDATE', 'DELETE')),
  avant        jsonb,
  apres        jsonb
);
create index journal_modifications_par_ligne on public.journal_modifications (table_cible, ligne_id, moment);

create or replace function public.journaliser_correction_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avant jsonb;
  v_apres jsonb;
begin
  -- Seules les modifications faites PAR l'administrateur connecté sont journalisées ici
  -- (les gestes normaux ont leur propre journal ; le serveur et les tâches automatiques n'ont pas d'utilisateur).
  if (select auth.uid()) is null or not public.est_admin() then
    return null;
  end if;

  v_avant := to_jsonb(old);
  if tg_op = 'UPDATE' then
    v_apres := to_jsonb(new);
  end if;

  insert into public.journal_modifications (auteur_id, table_cible, ligne_id, action, avant, apres)
  values ((select auth.uid()), tg_table_name, (v_avant ->> 'id')::uuid, tg_op, v_avant, v_apres);
  return null;
end;
$$;

create trigger journal_quarts
  after update or delete on public.quarts
  for each row execute function public.journaliser_correction_admin();
create trigger journal_equipage_periodes
  after update or delete on public.equipage_periodes
  for each row execute function public.journaliser_correction_admin();
create trigger journal_passes
  after update or delete on public.passes
  for each row execute function public.journaliser_correction_admin();

-- ---------------------------------------------------------------------
-- 9. Verrouillage : règles d'accès actives, aucune permission (jusqu'à l'étape 8)
-- ---------------------------------------------------------------------
alter table public.reglages              enable row level security;
alter table public.passes                enable row level security;
alter table public.passe_arrets          enable row level security;
alter table public.problemes             enable row level security;
alter table public.positions             enable row level security;
alter table public.quarts                enable row level security;
alter table public.equipage_periodes     enable row level security;
alter table public.equipage_journal      enable row level security;
alter table public.journal_modifications enable row level security;

revoke all on public.reglages, public.passes, public.passe_arrets, public.problemes,
              public.positions, public.quarts, public.equipage_periodes,
              public.equipage_journal, public.journal_modifications
  from anon, authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'arrets_conserves',  (select count(*) from public.stops),
  'routes_conservees', (select count(*) from public.routes),
  'btree_gist',        exists (select 1 from pg_extension where extname = 'btree_gist'),
  'tables_verrouillees', (select jsonb_agg(relname order by relname)
                            from pg_class
                           where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
                             and relname in ('reglages','passes','passe_arrets','problemes','positions','quarts',
                                             'equipage_periodes','equipage_journal','journal_modifications','utilisateurs')),
  'contraintes_anti_chevauchement', (select jsonb_agg(conname order by conname) from pg_constraint where contype = 'x' and connamespace = 'public'::regnamespace),
  'reglages', (select jsonb_object_agg(cle, valeur) from public.reglages),
  'colonnes_equipes', (select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = 'equipes')
) as verification;
