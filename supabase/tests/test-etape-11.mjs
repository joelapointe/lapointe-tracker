// Étape 11 — fichiers 07 (profil sans téléphone) et 08 (donner le rôle administrateur).
// Reproduit le parcours réel de Joé : créer le compte dans le tableau de bord (sans données cachées),
// puis exécuter le fichier 08 avec son courriel.
// Limite : le faux « auth.users » n'est pas le vrai ; le vrai parcours se confirme sur Supabase.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql', '05-etape9b-passes-fermetures-export.sql', '06-etape10-outils-admin-employes.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql'];

const db = await prepare(FILES);
await db.exec(`alter table auth.users add column email_confirmed_at timestamptz;`);   // existe sur le vrai Supabase
const sup = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };
const commeUtilisateur = async (uid, sql, p, role = 'authenticated') => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(sql, p)).rows; } finally { await db.query('reset role'); }
};
async function echoue(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 90)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const profil = async (id) => (await sup('select * from public.utilisateurs where id = $1', [id]))[0];
const creerAuth = async (email, app = {}, userMeta = {}) =>
  (await sup('insert into auth.users(email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at) values ($1,$2::jsonb,$3::jsonb, now()) returning id', [email, JSON.stringify(app), JSON.stringify(userMeta)]))[0].id;
const estAdmin = async (uid) => (await commeUtilisateur(uid, 'select public.est_admin() as r'))[0].r;
const estActif = async (uid) => (await commeUtilisateur(uid, 'select public.est_actif() as r'))[0].r;

// =====================================================================
log('=== AVANT LE FICHIER 07 : le problème est bien réel ===');
await echoue('création d\'un compte sans données cachées : ÉCHEC (« Database error creating new user »)',
  () => creerAuth('avant@exemple.ca'), 'employe_a_un_telephone');

const SQL07 = fs.readFileSync(SQL_DIR + '07-etape11-profil-sans-telephone.sql', 'utf8');
const r07 = await db.exec(SQL07);
const verif07 = r07[r07.length - 1].rows[0].verification;

log('\n=== FICHIER 07 ===');
eq('vérification : déclencheur présent, fonction verrouillée', [verif07.declencheur_present, verif07.fonction_appelable_par_un_employe, verif07.fonction_appelable_par_un_visiteur], [1, false, false]);
await db.exec(SQL07);
pass('le fichier 07 peut être ré-exécuté sans erreur');

// Le compte de Joé, créé comme dans le tableau de bord : courriel + mot de passe, rien d'autre
const sansProfil = await creerAuth('joe@exemple.ca');
pass('création du compte SANS données cachées : réussit maintenant');
eq('… mais aucun profil n\'est créé', await profil(sansProfil), undefined);
eq('… le compte n\'est ni administrateur ni actif (aucun accès)', [await estAdmin(sansProfil), await estActif(sansProfil)], [false, false]);
eq('… il ne voit aucun arrêt, aucune route', [(await commeUtilisateur(sansProfil, 'select count(*)::int n from public.stops'))[0].n, (await commeUtilisateur(sansProfil, 'select count(*)::int n from public.routes'))[0].n], [0, 0]);
await echoue('… il ne peut pas lister les utilisateurs', () => commeUtilisateur(sansProfil, 'select public.admin_lister_utilisateurs()'), 'non_autorise');
await echoue('… il ne peut pas faire « Je commence »', () => commeUtilisateur(sansProfil, `select public.quart_commencer(gen_random_uuid(), null, null, null, null)`), '');
eq('… il n\'a aucun profil lisible (table « utilisateurs » vide pour lui)', (await commeUtilisateur(sansProfil, 'select count(*)::int n from public.utilisateurs'))[0].n, 0);

log('\n=== LE DÉCLENCHEUR N\'A PAS CHANGÉ POUR LES AUTRES CAS ===');
const emp = await creerAuth('8195550101@tel.entretienlapointe.ca', { nom: 'Marc', telephone: '8195550101' });
eq('employé (nom + téléphone) : profil employé, actif, comme avant', [(await profil(emp)).nom, (await profil(emp)).telephone, (await profil(emp)).role, (await profil(emp)).actif], ['Marc', '8195550101', 'employe', true]);
const empRole = await creerAuth('8195550102@tel.entretienlapointe.ca', { nom: 'Luc', telephone: '8195550102', role: 'employe' });
eq('employé avec rôle explicite « employe » : profil employé', (await profil(empRole)).role, 'employe');
const adminMeta = await creerAuth('adjoint@exemple.ca', { nom: 'Adjoint', role: 'admin' });
eq('rôle « admin » dans les données serveur (comme avant) : profil administrateur', [(await profil(adminMeta)).role, (await profil(adminMeta)).telephone], ['admin', null]);
const trompeur = await creerAuth('pirate@exemple.ca', {}, { role: 'admin', nom: 'Pirate', telephone: '8195559999' });
eq('« admin » ou téléphone dans les données MODIFIABLES par l\'utilisateur : ignorés, aucun profil', await profil(trompeur), undefined);
eq('… et il n\'est pas administrateur', await estAdmin(trompeur), false);
await echoue('rôle inconnu (« superuser ») avec téléphone : toujours refusé par la base', () => creerAuth('x@exemple.ca', { telephone: '8195550103', role: 'superuser' }), 'utilisateurs_role_check');
await echoue('téléphone mal formé : toujours refusé par la base', () => creerAuth('y@exemple.ca', { telephone: '12345' }), 'utilisateurs_telephone_check');
await echoue('l\'employé ne peut toujours pas appeler la fonction du déclencheur', () => commeUtilisateur(emp, `select public.creer_profil_depuis_auth()`), 'permission denied');

