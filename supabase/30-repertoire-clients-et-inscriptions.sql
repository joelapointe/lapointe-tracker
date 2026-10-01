-- =====================================================================
-- DEMANDE 5 DE JOÉ (30 SEPTEMBRE 2026) — AVERTIR LES CLIENTS : le RÉPERTOIRE CLIENTS, les INSCRIPTIONS aux avis par texto et le REGISTRE DES CONSENTEMENTS
-- =====================================================================
-- À EXÉCUTER APRÈS LES FICHIERS PRÉCÉDENTS (01 à 29). Ne modifie AUCUNE donnée existante, AUCUNE règle d'accès existante et AUCUNE fonction existante : elle ajoute
-- des tables (vides au départ), des fonctions, une vue, et UNE colonne vide à la table stops (stops.client_id). Peut être exécuté plusieurs fois sans problème (les clients, les
-- inscriptions et le registre ne sont jamais effacés ; le « sel » des empreintes d'adresses IP n'est jamais changé).
--
-- POURQUOI : Joé veut avertir ses clients (courriel et texto) que l'équipe passera « dans environ X heures » pour qu'ils ramassent leur terrain. Les coordonnées des clients
-- ne peuvent PAS aller dans stops (tout employé actif lit stops) : elles vont dans un répertoire réservé à l'ADMINISTRATEUR. Les textos exigent, chez les compagnies de téléphone
-- (règle de Twilio, pas une loi), un consentement DISTINCT et FACULTATIF, prouvé : les clients s'inscrivent sur une page publique du site de Joé (entretienlapointe.ca/avis) et
-- chaque consentement, retrait ou désabonnement est gardé dans un registre qu'on ne peut ni modifier ni effacer.
--
-- CE QUE FAIT CE FICHIER :
--   • clients : le répertoire (une fiche par client : nom, type, adresse, courriel, cellulaire, « avertir par courriel oui/non », date du dernier contrat…). Lisible et modifiable
--     par l'ADMINISTRATEUR seulement ; jamais effacé (on ARCHIVE : actif = false). Les colonnes du CONSENTEMENT (avis_texto, désabonnements, consentement exprès aux promotions)
--     ne s'écrivent que par les fonctions ci-dessous : aucune écriture directe. Changer le numéro de cellulaire d'un client ANNULE son inscription aux textos (elle valait pour
--     l'ancien numéro).
--   • stops.client_id : le lien d'un arrêt vers une fiche du répertoire (vide au départ).
--   • textes_consentement : les versions du texte que le client lit avant de s'inscrire (une version n'est jamais modifiée ni effacée : c'est la preuve de ce que le client a accepté).
--     Deux textes au départ : celui des TEXTOS d'avis de passage (texto-2026-10-v1) et celui, SÉPARÉ et facultatif, des OFFRES PAR COURRIEL (promo-2026-10-v1 : une 2ᵉ case sur la page).
--   • inscriptions_avis : les inscriptions reçues de la page publique, en attente que Joé les relie à un client.
--   • consentements : le registre (accord, retrait ; par la page, verbalement, sur papier, par ARRET, par un lien de désabonnement). On n'y écrit qu'en AJOUTANT ; la seule
--     modification permise est de relier une ligne à un client (une fois).
--   • inscrire_avis(…) : la SEULE fonction que la page publique (visiteur non connecté) peut appeler. Piège anti-robot, vérification de chaque champ, une seule inscription par
--     numéro et par jour, et des limites par adresse IP (on ne garde qu'une EMPREINTE de l'adresse IP, jamais l'adresse elle-même). Si la 2ᵉ case (offres par courriel) est cochée,
--     le courriel est exigé et un 2ᵉ accord, distinct, est noté au registre.
--   • admin_relier_inscription, admin_ignorer_inscription, admin_enregistrer_consentement : pour l'administrateur seulement. Relier une inscription qui accepte les offres par courriel
--     marque la fiche « consentement exprès » (à la date de l'inscription), sauf si le courriel de la fiche est différent, si le client est désabonné de tous les courriels ou si un retrait est venu après.
--   • desabonner_contact : pour la fonction d'envoi seulement (rôle service_role : le mot ARRET reçu par texto, un lien de désabonnement dans un courriel).
--   • promo_courriel_permis + la vue clients_avis : « qui peut recevoir quoi » (avis par courriel, avis par texto, courriels promotionnels : consentement exprès, ou contrat dans les
--     2 dernières années = consentement implicite de la loi anti-pourriel, jamais après un désabonnement).
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run (ou : Claude l'exécute lui-même avec l'accord de Joé). Le résultat « verification » du bas
-- est à contrôler.
-- =====================================================================

do $$
begin
  if to_regclass('public.stops') is null or to_regclass('public.utilisateurs') is null then
    raise exception 'les tables stops et utilisateurs n''existent pas : les fichiers précédents n''ont pas été exécutés. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.est_admin()') is null or to_regprocedure('public._exiger_actif()') is null then
    raise exception 'les fonctions de base (est_admin et _exiger_actif : fichiers 01 et 04) n''existent pas. Rien n''a été modifié.';
  end if;
end $$;

begin;

-- Le répertoire des clients
create table if not exists public.clients (
  id                           uuid primary key default gen_random_uuid(),
  nom                          text not null,
  nom_entreprise               text,
  type_client                  text not null default 'particulier',
  adresse                      text,
  ville                        text,
  code_postal                  text,
  courriel                     text,
  telephone                    text,
  cellulaire                   text,
  avis_courriel                boolean not null default false,
  avis_texto                   boolean not null default false,
  dernier_contrat_le           date,
  promo_consentement_expres_le timestamptz,
  desabonne_courriel_le        timestamptz,
  desabonne_texto_le           timestamptz,
  desabonne_promo_le           timestamptz,
  quickbooks_nom               text,
  notes                        text,
  actif                        boolean not null default true,
  cree_le                      timestamptz not null default now(),
  maj_le                       timestamptz not null default now(),
  constraint clients_nom_plage check (char_length(btrim(nom)) between 1 and 150),
  constraint clients_entreprise_courte check (nom_entreprise is null or char_length(nom_entreprise) <= 150),
  constraint clients_type_liste check (type_client in ('particulier', 'investisseur', 'municipalite', 'commerce', 'syndicat', 'autre')),
  constraint clients_adresse_courte check (adresse is null or char_length(adresse) <= 200),
  constraint clients_ville_courte check (ville is null or char_length(ville) <= 100),
  constraint clients_code_postal_court check (code_postal is null or char_length(code_postal) <= 10),
  constraint clients_courriel_format check (courriel is null or (char_length(courriel) <= 150 and courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint clients_telephone_court check (telephone is null or char_length(telephone) <= 30),
  constraint clients_cellulaire_format check (cellulaire is null or cellulaire ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  constraint clients_texto_sans_numero check (not avis_texto or cellulaire is not null),
  constraint clients_quickbooks_court check (quickbooks_nom is null or char_length(quickbooks_nom) <= 150),
  constraint clients_notes_courtes check (notes is null or char_length(notes) <= 2000),
  constraint clients_dernier_contrat_plausible check (dernier_contrat_le is null or dernier_contrat_le between date '2000-01-01' and date '2100-12-31')
);

comment on table public.clients is
  'Le répertoire des clients (demande 5) : une fiche par client, avec ses coordonnées. Réservé à l''ADMINISTRATEUR (les employés n''y ont aucun accès) ; jamais effacé (archivé : actif = false). Les colonnes du consentement (avis_texto, désabonnements, consentement exprès) ne s''écrivent que par les fonctions du fichier 30.';
comment on column public.clients.avis_courriel is
  'Joé a choisi d''avertir ce client PAR COURRIEL (avis de service : jour et heure de passage). Les avis de service n''exigent pas de consentement (loi anti-pourriel, art. 6(6) d), mais un désabonnement (desabonne_courriel_le) les arrête toujours.';
comment on column public.clients.avis_texto is
  'Ce client est INSCRIT aux avis par texto : son consentement est dans le registre consentements. Jamais écrit directement : admin_relier_inscription ou admin_enregistrer_consentement. Retombe à faux si le cellulaire change, ou après ARRET.';
comment on column public.clients.dernier_contrat_le is
  'La date de FIN du dernier contrat (ou du dernier achat) : sert au consentement IMPLICITE de la loi anti-pourriel pour les courriels promotionnels (2 ans après, art. 10(10)).';
comment on column public.clients.promo_consentement_expres_le is
  'Quand ce client a donné un consentement EXPRÈS aux courriels promotionnels. Jamais écrit directement : admin_enregistrer_consentement.';

create index if not exists clients_courriel_idx on public.clients (lower(courriel));
create index if not exists clients_cellulaire_idx on public.clients (cellulaire);

-- Le lien d'un arrêt vers sa fiche du répertoire (vide au départ ; jamais une raison de refuser la suppression d'une fiche : elle n'est jamais supprimée)
alter table public.stops add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists stops_client_id_idx on public.stops (client_id);

-- Les versions du texte de consentement (la preuve de ce que le client a lu et accepté)
create table if not exists public.textes_consentement (
  version    text primary key,
  canal      text not null,
  texte      text not null,
  en_vigueur boolean not null default true,
  cree_le    timestamptz not null default now(),
  constraint textes_consentement_canal_liste check (canal in ('texto', 'courriel_promo')),
  constraint textes_consentement_texte_present check (char_length(btrim(texte)) >= 20)
);

comment on table public.textes_consentement is
  'Les versions du texte de consentement (demande 5). Une version n''est jamais modifiée ni effacée (seul « en_vigueur » peut changer) : un nouveau texte est une NOUVELLE version. Le texte affiché sur la page entretienlapointe.ca/avis est identique à celui de la version en vigueur.';

insert into public.textes_consentement (version, canal, texte) values (
  'texto-2026-10-v1', 'texto',
  $t$J'accepte de recevoir des textos d'Entretien Lapointe au numéro ci-dessus, pour les avis liés à mes services : jour ou heure de passage, début des travaux, changement d'horaire. Aucune publicité. La fréquence varie selon les travaux (jusqu'à quelques textos par semaine en saison). Des frais de messagerie et de données peuvent s'appliquer selon mon forfait. Je peux me désabonner en tout temps en répondant ARRET (ou STOP), ou obtenir de l'aide en répondant AIDE (ou HELP) ou en appelant le 819 268-8069. Mon numéro n'est ni vendu ni partagé avec des tiers, sauf le fournisseur qui envoie les textos pour Entretien Lapointe. Cette inscription est facultative : je reçois mes services même si je ne m'inscris pas.$t$)
on conflict (version) do nothing;

-- Le texte de la 2ᵉ case de la page (facultative, décochée au départ) : les offres et les nouvelles PAR COURRIEL, jamais par texto
insert into public.textes_consentement (version, canal, texte) values (
  'promo-2026-10-v1', 'courriel_promo',
  $t$J'accepte aussi de recevoir par courriel, de temps en temps, les offres et les nouvelles d'Entretien Lapointe (par exemple, un rappel avant la saison des feuilles). Je peux me désabonner en tout temps avec le lien au bas de chaque courriel ou en écrivant à info@entretienlapointe.ca. Cette case est facultative : elle n'a aucun effet sur mes services ni sur mes avis de passage. Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec), 819 268-8069.$t$)
on conflict (version) do nothing;

-- Le « sel » des empreintes d'adresses IP (un secret propre à cette base ; personne n'y a accès, sauf les fonctions ci-dessous)
create table if not exists public.avis_sel (
  sel text primary key
);
insert into public.avis_sel (sel) select replace(gen_random_uuid()::text, '-', '') where not exists (select 1 from public.avis_sel);

-- Les inscriptions reçues de la page publique
create table if not exists public.inscriptions_avis (
  id            uuid primary key default gen_random_uuid(),
  nom           text not null,
  adresse       text not null,
  cellulaire    text not null,
  courriel      text,
  version_texte text not null references public.textes_consentement(version),
  promo_accepte boolean not null default false,
  version_promo text references public.textes_consentement(version),
  ip_hash       text,
  agent         text,
  statut        text not null default 'nouvelle',
  client_id     uuid references public.clients(id),
  cree_le       timestamptz not null default now(),
  traitee_le    timestamptz,
  traitee_par   uuid references public.utilisateurs(id),
  constraint inscriptions_avis_nom_plage check (char_length(nom) between 2 and 100),
  constraint inscriptions_avis_adresse_plage check (char_length(adresse) between 5 and 200),
  constraint inscriptions_avis_cellulaire_format check (cellulaire ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  constraint inscriptions_avis_courriel_format check (courriel is null or (char_length(courriel) <= 150 and courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  constraint inscriptions_avis_agent_court check (agent is null or char_length(agent) <= 300),
  constraint inscriptions_avis_statut_liste check (statut in ('nouvelle', 'reliee', 'ignoree')),
  constraint inscriptions_avis_promo_coherente check ((promo_accepte and version_promo is not null and courriel is not null) or (not promo_accepte and version_promo is null))
);

comment on table public.inscriptions_avis is
  'Les inscriptions aux avis par texto reçues de la page publique entretienlapointe.ca/avis (demande 5), en attente que l''administrateur les relie à un client (admin_relier_inscription). Écrites par la fonction inscrire_avis seulement ; lisibles par l''ADMINISTRATEUR seulement.';

create index if not exists inscriptions_avis_ip_idx on public.inscriptions_avis (ip_hash, cree_le);
create index if not exists inscriptions_avis_cellulaire_idx on public.inscriptions_avis (cellulaire, cree_le);

-- Le registre des consentements (on n'y AJOUTE que ; la seule modification permise : relier une ligne à un client, une fois)
create table if not exists public.consentements (
  id             uuid primary key default gen_random_uuid(),
  client_id      uuid references public.clients(id),
  inscription_id uuid references public.inscriptions_avis(id),
  canal          text not null,
  action         text not null,
  source         text not null,
  contact        text not null,
  version_texte  text references public.textes_consentement(version),
  ip_hash        text,
  fait_le        timestamptz not null default now(),
  fait_par       uuid references public.utilisateurs(id),
  constraint consentements_canal_liste check (canal in ('texto', 'courriel_avis', 'courriel_promo')),
  constraint consentements_action_liste check (action in ('accord', 'retrait')),
  constraint consentements_source_liste check (source in ('page_avis', 'verbal', 'papier', 'admin', 'texto_arret', 'lien_desabonnement')),
  constraint consentements_contact_present check (char_length(contact) between 3 and 150)
);

comment on table public.consentements is
  'Le registre des consentements (demande 5) : chaque accord et chaque retrait (canal texto, courriel d''avis, courriel promotionnel), avec le moyen (page, verbal, papier, ARRET, lien de désabonnement), la version du texte lu et une empreinte de l''adresse IP. Ajout seulement : aucune ligne n''est modifiée ni effacée (seul client_id peut être rempli, une fois).';

create index if not exists consentements_client_idx on public.consentements (client_id, fait_le);
create index if not exists consentements_contact_idx on public.consentements (contact, fait_le);

-- Le registre et les versions du texte sont à l'épreuve des modifications : même l'administrateur, même le propriétaire de la base
create or replace function public._consentements_immuables()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then
    raise exception 'registre_immuable';
  end if;
  if old.client_id is null and new.client_id is not null
     and (new.id, new.inscription_id, new.canal, new.action, new.source, new.contact, new.version_texte, new.ip_hash, new.fait_le, new.fait_par)
         is not distinct from (old.id, old.inscription_id, old.canal, old.action, old.source, old.contact, old.version_texte, old.ip_hash, old.fait_le, old.fait_par) then
    return new;
  end if;
  raise exception 'registre_immuable';
end;
$$;

drop trigger if exists consentements_immuables on public.consentements;
create trigger consentements_immuables before update or delete on public.consentements
  for each row execute function public._consentements_immuables();
drop trigger if exists consentements_pas_de_vidage on public.consentements;
create trigger consentements_pas_de_vidage before truncate on public.consentements
  for each statement execute function public._consentements_immuables();

create or replace function public._textes_consentement_immuables()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'texte_immuable';
  end if;
  if (new.version, new.canal, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.texte, old.cree_le) then
    raise exception 'texte_immuable';
  end if;
  return new;
end;
$$;

drop trigger if exists textes_consentement_immuables on public.textes_consentement;
create trigger textes_consentement_immuables before update or delete on public.textes_consentement
  for each row execute function public._textes_consentement_immuables();

-- Une fiche client : les coordonnées sont remises au propre (courriel en minuscules, cellulaire au format +1…), la date de mise à jour se pose toute seule,
-- et un NOUVEAU cellulaire annule l'inscription aux textos (elle valait pour l'ancien numéro)
create or replace function public._cellulaire_normalise(p_brut text)
returns text
language sql immutable set search_path = ''
as $$
  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else null end
  from (select regexp_replace(coalesce(p_brut, ''), '[^0-9]', '', 'g') as d) x
$$;

create or replace function public._clients_avant_ecriture()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.courriel := nullif(lower(btrim(coalesce(new.courriel, ''))), '');
  if new.cellulaire is not null then
    new.cellulaire := public._cellulaire_normalise(new.cellulaire);
    if new.cellulaire is null then
      raise exception 'cellulaire_invalide';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    new.maj_le := now();
    if new.cellulaire is distinct from old.cellulaire then
      new.avis_texto := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists clients_avant_ecriture on public.clients;
create trigger clients_avant_ecriture before insert or update on public.clients
  for each row execute function public._clients_avant_ecriture();

-- Les droits : tout est réservé à l'administrateur ; les colonnes du consentement ne s'écrivent pas directement
alter table public.clients enable row level security;
alter table public.textes_consentement enable row level security;
alter table public.avis_sel enable row level security;
alter table public.inscriptions_avis enable row level security;
alter table public.consentements enable row level security;

revoke all on public.clients, public.textes_consentement, public.avis_sel, public.inscriptions_avis, public.consentements from public, anon, authenticated;

grant select on public.clients to authenticated;
grant insert (nom, nom_entreprise, type_client, adresse, ville, code_postal, courriel, telephone, cellulaire, avis_courriel, dernier_contrat_le, quickbooks_nom, notes, actif)
  on public.clients to authenticated;
grant update (nom, nom_entreprise, type_client, adresse, ville, code_postal, courriel, telephone, cellulaire, avis_courriel, dernier_contrat_le, quickbooks_nom, notes, actif)
  on public.clients to authenticated;
grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;

drop policy if exists clients_admin on public.clients;
create policy clients_admin on public.clients for all to authenticated
  using ((select public.est_admin())) with check ((select public.est_admin()));
drop policy if exists textes_consentement_admin_lecture on public.textes_consentement;
create policy textes_consentement_admin_lecture on public.textes_consentement for select to authenticated
  using ((select public.est_admin()));
drop policy if exists inscriptions_avis_admin_lecture on public.inscriptions_avis;
create policy inscriptions_avis_admin_lecture on public.inscriptions_avis for select to authenticated
  using ((select public.est_admin()));
drop policy if exists consentements_admin_lecture on public.consentements;
create policy consentements_admin_lecture on public.consentements for select to authenticated
  using ((select public.est_admin()));

-- LA page publique : s'inscrire aux avis par texto (le visiteur n'a pas de compte)
create or replace function public.inscrire_avis(
  p_nom      text,
  p_adresse  text,
  p_cellulaire text,
  p_courriel text,
  p_accepte  boolean,
  p_version  text,
  p_site_web text default null,
  p_agent    text default null,
  p_promo    boolean default false,
  p_version_promo text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_promo  boolean := coalesce(p_promo, false);
  v_nom    text := btrim(coalesce(p_nom, ''));
  v_adr    text := btrim(coalesce(p_adresse, ''));
  v_cel    text := public._cellulaire_normalise(p_cellulaire);
  v_cour   text := nullif(lower(btrim(coalesce(p_courriel, ''))), '');
  v_h      json;
  v_ip     text;
  v_hash   text;
  v_id     uuid;
begin
  -- Le piège anti-robot : un champ caché que seul un robot remplit. On répond « tout va bien » sans rien garder.
  if nullif(btrim(coalesce(p_site_web, '')), '') is not null then
    return jsonb_build_object('statut', 'enregistree');
  end if;
  if char_length(v_nom) not between 2 and 100 then
    raise exception 'nom_invalide';
  end if;
  if char_length(v_adr) not between 5 and 200 then
    raise exception 'adresse_invalide';
  end if;
  if v_cel is null then
    raise exception 'cellulaire_invalide';
  end if;
  if v_cour is not null and (char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'courriel_invalide';
  end if;
  if p_accepte is distinct from true then
    raise exception 'consentement_requis';
  end if;
  if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then
    raise exception 'version_inconnue';
  end if;
  -- La 2ᵉ case (offres par courriel) : facultative ; si elle est cochée, il faut un courriel et la version du texte lu
  if v_promo then
    if v_cour is null then
      raise exception 'courriel_requis_offres';
    end if;
    if not exists (select 1 from public.textes_consentement t where t.version = p_version_promo and t.canal = 'courriel_promo' and t.en_vigueur) then
      raise exception 'version_promo_inconnue';
    end if;
  end if;

  -- Déjà inscrit dans les dernières 24 h avec ce numéro (un double toucher) : on répond « enregistrée » sans rien ajouter
  -- (sauf si la personne ajoute maintenant son accord aux offres : c'est un NOUVEL accord, il doit être noté)
  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then
    return jsonb_build_object('statut', 'enregistree');
  end if;

  -- L'empreinte de l'adresse IP (jamais l'adresse elle-même) pour limiter les abus
  begin
    v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_h := null;
  end;
  v_ip := coalesce(nullif(btrim(coalesce(v_h ->> 'cf-connecting-ip', '')), ''),
                   nullif(btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), ''),
                   'inconnue');
  v_hash := encode(sha256(convert_to(v_ip || '|' || (select s.sel from public.avis_sel s limit 1), 'utf8')), 'hex');

  if (select count(*) from public.inscriptions_avis i where i.ip_hash = v_hash and i.cree_le > now() - interval '1 hour') >= 5
     or (select count(*) from public.inscriptions_avis i where i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 15
     or (select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 200 then
    raise exception 'trop_de_demandes';
  end if;

  insert into public.inscriptions_avis (nom, adresse, cellulaire, courriel, version_texte, promo_accepte, version_promo, ip_hash, agent)
  values (v_nom, v_adr, v_cel, v_cour, p_version, v_promo, case when v_promo then p_version_promo end, v_hash, left(p_agent, 300))
  returning id into v_id;

  insert into public.consentements (inscription_id, canal, action, source, contact, version_texte, ip_hash)
  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);

  if v_promo then
    insert into public.consentements (inscription_id, canal, action, source, contact, version_texte, ip_hash)
    values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);
  end if;

  return jsonb_build_object('statut', 'enregistree');
end;
$$;

-- Relier une inscription à un client : le numéro devient celui du client, et le client est INSCRIT aux avis par texto.
-- Si l'inscription accepte aussi les offres par courriel, la fiche reçoit le consentement exprès (daté du jour de l'inscription) — sauf si le courriel de la fiche est
-- différent, si le client est désabonné de tous les courriels ou si un retrait des offres est venu après : la réponse dit alors « promo » = courriel_different,
-- desabonne_des_courriels ou retire_depuis (rien n'est appliqué ; l'administrateur décide). « non_demandee » : la case n'était pas cochée.
create or replace function public.admin_relier_inscription(p_inscription_id uuid, p_client_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid;
  v_i     public.inscriptions_avis%rowtype;
  v_c     public.clients%rowtype;
  v_promo text := 'non_demandee';
  v_fait  timestamptz;
begin
  v_uid := public._exiger_actif();
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;
  if not found then
    raise exception 'inscription_introuvable';
  end if;
  if v_i.statut <> 'nouvelle' then
    raise exception 'inscription_deja_traitee';
  end if;
  select * into v_c from public.clients where id = p_client_id for update;
  if not found or not v_c.actif then
    raise exception 'client_introuvable';
  end if;

  -- (un changement de numéro annule l'inscription précédente : on écrit donc le numéro d'abord, puis l'inscription)
  update public.clients set cellulaire = v_i.cellulaire, courriel = coalesce(courriel, v_i.courriel) where id = p_client_id;
  update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;
  update public.consentements set client_id = p_client_id where inscription_id = p_inscription_id and client_id is null;
  update public.inscriptions_avis set statut = 'reliee', client_id = p_client_id, traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;

  if v_i.promo_accepte then
    select c.fait_le into v_fait from public.consentements c where c.inscription_id = p_inscription_id and c.canal = 'courriel_promo' and c.action = 'accord' order by c.fait_le limit 1;
    v_fait := coalesce(v_fait, v_i.cree_le);
    if v_c.desabonne_courriel_le is not null then
      v_promo := 'desabonne_des_courriels';
    elsif v_c.courriel is not null and lower(v_c.courriel) <> v_i.courriel then
      v_promo := 'courriel_different';
    elsif exists (select 1 from public.consentements c where c.canal = 'courriel_promo' and c.action = 'retrait' and c.contact = v_i.courriel and c.fait_le > v_fait) then
      v_promo := 'retire_depuis';
    else
      update public.clients set promo_consentement_expres_le = v_fait, desabonne_promo_le = null where id = p_client_id;
      v_promo := 'appliquee';
    end if;
  end if;

  return jsonb_build_object('statut', 'reliee', 'client_id', p_client_id, 'promo', v_promo);
end;
$$;

-- Écarter une inscription (la personne n'est pas une cliente, numéro erroné, essai…)
create or replace function public.admin_ignorer_inscription(p_inscription_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_i   public.inscriptions_avis%rowtype;
begin
  v_uid := public._exiger_actif();
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;
  if not found then
    raise exception 'inscription_introuvable';
  end if;
  if v_i.statut <> 'nouvelle' then
    raise exception 'inscription_deja_traitee';
  end if;
  update public.inscriptions_avis set statut = 'ignoree', traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;
  return jsonb_build_object('statut', 'ignoree');
end;
$$;

-- Noter un consentement ou un retrait obtenu VERBALEMENT, sur PAPIER ou décidé par l'administrateur
create or replace function public.admin_enregistrer_consentement(
  p_client_id uuid,
  p_canal     text,
  p_action    text,
  p_source    text,
  p_version   text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid;
  v_c   public.clients%rowtype;
begin
  v_uid := public._exiger_actif();
  if not public.est_admin() then
    raise exception 'non_autorise';
  end if;
  if p_canal is null or p_canal not in ('texto', 'courriel_promo') then
    raise exception 'canal_invalide';
  end if;
  if p_action is null or p_action not in ('accord', 'retrait') then
    raise exception 'action_invalide';
  end if;
  if p_source is null or p_source not in ('verbal', 'papier', 'admin') then
    raise exception 'source_invalide';
  end if;
  select * into v_c from public.clients where id = p_client_id for update;
  if not found or not v_c.actif then
    raise exception 'client_introuvable';
  end if;

  if p_canal = 'texto' then
    if p_action = 'accord' then
      if v_c.cellulaire is null then
        raise exception 'cellulaire_requis';
      end if;
      if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then
        raise exception 'version_inconnue';
      end if;
      update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;
      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)
      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);
    else
      if v_c.cellulaire is null then
        raise exception 'cellulaire_requis';
      end if;
      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = p_client_id;
      insert into public.consentements (client_id, canal, action, source, contact, fait_par)
      values (p_client_id, 'texto', 'retrait', p_source, v_c.cellulaire, v_uid);
    end if;
  else
    if v_c.courriel is null then
      raise exception 'courriel_requis';
    end if;
    if p_action = 'accord' then
      update public.clients set promo_consentement_expres_le = now(), desabonne_promo_le = null where id = p_client_id;
      insert into public.consentements (client_id, canal, action, source, contact, fait_par)
      values (p_client_id, 'courriel_promo', 'accord', p_source, v_c.courriel, v_uid);
    else
      update public.clients set promo_consentement_expres_le = null, desabonne_promo_le = now() where id = p_client_id;
      insert into public.consentements (client_id, canal, action, source, contact, fait_par)
      values (p_client_id, 'courriel_promo', 'retrait', p_source, v_c.courriel, v_uid);
    end if;
  end if;

  return jsonb_build_object('statut', 'enregistre');
end;
$$;

-- ARRET reçu par texto, ou lien de désabonnement d'un courriel : pour la fonction d'envoi seulement (service_role)
create or replace function public.desabonner_contact(p_canal text, p_contact text, p_source text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_cel  text;
  v_cour text;
  v_n    integer := 0;
  r      record;
begin
  if p_canal is null or p_canal not in ('texto', 'courriel', 'courriel_promo') then
    raise exception 'canal_invalide';
  end if;
  if p_source is null or p_source not in ('texto_arret', 'lien_desabonnement') then
    raise exception 'source_invalide';
  end if;

  if p_canal = 'texto' then
    v_cel := public._cellulaire_normalise(p_contact);
    if v_cel is null then
      raise exception 'contact_invalide';
    end if;
    for r in select c.id from public.clients c where c.cellulaire = v_cel loop
      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = r.id;
      insert into public.consentements (client_id, canal, action, source, contact) values (r.id, 'texto', 'retrait', p_source, v_cel);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      insert into public.consentements (canal, action, source, contact) values ('texto', 'retrait', p_source, v_cel);
    end if;
    update public.inscriptions_avis set statut = 'ignoree', traitee_le = now() where cellulaire = v_cel and statut = 'nouvelle';
  else
    v_cour := nullif(lower(btrim(coalesce(p_contact, ''))), '');
    if v_cour is null or char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'contact_invalide';
    end if;
    for r in select c.id from public.clients c where lower(c.courriel) = v_cour loop
      if p_canal = 'courriel' then
        update public.clients set desabonne_courriel_le = coalesce(desabonne_courriel_le, now()) where id = r.id;
        insert into public.consentements (client_id, canal, action, source, contact) values (r.id, 'courriel_avis', 'retrait', p_source, v_cour);
      else
        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()), promo_consentement_expres_le = null where id = r.id;
        insert into public.consentements (client_id, canal, action, source, contact) values (r.id, 'courriel_promo', 'retrait', p_source, v_cour);
      end if;
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then
      insert into public.consentements (canal, action, source, contact)
      values (case when p_canal = 'courriel' then 'courriel_avis' else 'courriel_promo' end, 'retrait', p_source, v_cour);
    end if;
  end if;

  return jsonb_build_object('statut', 'desabonne', 'clients', v_n);
end;
$$;

-- Les courriels promotionnels : consentement EXPRÈS, ou (loi anti-pourriel, art. 10(10)) un contrat terminé depuis moins de 2 ans ; jamais après un désabonnement
create or replace function public.promo_courriel_permis(
  p_courriel text,
  p_dernier_contrat date,
  p_consentement_expres timestamptz,
  p_desabonne_promo timestamptz,
  p_desabonne_courriel timestamptz,
  p_actif boolean default true)
returns boolean
language sql stable set search_path = ''
as $$
  select coalesce(p_actif, false)
     and p_courriel is not null
     and p_desabonne_promo is null
     and p_desabonne_courriel is null
     and (p_consentement_expres is not null
          or (p_dernier_contrat is not null and p_dernier_contrat >= (current_date - interval '2 years')::date))
$$;

-- « Qui peut recevoir quoi » : une seule définition, utilisée partout (les règles de la table clients s'appliquent : administrateur seulement)
create or replace view public.clients_avis with (security_invoker = true) as
select c.id,
       c.nom,
       c.type_client,
       (c.actif and c.avis_courriel and c.courriel is not null and c.desabonne_courriel_le is null) as courriel_avis_ok,
       (c.actif and c.avis_texto and c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,
       public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, c.promo_consentement_expres_le, c.desabonne_promo_le, c.desabonne_courriel_le, c.actif) as promo_courriel_ok,
       case when c.promo_consentement_expres_le is null and c.dernier_contrat_le is not null then (c.dernier_contrat_le + interval '2 years')::date end as promo_implicite_expire_le
from public.clients c;

comment on view public.clients_avis is
  'Qui peut recevoir quoi (demande 5) : courriel_avis_ok (avis de service par courriel), texto_avis_ok (avis par texto : inscription active), promo_courriel_ok (courriels promotionnels : consentement exprès ou contrat dans les 2 dernières années, jamais après un désabonnement) et la date où le consentement implicite expire.';

-- Qui peut appeler quoi
revoke all on function public._consentements_immuables()                          from public, anon, authenticated;
revoke all on function public._textes_consentement_immuables()                    from public, anon, authenticated;
revoke all on function public._cellulaire_normalise(text)                         from public, anon, authenticated;
revoke all on function public._clients_avant_ecriture()                           from public, anon, authenticated;
revoke all on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) from public;
grant execute on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) to anon, authenticated;
revoke all on function public.admin_relier_inscription(uuid, uuid)                from public, anon;
grant execute on function public.admin_relier_inscription(uuid, uuid)             to authenticated;
revoke all on function public.admin_ignorer_inscription(uuid)                     from public, anon;
grant execute on function public.admin_ignorer_inscription(uuid)                  to authenticated;
revoke all on function public.admin_enregistrer_consentement(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_enregistrer_consentement(uuid, text, text, text, text) to authenticated;
revoke all on function public.desabonner_contact(text, text, text)                from public, anon, authenticated;
grant execute on function public.desabonner_contact(text, text, text)             to service_role;
revoke all on function public.promo_courriel_permis(text, date, timestamptz, timestamptz, timestamptz, boolean) from public, anon;
grant execute on function public.promo_courriel_permis(text, date, timestamptz, timestamptz, timestamptz, boolean) to authenticated;
revoke all on public.clients_avis from public, anon, authenticated;
grant select on public.clients_avis to authenticated;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à contrôler.
-- =====================================================================
select jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(t order by t), '[]'::jsonb) from unnest(array['clients', 'textes_consentement', 'avis_sel', 'inscriptions_avis', 'consentements']) t where to_regclass('public.' || t) is not null),
  'regles_actives', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c where c.oid in ('public.clients'::regclass, 'public.textes_consentement'::regclass, 'public.avis_sel'::regclass, 'public.inscriptions_avis'::regclass, 'public.consentements'::regclass) and c.relrowsecurity),
  'regles', (select coalesce(jsonb_agg(tablename || '.' || policyname || ' (' || cmd || ')' order by tablename, policyname), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename in ('clients', 'textes_consentement', 'avis_sel', 'inscriptions_avis', 'consentements')),
  'visiteur_peut_lire_les_tables', (has_table_privilege('anon', 'public.clients', 'select') or has_table_privilege('anon', 'public.inscriptions_avis', 'select') or has_table_privilege('anon', 'public.consentements', 'select') or has_table_privilege('anon', 'public.avis_sel', 'select') or has_table_privilege('anon', 'public.clients_avis', 'select')),
  'connecte_peut_ecrire_le_consentement', has_column_privilege('authenticated', 'public.clients', 'avis_texto', 'update') or has_column_privilege('authenticated', 'public.clients', 'desabonne_texto_le', 'update') or has_table_privilege('authenticated', 'public.consentements', 'insert'),
  'visiteur_peut_appeler', (select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('inscrire_avis', 'admin_relier_inscription', 'admin_ignorer_inscription', 'admin_enregistrer_consentement', 'desabonner_contact', 'promo_courriel_permis') and has_function_privilege('anon', p.oid, 'execute')),
  'desabonner_reserve_au_service', has_function_privilege('service_role', 'public.desabonner_contact(text, text, text)', 'execute') and not has_function_privilege('authenticated', 'public.desabonner_contact(text, text, text)', 'execute'),
  'colonne_stops_client_id', (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'stops' and column_name = 'client_id'),
  'texte_en_vigueur', (select version from public.textes_consentement where en_vigueur and canal = 'texto' order by cree_le desc limit 1),
  'texte_promo_en_vigueur', (select version from public.textes_consentement where en_vigueur and canal = 'courriel_promo' order by cree_le desc limit 1),
  'clients', (select count(*) from public.clients),
  'inscriptions', (select count(*) from public.inscriptions_avis),
  'consentements', (select count(*) from public.consentements)
) as verification;
