// OUTIL (demande 5, chantier A) — fabrique le SQL d'import des clients de QuickBooks dans public.clients.
//
// Ce fichier ne contient AUCUNE donnée de client. Le fichier d'entrée (clients exportés de QuickBooks) et le SQL fabriqué contiennent des
// noms, adresses, téléphones et courriels : ils restent HORS du dépôt Git (le .gitignore bloque Clients*.xls, clients*.csv et import-clients*.sql).
//
// 1) Exporter QuickBooks > Clients.xls, puis le convertir en CSV (séparateur « ; », UTF-8) avec Excel. Exemple (PowerShell, sur une COPIE) :
//      $xl = New-Object -ComObject Excel.Application; $xl.Visible = $false; $xl.DisplayAlerts = $false
//      $wb = $xl.Workbooks.Open("C:\...\Clients-copie.xls", 0, $true); $wb.SaveAs("C:\...\clients.csv", 62); $wb.Close($false); $xl.Quit()
//    (62 = « CSV UTF-8 » ; le séparateur suit la langue de Windows : « ; » en français.)
// 2) node supabase/outils/importer-clients-quickbooks.mjs <clients.csv> <import-clients.sql>
//    (chemins relatifs ou Windows ; le SQL doit être écrit HORS du dépôt, par exemple dans le dossier temporaire)
// 3) Lire le résultat, puis l'exécuter chez Supabase (SQL Editor, ou Claude avec l'accord de Joé).
//
// CE QUE FAIT LE SQL : une fiche par client, SANS aucun avis activé (avis_courriel = false, avis_texto = false) et sans consentement. Le téléphone de QuickBooks va dans
// « telephone », jamais dans « cellulaire » (on ne sait pas si c'est un cellulaire : le client le donne lui-même sur la page d'inscription). Les clients sans téléphone ET
// sans courriel sont laissés de côté (décision de Joé, 1ᵉʳ oct. 2026). Relançable sans doublons : la clé est quickbooks_nom (= le « Nom » de QuickBooks).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [entree, sortie] = process.argv.slice(2);
if (!entree || !sortie) {
  console.error('Usage : node supabase/outils/importer-clients-quickbooks.mjs <clients.csv> <import-clients.sql>');
  process.exit(1);
}
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (path.resolve(sortie).toLowerCase().startsWith(racine.toLowerCase() + path.sep)) {
  console.error('Refusé : le SQL contient des données personnelles, il doit être écrit HORS du dépôt Git (par exemple dans le dossier temporaire).');
  process.exit(1);
}

const COLONNES = ['Nom', 'Nom de l’entreprise', 'Adresse municipale', 'Ville', 'Province', 'Pays', 'Code postal', 'Téléphone', 'Courriel'];
const texte = fs.readFileSync(entree, 'utf8').replace(/^\uFEFF/, '');
const lignes = texte.split(/\r?\n/).filter(Boolean).map((l) => l.split(';'));
const entete = lignes.shift();
const idx = Object.fromEntries(COLONNES.map((c) => [c, entete.indexOf(c)]));
for (const [c, i] of Object.entries(idx)) {
  if (i < 0) { console.error('Colonne introuvable dans le CSV : « ' + c + ' ». Séparateur « ; » ? Export QuickBooks modifié ?'); process.exit(1); }
}

const q = (s) => { s = (s || '').replace(/\s+/g, ' ').trim(); return s ? "'" + s.replace(/'/g, "''") + "'" : 'null'; };
const chiffres = (s) => (s || '').replace(/\D/g, '');
const col = (r, nom) => (r[idx[nom]] || '').trim();

const gardees = [];
let ecartees = 0;
const noms = new Set();
for (const r of lignes) {
  const nom = col(r, 'Nom');
  if (!nom) { ecartees++; continue; }
  if (!chiffres(col(r, 'Téléphone')) && !col(r, 'Courriel')) { ecartees++; continue; }
  if (noms.has(nom)) { console.error('Nom en double dans le CSV (la clé quickbooks_nom doit être unique) : ' + nom); process.exit(1); }
  noms.add(nom);
  const ent = col(r, 'Nom de l’entreprise');
  gardees.push('(' + [q(nom), ent && ent !== nom ? q(ent) : 'null', q(col(r, 'Adresse municipale')), q(col(r, 'Ville')), q(col(r, 'Code postal')),
    q(col(r, 'Courriel').toLowerCase()), q(col(r, 'Téléphone')), q(nom)].join(',') + ')');
}

const sql = `-- IMPORT DES CLIENTS DE QUICKBOOKS — contient des données personnelles : NE PAS mettre dans Git.
-- Ne crée que des fiches : avis_courriel = false, avis_texto = false, aucun consentement. Relançable sans doublons (clé : quickbooks_nom).
begin;
insert into public.clients (nom, nom_entreprise, adresse, ville, code_postal, courriel, telephone, quickbooks_nom)
select v.nom, v.ent, v.adr, v.ville, v.cp, v.courriel, v.tel, v.qb
from (values
${gardees.join(',\n')}
) as v(nom, ent, adr, ville, cp, courriel, tel, qb)
where not exists (select 1 from public.clients c where c.quickbooks_nom = v.qb);
select count(*) as clients_apres_import, count(*) filter (where courriel is not null) as avec_courriel, count(*) filter (where telephone is not null) as avec_telephone, count(*) filter (where avis_courriel or avis_texto) as avec_avis_actives from public.clients;
commit;
`;
fs.writeFileSync(sortie, sql);
console.log('Fiches à importer : ' + gardees.length + ' ; laissées de côté (ni téléphone ni courriel, ou sans nom) : ' + ecartees + ' ; SQL écrit.');