// =====================================================================
log('\n=== FICHIER 08 : donner le rôle administrateur ===');
const SQL08 = fs.readFileSync(SQL_DIR + '08-etape11-donner-role-admin.sql', 'utf8');
const PLACEHOLDER = 'TON-COURRIEL@EXEMPLE.CA';
vrai('le fichier contient exactement UNE ligne à modifier', SQL08.split(PLACEHOLDER).length === 2);
const avec = (courriel) => SQL08.replace(PLACEHOLDER, courriel);
const admins = async () => (await sup(`select count(*)::int n from public.utilisateurs where role = 'admin'`))[0].n;
const avant = await admins();   // « Adjoint » (créé plus haut pour tester le déclencheur) est déjà administrateur
eq('point de départ : un administrateur déjà présent (cas du test)', avant, 1);

await echoue('tel quel (courriel non remplacé) : refuse, ne fait rien', () => db.exec(SQL08), 'compte_introuvable');
await echoue('courriel inexistant : refuse', () => db.exec(avec('faute-de-frappe@exemple.ca')), 'compte_introuvable');
await echoue('un compte d\'employé (identifiant @tel.entretienlapointe.ca) : refuse', () => db.exec(avec('8195550101@tel.entretienlapointe.ca')), 'identifiant d\'employé');
eq('… Marc est resté un employé', (await profil(emp)).role, 'employe');
await echoue('un autre administrateur existe déjà : refuse (pas de deuxième administrateur par erreur)', () => db.exec(avec('joe@exemple.ca')), 'un autre compte est déjà administrateur');
eq('… le compte de Joé n\'a toujours pas de profil', await profil(sansProfil), undefined);

// Parcours normal : il n'y a pas d'autre administrateur
await sup(`delete from public.utilisateurs where id = $1`, [adminMeta]);
const r08 = await db.exec(avec('  Joe@Exemple.CA '));
const verif08 = r08[r08.length - 1].rows[0].verification;
const p = await profil(sansProfil);
eq('après le fichier 08 (courriel avec majuscules et espaces) : profil administrateur, nom « Joé », actif', [p.role, p.nom, p.actif, p.telephone], ['admin', 'Joé', true, null]);
const triee = (o) => Object.fromEntries(Object.entries(o).sort());   // l'ordre des clés JSON n'a pas d'importance
eq('la vérification liste UN administrateur, avec son courriel', verif08.administrateurs.map(triee), [triee({ nom: 'Joé', courriel: 'joe@exemple.ca', role: 'admin', actif: true, courriel_confirme: true })]);
eq('est_admin() est vrai pour lui, est_actif() aussi', [await estAdmin(sansProfil), await estActif(sansProfil)], [true, true]);
const liste = (await commeUtilisateur(sansProfil, 'select public.admin_lister_utilisateurs() as r'))[0].r;
eq('il peut maintenant lister les utilisateurs (fonction administrateur)', liste.map((u) => u.nom).sort(), ['Joé', 'Luc', 'Marc']);
eq('il voit les arrêts (13 de test)', (await commeUtilisateur(sansProfil, 'select count(*)::int n from public.stops'))[0].n, 13);
await db.exec(avec('joe@exemple.ca'));
eq('ré-exécuter le fichier 08 pour le même compte : sans erreur, toujours un seul administrateur', await admins(), 1);

// Après : les autres restent des employés
eq('Marc n\'est pas administrateur', await estAdmin(emp), false);
await echoue('Marc ne peut pas lister les utilisateurs', () => commeUtilisateur(emp, 'select public.admin_lister_utilisateurs()'), 'non_autorise');
await echoue('le compte sans profil de « pirate » non plus', () => commeUtilisateur(trompeur, 'select public.admin_lister_utilisateurs()'), 'non_autorise');
await echoue('un employé ne peut pas se donner le rôle admin par une écriture directe', () => commeUtilisateur(emp, `update public.utilisateurs set role = 'admin' where id = $1`, [emp]), 'permission denied');

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
