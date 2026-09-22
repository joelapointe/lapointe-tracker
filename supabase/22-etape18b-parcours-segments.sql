-- =====================================================================
-- ÉTAPE 18b (SUITE) — LE TRACÉ QUI SUIT LES RUES : LA TABLE DES TRONÇONS (décision de Joé, 21 septembre 2026)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 21. Ne modifie AUCUNE donnée existante : elle crée seulement une nouvelle table, vide.
-- Peut être exécuté plusieurs fois sans problème (la table et son contenu ne sont jamais effacés ; les règles sont remises à l'identique).
--
-- POURQUOI : Joé veut, sur la carte, une ligne qui SUIT LES RUES d'un client au suivant, dans l'ordre choisi (des lignes droites « à vol d'oiseau »
-- ne l'intéressent pas). Le calcul du trajet est fait par un service d'itinéraire (Geoapify), appelé UNIQUEMENT par la fonction serveur
-- « calculer-parcours » (supabase/functions/calculer-parcours) : la clé du service reste secrète chez Supabase, jamais dans l'application.
-- Chaque trajet d'un client A à un client B (un « tronçon ») n'est calculé qu'UNE SEULE FOIS puis gardé ici : les téléphones n'ont qu'à le LIRE
-- (et en gardent une copie pour le hors réseau). Un tronçon n'est recalculé que si l'un des deux clients a changé de place.
--
-- CE QUE FAIT CE FICHIER :
--   • la table parcours_segments : un tronçon = (client de départ, client d'arrivée), la ligne (liste de points [latitude, longitude]),
--     la distance en mètres, la durée en secondes, les positions des deux clients AU MOMENT du calcul (pour savoir si le tronçon est périmé),
--     et un statut : « ok », ou « sans_route » (le service n'a trouvé aucune route entre les deux : on ne redemande pas chaque fois) ;
--   • LECTURE : tout employé actif (comme les arrêts). ÉCRITURE : PERSONNE depuis l'application, pas même l'administrateur : seule la fonction
--     serveur écrit (avec la clé secrète du serveur, qui passe outre les règles d'accès) ;
--   • un tronçon disparaît avec l'un de ses deux arrêts (suppression en cascade) ;
--   • le temps réel : un téléphone est prévenu quand de nouveaux tronçons arrivent.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run. Le résultat « verification » du bas est à me coller.
-- =====================================================================

do $$
begin
  if to_regclass('public.stops') is null then
    raise exception 'la table stops n''existe pas : les fichiers précédents n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_actif()') is null then
    raise exception 'la fonction est_actif() (fichier 03) n''existe pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

create table if not exists public.parcours_segments (
  de_arret_id   uuid not null references public.stops(id) on delete cascade,
  vers_arret_id uuid not null references public.stops(id) on delete cascade,
  -- les positions des deux arrêts quand le tronçon a été calculé : si un arrêt a bougé depuis, le tronçon est périmé (recalculé par la fonction)
  de_lat        double precision not null,
  de_lon        double precision not null,
  vers_lat      double precision not null,
  vers_lon      double precision not null,
  statut        text not null default 'ok' check (statut in ('ok', 'sans_route')),
  trace         jsonb,             -- [[latitude, longitude], ...] : la ligne qui suit les rues (simplifiée) ; vide si « sans_route »
  distance_m    integer,
  duree_s       integer,
  calcule_le    timestamptz not null default now(),
  primary key (de_arret_id, vers_arret_id),
  check (de_arret_id <> vers_arret_id),
  check (statut <> 'ok' or (trace is not null and jsonb_typeof(trace) = 'array' and jsonb_array_length(trace) >= 2))
);

comment on table public.parcours_segments is
  'Tronçons du tracé qui suit les rues (client A vers client B), calculés par la fonction serveur calculer-parcours (Geoapify, données OpenStreetMap) : lecture par les employés actifs, écriture par le serveur seulement.';

alter table public.parcours_segments enable row level security;

-- Droits : lecture seulement pour les employés connectés ; aucun visiteur ; aucune écriture depuis l'application
revoke all on public.parcours_segments from public, anon, authenticated;
grant select on public.parcours_segments to authenticated;

drop policy if exists parcours_segments_lecture on public.parcours_segments;
create policy parcours_segments_lecture on public.parcours_segments for select to authenticated
  using ((select public.est_actif()));

-- Temps réel : les téléphones sont prévenus des nouveaux tronçons (chacun ne reçoit que ce que la règle ci-dessus l'autorise à voir)
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'parcours_segments') then
    alter publication supabase_realtime add table public.parcours_segments;
  end if;
end $$;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'table_existe', to_regclass('public.parcours_segments') is not null,
  'regles_actives', (select relrowsecurity from pg_class where oid = 'public.parcours_segments'::regclass),
  'regles', (select coalesce(jsonb_agg(policyname || ' (' || cmd || ')'), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename = 'parcours_segments'),
  'employe_peut_lire', has_table_privilege('authenticated', 'public.parcours_segments', 'select'),
  'employe_peut_ecrire', has_table_privilege('authenticated', 'public.parcours_segments', 'insert')
                          or has_table_privilege('authenticated', 'public.parcours_segments', 'update')
                          or has_table_privilege('authenticated', 'public.parcours_segments', 'delete'),
  'visiteur_peut_lire', has_table_privilege('anon', 'public.parcours_segments', 'select'),
  'temps_reel', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'parcours_segments'),
  'troncons_existants', (select count(*) from public.parcours_segments),
  'arrets_actifs', (select count(*) from public.stops where actif)
) as verification;
