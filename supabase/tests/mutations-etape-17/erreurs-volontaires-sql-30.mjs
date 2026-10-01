// Demande 5 — outil des ERREURS VOLONTAIRES du fichier SQL 30 (répertoire clients, inscriptions, registre des consentements) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-sql-30.mjs               (toutes les mutations, ≈ 4 s chacune)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-sql-30.mjs      (seulement celles-là ; « 100-150 » pour une plage)
//   LISTER=1 node mutations-etape-17/erreurs-volontaires-sql-30.mjs      (affiche seulement la liste numérotée des mutations)
//   MATCH="texte du nom" node mutations-etape-17/erreurs-volontaires-sql-30.mjs   (seulement les mutations dont le nom correspond à cette expression)
//   VALIDER=1 node mutations-etape-17/erreurs-volontaires-sql-30.mjs     (vérifie seulement que chaque texte à abîmer est présent UNE fois dans le fichier)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier SQL 30 (variable SQL30_TEST) ; test-repertoire-inscriptions.mjs doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin).
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/tests/
const FICHIER = fileURLToPath(new URL('../../30-repertoire-clients-et-inscriptions.sql', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8').replace(/\r\n/g, '\n');
const TMP = path.join(os.tmpdir(), `sql-30-mutation-${process.pid}.sql`);   // un fichier par processus : on peut en lancer plusieurs en même temps
const MATCH = process.env.MATCH ? new RegExp(process.env.MATCH, 'i') : null;   // seulement les mutations dont le NOM correspond
const ONLY = process.env.ONLY
  ? process.env.ONLY.split(',').flatMap((p) => { const [a, b] = p.split('-').map(Number); return b === undefined ? [a] : Array.from({ length: b - a + 1 }, (_, k) => a + k); })
  : null;                                                                   // « 3,7 » ou « 100-150 » ou « 1-20,300 »
const R = String.raw;
const AVANT_COMMIT = `commit;\n\n-- ====`;

// [nom, texte exact (UNE fois dans le fichier), texte abîmé]   ou   [nom, [[texte, texte abîmé], …]] (plusieurs remplacements d'un coup)
const M = [];
const m = (nom, de, vers, equivalente) => M.push([nom, de, vers, equivalente]);   // « equivalente » : la raison pour laquelle l'erreur ne change RIEN au comportement (elle peut survivre sans que ce soit un trou)
const mm = (nom, paires) => M.push([nom, paires]);
const variantes = (ligne, liste) => liste.forEach(([nom, vers]) => m(nom, ligne, vers));

// ── les gardes du début
m('le contrôle « les tables stops et utilisateurs existent » est retiré', `if to_regclass('public.stops') is null or to_regclass('public.utilisateurs') is null then`, `if false then`);
m('le contrôle « est_admin et _exiger_actif existent » est retiré', `if to_regprocedure('public.est_admin()') is null or to_regprocedure('public._exiger_actif()') is null then`, `if false then`);

// ── la table clients
m('ré-exécuter plante (clients créée sans « if not exists »)', `create table if not exists public.clients (`, `create table public.clients (`);
m('le nom d\'une fiche n\'est plus obligatoire', `  nom                          text not null,`, `  nom                          text,`);
m('le type d\'une fiche n\'est plus obligatoire', `  type_client                  text not null default 'particulier',`, `  type_client                  text default 'particulier',`);
m('le type par défaut n\'est plus « particulier »', `  type_client                  text not null default 'particulier',`, `  type_client                  text not null default 'autre',`);
m('« avertir par courriel » est vrai par défaut', `  avis_courriel                boolean not null default false,`, `  avis_courriel                boolean not null default true,`);
m('« avertir par courriel » n\'est plus obligatoire', `  avis_courriel                boolean not null default false,`, `  avis_courriel                boolean default false,`);
m('« inscrit aux textos » est vrai par défaut', `  avis_texto                   boolean not null default false,`, `  avis_texto                   boolean not null default true,`);
m('« actif » est faux par défaut', `  actif                        boolean not null default true,`, `  actif                        boolean not null default false,`);
m('« actif » n\'est plus obligatoire', `  actif                        boolean not null default true,`, `  actif                        boolean default true,`);
m('« cree_le » d\'une fiche n\'est plus posé tout seul (une date fixe)', `  cree_le                      timestamptz not null default now(),`, `  cree_le                      timestamptz not null default '2000-01-01',`);
m('« maj_le » d\'une fiche n\'est plus posé tout seul (une date fixe)', `  maj_le                       timestamptz not null default now(),`, `  maj_le                       timestamptz not null default '2000-01-01',`);

variantes(`  constraint clients_nom_plage check (char_length(btrim(nom)) between 1 and 150),`, [
  ['la règle « nom de 1 à 150 caractères » est retirée', `  constraint clients_nom_plage check (true),`],
  ['… accepte un nom vide (0 à 150)', `  constraint clients_nom_plage check (char_length(btrim(nom)) between 0 and 150),`],
  ['… accepte 151 caractères', `  constraint clients_nom_plage check (char_length(btrim(nom)) between 1 and 151),`],
  ['… refuse un nom d\'un seul caractère (2 à 150)', `  constraint clients_nom_plage check (char_length(btrim(nom)) between 2 and 150),`],
  ['… ne retire pas les espaces avant de compter', `  constraint clients_nom_plage check (char_length(nom) between 1 and 150),`]]);
variantes(`  constraint clients_entreprise_courte check (nom_entreprise is null or char_length(nom_entreprise) <= 150),`, [
  ['la règle « entreprise : 150 caractères au plus » est retirée', `  constraint clients_entreprise_courte check (true),`],
  ['… passe à 151', `  constraint clients_entreprise_courte check (nom_entreprise is null or char_length(nom_entreprise) <= 151),`],
  ['… passe à 149', `  constraint clients_entreprise_courte check (nom_entreprise is null or char_length(nom_entreprise) <= 149),`]]);
variantes(`  constraint clients_type_liste check (type_client in ('particulier', 'investisseur', 'municipalite', 'commerce', 'syndicat', 'autre')),`, [
  ['la règle « type de la liste » est retirée', `  constraint clients_type_liste check (true),`],
  ['… le type « syndicat » n\'est plus permis', `  constraint clients_type_liste check (type_client in ('particulier', 'investisseur', 'municipalite', 'commerce', 'autre')),`],
  ['… un type inconnu est permis', `  constraint clients_type_liste check (type_client in ('particulier', 'investisseur', 'municipalite', 'commerce', 'syndicat', 'autre', 'extraterrestre')),`],
  ['… le type « municipalite » n\'est plus permis', `  constraint clients_type_liste check (type_client in ('particulier', 'investisseur', 'commerce', 'syndicat', 'autre')),`]]);
variantes(`  constraint clients_adresse_courte check (adresse is null or char_length(adresse) <= 200),`, [
  ['la règle « adresse : 200 au plus » est retirée', `  constraint clients_adresse_courte check (true),`],
  ['… passe à 201', `  constraint clients_adresse_courte check (adresse is null or char_length(adresse) <= 201),`],
  ['… passe à 199', `  constraint clients_adresse_courte check (adresse is null or char_length(adresse) <= 199),`]]);
variantes(`  constraint clients_ville_courte check (ville is null or char_length(ville) <= 100),`, [
  ['la règle « ville : 100 au plus » est retirée', `  constraint clients_ville_courte check (true),`],
  ['… passe à 101', `  constraint clients_ville_courte check (ville is null or char_length(ville) <= 101),`],
  ['… passe à 99', `  constraint clients_ville_courte check (ville is null or char_length(ville) <= 99),`]]);
variantes(`  constraint clients_code_postal_court check (code_postal is null or char_length(code_postal) <= 10),`, [
  ['la règle « code postal : 10 au plus » est retirée', `  constraint clients_code_postal_court check (true),`],
  ['… passe à 11', `  constraint clients_code_postal_court check (code_postal is null or char_length(code_postal) <= 11),`],
  ['… passe à 9', `  constraint clients_code_postal_court check (code_postal is null or char_length(code_postal) <= 9),`]]);
variantes(R`  constraint clients_courriel_format check (courriel is null or (char_length(courriel) <= 150 and courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),`, [
  ['la règle « forme du courriel » est retirée', `  constraint clients_courriel_format check (true),`],
  ['… passe à 151 caractères', R`  constraint clients_courriel_format check (courriel is null or (char_length(courriel) <= 151 and courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),`],
  ['… passe à 149 caractères', R`  constraint clients_courriel_format check (courriel is null or (char_length(courriel) <= 149 and courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),`],
  ['… ne demande plus que l\'arobase', `  constraint clients_courriel_format check (courriel is null or (char_length(courriel) <= 150 and courriel ~ '@')),`],
  ['… ne demande plus de point dans le domaine', R`  constraint clients_courriel_format check (courriel is null or (char_length(courriel) <= 150 and courriel ~ '^[^@\s]+@[^@\s]+$')),`]]);
variantes(`  constraint clients_telephone_court check (telephone is null or char_length(telephone) <= 30),`, [
  ['la règle « téléphone : 30 au plus » est retirée', `  constraint clients_telephone_court check (true),`],
  ['… passe à 31', `  constraint clients_telephone_court check (telephone is null or char_length(telephone) <= 31),`],
  ['… passe à 29', `  constraint clients_telephone_court check (telephone is null or char_length(telephone) <= 29),`]]);
variantes(R`  constraint clients_cellulaire_format check (cellulaire is null or cellulaire ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),`, [
  ['la règle « forme du cellulaire » est retirée', `  constraint clients_cellulaire_format check (true),`],
  ['… l\'indicatif régional peut commencer par 0 ou 1', R`  constraint clients_cellulaire_format check (cellulaire is null or cellulaire ~ '^\+1[0-9][0-9]{2}[2-9][0-9]{6}$'),`],
  ['… le central peut commencer par 0 ou 1', R`  constraint clients_cellulaire_format check (cellulaire is null or cellulaire ~ '^\+1[2-9][0-9]{2}[0-9][0-9]{6}$'),`],
  ['… un chiffre de moins est permis', R`  constraint clients_cellulaire_format check (cellulaire is null or cellulaire ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{5}$'),`],
  ['… le « +1 » n\'est plus exigé', R`  constraint clients_cellulaire_format check (cellulaire is null or cellulaire ~ '^\+?1?[2-9][0-9]{2}[2-9][0-9]{6}$'),`]]);
variantes(`  constraint clients_texto_sans_numero check (not avis_texto or cellulaire is not null),`, [
  ['la règle « pas de texto sans numéro » est retirée', `  constraint clients_texto_sans_numero check (true),`],
  ['… ne refuse plus que les textos qui ont un numéro (inversée)', `  constraint clients_texto_sans_numero check (not avis_texto or cellulaire is null),`]]);
variantes(`  constraint clients_quickbooks_court check (quickbooks_nom is null or char_length(quickbooks_nom) <= 150),`, [
  ['la règle « nom QuickBooks : 150 au plus » est retirée', `  constraint clients_quickbooks_court check (true),`],
  ['… passe à 151', `  constraint clients_quickbooks_court check (quickbooks_nom is null or char_length(quickbooks_nom) <= 151),`],
  ['… passe à 149', `  constraint clients_quickbooks_court check (quickbooks_nom is null or char_length(quickbooks_nom) <= 149),`]]);
variantes(`  constraint clients_notes_courtes check (notes is null or char_length(notes) <= 2000),`, [
  ['la règle « notes : 2000 au plus » est retirée', `  constraint clients_notes_courtes check (true),`],
  ['… passe à 2001', `  constraint clients_notes_courtes check (notes is null or char_length(notes) <= 2001),`],
  ['… passe à 1999', `  constraint clients_notes_courtes check (notes is null or char_length(notes) <= 1999),`]]);
variantes(`  constraint clients_dernier_contrat_plausible check (dernier_contrat_le is null or dernier_contrat_le between date '2000-01-01' and date '2100-12-31')`, [
  ['la règle « date de contrat plausible » est retirée', `  constraint clients_dernier_contrat_plausible check (true)`],
  ['… la borne du bas recule à 1999', `  constraint clients_dernier_contrat_plausible check (dernier_contrat_le is null or dernier_contrat_le between date '1999-01-01' and date '2100-12-31')`],
  ['… la borne du bas avance à 2001', `  constraint clients_dernier_contrat_plausible check (dernier_contrat_le is null or dernier_contrat_le between date '2001-01-01' and date '2100-12-31')`],
  ['… la borne du haut avance à 2101', `  constraint clients_dernier_contrat_plausible check (dernier_contrat_le is null or dernier_contrat_le between date '2000-01-01' and date '2101-12-31')`],
  ['… la borne du haut recule à 2099', `  constraint clients_dernier_contrat_plausible check (dernier_contrat_le is null or dernier_contrat_le between date '2000-01-01' and date '2099-12-31')`]]);
m('l\'index des courriels est retiré', `create index if not exists clients_courriel_idx on public.clients (lower(courriel));`, ``);
m('l\'index des cellulaires est retiré', `create index if not exists clients_cellulaire_idx on public.clients (cellulaire);`, ``);

// ── stops.client_id
m('stops.client_id : ré-exécuter plante (colonne ajoutée sans « if not exists »)', `add column if not exists client_id uuid`, `add column client_id uuid`);
m('stops.client_id : supprimer une fiche ne vide plus le lien (plus de « on delete set null »)', `references public.clients(id) on delete set null;`, `references public.clients(id);`);
m('stops.client_id : plus de clé étrangère (n\'importe quel identifiant)', `add column if not exists client_id uuid references public.clients(id) on delete set null;`, `add column if not exists client_id uuid;`);
m('stops.client_id : supprimer une fiche EFFACE les arrêts (cascade)', `references public.clients(id) on delete set null;`, `references public.clients(id) on delete cascade;`);
m('stops.client_id : la colonne n\'est plus ajoutée', `alter table public.stops add column if not exists client_id uuid references public.clients(id) on delete set null;\ncreate index if not exists stops_client_id_idx on public.stops (client_id);`, `select 1;`);
m('l\'index de stops.client_id est retiré', `create index if not exists stops_client_id_idx on public.stops (client_id);`, ``);

// ── textes_consentement
m('ré-exécuter plante (textes_consentement créée sans « if not exists »)', `create table if not exists public.textes_consentement (`, `create table public.textes_consentement (`);
m('la version du texte n\'est plus la clé primaire', `  version    text primary key,`, `  version    text,`);
m('le canal d\'un texte n\'est plus obligatoire', `  canal      text not null,\n  texte      text not null,`, `  canal      text,\n  texte      text not null,`);
m('le texte n\'est plus obligatoire', `  texte      text not null,`, `  texte      text,`);
m('un nouveau texte n\'est plus « en vigueur » par défaut', `  en_vigueur boolean not null default true,`, `  en_vigueur boolean not null default false,`);
m('« en_vigueur » n\'est plus obligatoire', `  en_vigueur boolean not null default true,`, `  en_vigueur boolean default true,`);
m('« cree_le » d\'un texte n\'est plus posé tout seul', `  cree_le    timestamptz not null default now(),\n  constraint textes_consentement_canal_liste`, `  cree_le    timestamptz not null default '2000-01-01',\n  constraint textes_consentement_canal_liste`);
variantes(`  constraint textes_consentement_canal_liste check (canal in ('texto', 'courriel_promo')),`, [
  ['la règle « canal d\'un texte » est retirée', `  constraint textes_consentement_canal_liste check (true),`],
  ['… un autre canal est permis', `  constraint textes_consentement_canal_liste check (canal in ('texto', 'courriel_promo', 'pigeon')),`]]);
variantes(`  constraint textes_consentement_texte_present check (char_length(btrim(texte)) >= 20)`, [
  ['la règle « un texte d\'au moins 20 caractères » est retirée', `  constraint textes_consentement_texte_present check (true)`],
  ['… passe à 19', `  constraint textes_consentement_texte_present check (char_length(btrim(texte)) >= 19)`],
  ['… passe à 21', `  constraint textes_consentement_texte_present check (char_length(btrim(texte)) >= 21)`],
  ['… compte les espaces', `  constraint textes_consentement_texte_present check (char_length(texte) >= 20)`]]);
m('le texte de consentement n\'annonce plus « Aucune publicité »', `Aucune publicité. `, ``);
m('le texte de consentement n\'annonce plus la fréquence', `La fréquence varie selon les travaux (jusqu'à quelques textos par semaine en saison). `, ``);
m('le texte de consentement n\'annonce plus les frais de messagerie', `Des frais de messagerie et de données peuvent s'appliquer selon mon forfait. `, ``);
m('le texte de consentement n\'annonce plus ARRET', `en répondant ARRET (ou STOP), ou obtenir`, `en répondant STOP, ou obtenir`);
m('le texte de consentement n\'annonce plus STOP', `en répondant ARRET (ou STOP), ou obtenir`, `en répondant ARRET, ou obtenir`);
m('le texte de consentement n\'annonce plus AIDE', `en répondant AIDE (ou HELP) ou en appelant`, `en répondant HELP ou en appelant`);
m('le texte de consentement n\'annonce plus HELP', `en répondant AIDE (ou HELP) ou en appelant`, `en répondant AIDE ou en appelant`);
m('le texte de consentement n\'a plus le numéro de téléphone', `en appelant le 819 268-8069.`, `en appelant le 000 000-0000.`);
m('le texte de consentement n\'annonce plus que le numéro n\'est ni vendu ni partagé', `Mon numéro n'est ni vendu ni partagé avec des tiers, sauf le fournisseur qui envoie les textos pour Entretien Lapointe. `, ``);
m('le texte de consentement ne dit plus que l\'inscription est facultative', `Cette inscription est facultative : je reçois mes services même si je ne m'inscris pas.`, `Cette inscription est obligatoire.`);
m('le texte de consentement ne nomme plus l\'entreprise', `J'accepte de recevoir des textos d'Entretien Lapointe au numéro ci-dessus, pour les avis liés à mes services : jour ou heure de passage, début des travaux, changement d'horaire. Aucune publicité.`, `J'accepte de recevoir des textos au numéro ci-dessus, pour les avis liés à mes services. Aucune publicité.`);
m('ré-exécuter plante (le texte des textos est réinséré sans « on conflict do nothing »)', `si je ne m'inscris pas.$t$)\non conflict (version) do nothing;`, `si je ne m'inscris pas.$t$);`);
m('ré-exécuter plante (le texte des offres est réinséré sans « on conflict do nothing »)', `819 268-8069.$t$)\non conflict (version) do nothing;`, `819 268-8069.$t$);`);

// ── le sel secret
m('ré-exécuter plante (avis_sel créée sans « if not exists »)', `create table if not exists public.avis_sel (`, `create table public.avis_sel (`);
m('ré-exécuter ajoute un 2ᵉ sel (plus de « where not exists »)', `select replace(gen_random_uuid()::text, '-', '') where not exists (select 1 from public.avis_sel);`, `select replace(gen_random_uuid()::text, '-', '');`);
m('le sel est le même partout (une valeur fixe)', `select replace(gen_random_uuid()::text, '-', '') where not exists`, `select 'sel-fixe-de-la-base' where not exists`);

// ── inscriptions_avis
m('ré-exécuter plante (inscriptions_avis créée sans « if not exists »)', `create table if not exists public.inscriptions_avis (`, `create table public.inscriptions_avis (`);
m('le nom d\'une inscription n\'est plus obligatoire', `  nom           text not null,\n  adresse       text not null,`, `  nom           text,\n  adresse       text not null,`);
m('l\'adresse d\'une inscription n\'est plus obligatoire', `  adresse       text not null,\n  cellulaire    text not null,\n  courriel      text,`, `  adresse       text,\n  cellulaire    text not null,\n  courriel      text,`);
m('le cellulaire d\'une inscription n\'est plus obligatoire', `  cellulaire    text not null,\n  courriel      text,`, `  cellulaire    text,\n  courriel      text,`);
m('la version du texte lu n\'est plus obligatoire', `  version_texte text not null references public.textes_consentement(version),`, `  version_texte text references public.textes_consentement(version),`);
m('la version du texte lu n\'est plus une vraie version (plus de clé étrangère)', `  version_texte text not null references public.textes_consentement(version),`, `  version_texte text not null,`);
m('« statut » d\'une inscription n\'est plus « nouvelle » au départ', `  statut        text not null default 'nouvelle',`, `  statut        text not null default 'reliee',`);
m('« statut » n\'est plus obligatoire', `  statut        text not null default 'nouvelle',`, `  statut        text default 'nouvelle',`);
m('supprimer une fiche client EFFACE ses inscriptions (cascade)', `  client_id     uuid references public.clients(id),\n  cree_le       timestamptz not null default now(),`, `  client_id     uuid references public.clients(id) on delete cascade,\n  cree_le       timestamptz not null default now(),`);
m('l\'inscription peut viser un client qui n\'existe pas (plus de clé étrangère)', `  client_id     uuid references public.clients(id),\n  cree_le       timestamptz not null default now(),`, `  client_id     uuid,\n  cree_le       timestamptz not null default now(),`);
m('« cree_le » d\'une inscription n\'est plus posé tout seul', `  cree_le       timestamptz not null default now(),\n  traitee_le`, `  cree_le       timestamptz not null default '2000-01-01',\n  traitee_le`);
m('« traitee_par » peut être une personne qui n\'existe pas', `  traitee_par   uuid references public.utilisateurs(id),`, `  traitee_par   uuid,`);
variantes(`  constraint inscriptions_avis_nom_plage check (char_length(nom) between 2 and 100),`, [
  ['la règle « nom d\'inscription de 2 à 100 caractères » est retirée', `  constraint inscriptions_avis_nom_plage check (true),`],
  ['… passe à 1 à 100', `  constraint inscriptions_avis_nom_plage check (char_length(nom) between 1 and 100),`],
  ['… passe à 3 à 100', `  constraint inscriptions_avis_nom_plage check (char_length(nom) between 3 and 100),`],
  ['… passe à 2 à 101', `  constraint inscriptions_avis_nom_plage check (char_length(nom) between 2 and 101),`],
  ['… passe à 2 à 99', `  constraint inscriptions_avis_nom_plage check (char_length(nom) between 2 and 99),`]]);
variantes(`  constraint inscriptions_avis_adresse_plage check (char_length(adresse) between 5 and 200),`, [
  ['la règle « adresse d\'inscription de 5 à 200 caractères » est retirée', `  constraint inscriptions_avis_adresse_plage check (true),`],
  ['… passe à 4 à 200', `  constraint inscriptions_avis_adresse_plage check (char_length(adresse) between 4 and 200),`],
  ['… passe à 6 à 200', `  constraint inscriptions_avis_adresse_plage check (char_length(adresse) between 6 and 200),`],
  ['… passe à 5 à 201', `  constraint inscriptions_avis_adresse_plage check (char_length(adresse) between 5 and 201),`],
  ['… passe à 5 à 199', `  constraint inscriptions_avis_adresse_plage check (char_length(adresse) between 5 and 199),`]]);
variantes(R`  constraint inscriptions_avis_cellulaire_format check (cellulaire ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),`, [
  ['la règle « forme du cellulaire d\'inscription » est retirée', `  constraint inscriptions_avis_cellulaire_format check (true),`],
  ['… l\'indicatif régional peut commencer par 1', R`  constraint inscriptions_avis_cellulaire_format check (cellulaire ~ '^\+1[1-9][0-9]{2}[2-9][0-9]{6}$'),`],
  ['… le « +1 » n\'est plus exigé', R`  constraint inscriptions_avis_cellulaire_format check (cellulaire ~ '^\+?1?[2-9][0-9]{2}[2-9][0-9]{6}$'),`]]);
variantes(R`  constraint inscriptions_avis_courriel_format check (courriel is null or (char_length(courriel) <= 150 and courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),`, [
  ['la règle « forme du courriel d\'inscription » est retirée', `  constraint inscriptions_avis_courriel_format check (true),`],
  ['… passe à 151 caractères', R`  constraint inscriptions_avis_courriel_format check (courriel is null or (char_length(courriel) <= 151 and courriel ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),`],
  ['… ne demande plus que l\'arobase', `  constraint inscriptions_avis_courriel_format check (courriel is null or (char_length(courriel) <= 150 and courriel ~ '@')),`]]);
variantes(`  constraint inscriptions_avis_agent_court check (agent is null or char_length(agent) <= 300),`, [
  ['la règle « navigateur : 300 au plus » est retirée', `  constraint inscriptions_avis_agent_court check (true),`],
  ['… passe à 301', `  constraint inscriptions_avis_agent_court check (agent is null or char_length(agent) <= 301),`],
  ['… passe à 299', `  constraint inscriptions_avis_agent_court check (agent is null or char_length(agent) <= 299),`]]);
variantes(`  constraint inscriptions_avis_statut_liste check (statut in ('nouvelle', 'reliee', 'ignoree'))`, [
  ['la règle « statut de la liste » est retirée', `  constraint inscriptions_avis_statut_liste check (true)`],
  ['… « ignoree » n\'est plus permis', `  constraint inscriptions_avis_statut_liste check (statut in ('nouvelle', 'reliee'))`],
  ['… « reliee » n\'est plus permis', `  constraint inscriptions_avis_statut_liste check (statut in ('nouvelle', 'ignoree'))`],
  ['… un statut inconnu est permis', `  constraint inscriptions_avis_statut_liste check (statut in ('nouvelle', 'reliee', 'ignoree', 'en_attente'))`]]);
m('l\'index des inscriptions par adresse IP est retiré', `create index if not exists inscriptions_avis_ip_idx on public.inscriptions_avis (ip_hash, cree_le);`, ``);
m('l\'index des inscriptions par cellulaire est retiré', `create index if not exists inscriptions_avis_cellulaire_idx on public.inscriptions_avis (cellulaire, cree_le);`, ``);

// ── consentements
m('ré-exécuter plante (consentements créée sans « if not exists »)', `create table if not exists public.consentements (`, `create table public.consentements (`);
m('le canal d\'une ligne du registre n\'est plus obligatoire', `  canal          text not null,\n  action         text not null,`, `  canal          text,\n  action         text not null,`);
m('l\'action d\'une ligne du registre n\'est plus obligatoire', `  action         text not null,\n  source         text not null,`, `  action         text,\n  source         text not null,`);
m('la source d\'une ligne du registre n\'est plus obligatoire', `  source         text not null,\n  contact        text not null,`, `  source         text,\n  contact        text not null,`);
m('le contact d\'une ligne du registre n\'est plus obligatoire', `  contact        text not null,\n  version_texte  text references`, `  contact        text,\n  version_texte  text references`);
m('supprimer une fiche client EFFACE ses lignes du registre (cascade)', `  client_id      uuid references public.clients(id),\n  inscription_id`, `  client_id      uuid references public.clients(id) on delete cascade,\n  inscription_id`);
m('supprimer une fiche client VIDE le lien du registre (set null)', `  client_id      uuid references public.clients(id),\n  inscription_id`, `  client_id      uuid references public.clients(id) on delete set null,\n  inscription_id`);
m('supprimer une inscription EFFACE ses lignes du registre (cascade)', `  inscription_id uuid references public.inscriptions_avis(id),`, `  inscription_id uuid references public.inscriptions_avis(id) on delete cascade,`);
m('la version lue n\'est plus une vraie version (plus de clé étrangère)', `  version_texte  text references public.textes_consentement(version),\n  ip_hash        text,\n  fait_le`, `  version_texte  text,\n  ip_hash        text,\n  fait_le`);
m('« fait_le » n\'est plus posé tout seul', `  fait_le        timestamptz not null default now(),`, `  fait_le        timestamptz not null default '2000-01-01',`);
m('« fait_par » peut être une personne qui n\'existe pas', `  fait_par       uuid references public.utilisateurs(id),`, `  fait_par       uuid,`);
variantes(`  constraint consentements_canal_liste check (canal in ('texto', 'courriel_avis', 'courriel_promo')),`, [
  ['la règle « canal du registre » est retirée', `  constraint consentements_canal_liste check (true),`],
  ['… « courriel_avis » n\'est plus permis', `  constraint consentements_canal_liste check (canal in ('texto', 'courriel_promo')),`],
  ['… « courriel_promo » n\'est plus permis', `  constraint consentements_canal_liste check (canal in ('texto', 'courriel_avis')),`],
  ['… « texto » n\'est plus permis', `  constraint consentements_canal_liste check (canal in ('courriel_avis', 'courriel_promo')),`],
  ['… un canal inconnu est permis', `  constraint consentements_canal_liste check (canal in ('texto', 'courriel_avis', 'courriel_promo', 'pigeon')),`]]);
variantes(`  constraint consentements_action_liste check (action in ('accord', 'retrait')),`, [
  ['la règle « action du registre » est retirée', `  constraint consentements_action_liste check (true),`],
  ['… « retrait » n\'est plus permis', `  constraint consentements_action_liste check (action in ('accord')),`],
  ['… une action inconnue est permise', `  constraint consentements_action_liste check (action in ('accord', 'retrait', 'peut-etre')),`]]);
variantes(`  constraint consentements_source_liste check (source in ('page_avis', 'verbal', 'papier', 'admin', 'texto_arret', 'lien_desabonnement')),`, [
  ['la règle « source du registre » est retirée', `  constraint consentements_source_liste check (true),`],
  ['… « lien_desabonnement » n\'est plus permis', `  constraint consentements_source_liste check (source in ('page_avis', 'verbal', 'papier', 'admin', 'texto_arret')),`],
  ['… « texto_arret » n\'est plus permis', `  constraint consentements_source_liste check (source in ('page_avis', 'verbal', 'papier', 'admin', 'lien_desabonnement')),`],
  ['… « page_avis » n\'est plus permis', `  constraint consentements_source_liste check (source in ('verbal', 'papier', 'admin', 'texto_arret', 'lien_desabonnement')),`],
  ['… « papier » n\'est plus permis', `  constraint consentements_source_liste check (source in ('page_avis', 'verbal', 'admin', 'texto_arret', 'lien_desabonnement')),`],
  ['… une source inconnue est permise', `  constraint consentements_source_liste check (source in ('page_avis', 'verbal', 'papier', 'admin', 'texto_arret', 'lien_desabonnement', 'rumeur')),`]]);
variantes(`  constraint consentements_contact_present check (char_length(contact) between 3 and 150)`, [
  ['la règle « contact de 3 à 150 caractères » est retirée', `  constraint consentements_contact_present check (true)`],
  ['… passe à 2 à 150', `  constraint consentements_contact_present check (char_length(contact) between 2 and 150)`],
  ['… passe à 4 à 150', `  constraint consentements_contact_present check (char_length(contact) between 4 and 150)`],
  ['… passe à 3 à 151', `  constraint consentements_contact_present check (char_length(contact) between 3 and 151)`],
  ['… passe à 3 à 149', `  constraint consentements_contact_present check (char_length(contact) between 3 and 149)`]]);
m('l\'index du registre par client est retiré', `create index if not exists consentements_client_idx on public.consentements (client_id, fait_le);`, ``);
m('l\'index du registre par contact est retiré', `create index if not exists consentements_contact_idx on public.consentements (contact, fait_le);`, ``);

// ── le registre est immuable
m('le registre peut être effacé ligne par ligne', `  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then`, `  if tg_op = 'TRUNCATE' then`, 'la fin de la fonction refuse de toute façon un effacement (NEW est vide) : même résultat');
m('le registre peut être effacé (toute action)', `  if tg_op = 'TRUNCATE' or tg_op = 'DELETE' then\n    raise exception 'registre_immuable';\n  end if;`, `  if false then\n    raise exception 'registre_immuable';\n  end if;`, 'la fin de la fonction refuse de toute façon un effacement ou un vidage : même résultat');
m('une ligne déjà reliée à un client peut être reliée à un autre', `  if old.client_id is null and new.client_id is not null`, `  if new.client_id is not null`);
m('une ligne reliée à un client peut être remise à vide', `  if old.client_id is null and new.client_id is not null`, `  if old.client_id is null`);
m('relier une ligne ne vérifie plus rien d\'autre (toute modification passe)', `         is not distinct from (old.id, old.inscription_id, old.canal, old.action, old.source, old.contact, old.version_texte, old.ip_hash, old.fait_le, old.fait_par) then`, `         is not distinct from (new.id, new.inscription_id, new.canal, new.action, new.source, new.contact, new.version_texte, new.ip_hash, new.fait_le, new.fait_par) then`);
for (const champ of ['id', 'inscription_id', 'canal', 'action', 'source', 'contact', 'version_texte', 'ip_hash', 'fait_le', 'fait_par']) {
  const liste = ['id', 'inscription_id', 'canal', 'action', 'source', 'contact', 'version_texte', 'ip_hash', 'fait_le', 'fait_par'];
  const sans = (p) => liste.filter((c) => c !== champ).map((c) => p + '.' + c).join(', ');
  mm(`le registre ne vérifie plus la colonne « ${champ} » quand on relie une ligne`, [
    [`     and (new.id, new.inscription_id, new.canal, new.action, new.source, new.contact, new.version_texte, new.ip_hash, new.fait_le, new.fait_par)`, `     and (${sans('new')})`],
    [`         is not distinct from (old.id, old.inscription_id, old.canal, old.action, old.source, old.contact, old.version_texte, old.ip_hash, old.fait_le, old.fait_par) then`, `         is not distinct from (${sans('old')}) then`]]);
}
m('ré-exécuter plante (déclencheur du registre non retiré avant d\'être recréé)', `drop trigger if exists consentements_immuables on public.consentements;\n`, ``);
m('le déclencheur du registre n\'existe plus', `create trigger consentements_immuables before update or delete on public.consentements\n  for each row execute function public._consentements_immuables();`, `select 1;`);
m('le déclencheur ne couvre plus la modification (seulement l\'effacement)', `create trigger consentements_immuables before update or delete on public.consentements`, `create trigger consentements_immuables before delete on public.consentements`);
m('le déclencheur ne couvre plus l\'effacement (seulement la modification)', `create trigger consentements_immuables before update or delete on public.consentements`, `create trigger consentements_immuables before update on public.consentements`);
m('ré-exécuter plante (déclencheur de vidage non retiré avant d\'être recréé)', `drop trigger if exists consentements_pas_de_vidage on public.consentements;\n`, ``);
m('le registre peut être vidé d\'un coup (plus de déclencheur de vidage)', `create trigger consentements_pas_de_vidage before truncate on public.consentements\n  for each statement execute function public._consentements_immuables();`, `select 1;`);

m('un texte de consentement peut être effacé', `  if tg_op = 'DELETE' then\n    raise exception 'texte_immuable';\n  end if;`, `  if false then\n    raise exception 'texte_immuable';\n  end if;`, 'la comparaison qui suit échoue aussi pour un effacement (NEW est vide) : même résultat');
m('un texte de consentement peut être modifié (la vérification est retirée)', `  if (new.version, new.canal, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.texte, old.cree_le) then`, `  if false then`);
m('un texte peut être renommé (« version » n\'est plus vérifiée)', `  if (new.version, new.canal, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.texte, old.cree_le) then`, `  if (new.canal, new.texte, new.cree_le) is distinct from (old.canal, old.texte, old.cree_le) then`);
m('le texte peut être modifié (« texte » n\'est plus vérifié)', `  if (new.version, new.canal, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.texte, old.cree_le) then`, `  if (new.version, new.canal, new.cree_le) is distinct from (old.version, old.canal, old.cree_le) then`);
m('la date de création du texte peut être changée', `  if (new.version, new.canal, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.texte, old.cree_le) then`, `  if (new.version, new.canal, new.texte) is distinct from (old.version, old.canal, old.texte) then`);
m('« en_vigueur » ne peut plus changer (toute modification est refusée)', `  if (new.version, new.canal, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.texte, old.cree_le) then`, `  if new.* is distinct from old.* then`);
m('ré-exécuter plante (déclencheur des textes non retiré avant d\'être recréé)', `drop trigger if exists textes_consentement_immuables on public.textes_consentement;\n`, ``);
m('le déclencheur des textes n\'existe plus', `create trigger textes_consentement_immuables before update or delete on public.textes_consentement\n  for each row execute function public._textes_consentement_immuables();`, `select 1;`);
m('le déclencheur des textes ne couvre plus l\'effacement', `create trigger textes_consentement_immuables before update or delete on public.textes_consentement`, `create trigger textes_consentement_immuables before update on public.textes_consentement`);
m('le déclencheur des textes ne couvre plus la modification', `create trigger textes_consentement_immuables before update or delete on public.textes_consentement`, `create trigger textes_consentement_immuables before delete on public.textes_consentement`);

// ── le cellulaire normalisé
variantes(R`  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else null end`, [
  ['un numéro de 11 chiffres qui commence par 1 est refusé', R`  select case when d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else null end`],
  ['plusieurs « 1 » de tête sont permis', R`  select case when d ~ '^1*[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else null end`],
  ['l\'indicatif régional peut commencer par 0', R`  select case when d ~ '^1?[0-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else null end`],
  ['l\'indicatif régional peut commencer par 1', R`  select case when d ~ '^1?[1-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else null end`],
  ['le central peut commencer par 0 ou 1', R`  select case when d ~ '^1?[2-9][0-9]{2}[0-9][0-9]{6}$' then '+1' || right(d, 10) else null end`],
  ['un numéro trop court (9 chiffres) est permis', R`  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{5}$' then '+1' || right(d, 10) else null end`],
  ['un numéro trop long est permis (pas de fin de chaîne)', R`  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}' then '+1' || right(d, 10) else null end`],
  ['un texte avant le numéro est permis (pas de début de chaîne)', R`  select case when d ~ '1?[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else null end`],
  ['le « 1 » de tête est gardé dans le résultat (11 chiffres)', R`  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || d else null end`],
  ['le résultat n\'a plus le « +1 »', R`  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' then '' || right(d, 10) else null end`],
  ['le résultat garde 11 chiffres', R`  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 11) else null end`],
  ['un numéro invalide est renvoyé tel quel', R`  select case when d ~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1' || right(d, 10) else d end`]]);
m('les espaces et les tirets du numéro ne sont plus enlevés (seuls les espaces le sont)', `regexp_replace(coalesce(p_brut, ''), '[^0-9]', '', 'g')`, `regexp_replace(coalesce(p_brut, ''), ' ', '', 'g')`);
m('seul le premier caractère non numérique est enlevé (plus de « g »)', `regexp_replace(coalesce(p_brut, ''), '[^0-9]', '', 'g')`, `regexp_replace(coalesce(p_brut, ''), '[^0-9]', '')`);

// ── la fiche client : normalisation et déclencheur
m('le courriel n\'est plus mis en minuscules', `  new.courriel := nullif(lower(btrim(coalesce(new.courriel, ''))), '');`, `  new.courriel := nullif(btrim(coalesce(new.courriel, '')), '');`);
m('le courriel n\'est plus débarrassé de ses espaces', `  new.courriel := nullif(lower(btrim(coalesce(new.courriel, ''))), '');`, `  new.courriel := nullif(lower(coalesce(new.courriel, '')), '');`);
m('un courriel vide n\'est plus remplacé par « aucun »', `  new.courriel := nullif(lower(btrim(coalesce(new.courriel, ''))), '');`, `  new.courriel := lower(btrim(coalesce(new.courriel, '')));`);
m('le courriel n\'est plus remis au propre du tout', `  new.courriel := nullif(lower(btrim(coalesce(new.courriel, ''))), '');`, `  null;`);
m('le cellulaire n\'est plus remis au format +1…', `    new.cellulaire := public._cellulaire_normalise(new.cellulaire);`, `    null;`);
m('un cellulaire invalide est accepté comme « aucun »', `    if new.cellulaire is null then\n      raise exception 'cellulaire_invalide';\n    end if;`, `    null;`);
m('un cellulaire absent déclenche aussi « invalide »', `  if new.cellulaire is not null then\n    new.cellulaire := public._cellulaire_normalise(new.cellulaire);`, `  if true then\n    new.cellulaire := public._cellulaire_normalise(new.cellulaire);`);
m('« maj_le » n\'avance plus à chaque modification', `    new.maj_le := now();`, `    null;`);
m('un nouveau cellulaire n\'annule plus l\'inscription aux textos', `    if new.cellulaire is distinct from old.cellulaire then\n      new.avis_texto := false;\n    end if;`, `    null;`);
m('l\'inscription aux textos est annulée à CHAQUE modification de la fiche', `    if new.cellulaire is distinct from old.cellulaire then`, `    if true then`);
m('l\'annulation de l\'inscription ignore le passage à « aucun numéro »', `    if new.cellulaire is distinct from old.cellulaire then`, `    if new.cellulaire <> old.cellulaire then`);
m('le déclencheur des fiches ne s\'applique plus à l\'ajout (seulement à la modification)', `create trigger clients_avant_ecriture before insert or update on public.clients`, `create trigger clients_avant_ecriture before update on public.clients`);
m('le déclencheur des fiches ne s\'applique plus à la modification (seulement à l\'ajout)', `create trigger clients_avant_ecriture before insert or update on public.clients`, `create trigger clients_avant_ecriture before insert on public.clients`);
m('le déclencheur des fiches n\'existe plus', `create trigger clients_avant_ecriture before insert or update on public.clients\n  for each row execute function public._clients_avant_ecriture();`, `select 1;`);
m('ré-exécuter plante (déclencheur des fiches non retiré avant d\'être recréé)', `drop trigger if exists clients_avant_ecriture on public.clients;\n`, ``);
m('le déclencheur des fiches n\'est plus « security definer » (il appelle une fonction interdite à l\'administrateur)', `create or replace function public._clients_avant_ecriture()\nreturns trigger\nlanguage plpgsql security definer set search_path = ''`, `create or replace function public._clients_avant_ecriture()\nreturns trigger\nlanguage plpgsql set search_path = ''`);

// ── la sécurité des tables
m('clients : la sécurité (RLS) est coupée', `alter table public.clients enable row level security;`, `alter table public.clients disable row level security;`);
m('textes_consentement : la sécurité (RLS) est coupée', `alter table public.textes_consentement enable row level security;`, `alter table public.textes_consentement disable row level security;`);
m('avis_sel : la sécurité (RLS) est coupée', `alter table public.avis_sel enable row level security;`, `alter table public.avis_sel disable row level security;`);
m('inscriptions_avis : la sécurité (RLS) est coupée', `alter table public.inscriptions_avis enable row level security;`, `alter table public.inscriptions_avis disable row level security;`);
m('consentements : la sécurité (RLS) est coupée', `alter table public.consentements enable row level security;`, `alter table public.consentements disable row level security;`);
m('les droits par défaut des tables ne sont plus retirés (visiteurs et connectés gardent tout)', `revoke all on public.clients, public.textes_consentement, public.avis_sel, public.inscriptions_avis, public.consentements from public, anon, authenticated;`, `select 1;`);
m('les droits par défaut ne sont retirés qu\'au public (les visiteurs gardent tout)', `revoke all on public.clients, public.textes_consentement, public.avis_sel, public.inscriptions_avis, public.consentements from public, anon, authenticated;`, `revoke all on public.clients, public.textes_consentement, public.avis_sel, public.inscriptions_avis, public.consentements from public, authenticated;`);
m('les droits par défaut ne sont retirés qu\'aux visiteurs (les connectés gardent tout)', `revoke all on public.clients, public.textes_consentement, public.avis_sel, public.inscriptions_avis, public.consentements from public, anon, authenticated;`, `revoke all on public.clients, public.textes_consentement, public.avis_sel, public.inscriptions_avis, public.consentements from public, anon;`);
m('« avis_sel » n\'est plus retiré des droits par défaut (les connectés et visiteurs le lisent)', `revoke all on public.clients, public.textes_consentement, public.avis_sel, public.inscriptions_avis, public.consentements from public, anon, authenticated;`, `revoke all on public.clients, public.textes_consentement, public.inscriptions_avis, public.consentements from public, anon, authenticated;`);
m('l\'administrateur ne peut plus lire les clients (droit retiré)', `grant select on public.clients to authenticated;\n`, ``);
m('un visiteur peut lire les clients', `grant select on public.clients to authenticated;\n`, `grant select on public.clients to authenticated;\ngrant select on public.clients to anon;\n`);
m('un connecté peut supprimer des clients', `grant select on public.clients to authenticated;\n`, `grant select, delete on public.clients to authenticated;\n`);
m('un connecté peut tout écrire dans les clients (droit de table entier)', `grant select on public.clients to authenticated;\n`, `grant select, insert, update on public.clients to authenticated;\n`);
const COLS = `nom, nom_entreprise, type_client, adresse, ville, code_postal, courriel, telephone, cellulaire, avis_courriel, dernier_contrat_le, quickbooks_nom, notes, actif`;
m('l\'administrateur peut ÉCRIRE « avis_texto » à l\'ajout', `grant insert (${COLS})`, `grant insert (${COLS}, avis_texto)`);
m('l\'administrateur peut ÉCRIRE « avis_texto » à la modification', `grant update (${COLS})`, `grant update (${COLS}, avis_texto)`);
m('l\'administrateur peut écrire « desabonne_texto_le » à la modification', `grant update (${COLS})`, `grant update (${COLS}, desabonne_texto_le)`);
m('l\'administrateur peut écrire « promo_consentement_expres_le » à la modification', `grant update (${COLS})`, `grant update (${COLS}, promo_consentement_expres_le)`);
m('l\'administrateur peut écrire « desabonne_courriel_le » à l\'ajout', `grant insert (${COLS})`, `grant insert (${COLS}, desabonne_courriel_le)`);
m('l\'administrateur peut écrire « maj_le » à la modification', `grant update (${COLS})`, `grant update (${COLS}, maj_le)`);
m('l\'administrateur ne peut plus écrire « nom » à l\'ajout', `grant insert (${COLS})`, `grant insert (${COLS.replace('nom, ', '')})`);
m('l\'administrateur ne peut plus modifier « notes »', `grant update (${COLS})`, `grant update (${COLS.replace(', notes', '')})`);
m('l\'administrateur ne peut plus modifier « actif » (archiver)', `grant update (${COLS})`, `grant update (${COLS.replace(', actif', '')})`);
m('l\'administrateur ne peut plus modifier « avis_courriel »', `grant update (${COLS})`, `grant update (${COLS.replace('avis_courriel, ', '')})`);
m('l\'administrateur ne peut plus écrire « cellulaire » à l\'ajout', `grant insert (${COLS})`, `grant insert (${COLS.replace('cellulaire, ', '')})`);
m('l\'administrateur ne peut plus lire les textes, inscriptions et registre', `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\n`, ``);
m('un connecté peut écrire dans le registre', `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\n`, `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\ngrant insert on public.consentements to authenticated;\n`);
m('un connecté peut modifier les inscriptions', `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\n`, `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\ngrant update on public.inscriptions_avis to authenticated;\n`);
m('un visiteur peut lire les inscriptions', `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\n`, `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\ngrant select on public.inscriptions_avis to anon;\n`);
m('un connecté peut lire « avis_sel » (le sel secret)', `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\n`, `grant select on public.textes_consentement, public.inscriptions_avis, public.consentements to authenticated;\ngrant select on public.avis_sel to authenticated;\n`);

// ── les règles d'accès
m('ré-exécuter plante (clients_admin non retirée avant d\'être remise)', `drop policy if exists clients_admin on public.clients;\n`, ``);
m('n\'importe quel employé peut lire les clients', `  using ((select public.est_admin())) with check ((select public.est_admin()));`, `  using (true) with check ((select public.est_admin()));`);
m('n\'importe quel employé peut ajouter des clients', `  using ((select public.est_admin())) with check ((select public.est_admin()));`, `  using ((select public.est_admin())) with check (true);`);
m('la règle des clients ne laisse que lire (l\'administrateur ne peut plus écrire)', `create policy clients_admin on public.clients for all to authenticated`, `create policy clients_admin on public.clients for select to authenticated`);
m('la règle des clients s\'applique aussi aux visiteurs non connectés', `create policy clients_admin on public.clients for all to authenticated\n  using ((select public.est_admin())) with check ((select public.est_admin()));`, `create policy clients_admin on public.clients for all to public\n  using ((select public.est_admin())) with check ((select public.est_admin()));`);
m('ré-exécuter plante (règle des textes non retirée avant d\'être remise)', `drop policy if exists textes_consentement_admin_lecture on public.textes_consentement;\n`, ``);
m('n\'importe quel employé peut lire les textes de consentement', `create policy textes_consentement_admin_lecture on public.textes_consentement for select to authenticated\n  using ((select public.est_admin()));`, `create policy textes_consentement_admin_lecture on public.textes_consentement for select to authenticated\n  using (true);`);
m('ré-exécuter plante (règle des inscriptions non retirée avant d\'être remise)', `drop policy if exists inscriptions_avis_admin_lecture on public.inscriptions_avis;\n`, ``);
m('n\'importe quel employé peut lire les inscriptions', `create policy inscriptions_avis_admin_lecture on public.inscriptions_avis for select to authenticated\n  using ((select public.est_admin()));`, `create policy inscriptions_avis_admin_lecture on public.inscriptions_avis for select to authenticated\n  using (true);`);
m('ré-exécuter plante (règle du registre non retirée avant d\'être remise)', `drop policy if exists consentements_admin_lecture on public.consentements;\n`, ``);
m('n\'importe quel employé peut lire le registre', `create policy consentements_admin_lecture on public.consentements for select to authenticated\n  using ((select public.est_admin()));`, `create policy consentements_admin_lecture on public.consentements for select to authenticated\n  using (true);`);
m('la règle du registre laisse aussi écrire', `create policy consentements_admin_lecture on public.consentements for select to authenticated`, `create policy consentements_admin_lecture on public.consentements for all to authenticated`);

// ── inscrire_avis (la page publique)
m('inscrire_avis n\'est plus « security definer » (le visiteur écrit avec ses droits : refusé)', `  p_version_promo text default null)\nreturns jsonb\nlanguage plpgsql security definer set search_path = ''`, `  p_version_promo text default null)\nreturns jsonb\nlanguage plpgsql set search_path = ''`);
m('inscrire_avis : un champ caché rempli n\'est plus un robot', `  if nullif(btrim(coalesce(p_site_web, '')), '') is not null then`, `  if false then`);
m('inscrire_avis : un champ caché fait d\'espaces est pris pour un robot', `  if nullif(btrim(coalesce(p_site_web, '')), '') is not null then`, `  if nullif(coalesce(p_site_web, ''), '') is not null then`);
m('inscrire_avis : un robot reçoit une erreur au lieu de « enregistree »', `  if nullif(btrim(coalesce(p_site_web, '')), '') is not null then\n    return jsonb_build_object('statut', 'enregistree');\n  end if;`, `  if nullif(btrim(coalesce(p_site_web, '')), '') is not null then\n    raise exception 'robot';\n  end if;`);
m('inscrire_avis : le robot est quand même enregistré (le piège ne sert à rien)', `  if nullif(btrim(coalesce(p_site_web, '')), '') is not null then\n    return jsonb_build_object('statut', 'enregistree');\n  end if;`, `  if nullif(btrim(coalesce(p_site_web, '')), '') is not null then\n    null;\n  end if;`);
m('inscrire_avis : le nom n\'est plus débarrassé de ses espaces', `  v_nom    text := btrim(coalesce(p_nom, ''));`, `  v_nom    text := coalesce(p_nom, '');`);
m('inscrire_avis : l\'adresse n\'est plus débarrassée de ses espaces', `  v_adr    text := btrim(coalesce(p_adresse, ''));`, `  v_adr    text := coalesce(p_adresse, '');`);
m('inscrire_avis : le cellulaire n\'est plus remis au format +1…', `  v_cel    text := public._cellulaire_normalise(p_cellulaire);`, `  v_cel    text := p_cellulaire;`);
m('inscrire_avis : le courriel n\'est plus mis en minuscules', `  v_cour   text := nullif(lower(btrim(coalesce(p_courriel, ''))), '');`, `  v_cour   text := nullif(btrim(coalesce(p_courriel, '')), '');`);
m('inscrire_avis : un courriel d\'espaces n\'est plus « aucun courriel »', `  v_cour   text := nullif(lower(btrim(coalesce(p_courriel, ''))), '');`, `  v_cour   text := lower(btrim(coalesce(p_courriel, '')));`);
variantes(`  if char_length(v_nom) not between 2 and 100 then`, [
  ['inscrire_avis : le nom n\'est plus vérifié', `  if false then`],
  ['inscrire_avis : un nom d\'un caractère est permis', `  if char_length(v_nom) not between 1 and 100 then`],
  ['inscrire_avis : un nom de 2 caractères est refusé', `  if char_length(v_nom) not between 3 and 100 then`],
  ['inscrire_avis : un nom de 101 caractères est permis', `  if char_length(v_nom) not between 2 and 101 then`],
  ['inscrire_avis : un nom de 100 caractères est refusé', `  if char_length(v_nom) not between 2 and 99 then`]]);
variantes(`  if char_length(v_adr) not between 5 and 200 then`, [
  ['inscrire_avis : l\'adresse n\'est plus vérifiée', `  if false then`],
  ['inscrire_avis : une adresse de 4 caractères est permise', `  if char_length(v_adr) not between 4 and 200 then`],
  ['inscrire_avis : une adresse de 5 caractères est refusée', `  if char_length(v_adr) not between 6 and 200 then`],
  ['inscrire_avis : une adresse de 201 caractères est permise', `  if char_length(v_adr) not between 5 and 201 then`],
  ['inscrire_avis : une adresse de 200 caractères est refusée', `  if char_length(v_adr) not between 5 and 199 then`]]);
m('inscrire_avis : le cellulaire n\'est plus vérifié', `  if v_cel is null then\n    raise exception 'cellulaire_invalide';\n  end if;`, `  null;`);
m('inscrire_avis : la forme du courriel n\'est plus vérifiée', R`  if v_cour is not null and (char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`, `  if v_cour is not null and (char_length(v_cour) > 150) then`);
m('inscrire_avis : la longueur du courriel n\'est plus vérifiée', R`  if v_cour is not null and (char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`, R`  if v_cour is not null and (v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`);
m('inscrire_avis : le courriel n\'est plus vérifié du tout', R`  if v_cour is not null and (char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`, `  if false then`);
m('inscrire_avis : un courriel de 151 caractères est permis', R`  if v_cour is not null and (char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`, R`  if v_cour is not null and (char_length(v_cour) > 151 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`);
m('inscrire_avis : un courriel de 150 caractères est refusé', R`  if v_cour is not null and (char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`, R`  if v_cour is not null and (char_length(v_cour) > 149 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then`);
m('inscrire_avis : une case non cochée (faux) est acceptée', `  if p_accepte is distinct from true then`, `  if p_accepte is null then`);
m('inscrire_avis : une case absente (NULL) est acceptée', `  if p_accepte is distinct from true then`, `  if p_accepte is false then`);
m('inscrire_avis : la case n\'est plus exigée', `  if p_accepte is distinct from true then`, `  if false then`);
m('inscrire_avis : une version qui n\'est plus « en vigueur » est acceptée', `  if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then\n    raise exception 'version_inconnue';\n  end if;\n  -- La 2ᵉ case`, `  if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto') then\n    raise exception 'version_inconnue';\n  end if;\n  -- La 2ᵉ case`);
m('inscrire_avis : la version du texte n\'est plus vérifiée', `  if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then\n    raise exception 'version_inconnue';\n  end if;\n  -- La 2ᵉ case`, `  null;\n  -- La 2ᵉ case`);
m('inscrire_avis : le double toucher n\'est plus repéré', `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then`, `  if false then`);
m('inscrire_avis : le double toucher est repéré pendant 2 jours', `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then`, `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '2 days' and (i.promo_accepte or not v_promo)) then`);
m('inscrire_avis : le double toucher n\'est repéré que pendant 12 heures', `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then`, `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '12 hours' and (i.promo_accepte or not v_promo)) then`);
m('inscrire_avis : le double toucher ne regarde plus le numéro (n\'importe quelle inscription récente)', `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then`, `  if exists (select 1 from public.inscriptions_avis i where i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then`);
m('inscrire_avis : le double toucher répond par une erreur', `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then\n    return jsonb_build_object('statut', 'enregistree');`, `  if exists (select 1 from public.inscriptions_avis i where i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)) then\n    raise exception 'deja_inscrit';`);
m('inscrire_avis : des en-têtes illisibles font planter l\'inscription', `  exception when others then\n    v_h := null;\n  end;`, `  end;`);
m('inscrire_avis : « cf-connecting-ip » n\'est plus lu', `  v_ip := coalesce(nullif(btrim(coalesce(v_h ->> 'cf-connecting-ip', '')), ''),\n                   nullif(`, `  v_ip := coalesce(nullif(`);
m('inscrire_avis : « x-forwarded-for » est lu avant « cf-connecting-ip »', `  v_ip := coalesce(nullif(btrim(coalesce(v_h ->> 'cf-connecting-ip', '')), ''),\n                   nullif(btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), ''),`, `  v_ip := coalesce(nullif(btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), ''),\n                   nullif(btrim(coalesce(v_h ->> 'cf-connecting-ip', '')), ''),`);
m('inscrire_avis : « x-forwarded-for » n\'est plus lu', `                   nullif(btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), ''),\n`, ``);
m('inscrire_avis : c\'est la 2ᵉ adresse de « x-forwarded-for » qui compte', `split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)`, `split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 2)`);
m('inscrire_avis : toute la liste de « x-forwarded-for » compte (pas seulement la première)', `nullif(btrim(split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1)), ''),`, `nullif(btrim(coalesce(v_h ->> 'x-forwarded-for', '')), ''),`);
m('inscrire_avis : sans en-têtes, aucune empreinte commune (NULL au lieu de « inconnue »)', `                   'inconnue');`, `                   null);`);
m('inscrire_avis : l\'empreinte n\'utilise plus le sel secret', `convert_to(v_ip || '|' || (select s.sel from public.avis_sel s limit 1), 'utf8')`, `convert_to(v_ip, 'utf8')`);
m('inscrire_avis : l\'empreinte est en base64 (plus en hexadécimal)', `'utf8')), 'hex');`, `'utf8')), 'base64');`);
m('inscrire_avis : l\'adresse IP elle-même est gardée au lieu de l\'empreinte', `  v_hash := encode(sha256(convert_to(v_ip || '|' || (select s.sel from public.avis_sel s limit 1), 'utf8')), 'hex');`, `  v_hash := v_ip;`);
m('inscrire_avis : l\'empreinte est la même pour tout le monde', `  v_hash := encode(sha256(convert_to(v_ip || '|' || (select s.sel from public.avis_sel s limit 1), 'utf8')), 'hex');`, `  v_hash := encode(sha256(convert_to('x', 'utf8')), 'hex');`);
mm('inscrire_avis : la limite d\'une heure n\'existe plus', [[`i.ip_hash = v_hash and i.cree_le > now() - interval '1 hour') >= 5\n     or`, `i.ip_hash = v_hash and i.cree_le > now() - interval '1 hour') >= 99999\n     or`]]);
m('inscrire_avis : la limite d\'une heure passe à 6', `i.cree_le > now() - interval '1 hour') >= 5`, `i.cree_le > now() - interval '1 hour') >= 6`);
m('inscrire_avis : la limite d\'une heure passe à 4', `i.cree_le > now() - interval '1 hour') >= 5`, `i.cree_le > now() - interval '1 hour') >= 4`);
m('inscrire_avis : la fenêtre « une heure » devient deux heures', `i.cree_le > now() - interval '1 hour') >= 5`, `i.cree_le > now() - interval '2 hours') >= 5`);
m('inscrire_avis : la fenêtre « une heure » devient 30 minutes', `i.cree_le > now() - interval '1 hour') >= 5`, `i.cree_le > now() - interval '30 minutes') >= 5`);
m('inscrire_avis : la limite d\'une heure est comptée « plus que » (>) au lieu de « au moins » (>=)', `i.cree_le > now() - interval '1 hour') >= 5`, `i.cree_le > now() - interval '1 hour') > 5`);
m('inscrire_avis : la limite d\'une heure compte toutes les adresses', `(select count(*) from public.inscriptions_avis i where i.ip_hash = v_hash and i.cree_le > now() - interval '1 hour') >= 5`, `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 hour') >= 5`);
m('inscrire_avis : la limite de la journée par adresse passe à 16', `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 15`, `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 16`);
m('inscrire_avis : la limite de la journée par adresse passe à 14', `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 15`, `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 14`);
m('inscrire_avis : la fenêtre « une journée » par adresse devient deux jours', `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 15`, `i.ip_hash = v_hash and i.cree_le > now() - interval '2 days') >= 15`);
m('inscrire_avis : la fenêtre « une journée » par adresse devient 12 heures', `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 15`, `i.ip_hash = v_hash and i.cree_le > now() - interval '12 hours') >= 15`);
m('inscrire_avis : la limite de la journée par adresse est comptée « > » au lieu de « >= »', `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 15`, `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') > 15`);
m('inscrire_avis : la limite de la journée par adresse n\'existe plus', `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 15`, `i.ip_hash = v_hash and i.cree_le > now() - interval '1 day') >= 99999`);
m('inscrire_avis : la limite de la base passe à 201', `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 200 then`, `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 201 then`);
m('inscrire_avis : la limite de la base passe à 199', `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 200 then`, `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 199 then`);
m('inscrire_avis : la fenêtre de la limite de la base devient deux jours', `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 200 then`, `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '2 days') >= 200 then`);
m('inscrire_avis : la limite de la base est comptée « > » au lieu de « >= »', `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 200 then`, `(select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') > 200 then`);
m('inscrire_avis : la limite de la base n\'existe plus', `     or (select count(*) from public.inscriptions_avis i where i.cree_le > now() - interval '1 day') >= 200 then`, `     or false then`);
m('inscrire_avis : les limites sont en « et » (il faut toutes les dépasser)', `i.cree_le > now() - interval '1 hour') >= 5\n     or (select`, `i.cree_le > now() - interval '1 hour') >= 5\n     and (select`);
m('inscrire_avis : le dépassement n\'est plus refusé', `    raise exception 'trop_de_demandes';`, `    null;`);
m('inscrire_avis : le navigateur n\'est plus coupé à 300 caractères', `left(p_agent, 300))`, `p_agent)`);
m('inscrire_avis : le navigateur est coupé à 299 caractères', `left(p_agent, 300))`, `left(p_agent, 299))`);
m('inscrire_avis : l\'empreinte n\'est pas gardée avec l\'inscription', `  insert into public.inscriptions_avis (nom, adresse, cellulaire, courriel, version_texte, promo_accepte, version_promo, ip_hash, agent)\n  values (v_nom, v_adr, v_cel, v_cour, p_version, v_promo, case when v_promo then p_version_promo end, v_hash, left(p_agent, 300))`, `  insert into public.inscriptions_avis (nom, adresse, cellulaire, courriel, version_texte, ip_hash, agent)\n  values (v_nom, v_adr, v_cel, v_cour, p_version, v_promo, case when v_promo then p_version_promo end, null, left(p_agent, 300))`);
m('inscrire_avis : l\'adresse et le nom sont inversés dans l\'inscription', `  values (v_nom, v_adr, v_cel, v_cour, p_version, v_promo, case when v_promo then p_version_promo end, v_hash, left(p_agent, 300))`, `  values (v_adr, v_nom, v_cel, v_cour, p_version, v_promo, case when v_promo then p_version_promo end, v_hash, left(p_agent, 300))`);
m('inscrire_avis : le courriel n\'est pas gardé', `  values (v_nom, v_adr, v_cel, v_cour, p_version, v_promo, case when v_promo then p_version_promo end, v_hash, left(p_agent, 300))`, `  values (v_nom, v_adr, v_cel, null, p_version, v_promo, case when v_promo then p_version_promo end, v_hash, left(p_agent, 300))`);
m('inscrire_avis : la ligne du registre n\'est plus ajoutée', `  insert into public.consentements (inscription_id, canal, action, source, contact, version_texte, ip_hash)\n  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  null;`);
m('inscrire_avis : le registre note un retrait au lieu d\'un accord', `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  values (v_id, 'texto', 'retrait', 'page_avis', v_cel, p_version, v_hash);`);
m('inscrire_avis : le registre note une autre source', `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  values (v_id, 'texto', 'accord', 'verbal', v_cel, p_version, v_hash);`);
m('inscrire_avis : le registre note un autre canal', `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cel, p_version, v_hash);`);
m('inscrire_avis : le registre note le nom au lieu du numéro', `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  values (v_id, 'texto', 'accord', 'page_avis', v_nom, p_version, v_hash);`);
m('inscrire_avis : le registre ne garde pas la version lue', `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, null, v_hash);`);
m('inscrire_avis : le registre ne garde pas l\'empreinte', `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, null);`);
m('inscrire_avis : le registre n\'est pas lié à l\'inscription', `  values (v_id, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`, `  values (null, 'texto', 'accord', 'page_avis', v_cel, p_version, v_hash);`);
m('inscrire_avis : la réponse finale n\'est plus « enregistree »', `    values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);\n  end if;\n\n  return jsonb_build_object('statut', 'enregistree');`, `    values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);\n  end if;\n\n  return jsonb_build_object('statut', 'ok');`);

// ── admin_relier_inscription
m('relier : un employé peut relier (le contrôle « administrateur » est retiré)', `  v_uid := public._exiger_actif();\n  if not public.est_admin() then\n    raise exception 'non_autorise';\n  end if;\n  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;\n  if not found then\n    raise exception 'inscription_introuvable';\n  end if;\n  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  select * into v_c`, `  v_uid := public._exiger_actif();\n  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;\n  if not found then\n    raise exception 'inscription_introuvable';\n  end if;\n  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  select * into v_c`);
m('relier : une inscription inconnue n\'est plus refusée', `  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;\n  if not found then\n    raise exception 'inscription_introuvable';\n  end if;\n  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  select * into v_c`, `  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;\n  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  select * into v_c`);
m('relier : une inscription déjà traitée peut être reliée de nouveau', `  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  select * into v_c`, `  select * into v_c`);
m('relier : un client inconnu n\'est plus refusé', `  if not found or not v_c.actif then\n    raise exception 'client_introuvable';\n  end if;\n\n  -- (un changement`, `  if not v_c.actif then\n    raise exception 'client_introuvable';\n  end if;\n\n  -- (un changement`);
m('relier : un client archivé est accepté', `  if not found or not v_c.actif then\n    raise exception 'client_introuvable';\n  end if;\n\n  -- (un changement`, `  if not found then\n    raise exception 'client_introuvable';\n  end if;\n\n  -- (un changement`);
m('relier : le numéro de l\'inscription n\'est plus copié chez le client', `  update public.clients set cellulaire = v_i.cellulaire, courriel = coalesce(courriel, v_i.courriel) where id = p_client_id;`, `  update public.clients set courriel = coalesce(courriel, v_i.courriel) where id = p_client_id;`);
m('relier : le courriel de l\'inscription remplace toujours celui du client', `courriel = coalesce(courriel, v_i.courriel) where id = p_client_id;`, `courriel = coalesce(v_i.courriel, courriel) where id = p_client_id;`);
m('relier : le courriel de l\'inscription n\'est plus copié', `courriel = coalesce(courriel, v_i.courriel) where id = p_client_id;`, `courriel = courriel where id = p_client_id;`);
m('relier : le numéro et l\'inscription sont écrits en même temps (le déclencheur annule l\'inscription)', `  update public.clients set cellulaire = v_i.cellulaire, courriel = coalesce(courriel, v_i.courriel) where id = p_client_id;\n  update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;`, `  update public.clients set cellulaire = v_i.cellulaire, courriel = coalesce(courriel, v_i.courriel), avis_texto = true, desabonne_texto_le = null where id = p_client_id;`);
m('relier : le client n\'est plus inscrit aux textos', `  update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;\n  update public.consentements set client_id = p_client_id where inscription_id`, `  update public.clients set desabonne_texto_le = null where id = p_client_id;\n  update public.consentements set client_id = p_client_id where inscription_id`);
m('relier : un désabonnement antérieur n\'est plus levé', `  update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;\n  update public.consentements set client_id = p_client_id where inscription_id`, `  update public.clients set avis_texto = true where id = p_client_id;\n  update public.consentements set client_id = p_client_id where inscription_id`);
m('relier : la preuve du registre n\'est plus reliée au client', `  update public.consentements set client_id = p_client_id where inscription_id = p_inscription_id and client_id is null;`, `  null;`);
m('relier : la preuve de TOUTES les inscriptions est reliée au client', `  update public.consentements set client_id = p_client_id where inscription_id = p_inscription_id and client_id is null;`, `  update public.consentements set client_id = p_client_id where client_id is null;`);
m('relier : l\'inscription reste « nouvelle » après avoir été reliée', `  update public.inscriptions_avis set statut = 'reliee', client_id = p_client_id, traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;`, `  update public.inscriptions_avis set client_id = p_client_id, traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;`);
m('relier : l\'inscription reliée ne garde pas son client', `  update public.inscriptions_avis set statut = 'reliee', client_id = p_client_id, traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;`, `  update public.inscriptions_avis set statut = 'reliee', traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;`);
m('relier : l\'inscription reliée ne garde pas qui l\'a traitée', `  update public.inscriptions_avis set statut = 'reliee', client_id = p_client_id, traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;`, `  update public.inscriptions_avis set statut = 'reliee', client_id = p_client_id, traitee_le = now() where id = p_inscription_id;`);
m('relier : l\'inscription reliée ne garde pas quand elle a été traitée', `  update public.inscriptions_avis set statut = 'reliee', client_id = p_client_id, traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;`, `  update public.inscriptions_avis set statut = 'reliee', client_id = p_client_id, traitee_par = v_uid where id = p_inscription_id;`);
m('relier : toutes les inscriptions deviennent « reliee »', `traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;\n\n  if v_i.promo_accepte then`, `traitee_le = now(), traitee_par = v_uid;\n\n  if v_i.promo_accepte then`);
m('relier : la réponse ne nomme plus le client', `  return jsonb_build_object('statut', 'reliee', 'client_id', p_client_id, 'promo', v_promo);`, `  return jsonb_build_object('statut', 'reliee', 'promo', v_promo);`);

// ── admin_ignorer_inscription
m('ignorer : un employé peut écarter (le contrôle « administrateur » est retiré)', `  v_uid := public._exiger_actif();\n  if not public.est_admin() then\n    raise exception 'non_autorise';\n  end if;\n  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;\n  if not found then\n    raise exception 'inscription_introuvable';\n  end if;\n  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  update public.inscriptions_avis set statut = 'ignoree'`, `  v_uid := public._exiger_actif();\n  select * into v_i from public.inscriptions_avis where id = p_inscription_id for update;\n  if not found then\n    raise exception 'inscription_introuvable';\n  end if;\n  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  update public.inscriptions_avis set statut = 'ignoree'`);
m('ignorer : une inscription inconnue n\'est plus refusée', `  if not found then\n    raise exception 'inscription_introuvable';\n  end if;\n  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  update public.inscriptions_avis set statut = 'ignoree'`, `  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  update public.inscriptions_avis set statut = 'ignoree'`);
m('ignorer : une inscription déjà traitée peut être écartée', `  if v_i.statut <> 'nouvelle' then\n    raise exception 'inscription_deja_traitee';\n  end if;\n  update public.inscriptions_avis set statut = 'ignoree'`, `  update public.inscriptions_avis set statut = 'ignoree'`);
m('ignorer : l\'inscription n\'est plus marquée « ignoree »', `  update public.inscriptions_avis set statut = 'ignoree', traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;\n  return`, `  update public.inscriptions_avis set statut = 'nouvelle', traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;\n  return`);
m('ignorer : on ne garde pas qui a écarté l\'inscription', `  update public.inscriptions_avis set statut = 'ignoree', traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;\n  return`, `  update public.inscriptions_avis set statut = 'ignoree', traitee_le = now() where id = p_inscription_id;\n  return`);
m('ignorer : on ne garde pas quand l\'inscription a été écartée', `  update public.inscriptions_avis set statut = 'ignoree', traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;\n  return`, `  update public.inscriptions_avis set statut = 'ignoree', traitee_par = v_uid where id = p_inscription_id;\n  return`);
m('ignorer : toutes les inscriptions sont écartées', `  update public.inscriptions_avis set statut = 'ignoree', traitee_le = now(), traitee_par = v_uid where id = p_inscription_id;\n  return`, `  update public.inscriptions_avis set statut = 'ignoree', traitee_le = now(), traitee_par = v_uid;\n  return`);
m('ignorer : la réponse n\'est plus « ignoree »', `  return jsonb_build_object('statut', 'ignoree');`, `  return jsonb_build_object('statut', 'ok');`);

// ── admin_enregistrer_consentement
m('noter : un employé peut noter un consentement (le contrôle « administrateur » est retiré)', `  v_uid := public._exiger_actif();\n  if not public.est_admin() then\n    raise exception 'non_autorise';\n  end if;\n  if p_canal is null`, `  v_uid := public._exiger_actif();\n  if p_canal is null`);
m('noter : un canal inconnu est accepté', `  if p_canal is null or p_canal not in ('texto', 'courriel_promo') then\n    raise exception 'canal_invalide';\n  end if;`, `  null;`);
m('noter : le canal « courriel_avis » est accepté', `p_canal not in ('texto', 'courriel_promo')`, `p_canal not in ('texto', 'courriel_promo', 'courriel_avis')`);
m('noter : un canal absent (NULL) est accepté', `  if p_canal is null or p_canal not in ('texto', 'courriel_promo') then`, `  if p_canal not in ('texto', 'courriel_promo') then`);
m('noter : une action inconnue est acceptée', `  if p_action is null or p_action not in ('accord', 'retrait') then\n    raise exception 'action_invalide';\n  end if;`, `  null;`);
m('noter : une action absente (NULL) est acceptée', `  if p_action is null or p_action not in ('accord', 'retrait') then`, `  if p_action not in ('accord', 'retrait') then`);
m('noter : une source inconnue est acceptée', `  if p_source is null or p_source not in ('verbal', 'papier', 'admin') then\n    raise exception 'source_invalide';\n  end if;`, `  null;`);
m('noter : la source « page_avis » est acceptée', `p_source not in ('verbal', 'papier', 'admin')`, `p_source not in ('verbal', 'papier', 'admin', 'page_avis')`);
m('noter : la source « papier » n\'est plus acceptée', `p_source not in ('verbal', 'papier', 'admin')`, `p_source not in ('verbal', 'admin')`);
m('noter : une source absente (NULL) est acceptée', `  if p_source is null or p_source not in ('verbal', 'papier', 'admin') then`, `  if p_source not in ('verbal', 'papier', 'admin') then`);
m('noter : un client inconnu n\'est plus refusé', `  select * into v_c from public.clients where id = p_client_id for update;\n  if not found or not v_c.actif then\n    raise exception 'client_introuvable';\n  end if;\n\n  if p_canal = 'texto' then`, `  select * into v_c from public.clients where id = p_client_id for update;\n  if not v_c.actif then\n    raise exception 'client_introuvable';\n  end if;\n\n  if p_canal = 'texto' then`);
m('noter : un client archivé est accepté', `  select * into v_c from public.clients where id = p_client_id for update;\n  if not found or not v_c.actif then\n    raise exception 'client_introuvable';\n  end if;\n\n  if p_canal = 'texto' then`, `  select * into v_c from public.clients where id = p_client_id for update;\n  if not found then\n    raise exception 'client_introuvable';\n  end if;\n\n  if p_canal = 'texto' then`);
m('noter : un accord par texto sans cellulaire est accepté', `    if p_action = 'accord' then\n      if v_c.cellulaire is null then\n        raise exception 'cellulaire_requis';\n      end if;\n      if not exists`, `    if p_action = 'accord' then\n      if not exists`);
m('noter : un retrait par texto sans cellulaire est accepté', `    else\n      if v_c.cellulaire is null then\n        raise exception 'cellulaire_requis';\n      end if;\n      update public.clients set avis_texto = false`, `    else\n      update public.clients set avis_texto = false`);
m('noter : un accord par texto sans version lue est accepté', `      if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then\n        raise exception 'version_inconnue';\n      end if;\n      update public.clients set avis_texto = true`, `      update public.clients set avis_texto = true`);
m('noter : un accord avec une version qui n\'est plus en vigueur est accepté', `      if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then\n        raise exception 'version_inconnue';\n      end if;\n      update public.clients set avis_texto = true`, `      if not exists (select 1 from public.textes_consentement t where t.version = p_version and t.canal = 'texto') then\n        raise exception 'version_inconnue';\n      end if;\n      update public.clients set avis_texto = true`);
m('noter : un accord par texto n\'inscrit plus le client', `      update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;\n      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)`, `      update public.clients set desabonne_texto_le = null where id = p_client_id;\n      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)`);
m('noter : un accord par texto ne lève plus le désabonnement', `      update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;\n      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)`, `      update public.clients set avis_texto = true where id = p_client_id;\n      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)`);
m('noter : un accord par texto n\'inscrit que le premier client (pas de « where »)', `      update public.clients set avis_texto = true, desabonne_texto_le = null where id = p_client_id;\n      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)`, `      update public.clients set avis_texto = true, desabonne_texto_le = null;\n      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)`);
m('noter : un accord par texto n\'est plus écrit au registre', `      insert into public.consentements (client_id, canal, action, source, contact, version_texte, fait_par)\n      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`, `      null;`);
m('noter : le registre garde « retrait » pour un accord par texto', `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`, `      values (p_client_id, 'texto', 'retrait', p_source, v_c.cellulaire, p_version, v_uid);`);
m('noter : le registre ne garde pas la source d\'un accord par texto', `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`, `      values (p_client_id, 'texto', 'accord', 'admin', v_c.cellulaire, p_version, v_uid);`);
m('noter : le registre ne garde pas le numéro d\'un accord par texto', `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`, `      values (p_client_id, 'texto', 'accord', p_source, v_c.courriel, p_version, v_uid);`);
m('noter : le registre ne garde pas la version d\'un accord par texto', `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`, `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, null, v_uid);`);
m('noter : le registre ne garde pas qui a noté un accord par texto', `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`, `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, null);`);
m('noter : le registre ne garde pas le client d\'un accord par texto', `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`, `      values (null, 'texto', 'accord', p_source, v_c.cellulaire, p_version, v_uid);`);
m('noter : un retrait par texto ne désinscrit plus le client', `      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = p_client_id;`, `      update public.clients set desabonne_texto_le = now() where id = p_client_id;`);
m('noter : un retrait par texto ne date plus le désabonnement', `      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = p_client_id;`, `      update public.clients set avis_texto = false where id = p_client_id;`);
m('noter : un retrait par texto désinscrit tous les clients (pas de « where »)', `      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = p_client_id;`, `      update public.clients set avis_texto = false, desabonne_texto_le = now();`);
m('noter : un retrait par texto n\'est plus écrit au registre', `      insert into public.consentements (client_id, canal, action, source, contact, fait_par)\n      values (p_client_id, 'texto', 'retrait', p_source, v_c.cellulaire, v_uid);`, `      null;`);
m('noter : le registre garde « accord » pour un retrait par texto', `      values (p_client_id, 'texto', 'retrait', p_source, v_c.cellulaire, v_uid);`, `      values (p_client_id, 'texto', 'accord', p_source, v_c.cellulaire, v_uid);`);
m('noter : les promotions sans courriel sont acceptées', `    if v_c.courriel is null then\n      raise exception 'courriel_requis';\n    end if;`, `    null;`);
m('noter : un accord aux promotions ne pose plus la date du consentement exprès', `      update public.clients set promo_consentement_expres_le = now(), desabonne_promo_le = null where id = p_client_id;`, `      update public.clients set desabonne_promo_le = null where id = p_client_id;`);
m('noter : un accord aux promotions ne lève plus le désabonnement', `      update public.clients set promo_consentement_expres_le = now(), desabonne_promo_le = null where id = p_client_id;`, `      update public.clients set promo_consentement_expres_le = now() where id = p_client_id;`);
m('noter : un accord aux promotions vise tous les clients (pas de « where »)', `      update public.clients set promo_consentement_expres_le = now(), desabonne_promo_le = null where id = p_client_id;`, `      update public.clients set promo_consentement_expres_le = now(), desabonne_promo_le = null;`);
m('noter : un accord aux promotions n\'est plus écrit au registre', `      insert into public.consentements (client_id, canal, action, source, contact, fait_par)\n      values (p_client_id, 'courriel_promo', 'accord', p_source, v_c.courriel, v_uid);`, `      null;`);
m('noter : le registre garde le numéro au lieu du courriel pour un accord aux promotions', `      values (p_client_id, 'courriel_promo', 'accord', p_source, v_c.courriel, v_uid);`, `      values (p_client_id, 'courriel_promo', 'accord', p_source, v_c.cellulaire, v_uid);`);
m('noter : le registre garde « texto » comme canal d\'un accord aux promotions', `      values (p_client_id, 'courriel_promo', 'accord', p_source, v_c.courriel, v_uid);`, `      values (p_client_id, 'texto', 'accord', p_source, v_c.courriel, v_uid);`);
m('noter : un retrait des promotions n\'efface plus le consentement exprès', `      update public.clients set promo_consentement_expres_le = null, desabonne_promo_le = now() where id = p_client_id;`, `      update public.clients set desabonne_promo_le = now() where id = p_client_id;`);
m('noter : un retrait des promotions ne date plus le désabonnement', `      update public.clients set promo_consentement_expres_le = null, desabonne_promo_le = now() where id = p_client_id;`, `      update public.clients set promo_consentement_expres_le = null where id = p_client_id;`);
m('noter : un retrait des promotions vise tous les clients (pas de « where »)', `      update public.clients set promo_consentement_expres_le = null, desabonne_promo_le = now() where id = p_client_id;`, `      update public.clients set promo_consentement_expres_le = null, desabonne_promo_le = now();`);
m('noter : un retrait des promotions n\'est plus écrit au registre', `      insert into public.consentements (client_id, canal, action, source, contact, fait_par)\n      values (p_client_id, 'courriel_promo', 'retrait', p_source, v_c.courriel, v_uid);`, `      null;`);
m('noter : le registre garde « accord » pour un retrait des promotions', `      values (p_client_id, 'courriel_promo', 'retrait', p_source, v_c.courriel, v_uid);`, `      values (p_client_id, 'courriel_promo', 'accord', p_source, v_c.courriel, v_uid);`);
m('noter : la réponse n\'est plus « enregistre »', `  return jsonb_build_object('statut', 'enregistre');`, `  return jsonb_build_object('statut', 'ok');`);

// ── desabonner_contact
m('désabonner : un canal inconnu est accepté', `  if p_canal is null or p_canal not in ('texto', 'courriel', 'courriel_promo') then\n    raise exception 'canal_invalide';\n  end if;`, `  null;`);
m('désabonner : un canal absent (NULL) est accepté', `  if p_canal is null or p_canal not in ('texto', 'courriel', 'courriel_promo') then`, `  if p_canal not in ('texto', 'courriel', 'courriel_promo') then`);
m('désabonner : une source inconnue est acceptée', `  if p_source is null or p_source not in ('texto_arret', 'lien_desabonnement') then\n    raise exception 'source_invalide';\n  end if;`, `  null;`);
m('désabonner : la source « verbal » est acceptée', `p_source not in ('texto_arret', 'lien_desabonnement')`, `p_source not in ('texto_arret', 'lien_desabonnement', 'verbal')`);
m('désabonner : une source absente (NULL) est acceptée', `  if p_source is null or p_source not in ('texto_arret', 'lien_desabonnement') then`, `  if p_source not in ('texto_arret', 'lien_desabonnement') then`);
m('désabonner : le numéro n\'est plus remis au format +1…', `    v_cel := public._cellulaire_normalise(p_contact);`, `    v_cel := p_contact;`);
m('désabonner : un numéro invalide n\'est plus refusé', `    if v_cel is null then\n      raise exception 'contact_invalide';\n    end if;`, `    null;`);
m('désabonner : ARRET ne désinscrit plus personne', `      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = r.id;`, `      update public.clients set desabonne_texto_le = now() where id = r.id;`);
m('désabonner : ARRET ne date plus le désabonnement', `      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = r.id;`, `      update public.clients set avis_texto = false where id = r.id;`);
m('désabonner : ARRET désinscrit tous les clients (pas de « where »)', `      update public.clients set avis_texto = false, desabonne_texto_le = now() where id = r.id;`, `      update public.clients set avis_texto = false, desabonne_texto_le = now();`);
m('désabonner : ARRET ne cherche plus par numéro (tous les clients)', `    for r in select c.id from public.clients c where c.cellulaire = v_cel loop`, `    for r in select c.id from public.clients c loop`);
m('désabonner : ARRET n\'écrit plus au registre pour un client connu', `      insert into public.consentements (client_id, canal, action, source, contact) values (r.id, 'texto', 'retrait', p_source, v_cel);\n      v_n := v_n + 1;`, `      v_n := v_n + 1;`);
m('désabonner : ARRET ne compte plus les clients', `      v_n := v_n + 1;\n    end loop;\n    if v_n = 0 then\n      insert into public.consentements (canal, action, source, contact) values ('texto', 'retrait', p_source, v_cel);`, `    end loop;\n    if v_n = 0 then\n      insert into public.consentements (canal, action, source, contact) values ('texto', 'retrait', p_source, v_cel);`);
m('désabonner : ARRET écrit « accord » au registre', `values (r.id, 'texto', 'retrait', p_source, v_cel);`, `values (r.id, 'texto', 'accord', p_source, v_cel);`);
m('désabonner : ARRET ne garde pas la source au registre', `values (r.id, 'texto', 'retrait', p_source, v_cel);`, `values (r.id, 'texto', 'retrait', 'admin', v_cel);`);
m('désabonner : un numéro inconnu n\'est plus gardé au registre', `    if v_n = 0 then\n      insert into public.consentements (canal, action, source, contact) values ('texto', 'retrait', p_source, v_cel);\n    end if;\n    update public.inscriptions_avis`, `    update public.inscriptions_avis`);
m('désabonner : le numéro inconnu est gardé même quand le client existe', `    if v_n = 0 then\n      insert into public.consentements (canal, action, source, contact) values ('texto', 'retrait', p_source, v_cel);`, `    if true then\n      insert into public.consentements (canal, action, source, contact) values ('texto', 'retrait', p_source, v_cel);`);
m('désabonner : les inscriptions en attente de ce numéro ne sont plus écartées', `    update public.inscriptions_avis set statut = 'ignoree', traitee_le = now() where cellulaire = v_cel and statut = 'nouvelle';`, `    null;`);
m('désabonner : les inscriptions déjà reliées sont aussi écartées', `where cellulaire = v_cel and statut = 'nouvelle';`, `where cellulaire = v_cel;`);
m('désabonner : toutes les inscriptions en attente sont écartées', `where cellulaire = v_cel and statut = 'nouvelle';`, `where statut = 'nouvelle';`);
m('désabonner : le courriel n\'est plus mis en minuscules', `    v_cour := nullif(lower(btrim(coalesce(p_contact, ''))), '');`, `    v_cour := nullif(btrim(coalesce(p_contact, '')), '');`);
m('désabonner : un courriel invalide n\'est plus refusé', R`    if v_cour is null or char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then`, `    if false then`);
m('désabonner : un courriel absent est accepté', R`    if v_cour is null or char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then`, R`    if char_length(v_cour) > 150 or v_cour !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then`);
m('désabonner : la recherche par courriel tient compte des majuscules', `    for r in select c.id from public.clients c where lower(c.courriel) = v_cour loop`, `    for r in select c.id from public.clients c where c.courriel = v_cour loop`, 'les courriels gardés sont toujours en minuscules (déclencheur) : aucune différence');
m('désabonner : le désabonnement des courriels n\'est plus daté', `        update public.clients set desabonne_courriel_le = coalesce(desabonne_courriel_le, now()) where id = r.id;`, `        null;`);
m('désabonner : le 2ᵉ clic change la date du désabonnement des courriels', `        update public.clients set desabonne_courriel_le = coalesce(desabonne_courriel_le, now()) where id = r.id;`, `        update public.clients set desabonne_courriel_le = now() where id = r.id;`);
m('désabonner : le désabonnement des courriels vise tous les clients', `        update public.clients set desabonne_courriel_le = coalesce(desabonne_courriel_le, now()) where id = r.id;`, `        update public.clients set desabonne_courriel_le = coalesce(desabonne_courriel_le, now());`);
m('désabonner : le registre garde « courriel_promo » pour un désabonnement des courriels d\'avis', `values (r.id, 'courriel_avis', 'retrait', p_source, v_cour);`, `values (r.id, 'courriel_promo', 'retrait', p_source, v_cour);`);
m('désabonner : le désabonnement des courriels n\'est plus écrit au registre', `        insert into public.consentements (client_id, canal, action, source, contact) values (r.id, 'courriel_avis', 'retrait', p_source, v_cour);`, `        null;`);
m('désabonner : le désabonnement des offres n\'est plus daté', `        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()), promo_consentement_expres_le = null where id = r.id;`, `        update public.clients set promo_consentement_expres_le = null where id = r.id;`);
m('désabonner : le désabonnement des offres n\'efface plus le consentement exprès', `        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()), promo_consentement_expres_le = null where id = r.id;`, `        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()) where id = r.id;`);
m('désabonner : le désabonnement des offres vise tous les clients', `        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()), promo_consentement_expres_le = null where id = r.id;`, `        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()), promo_consentement_expres_le = null;`);
m('désabonner : le désabonnement des offres désabonne aussi des courriels d\'avis', `        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()), promo_consentement_expres_le = null where id = r.id;`, `        update public.clients set desabonne_promo_le = coalesce(desabonne_promo_le, now()), desabonne_courriel_le = now(), promo_consentement_expres_le = null where id = r.id;`);
m('désabonner : le désabonnement des offres n\'est plus écrit au registre', `        insert into public.consentements (client_id, canal, action, source, contact) values (r.id, 'courriel_promo', 'retrait', p_source, v_cour);`, `        null;`);
m('désabonner : un courriel inconnu n\'est plus gardé au registre', `    if v_n = 0 then\n      insert into public.consentements (canal, action, source, contact)\n      values (case when p_canal = 'courriel' then 'courriel_avis' else 'courriel_promo' end, 'retrait', p_source, v_cour);\n    end if;`, `    null;`);
m('désabonner : le canal du courriel inconnu est inversé au registre', `values (case when p_canal = 'courriel' then 'courriel_avis' else 'courriel_promo' end, 'retrait', p_source, v_cour);`, `values (case when p_canal = 'courriel' then 'courriel_promo' else 'courriel_avis' end, 'retrait', p_source, v_cour);`);
m('désabonner : la réponse ne compte plus les clients', `  return jsonb_build_object('statut', 'desabonne', 'clients', v_n);`, `  return jsonb_build_object('statut', 'desabonne', 'clients', 0);`);
m('désabonner : la réponse n\'est plus « desabonne »', `  return jsonb_build_object('statut', 'desabonne', 'clients', v_n);`, `  return jsonb_build_object('statut', 'ok', 'clients', v_n);`);

// ── promo_courriel_permis
m('promotions : un client inactif peut en recevoir', `  select coalesce(p_actif, false)\n     and p_courriel is not null`, `  select true\n     and p_courriel is not null`);
m('promotions : « actif » absent (NULL) compte comme actif', `  select coalesce(p_actif, false)`, `  select coalesce(p_actif, true)`);
m('promotions : sans courriel, on peut en envoyer', `     and p_courriel is not null\n`, ``);
m('promotions : après un désabonnement des offres, on peut en envoyer', `     and p_desabonne_promo is null\n`, ``);
m('promotions : après un désabonnement des courriels, on peut en envoyer', `     and p_desabonne_courriel is null\n`, ``);
m('promotions : le consentement exprès ne suffit plus', `     and (p_consentement_expres is not null\n          or (p_dernier_contrat is not null`, `     and (false\n          or (p_dernier_contrat is not null`);
m('promotions : le contrat récent ne suffit plus', `          or (p_dernier_contrat is not null and p_dernier_contrat >= (current_date - interval '2 years')::date))`, `          or false)`);
m('promotions : sans date de contrat, on peut en envoyer', `          or (p_dernier_contrat is not null and p_dernier_contrat >= (current_date - interval '2 years')::date))`, `          or (p_dernier_contrat is null or p_dernier_contrat >= (current_date - interval '2 years')::date))`);
m('promotions : le consentement implicite dure 3 ans', `p_dernier_contrat >= (current_date - interval '2 years')::date`, `p_dernier_contrat >= (current_date - interval '3 years')::date`);
m('promotions : le consentement implicite dure 1 an', `p_dernier_contrat >= (current_date - interval '2 years')::date`, `p_dernier_contrat >= (current_date - interval '1 year')::date`);
m('promotions : le consentement implicite est refusé le jour exact des 2 ans (> au lieu de >=)', `p_dernier_contrat >= (current_date - interval '2 years')::date`, `p_dernier_contrat > (current_date - interval '2 years')::date`);
m('promotions : un contrat dans le futur n\'est plus un contrat', `p_dernier_contrat >= (current_date - interval '2 years')::date`, `p_dernier_contrat between (current_date - interval '2 years')::date and current_date - 1`);

// ── la vue
m('la vue clients_avis n\'est plus « security_invoker » (l\'employé verrait tout)', `create or replace view public.clients_avis with (security_invoker = true) as`, `create or replace view public.clients_avis as`);
m('vue : les avis par courriel ne demandent plus que le client soit actif', `       (c.actif and c.avis_courriel and c.courriel is not null and c.desabonne_courriel_le is null) as courriel_avis_ok,`, `       (c.avis_courriel and c.courriel is not null and c.desabonne_courriel_le is null) as courriel_avis_ok,`);
m('vue : les avis par courriel ne demandent plus le choix de Joé', `       (c.actif and c.avis_courriel and c.courriel is not null and c.desabonne_courriel_le is null) as courriel_avis_ok,`, `       (c.actif and c.courriel is not null and c.desabonne_courriel_le is null) as courriel_avis_ok,`);
m('vue : les avis par courriel ne demandent plus de courriel', `       (c.actif and c.avis_courriel and c.courriel is not null and c.desabonne_courriel_le is null) as courriel_avis_ok,`, `       (c.actif and c.avis_courriel and c.desabonne_courriel_le is null) as courriel_avis_ok,`);
m('vue : les avis par courriel ignorent le désabonnement', `       (c.actif and c.avis_courriel and c.courriel is not null and c.desabonne_courriel_le is null) as courriel_avis_ok,`, `       (c.actif and c.avis_courriel and c.courriel is not null) as courriel_avis_ok,`);
m('vue : les avis par texto ne demandent plus que le client soit actif', `       (c.actif and c.avis_texto and c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,`, `       (c.avis_texto and c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,`);
m('vue : les avis par texto ne demandent plus l\'inscription', `       (c.actif and c.avis_texto and c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,`, `       (c.actif and c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,`);
m('vue : les avis par texto ne demandent plus de numéro', `       (c.actif and c.avis_texto and c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,`, `       (c.actif and c.avis_texto and c.desabonne_texto_le is null) as texto_avis_ok,`, 'la règle de la table interdit déjà « inscrit aux textos » sans numéro : aucune différence');
m('vue : les avis par texto ignorent le désabonnement', `       (c.actif and c.avis_texto and c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,`, `       (c.actif and c.avis_texto and c.cellulaire is not null) as texto_avis_ok,`);
m('vue : les avis par texto suivent le désabonnement des COURRIELS (mauvaise colonne)', `c.cellulaire is not null and c.desabonne_texto_le is null) as texto_avis_ok,`, `c.cellulaire is not null and c.desabonne_courriel_le is null) as texto_avis_ok,`);
m('vue : les promotions ignorent les désabonnements', `public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, c.promo_consentement_expres_le, c.desabonne_promo_le, c.desabonne_courriel_le, c.actif) as promo_courriel_ok,`, `public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, c.promo_consentement_expres_le, null, null, c.actif) as promo_courriel_ok,`);
m('vue : les promotions ignorent le consentement exprès', `public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, c.promo_consentement_expres_le, c.desabonne_promo_le, c.desabonne_courriel_le, c.actif) as promo_courriel_ok,`, `public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, null, c.desabonne_promo_le, c.desabonne_courriel_le, c.actif) as promo_courriel_ok,`);
m('vue : les promotions ignorent la date du contrat', `public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, c.promo_consentement_expres_le, c.desabonne_promo_le, c.desabonne_courriel_le, c.actif) as promo_courriel_ok,`, `public.promo_courriel_permis(c.courriel, null, c.promo_consentement_expres_le, c.desabonne_promo_le, c.desabonne_courriel_le, c.actif) as promo_courriel_ok,`);
m('vue : les promotions ignorent l\'état « actif »', `public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, c.promo_consentement_expres_le, c.desabonne_promo_le, c.desabonne_courriel_le, c.actif) as promo_courriel_ok,`, `public.promo_courriel_permis(c.courriel, c.dernier_contrat_le, c.promo_consentement_expres_le, c.desabonne_promo_le, c.desabonne_courriel_le, true) as promo_courriel_ok,`);
m('vue : la date d\'expiration implicite ajoute 3 ans', `(c.dernier_contrat_le + interval '2 years')::date end as promo_implicite_expire_le`, `(c.dernier_contrat_le + interval '3 years')::date end as promo_implicite_expire_le`);
m('vue : la date d\'expiration implicite est donnée même avec un consentement exprès', `case when c.promo_consentement_expres_le is null and c.dernier_contrat_le is not null then`, `case when c.dernier_contrat_le is not null then`);
m('vue : la date d\'expiration implicite n\'est jamais donnée', `case when c.promo_consentement_expres_le is null and c.dernier_contrat_le is not null then (c.dernier_contrat_le + interval '2 years')::date end as promo_implicite_expire_le`, `null::date as promo_implicite_expire_le`);

// ── les droits des fonctions et de la vue
m('inscrire_avis : le droit d\'appel est retiré (personne ne peut s\'inscrire)', `grant execute on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) to anon, authenticated;`, ``);
m('inscrire_avis : un visiteur ne peut plus s\'inscrire', `grant execute on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) to anon, authenticated;`, `grant execute on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) to authenticated;`);
m('inscrire_avis : une personne connectée ne peut plus l\'appeler', `grant execute on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) to anon, authenticated;`, `grant execute on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) to anon;`);
m('admin_relier_inscription : un visiteur peut l\'appeler (droit par défaut gardé)', `revoke all on function public.admin_relier_inscription(uuid, uuid)                from public, anon;`, ``);
m('admin_relier_inscription : plus personne ne peut l\'appeler', `grant execute on function public.admin_relier_inscription(uuid, uuid)             to authenticated;`, ``);
m('admin_ignorer_inscription : un visiteur peut l\'appeler (droit par défaut gardé)', `revoke all on function public.admin_ignorer_inscription(uuid)                     from public, anon;`, ``);
m('admin_ignorer_inscription : plus personne ne peut l\'appeler', `grant execute on function public.admin_ignorer_inscription(uuid)                  to authenticated;`, ``);
m('admin_enregistrer_consentement : un visiteur peut l\'appeler (droit par défaut gardé)', `revoke all on function public.admin_enregistrer_consentement(uuid, text, text, text, text) from public, anon;`, ``);
m('admin_enregistrer_consentement : plus personne ne peut l\'appeler', `grant execute on function public.admin_enregistrer_consentement(uuid, text, text, text, text) to authenticated;`, ``);
m('desabonner_contact : un visiteur et un connecté peuvent l\'appeler (droit par défaut gardé)', `revoke all on function public.desabonner_contact(text, text, text)                from public, anon, authenticated;`, ``);
m('desabonner_contact : le service d\'envoi ne peut plus l\'appeler', `grant execute on function public.desabonner_contact(text, text, text)             to service_role;`, ``);
m('desabonner_contact : une personne connectée peut l\'appeler', `grant execute on function public.desabonner_contact(text, text, text)             to service_role;`, `grant execute on function public.desabonner_contact(text, text, text)             to service_role, authenticated;`);
m('desabonner_contact : un visiteur peut l\'appeler', `grant execute on function public.desabonner_contact(text, text, text)             to service_role;`, `grant execute on function public.desabonner_contact(text, text, text)             to service_role, anon;`);
m('promo_courriel_permis : un visiteur peut l\'appeler (droit par défaut gardé)', `revoke all on function public.promo_courriel_permis(text, date, timestamptz, timestamptz, timestamptz, boolean) from public, anon;`, ``);
m('promo_courriel_permis : une personne connectée ne peut plus l\'appeler (la vue plante)', `grant execute on function public.promo_courriel_permis(text, date, timestamptz, timestamptz, timestamptz, boolean) to authenticated;`, ``);
m('la fonction de normalisation du cellulaire est appelable par tous (droit par défaut gardé)', `revoke all on function public._cellulaire_normalise(text)                         from public, anon, authenticated;`, ``);
m('la fonction du registre est appelable par tous (droit par défaut gardé)', `revoke all on function public._consentements_immuables()                          from public, anon, authenticated;`, ``);
m('la fonction des textes est appelable par tous (droit par défaut gardé)', `revoke all on function public._textes_consentement_immuables()                    from public, anon, authenticated;`, ``);
m('la fonction des fiches est appelable par tous (droit par défaut gardé)', `revoke all on function public._clients_avant_ecriture()                           from public, anon, authenticated;`, ``);
m('la vue clients_avis est lisible par tous (droit par défaut gardé)', `revoke all on public.clients_avis from public, anon, authenticated;`, ``);
m('la vue clients_avis n\'est plus lisible par l\'administrateur', `grant select on public.clients_avis to authenticated;`, ``);
m('la vue clients_avis est lisible par les visiteurs', `grant select on public.clients_avis to authenticated;`, `grant select on public.clients_avis to authenticated, anon;`);

// ── la requête « verification » du bas
m('la vérification dit que les règles sont actives pour une autre table', `'public.textes_consentement'::regclass, 'public.avis_sel'::regclass`, `'public.textes_consentement'::regclass, 'public.stops'::regclass`);
m('la vérification ne regarde plus les droits d\'un visiteur sur les clients', `(has_table_privilege('anon', 'public.clients', 'select') or has_table_privilege('anon', 'public.inscriptions_avis', 'select')`, `(false or has_table_privilege('anon', 'public.inscriptions_avis', 'select')`);
m('la vérification oublie de dire qui peut appeler inscrire_avis', `and p.proname in ('inscrire_avis', 'admin_relier_inscription', 'admin_ignorer_inscription', 'admin_enregistrer_consentement', 'desabonner_contact', 'promo_courriel_permis') and has_function_privilege('anon', p.oid, 'execute')`, `and p.proname in ('admin_relier_inscription', 'admin_ignorer_inscription', 'admin_enregistrer_consentement', 'desabonner_contact', 'promo_courriel_permis') and has_function_privilege('anon', p.oid, 'execute')`);
m('la vérification donne un mauvais nombre de clients', `  'clients', (select count(*) from public.clients),`, `  'clients', (select count(*) from public.clients) + 1,`);
m('la vérification donne un mauvais nombre de consentements', `  'consentements', (select count(*) from public.consentements)`, `  'consentements', (select count(*) from public.consentements) + 1`);
m('la vérification donne un mauvais nombre d\'inscriptions', `  'inscriptions', (select count(*) from public.inscriptions_avis),`, `  'inscriptions', (select count(*) from public.inscriptions_avis) + 1,`);
m('la vérification ne nomme plus le texte en vigueur', `  'texte_en_vigueur', (select version from public.textes_consentement where en_vigueur and canal = 'texto' order by cree_le desc limit 1),`, `  'texte_en_vigueur', null,`);
m('la vérification ne filtre plus les textes par canal (le texte des textos peut être celui des offres)', `  'texte_en_vigueur', (select version from public.textes_consentement where en_vigueur and canal = 'texto' order by cree_le desc limit 1),`, `  'texte_en_vigueur', (select version from public.textes_consentement where en_vigueur order by cree_le desc limit 1),`);
m('la vérification ne nomme plus le texte des offres', `  'texte_promo_en_vigueur', (select version from public.textes_consentement where en_vigueur and canal = 'courriel_promo' order by cree_le desc limit 1),`, `  'texte_promo_en_vigueur', null,`);
m('la vérification nomme pour les offres un texte des textos', `where en_vigueur and canal = 'courriel_promo' order by cree_le desc limit 1),`, `where en_vigueur and canal = 'texto' order by cree_le desc limit 1),`);
m('la vérification dit que desabonner_contact est réservée au service même si ce n\'est pas vrai', `  'desabonner_reserve_au_service', has_function_privilege('service_role', 'public.desabonner_contact(text, text, text)', 'execute') and not has_function_privilege('authenticated', 'public.desabonner_contact(text, text, text)', 'execute'),`, `  'desabonner_reserve_au_service', true,`);
m('la vérification dit que le consentement ne s\'écrit pas directement même si c\'est faux', `  'connecte_peut_ecrire_le_consentement', has_column_privilege('authenticated', 'public.clients', 'avis_texto', 'update') or has_column_privilege('authenticated', 'public.clients', 'desabonne_texto_le', 'update') or has_table_privilege('authenticated', 'public.consentements', 'insert'),`, `  'connecte_peut_ecrire_le_consentement', false,`);

// ── la 2ᵉ case : les offres par courriel
const PT = `  $t$J'accepte aussi de recevoir par courriel, de temps en temps, les offres et les nouvelles d'Entretien Lapointe (par exemple, un rappel avant la saison des feuilles). Je peux me désabonner en tout temps avec le lien au bas de chaque courriel ou en écrivant à info@entretienlapointe.ca. Cette case est facultative : elle n'a aucun effet sur mes services ni sur mes avis de passage. Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec), 819 268-8069.$t$)`;
m('le texte des offres est rangé sous le canal « texto »', `  'promo-2026-10-v1', 'courriel_promo',`, `  'promo-2026-10-v1', 'texto',`);
m('le texte des offres change de nom de version', `  'promo-2026-10-v1', 'courriel_promo',`, `  'promo-2026-10-v2', 'courriel_promo',`);
m('le texte des offres n\'est plus ajouté', `insert into public.textes_consentement (version, canal, texte) values (\n  'promo-2026-10-v1', 'courriel_promo',\n${PT}\non conflict (version) do nothing;\n`, ``);
m('le texte des offres ne dit plus « par courriel »', `J'accepte aussi de recevoir par courriel, de temps en temps,`, `J'accepte aussi de recevoir, de temps en temps,`);
m('le texte des offres ne dit plus « de temps en temps »', `par courriel, de temps en temps, les offres`, `par courriel les offres`);
m('le texte des offres ne donne plus l\'exemple de la saison des feuilles', ` (par exemple, un rappel avant la saison des feuilles)`, ``);
m('le texte des offres ne dit plus comment se désabonner', `Je peux me désabonner en tout temps avec le lien au bas de chaque courriel ou en écrivant à info@entretienlapointe.ca. `, ``);
m('le texte des offres ne donne plus le lien de désabonnement', `avec le lien au bas de chaque courriel ou en écrivant`, `en écrivant`);
m('le texte des offres ne dit plus que la case est facultative', `Cette case est facultative : elle n'a aucun effet sur mes services ni sur mes avis de passage. `, ``);
m('le texte des offres ne dit plus que ça n\'a aucun effet sur les services', `elle n'a aucun effet sur mes services ni sur mes avis de passage`, `elle compte`);
m('le texte des offres ne donne plus l\'adresse postale', `Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec), 819 268-8069.$t$)`, `Entretien Lapointe, 819 268-8069.$t$)`);
m('le texte des offres ne donne plus le téléphone', `Charette (Québec), 819 268-8069.$t$)`, `Charette (Québec).$t$)`);
m('le texte des offres donne un mauvais courriel', `en écrivant à info@entretienlapointe.ca.`, `en écrivant à info@exemple.ca.`);

// les inscriptions : l'accord aux offres
m('« promo_accepte » est vrai par défaut', `  promo_accepte boolean not null default false,`, `  promo_accepte boolean not null default true,`);
m('« promo_accepte » n\'est plus obligatoire', `  promo_accepte boolean not null default false,`, `  promo_accepte boolean default false,`);
m('la version des offres d\'une inscription n\'est plus une vraie version (plus de clé étrangère)', `  version_promo text references public.textes_consentement(version),`, `  version_promo text,`);
m('supprimer une version du texte des offres EFFACE les inscriptions (cascade)', `  version_promo text references public.textes_consentement(version),`, `  version_promo text references public.textes_consentement(version) on delete cascade,`);
const COH = `  constraint inscriptions_avis_promo_coherente check ((promo_accepte and version_promo is not null and courriel is not null) or (not promo_accepte and version_promo is null))`;
variantes(COH, [
  ['la règle « offres : version et courriel obligatoires » est retirée', `  constraint inscriptions_avis_promo_coherente check (true)`],
  ['les offres cochées n\'exigent plus la version lue', `  constraint inscriptions_avis_promo_coherente check ((promo_accepte and courriel is not null) or (not promo_accepte and version_promo is null))`],
  ['les offres cochées n\'exigent plus de courriel', `  constraint inscriptions_avis_promo_coherente check ((promo_accepte and version_promo is not null) or (not promo_accepte and version_promo is null))`],
  ['sans les offres, une version lue est permise', `  constraint inscriptions_avis_promo_coherente check ((promo_accepte and version_promo is not null and courriel is not null) or (not promo_accepte))`],
  ['les offres cochées sont toujours permises', `  constraint inscriptions_avis_promo_coherente check (promo_accepte or (not promo_accepte and version_promo is null))`],
  ['les offres non cochées sont toujours permises', `  constraint inscriptions_avis_promo_coherente check ((promo_accepte and version_promo is not null and courriel is not null) or not promo_accepte)`]]);

// inscrire_avis : les offres
m('inscrire_avis : « promo » absent (NULL) fait échouer l\'inscription', `  v_promo  boolean := coalesce(p_promo, false);`, `  v_promo  boolean := p_promo;`);
m('inscrire_avis : les offres sont cochées par défaut', `  p_promo    boolean default false,`, `  p_promo    boolean default true,`);
m('inscrire_avis : les offres cochées n\'exigent plus de courriel', `    if v_cour is null then\n      raise exception 'courriel_requis_offres';\n    end if;`, `    null;`);
m('inscrire_avis : le refus « courriel manquant pour les offres » change de nom', `raise exception 'courriel_requis_offres';`, `raise exception 'courriel_invalide';`);
m('inscrire_avis : les offres cochées n\'exigent plus la version lue', `    if not exists (select 1 from public.textes_consentement t where t.version = p_version_promo and t.canal = 'courriel_promo' and t.en_vigueur) then\n      raise exception 'version_promo_inconnue';\n    end if;`, `    null;`);
m('inscrire_avis : la version des offres peut être celle d\'un autre canal', `t.version = p_version_promo and t.canal = 'courriel_promo' and t.en_vigueur`, `t.version = p_version_promo and t.en_vigueur`);
m('inscrire_avis : la version des offres peut être une version retirée du service', `t.version = p_version_promo and t.canal = 'courriel_promo' and t.en_vigueur`, `t.version = p_version_promo and t.canal = 'courriel_promo'`);
m('inscrire_avis : la version des offres est comparée à celle des textos', `t.version = p_version_promo and t.canal = 'courriel_promo' and t.en_vigueur`, `t.version = p_version and t.canal = 'courriel_promo' and t.en_vigueur`);
m('inscrire_avis : le refus « version des offres inconnue » change de nom', `raise exception 'version_promo_inconnue';`, `raise exception 'version_inconnue';`);
m('inscrire_avis : les vérifications des offres ne se font plus', `  if v_promo then\n    if v_cour is null then`, `  if false then\n    if v_cour is null then`);
m('inscrire_avis : les vérifications des offres se font quand la case n\'est PAS cochée', `  if v_promo then\n    if v_cour is null then`, `  if not v_promo then\n    if v_cour is null then`);
m('inscrire_avis : la version des textos peut être celle des offres (le canal n\'est plus vérifié)', `where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then\n    raise exception 'version_inconnue';\n  end if;\n  -- La 2ᵉ case`, `where t.version = p_version and t.en_vigueur) then\n    raise exception 'version_inconnue';\n  end if;\n  -- La 2ᵉ case`);
const DEDUP = `i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte or not v_promo)`;
variantes(DEDUP, [
  ['inscrire_avis : un nouvel accord aux offres est pris pour un doublon (l\'ancienne règle)', `i.cellulaire = v_cel and i.cree_le > now() - interval '1 day'`],
  ['inscrire_avis : seul un doublon AVEC offres des deux côtés est repéré', `i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (i.promo_accepte and v_promo)`],
  ['inscrire_avis : seul un doublon SANS offres est repéré', `i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (not i.promo_accepte and not v_promo)`],
  ['inscrire_avis : un envoi sans offres après un envoi avec offres n\'est plus un doublon', `i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (not i.promo_accepte or not v_promo)`],
  ['inscrire_avis : un doublon avec offres n\'est plus repéré', `i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and (not v_promo)`],
  ['inscrire_avis : un nouvel accord aux offres est refusé comme un doublon seulement si l\'ancien avait les offres', `i.cellulaire = v_cel and i.cree_le > now() - interval '1 day' and i.promo_accepte`]]);
m('inscrire_avis : l\'inscription ne garde jamais l\'accord aux offres', `values (v_nom, v_adr, v_cel, v_cour, p_version, v_promo, case when v_promo then p_version_promo end, v_hash, left(p_agent, 300))`, `values (v_nom, v_adr, v_cel, v_cour, p_version, false, null, v_hash, left(p_agent, 300))`);
m('inscrire_avis : l\'inscription garde la version des offres même sans l\'accord', `case when v_promo then p_version_promo end, v_hash`, `p_version_promo, v_hash`);
m('inscrire_avis : l\'inscription ne garde pas la version des offres lue', `case when v_promo then p_version_promo end, v_hash`, `null, v_hash`);
m('inscrire_avis : l\'inscription garde la version des textos comme version des offres', `case when v_promo then p_version_promo end, v_hash`, `case when v_promo then p_version end, v_hash`);
const PREG = `    insert into public.consentements (inscription_id, canal, action, source, contact, version_texte, ip_hash)\n    values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`;
m('inscrire_avis : l\'accord aux offres n\'est plus écrit au registre', PREG, `    null;`);
m('inscrire_avis : le registre note « texto » pour l\'accord aux offres', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (v_id, 'texto', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`);
m('inscrire_avis : le registre note « retrait » pour l\'accord aux offres', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (v_id, 'courriel_promo', 'retrait', 'page_avis', v_cour, p_version_promo, v_hash);`);
m('inscrire_avis : le registre note une autre source pour l\'accord aux offres', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (v_id, 'courriel_promo', 'accord', 'verbal', v_cour, p_version_promo, v_hash);`);
m('inscrire_avis : le registre note le numéro au lieu du courriel pour les offres', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cel, p_version_promo, v_hash);`);
m('inscrire_avis : le registre note la version des textos pour les offres', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version, v_hash);`);
m('inscrire_avis : le registre ne garde pas la version des offres', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, null, v_hash);`);
m('inscrire_avis : le registre ne garde pas l\'empreinte pour les offres', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, null);`);
m('inscrire_avis : l\'accord aux offres n\'est pas relié à l\'inscription', `values (v_id, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`, `values (null, 'courriel_promo', 'accord', 'page_avis', v_cour, p_version_promo, v_hash);`);
m('inscrire_avis : l\'accord aux offres est écrit même quand la case n\'est pas cochée', `  if v_promo then\n    insert into public.consentements`, `  if true then\n    insert into public.consentements`);
m('inscrire_avis : l\'accord aux offres n\'est jamais écrit (condition fausse)', `  if v_promo then\n    insert into public.consentements`, `  if false then\n    insert into public.consentements`);

// relier : le consentement exprès aux offres
m('relier : le consentement aux offres est appliqué même si la case n\'était pas cochée', `  if v_i.promo_accepte then\n    select c.fait_le into v_fait`, `  if true then\n    select c.fait_le into v_fait`);
m('relier : le consentement aux offres n\'est jamais appliqué', `  if v_i.promo_accepte then\n    select c.fait_le into v_fait`, `  if false then\n    select c.fait_le into v_fait`);
m('relier : la date du consentement aux offres est celle du lien (maintenant)', `    v_fait := coalesce(v_fait, v_i.cree_le);`, `    v_fait := now();`);
m('relier : la date du consentement aux offres est celle de l\'inscription (pas celle du registre)', `    v_fait := coalesce(v_fait, v_i.cree_le);`, `    v_fait := v_i.cree_le;`);
m('relier : un client désabonné de tous les courriels reçoit quand même le consentement', `    if v_c.desabonne_courriel_le is not null then\n      v_promo := 'desabonne_des_courriels';`, `    if false then\n      v_promo := 'desabonne_des_courriels';`);
m('relier : un client NON désabonné est refusé comme s\'il l\'était', `    if v_c.desabonne_courriel_le is not null then`, `    if v_c.desabonne_courriel_le is null then`);
m('relier : un courriel différent reçoit quand même le consentement', `    elsif v_c.courriel is not null and lower(v_c.courriel) <> v_i.courriel then`, `    elsif false then`);
m('relier : un courriel identique est pris pour un courriel différent', `lower(v_c.courriel) <> v_i.courriel`, `lower(v_c.courriel) = v_i.courriel`);
m('relier : le courriel de la fiche est comparé sans tenir compte des majuscules (inutile : déjà en minuscules)', `lower(v_c.courriel) <> v_i.courriel`, `v_c.courriel <> v_i.courriel`, 'les courriels gardés sont toujours en minuscules (déclencheur) : aucune différence');
m('relier : un retrait venu après l\'accord est ignoré', `    elsif exists (select 1 from public.consentements c where c.canal = 'courriel_promo' and c.action = 'retrait' and c.contact = v_i.courriel and c.fait_le > v_fait) then`, `    elsif false then`);
m('relier : un retrait ANTÉRIEUR à l\'accord bloque le consentement', `c.contact = v_i.courriel and c.fait_le > v_fait)`, `c.contact = v_i.courriel and c.fait_le < v_fait)`);
m('relier : le retrait d\'un AUTRE courriel bloque le consentement', `c.action = 'retrait' and c.contact = v_i.courriel and c.fait_le > v_fait)`, `c.action = 'retrait' and c.fait_le > v_fait)`);
m('relier : un « accord » plus récent est pris pour un retrait', `c.action = 'retrait' and c.contact = v_i.courriel`, `c.action = 'accord' and c.contact = v_i.courriel`);
m('relier : un retrait des TEXTOS bloque le consentement aux offres', `c.canal = 'courriel_promo' and c.action = 'retrait' and c.contact = v_i.courriel`, `c.canal = 'texto' and c.action = 'retrait' and c.contact = v_i.courriel`);
m('relier : la fiche reçoit la date du lien au lieu de celle de l\'inscription', `update public.clients set promo_consentement_expres_le = v_fait, desabonne_promo_le = null where id = p_client_id;`, `update public.clients set promo_consentement_expres_le = now(), desabonne_promo_le = null where id = p_client_id;`);
m('relier : un désabonnement antérieur des offres n\'est plus levé', `update public.clients set promo_consentement_expres_le = v_fait, desabonne_promo_le = null where id = p_client_id;`, `update public.clients set promo_consentement_expres_le = v_fait where id = p_client_id;`);
m('relier : le consentement aux offres est donné à TOUTES les fiches (pas de « where »)', `update public.clients set promo_consentement_expres_le = v_fait, desabonne_promo_le = null where id = p_client_id;`, `update public.clients set promo_consentement_expres_le = v_fait, desabonne_promo_le = null;`);
m('relier : la réponse « appliquee » change de nom', `v_promo := 'appliquee';`, `v_promo := 'applique';`);
m('relier : la réponse « desabonne_des_courriels » change de nom', `v_promo := 'desabonne_des_courriels';`, `v_promo := 'desabonne';`);
m('relier : la réponse « courriel_different » change de nom', `v_promo := 'courriel_different';`, `v_promo := 'differente';`);
m('relier : la réponse « retire_depuis » change de nom', `v_promo := 'retire_depuis';`, `v_promo := 'retire';`);
m('relier : la réponse « non_demandee » change de nom', `v_promo text := 'non_demandee';`, `v_promo text := 'non';`);
m('relier : la réponse ne contient plus « promo »', `'client_id', p_client_id, 'promo', v_promo);`, `'client_id', p_client_id);`);
m('relier : « promo » donne le courriel au lieu du résultat', `'client_id', p_client_id, 'promo', v_promo);`, `'client_id', p_client_id, 'promo', v_i.courriel);`);

// noter : la version doit être celle du canal des textos
m('noter : un accord par texto accepte la version du texte des offres (le canal n\'est plus vérifié)', `where t.version = p_version and t.canal = 'texto' and t.en_vigueur) then\n        raise exception 'version_inconnue';\n      end if;\n      update public.clients set avis_texto = true`, `where t.version = p_version and t.en_vigueur) then\n        raise exception 'version_inconnue';\n      end if;\n      update public.clients set avis_texto = true`);

// les droits : la nouvelle signature
m('inscrire_avis : l\'ancienne signature (8 paramètres) reste ouverte aux visiteurs', `revoke all on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) from public;`, `revoke all on function public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text) from public;\ncreate function public.inscrire_avis(text, text, text, text, boolean, text, text, text) returns jsonb language sql as $f$ select '{}'::jsonb $f$;\ngrant execute on function public.inscrire_avis(text, text, text, text, boolean, text, text, text) to anon;`);


// ── du fichier ajouté au passage (ne doit rien changer d'autre)
m('une fiche client est ajoutée au passage', AVANT_COMMIT, `insert into public.clients (nom) values ('Fiche de trop');\ncommit;\n\n-- ====`);
m('une règle d\'accès d\'un autre tableau est retirée au passage', AVANT_COMMIT, `drop policy if exists stops_lecture on public.stops;\ncommit;\n\n-- ====`);
m('un arrêt est supprimé au passage', AVANT_COMMIT, `delete from public.stops where id = (select id from public.stops limit 1);\ncommit;\n\n-- ====`);
m('est_admin est remplacée au passage', AVANT_COMMIT, `create or replace function public.est_admin() returns boolean language sql stable as $f$ select true $f$;\ncommit;\n\n-- ====`);

// ─────────────────────────────────────────────────────────────────────────
const APPLIQUER = (texte, de, vers) => (Array.isArray(de) ? de.reduce((t, [a, b]) => t.replace(a, () => b), texte) : texte.replace(de, () => vers));
const PAIRES = (de) => (Array.isArray(de) ? de : [[de]]);
let detectees = 0, essayees = 0, equivalentes = 0; const rapport = [];
try {
  for (const [i, [nom, de, vers, equivalente]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    if (MATCH && !MATCH.test(nom)) continue;
    essayees++;
    const paires = PAIRES(de);
    const mauvais = paires.map(([a]) => SOURCE.split(a).length - 1).find((c) => c !== 1);
    if (mauvais !== undefined) { rapport.push(`?? ${i + 1}. TEXTE ${mauvais === 0 ? 'INTROUVABLE' : 'EN ' + mauvais + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    const abime = APPLIQUER(SOURCE, de, vers);
    if (abime === SOURCE) { rapport.push(`?? ${i + 1}. MUTATION SANS EFFET : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    if (process.env.LISTER) { console.log(`${i + 1}. ${nom}`); continue; }
    if (process.env.VALIDER) { continue; }
    fs.writeFileSync(TMP, abime);
    let sortie = '';
    try { sortie = execFileSync('node', ['test-repertoire-inscriptions.mjs'], { cwd: TESTS, env: { ...process.env, SQL30_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const r = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = r ? Number(r[2]) : -1;
    const vu = ko !== 0;
    if (vu) detectees++;
    if (!vu && equivalente) { equivalentes++; rapport.push(`=  équivalente ${i + 1}. ${nom}  [${equivalente}]`); console.log(rapport[rapport.length - 1]); continue; }
    rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. ${nom}${r ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
    console.log(rapport[rapport.length - 1]);
  }
} finally {
  fs.rmSync(TMP, { force: true });
}
if (process.env.VALIDER) {
  const problemes = rapport.filter((l) => l.startsWith('??'));
  console.log(`\n${essayees} mutations examinées, ${problemes.length} à corriger`);
} else {
  console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees - equivalentes}` + (equivalentes ? `, et ${equivalentes} équivalente(s) qui ne changent rien au comportement (pas des trous)` : ''));
  const rates = rapport.filter((l) => l.startsWith('RATÉE') || l.startsWith('??'));
  if (rates.length) console.log('À REGARDER :\n' + rates.join('\n'));
}
console.log(fs.readFileSync(FICHIER, 'utf8').replace(/\r\n/g, '\n') === SOURCE ? 'Le vrai fichier (SQL 30) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
