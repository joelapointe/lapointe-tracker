// Étape 10 — outils SQL (06) + Edge Function « admin-employes ».
// La fonction est testée avec de FAUSSES connexions à Supabase Auth, mais avec la VRAIE base (PGlite) :
// les déclencheurs, les clés étrangères, est_admin() et les droits sont ceux des fichiers SQL.
// Ce que ces tests NE peuvent PAS vérifier : le comportement réel de Supabase Auth (GoTrue) et de PostgREST.
// Cela se vérifie à l'étape 11, sur la vraie base.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';
import { randomUUID as uuid } from 'crypto';
import { stripTypeScriptTypes } from 'node:module';

// La fonction est du TypeScript pour Supabase (Deno). On retire les types et on charge le code tel quel
// (sans passer par le package.json de la racine, qui est en CommonJS).
const CODE_FONCTION = fs.readFileSync(SQL_DIR + 'functions/admin-employes/index.ts', 'utf8');
const { traiter, normaliserTelephone, nipTropFacile, nipValide, genererNip, DOMAINE_EMAIL } =
  await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(CODE_FONCTION)).toString('base64'));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql', '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql'];
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

// ---------------------------------------------------------------------
// Environnement : la vraie base + un « faux Supabase Auth »
// ---------------------------------------------------------------------
const db = await prepare(FILES);
const r06 = await db.exec(fs.readFileSync(SQL_DIR + '06-etape10-outils-admin-employes.sql', 'utf8'));
const verif = r06[r06.length - 1].rows[0].verification;
// Comme sur la vraie base : 07 (déclencheur corrigé) puis 09 (le serveur crée le profil de l'employé) ont aussi été exécutés.
await db.exec(fs.readFileSync(SQL_DIR + '07-etape11-profil-sans-telephone.sql', 'utf8'));
const r09 = await db.exec(fs.readFileSync(SQL_DIR + '09-etape11-profil-employe-par-le-serveur.sql', 'utf8'));
const verif09 = r09[r09.length - 1].rows[0].verification;
// Comme sur Supabase : service_role voit le schéma public et contourne les règles d'accès par ligne.
await db.exec(`grant usage on schema public to service_role; alter role service_role bypassrls;`);

const sup = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };                       // super-utilisateur
const q = sup;
const commeRole = async (role, uid, sql, p) => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(sql, p)).rows; } finally { await db.query('reset role'); }
};
const fn = async (uid, call, params = []) => (await commeRole('authenticated', uid, `select public.${call} as r`, params))[0].r;

const motsDePasse = new Map();   // id -> mot de passe (faux Auth)
const bannis = new Set();
const journal = [];
let dernierCreer = null;

function fabriquerDeps(surcharges = {}) {
  return {
    async estAdmin(autorisation) {
      const jeton = autorisation.replace(/^Bearer\s+/i, '');
      const estUuid = /^[0-9a-f-]{36}$/i.test(jeton);
      try {
        const r = await commeRole(estUuid ? 'authenticated' : 'anon', estUuid ? jeton : '', 'select public.est_admin() as r');
        return r[0].r === true;
      } catch { return false; }   // comme PostgREST : une erreur = « non »
    },
    async profilParId(id) {
      return (await commeRole('service_role', '', 'select id, nom, telephone, role, actif from public.utilisateurs where id = $1', [id]))[0] ?? null;
    },
    async profilParTelephone(t) {
      return (await commeRole('service_role', '', 'select id, nom, telephone, role, actif from public.utilisateurs where telephone = $1', [t]))[0] ?? null;
    },
    async definirActif(id, actif) { await commeRole('service_role', '', 'update public.utilisateurs set actif = $2 where id = $1', [id, actif]); },
    async aUnHistorique(id) { return (await commeRole('service_role', '', 'select public._utilisateur_a_de_l_historique($1) as r', [id]))[0].r; },
    async creerProfilEmploye(id, nom, telephone) {
      await commeRole('service_role', '', 'select public._creer_profil_employe($1::uuid, $2, $3)', [id, nom, telephone]);
    },
    async authCreer(a) {
      dernierCreer = a;
      if ((await sup('select 1 from auth.users where email = $1', [a.email])).length) return { erreur: 'existe_deja' };
      try {
        // Comme le VRAI Supabase Auth (constaté le 19 sept. 2026) : le compte est d'abord créé avec seulement le fournisseur,
        // puis les données « app_metadata » sont ajoutées dans une DEUXIÈME écriture. Un déclencheur « à l'insertion » ne les voit donc pas.
        const r = await sup('insert into auth.users(email, raw_app_meta_data) values ($1, $2::jsonb) returning id', [a.email, JSON.stringify({ provider: 'email', providers: ['email'] })]);
        await sup('update auth.users set raw_app_meta_data = raw_app_meta_data || $2::jsonb where id = $1', [r[0].id, JSON.stringify(a.app_metadata)]);
        motsDePasse.set(r[0].id, a.password);
        return { id: r[0].id };
      } catch { return { erreur: 'echec' }; }
    },
    async authChangerMotDePasse(id, pw) {
      if (!(await sup('select 1 from auth.users where id = $1', [id])).length) return false;
      motsDePasse.set(id, pw); return true;
    },
    async authBloquer(id, bloque) { bloque ? bannis.add(id) : bannis.delete(id); return true; },
    async authSupprimer(id) {
      try { await sup('delete from auth.users where id = $1', [id]); motsDePasse.delete(id); return true; } catch { return false; }
    },
    nipAleatoire: () => genererNip((n) => crypto.getRandomValues(new Uint32Array(n))),
    journal: (l) => journal.push(l),
    ...surcharges,
  };
}

async function appel(uid, corps, { deps = fabriquerDeps(), methode = 'POST', brut, autorisation } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const aut = autorisation === undefined ? (uid ? 'Bearer ' + uid : undefined) : autorisation;
  if (aut) headers.Authorization = aut;
  const rep = await traiter(new Request('https://x.supabase.co/functions/v1/admin-employes', {
    method: methode, headers, body: methode === 'POST' ? (brut ?? JSON.stringify(corps)) : undefined }), deps);
  const texte = await rep.text();
  let json = null; try { json = JSON.parse(texte); } catch { /* vide */ }
  return { statut: rep.status, json, entetes: rep.headers };
}

const nbUsers = async () => Number((await sup('select count(*)::int n from auth.users'))[0].n);
const profil = async (id) => (await sup('select * from public.utilisateurs where id = $1', [id]))[0];
const compte = async (id) => (await sup('select * from auth.users where id = $1', [id]))[0];
const NIPS_UTILISES = new Set();
const nip = (n) => { NIPS_UTILISES.add(n); return n; };

// Comptes de départ (créés comme le ferait l'étape 11 pour Joé, et comme la fonction le fera pour les employés)
const insAuth = async (email, app) => (await sup('insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id', [email, JSON.stringify(app)]))[0].id;
const joe = await insAuth('joe@exemple.ca', { nom: 'Joé', role: 'admin' });
const admin2 = await insAuth('adjoint@exemple.ca', { nom: 'Adjoint', role: 'admin' });
await sup(`update public.utilisateurs set actif = false where id = $1`, [admin2]);   // administrateur désactivé
const employe = await insAuth('marc@exemple.ca', { nom: 'Marc', telephone: '8195550101' });
const inactif = await insAuth('zoe@exemple.ca', { nom: 'Zoé', telephone: '8195550102' });
await sup(`update public.utilisateurs set actif = false where id = $1`, [inactif]);

// =====================================================================
log('\n=== OUTILS SQL (fichier 06) ===');
eq('visiteur : ne peut pas appeler _utilisateur_a_de_l_historique', verif.appelable_par_un_visiteur, false);
eq('employé : ne peut pas non plus', verif.appelable_par_un_employe, false);
eq('serveur : peut l\'appeler', verif.appelable_par_le_serveur, true);
eq('le serveur lit « utilisateurs » et change « actif »', [verif.serveur_peut_lire_utilisateurs, verif.serveur_peut_changer_actif], [true, true]);
eq('visiteur / employé : aucun nouveau droit sur « utilisateurs »', verif.visiteur_et_employe_sans_droit_sur_utilisateurs, true);
eq('tables qui pointent vers « utilisateurs » (détectées automatiquement)', verif.tables_qui_pointent_vers_utilisateurs,
  ['equipage_journal', 'equipage_periodes', 'journal_modifications', 'passe_arrets', 'passes', 'positions', 'problemes', 'quarts']);
for (const [role, uid] of [['anon', ''], ['authenticated', employe], ['authenticated', joe]]) {
  try { await commeRole(role, uid, 'select public._utilisateur_a_de_l_historique($1)', [employe]); fail(`${role}${uid === joe ? ' (administrateur)' : ''} : refusé`, 'aurait dû échouer'); }
  catch (e) { e.message.includes('permission denied') ? pass(`${role}${uid === joe ? ' (administrateur, depuis l\'application)' : ''} ne peut pas appeler la fonction  [permission denied]`) : fail('autre erreur', e.message); }
}
// Ré-exécution sans danger
await db.exec(fs.readFileSync(SQL_DIR + '06-etape10-outils-admin-employes.sql', 'utf8'));
pass('le fichier 06 peut être ré-exécuté sans erreur');

// =====================================================================
log('\n=== VALIDATION (fonctions pures) ===');
eq('téléphone : 8191234567', normaliserTelephone('8191234567'), '8191234567');
eq('téléphone : 819-123-4567', normaliserTelephone('819-123-4567'), '8191234567');
eq('téléphone : (819) 123 4567', normaliserTelephone('(819) 123 4567'), '8191234567');
eq('téléphone : +1 819 123-4567', normaliserTelephone('+1 819 123-4567'), '8191234567');
eq('téléphone : 1-819-123-4567', normaliserTelephone('1-819-123-4567'), '8191234567');
for (const mauvais of ['123456789', '81912345678', '0191234567', '1191234567', 'abcdefghij', '', null, undefined, 8191234567, {}, '819123456a', '+33 6 12 34 56 78'])
  eq(`téléphone refusé : ${JSON.stringify(mauvais)}`, normaliserTelephone(mauvais), null);
for (const facile of ['000000', '111111', '999999', '123456', '234567', '456789', '654321', '987654', '543210'])
  vrai(`NIP trop facile : ${facile}`, nipTropFacile(facile));
for (const bon of ['123457', '135790', '246810', '100000', '121212', '482915', '012346', '098765'])
  vrai(`NIP acceptable : ${bon}`, !nipTropFacile(bon));
vrai('nipValide : « 482915 »', nipValide('482915'));
for (const mauvais of ['12345', '1234567', 'abcdef', '12 345', 482915, null, undefined, '12345a', '１２３４５６'])
  vrai(`nipValide refuse ${JSON.stringify(mauvais)}`, !nipValide(mauvais));
{
  let tous6 = true, aucunFacile = true, zerosDevant = false;
  for (let i = 0; i < 20000; i++) {
    const n = genererNip((k) => crypto.getRandomValues(new Uint32Array(k)));
    if (!/^[0-9]{6}$/.test(n)) tous6 = false;
    if (nipTropFacile(n)) aucunFacile = false;
    if (n.startsWith('0')) zerosDevant = true;
  }
  vrai('NIP tiré au hasard : toujours 6 chiffres (20 000 essais)', tous6);
  vrai('NIP tiré au hasard : jamais un NIP trop facile', aucunFacile);
  vrai('NIP tiré au hasard : peut commencer par 0 (chaîne, pas nombre)', zerosDevant);
  const suite = ['123456', '000000', '482915'];
  eq('NIP tiré au hasard : un tirage trop facile est retiré', genererNip(() => new Uint32Array([Number(suite.shift())])), '482915');
}

// =====================================================================
log('\n=== QUI A LE DROIT D\'APPELER ===');
const avant = await nbUsers();
const tentative = { action: 'creer', nom: 'Pirate', telephone: '8195559999', nip: nip('482915') };
let r = await appel(null, tentative);
eq('sans jeton : refusé 403', [r.statut, r.json.erreur], [403, 'non_autorise']);
r = await appel(null, tentative, { autorisation: 'Bearer' });
eq('« Bearer » sans jeton : refusé 403', [r.statut, r.json.erreur], [403, 'non_autorise']);
r = await appel(null, tentative, { autorisation: 'Basic abc' });
eq('autre type d\'autorisation : refusé', [r.statut, r.json.erreur], [403, 'non_autorise']);
r = await appel(null, tentative, { autorisation: 'Bearer cle-publique-anon' });
eq('avec la clé publique (jeton « anon », valide pour Supabase) : refusé', [r.statut, r.json.erreur], [403, 'non_autorise']);
r = await appel(employe, tentative);
eq('un employé : refusé', [r.statut, r.json.erreur], [403, 'non_autorise']);
r = await appel(inactif, tentative);
eq('un employé désactivé : refusé', [r.statut, r.json.erreur], [403, 'non_autorise']);
r = await appel(admin2, tentative);
eq('un administrateur DÉSACTIVÉ : refusé', [r.statut, r.json.erreur], [403, 'non_autorise']);
r = await appel(uuid(), tentative);
eq('un jeton dont le compte n\'existe pas : refusé', [r.statut, r.json.erreur], [403, 'non_autorise']);
eq('… et rien n\'a été créé par ces tentatives', await nbUsers(), avant);
r = await appel(employe, { action: 'supprimer', id: joe });
eq('un employé ne peut pas supprimer Joé', [r.statut, (await profil(joe)) !== undefined], [403, true]);
r = await appel(employe, { action: 'reinitialiser_nip', id: joe, nip: nip('482915') });
eq('un employé ne peut pas changer le NIP de Joé', [r.statut, motsDePasse.has(joe)], [403, false]);
r = await appel(employe, { action: 'desactiver', id: inactif });
eq('un employé ne peut rien désactiver / réactiver', [r.statut, (await profil(inactif)).actif], [403, false]);

r = await appel(joe, {}, { methode: 'GET' });
eq('GET refusé (405)', [r.statut, r.json.erreur], [405, 'methode_refusee']);
r = await appel(null, null, { methode: 'OPTIONS' });
eq('OPTIONS (pré-vérification du navigateur) : 204 avec les en-têtes CORS', [r.statut, r.entetes.get('access-control-allow-origin'), /authorization/.test(r.entetes.get('access-control-allow-headers'))], [204, '*', true]);
r = await appel(joe, null, { brut: 'ceci n\'est pas du json' });
eq('corps qui n\'est pas du JSON : 400', [r.statut, r.json.erreur], [400, 'requete_invalide']);
r = await appel(joe, null, { brut: '[1,2]' });
eq('corps qui est une liste : 400', [r.statut, r.json.erreur], [400, 'requete_invalide']);
r = await appel(joe, { action: 'tout-detruire' });
eq('action inconnue : 400', [r.statut, r.json.erreur], [400, 'action_inconnue']);
r = await appel(joe, { nom: 'x' });
eq('action absente : 400', [r.statut, r.json.erreur], [400, 'action_inconnue']);
vrai('les réponses ont l\'en-tête CORS', r.entetes.get('access-control-allow-origin') === '*');

// =====================================================================
log('\n=== CRÉER UN EMPLOYÉ ===');
r = await appel(joe, { action: 'creer', nom: '  Luc   Tremblay ', telephone: '(819) 555-0201', nip: nip('482915') });
eq('création réussie : 200', [r.statut, r.json.ok], [200, true]);
const luc = r.json.employe?.id;
eq('la réponse donne le nom nettoyé, le numéro à 10 chiffres et actif', [r.json.employe.nom, r.json.employe.telephone, r.json.employe.actif], ['Luc Tremblay', '8195550201', true]);
eq('la réponse redonne le NIP tapé (à remettre à l\'employé), non généré', [r.json.nip, r.json.nip_genere], ['482915', false]);
eq('l\'identifiant technique est numéro@domaine', dernierCreer.email, `8195550201@${DOMAINE_EMAIL}`);
eq('le mot de passe envoyé à Auth est le NIP', motsDePasse.get(luc), '482915');
let p = await profil(luc);
eq('profil créé par le déclencheur : nom, téléphone, rôle employé, actif', [p.nom, p.telephone, p.role, p.actif], ['Luc Tremblay', '8195550201', 'employe', true]);
eq('la fonction n\'a JAMAIS fourni de rôle à Auth (seulement nom et téléphone, en plus du fournisseur ajouté par Auth)', Object.keys((await compte(luc)).raw_app_meta_data).sort(), ['nom', 'provider', 'providers', 'telephone']);
eq('le NIP n\'est pas dans la réponse sous une autre forme (une seule clé « nip »)', Object.keys(r.json).sort(), ['employe', 'nip', 'nip_genere', 'ok']);

r = await appel(joe, { action: 'creer', nom: 'Nina', telephone: '819 555 0202', role: 'admin', actif: false, id: joe, nip: nip('135790') });
const nina = r.json.employe?.id;
p = await profil(nina);
eq('champ « role: admin » envoyé par l\'appelant : ignoré, le compte est un employé', [r.statut, p.role, p.actif], [200, 'employe', true]);
eq('… et « actif: false » ignoré aussi', p.actif, true);

r = await appel(joe, { action: 'creer', nom: 'Oscar', telephone: '8195550203' });
const oscar = r.json.employe?.id;
vrai('sans NIP : un NIP à 6 chiffres est tiré au hasard et renvoyé', r.statut === 200 && /^[0-9]{6}$/.test(r.json.nip) && r.json.nip_genere === true, JSON.stringify(r.json));
NIPS_UTILISES.add(r.json.nip);
eq('… et c\'est bien le mot de passe du compte', motsDePasse.get(oscar), r.json.nip);
r = await appel(joe, { action: 'creer', nom: 'Pia', telephone: '8195550204', nip: '' });
vrai('NIP vide : traité comme absent (tiré au hasard)', r.statut === 200 && r.json.nip_genere === true);
NIPS_UTILISES.add(r.json.nip);

let avantRefus = await nbUsers();
r = await appel(joe, { action: 'creer', nom: 'Luc bis', telephone: '8195550201', nip: nip('246810') });
eq('numéro déjà pris : 409, nomme la personne', [r.statut, r.json.erreur, r.json.message.includes('Luc Tremblay')], [409, 'telephone_deja_utilise', true]);
r = await appel(joe, { action: 'creer', nom: 'Zoé bis', telephone: '8195550102', nip: nip('246810') });
eq('numéro d\'un compte désactivé : 409, suggère de réactiver', [r.statut, r.json.erreur, /réactiv/.test(r.json.message)], [409, 'telephone_deja_utilise', true]);
r = await appel(joe, { action: 'creer', nom: 'Course', telephone: '8195550201', nip: nip('246810') },
  { deps: fabriquerDeps({ profilParTelephone: async () => null }) });   // le contrôle préalable rate (course) : Auth refuse quand même
eq('même si le contrôle préalable rate, Auth refuse le doublon : 409', [r.statut, r.json.erreur], [409, 'telephone_deja_utilise']);
eq('… aucun compte créé par ces refus', await nbUsers(), avantRefus);

for (const [libelle, corps, code] of [
  ['nom absent', { action: 'creer', telephone: '8195550301', nip: '482915' }, 'nom_invalide'],
  ['nom vide', { action: 'creer', nom: '   ', telephone: '8195550301', nip: '482915' }, 'nom_invalide'],
  ['nom trop long', { action: 'creer', nom: 'x'.repeat(101), telephone: '8195550301', nip: '482915' }, 'nom_invalide'],
  ['nom qui n\'est pas du texte', { action: 'creer', nom: 42, telephone: '8195550301', nip: '482915' }, 'nom_invalide'],
  ['téléphone absent', { action: 'creer', nom: 'A', nip: '482915' }, 'telephone_invalide'],
  ['téléphone trop court', { action: 'creer', nom: 'A', telephone: '555-0301', nip: '482915' }, 'telephone_invalide'],
  ['NIP trop court', { action: 'creer', nom: 'A', telephone: '8195550301', nip: '12345' }, 'nip_invalide'],
  ['NIP trop long', { action: 'creer', nom: 'A', telephone: '8195550301', nip: '1234567' }, 'nip_invalide'],
  ['NIP avec des lettres', { action: 'creer', nom: 'A', telephone: '8195550301', nip: '48a915' }, 'nip_invalide'],
  ['NIP envoyé comme nombre', { action: 'creer', nom: 'A', telephone: '8195550301', nip: 482915 }, 'nip_invalide'],
  ['NIP 000000', { action: 'creer', nom: 'A', telephone: '8195550301', nip: '000000' }, 'nip_trop_facile'],
  ['NIP 123456', { action: 'creer', nom: 'A', telephone: '8195550301', nip: '123456' }, 'nip_trop_facile'],
]) {
  r = await appel(joe, corps);
  eq(`refusé : ${libelle}`, [r.statut, r.json.erreur], [400, code]);
}
eq('… aucun compte créé par ces refus', await nbUsers(), avantRefus);

// Le serveur crée le profil (correction du 19 sept. 2026 : Auth écrit nom/téléphone APRÈS la création du compte)
{
  eq('09 : _creer_profil_employe — visiteur / employé : interdit, serveur : permis', [verif09.appelable_par_un_visiteur, verif09.appelable_par_un_employe, verif09.appelable_par_le_serveur], [false, false, true]);
  await db.exec(fs.readFileSync(SQL_DIR + '09-etape11-profil-employe-par-le-serveur.sql', 'utf8'));
  pass('09 : peut être ré-exécuté sans erreur');
  for (const [role, uid] of [['anon', ''], ['authenticated', employe], ['authenticated', joe]]) {
    try { await commeRole(role, uid, `select public._creer_profil_employe($1::uuid, 'X', '8195550000')`, [employe]); fail(`09 : ${role} refusé`, 'aurait dû échouer'); }
    catch (e) { e.message.includes('permission denied') ? pass(`09 : ${role}${uid === joe ? ' (administrateur, depuis l\'application)' : ''} ne peut pas l'appeler  [permission denied]`) : fail('autre erreur', e.message); }
  }
  try { await commeRole('service_role', '', `select public._creer_profil_employe(gen_random_uuid(), 'Fantôme', '8195550000')`); fail('09 : compte Auth inexistant refusé', 'aurait dû échouer'); }
  catch (e) { e.message.includes('compte_introuvable') ? pass('09 : refuse un compte Auth qui n\'existe pas  [compte_introuvable]') : fail('autre erreur', e.message); }
  const avantConflit = await profil(joe);
  await commeRole('service_role', '', `select public._creer_profil_employe($1::uuid, 'Pirate', '8195550000')`, [joe]);
  eq('09 : si le profil existe déjà (ici celui de Joé), rien n\'est modifié', await profil(joe), avantConflit);
  const nbAvant = await nbUsers();
  r = await appel(joe, { action: 'creer', nom: 'Deux temps', telephone: '8195550601', nip: nip('482915') });
  eq('Auth en DEUX écritures (comportement réel) : création réussie, profil « employe »', [r.statut, (await profil(r.json?.employe?.id))?.role, (await profil(r.json?.employe?.id))?.nom], [200, 'employe', 'Deux temps']);
  const unTemps = fabriquerDeps({
    async authCreer(a) {   // ancien comportement supposé : données fournies dès l'insertion, le déclencheur crée le profil
      dernierCreer = a;
      const x = await sup('insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id', [a.email, JSON.stringify(a.app_metadata)]);
      motsDePasse.set(x[0].id, a.password);
      return { id: x[0].id };
    } });
  r = await appel(joe, { action: 'creer', nom: 'Un temps', telephone: '8195550602', nip: nip('482915') }, { deps: unTemps });
  eq('Auth en UNE écriture (le déclencheur crée déjà le profil) : fonctionne aussi, sans doublon', [r.statut, (await sup(`select count(*)::int n from utilisateurs where telephone = '8195550602'`))[0].n], [200, 1]);
  const avantPanne = await nbUsers();
  const debutJournal = journal.length;
  r = await appel(joe, { action: 'creer', nom: 'Panne profil', telephone: '8195550603', nip: nip('482915') },
    { deps: fabriquerDeps({ creerProfilEmploye: async () => { throw new Error('boum 8195550603'); } }) });
  eq('la création du profil plante : création ANNULÉE (aucun compte fantôme)', [r.statut, r.json.erreur, await nbUsers()], [500, 'profil_incorrect', avantPanne]);
  vrai('… le journal dit pourquoi, sans nom ni numéro', journal.slice(debutJournal).some((l) => l === 'creer detail: profil_erreur') && !journal.slice(debutJournal).join('').includes('8195550603'));
  r = await appel(joe, { action: 'creer', nom: 'Panne totale', telephone: '8195550604', nip: nip('482915') },
    { deps: fabriquerDeps({ creerProfilEmploye: async () => { throw new Error('x'); }, authSupprimer: async () => false }) });
  vrai('… si l\'annulation échoue aussi : le message le dit et indique où vérifier', r.statut === 500 && /Authentication > Users/.test(r.json.message), JSON.stringify(r.json));
  await sup(`delete from auth.users where email = '8195550604@${DOMAINE_EMAIL}'`);   // ménage du compte laissé exprès par ce test
  r = await appel(joe, { action: 'creer', nom: 'Profil absent', telephone: '8195550605', nip: nip('482915') },
    { deps: fabriquerDeps({ creerProfilEmploye: async () => {} , profilParId: async () => null }) });
  eq('le profil reste introuvable : création annulée', [r.statut, r.json.erreur], [500, 'profil_incorrect']);
  eq('… (et le journal le distingue)', journal.slice(debutJournal).includes('creer detail: profil_absent'), true);
  eq('… aucun compte ni profil « Profil absent » ne subsiste', [(await sup(`select 1 from auth.users where email like '8195550605@%'`)).length, (await sup(`select 1 from utilisateurs where telephone = '8195550605'`)).length], [0, 0]);
  void nbAvant;
}

// Filet de sécurité : un profil qui n'est pas celui attendu annule tout
{
  const avantFiletSecurite = await nbUsers();
  const deps = fabriquerDeps({
    async authCreer(a) {   // simule un déclencheur défaillant : le compte naît administrateur
      const x = await sup('insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id', [a.email, JSON.stringify({ ...a.app_metadata, role: 'admin' })]);
      return { id: x[0].id };
    },
  });
  r = await appel(joe, { action: 'creer', nom: 'Louche', telephone: '8195550999', nip: nip('482915') }, { deps });
  eq('profil inattendu (administrateur au lieu d\'employé) : création ANNULÉE', [r.statut, r.json.erreur, await nbUsers()], [500, 'profil_incorrect', avantFiletSecurite]);
  r = await appel(joe, { action: 'creer', nom: 'Louche', telephone: '8195550998', nip: nip('482915') }, { deps: fabriquerDeps({ authCreer: async () => ({ erreur: 'echec' }) }) });
  eq('Auth qui échoue : 500 propre, rien de créé', [r.statut, r.json.erreur, await nbUsers()], [500, 'creation_echouee', avantFiletSecurite]);
}

// =====================================================================
log('\n=== DÉSACTIVER / RÉACTIVER ===');
// Un employé actif qui a un quart ouvert
const quartMarc = uuid();
await fn(employe, `quart_commencer($1::uuid, $2::timestamptz, null, null, null)`, [quartMarc, at(30)]);
eq('avant : Marc est actif et voit sa situation', (await commeRole('authenticated', employe, 'select public.est_actif() as r'))[0].r, true);
r = await appel(joe, { action: 'desactiver', id: employe });
eq('désactivation : 200', [r.statut, r.json.ok, r.json.employe.actif], [200, true, false]);
eq('la base : actif = false', (await profil(employe)).actif, false);
eq('la connexion est bloquée (ban)', bannis.has(employe), true);
eq('Marc n\'est plus « actif » pour la base (il ne voit plus rien)', (await commeRole('authenticated', employe, 'select public.est_actif() as r'))[0].r, false);
eq('… il ne voit plus aucun arrêt', (await commeRole('authenticated', employe, 'select count(*)::int n from public.stops'))[0].n, 0);
try { await fn(employe, `quart_terminer($1::uuid, null, null, null, null)`, [quartMarc]); fail('Marc désactivé ne peut plus punch', 'aurait dû échouer'); }
catch (e) { pass('Marc désactivé ne peut plus faire « Je termine »  [' + e.message.split('\n')[0].slice(0, 50) + ']'); }
eq('son historique est intact (le quart existe toujours)', (await q('select count(*)::int n from quarts where id = $1', [quartMarc]))[0].n, 1);
r = await appel(joe, { action: 'desactiver', id: employe });
eq('désactiver deux fois : sans erreur (idempotent)', [r.statut, (await profil(employe)).actif], [200, false]);
r = await appel(joe, { action: 'reactiver', id: employe });
eq('réactivation : 200', [r.statut, r.json.employe.actif], [200, true]);
eq('la base : actif = true et la connexion est débloquée', [(await profil(employe)).actif, bannis.has(employe)], [true, false]);
eq('Marc revoit ses arrêts', (await commeRole('authenticated', employe, 'select count(*)::int n from public.stops'))[0].n, 13);
r = await appel(joe, { action: 'reactiver', id: employe });
eq('réactiver deux fois : sans erreur', [r.statut, r.json.ok], [200, true]);

// Échec du blocage de connexion : la base est quand même à jour, et la réponse le dit
r = await appel(joe, { action: 'desactiver', id: nina }, { deps: fabriquerDeps({ authBloquer: async () => false }) });
eq('blocage impossible : erreur claire', [r.statut, r.json.erreur], [500, 'connexion_non_modifiee']);
eq('… mais la base est déjà « inactive » (côté sûr)', (await profil(nina)).actif, false);
r = await appel(joe, { action: 'desactiver', id: nina });
eq('… et refaire l\'action répare la situation', [r.statut, bannis.has(nina)], [200, true]);
r = await appel(joe, { action: 'reactiver', id: nina }, { deps: fabriquerDeps({ authBloquer: async () => false }) });
eq('déblocage impossible : erreur claire', [r.statut, r.json.erreur], [500, 'connexion_non_modifiee']);
r = await appel(joe, { action: 'reactiver', id: nina });
eq('… refaire l\'action répare aussi', [r.statut, (await profil(nina)).actif, bannis.has(nina)], [200, true, false]);

// Cibles interdites ou invalides
for (const action of ['desactiver', 'reactiver', 'supprimer', 'reinitialiser_nip']) {
  r = await appel(joe, { action, id: joe, nip: '482915' });
  eq(`${action} : Joé ne peut pas se cibler lui-même (compte administrateur)`, [r.statut, r.json.erreur], [403, 'compte_administrateur']);
  r = await appel(joe, { action, id: admin2, nip: '482915' });
  eq(`${action} : un autre compte administrateur non plus`, [r.statut, r.json.erreur], [403, 'compte_administrateur']);
  r = await appel(joe, { action, id: uuid(), nip: '482915' });
  eq(`${action} : employé inexistant → 404`, [r.statut, r.json.erreur], [404, 'employe_introuvable']);
  for (const mauvais of [undefined, null, '', 'pas-un-uuid', 12, "'; drop table utilisateurs; --", [joe]]) {
    r = await appel(joe, { action, id: mauvais, nip: '482915' });
    if (r.statut !== 400 || r.json.erreur !== 'requete_invalide') fail(`${action} : identifiant invalide ${JSON.stringify(mauvais)} → 400`, JSON.stringify(r.json));
  }
  pass(`${action} : 7 identifiants invalides → 400`);
}
eq('Joé n\'a pas été touché par ces tentatives', [(await profil(joe)).actif, (await profil(joe)).role, motsDePasse.has(joe), bannis.has(joe)], [true, 'admin', false, false]);
eq('l\'autre administrateur non plus', [(await profil(admin2)).actif, motsDePasse.has(admin2), bannis.has(admin2)], [false, false, false]);
r = await appel(joe, { action: 'desactiver', id: luc.toUpperCase() });
eq('un UUID en majuscules est accepté', [r.statut, (await profil(luc)).actif], [200, false]);
await appel(joe, { action: 'reactiver', id: luc });

// =====================================================================
log('\n=== SUPPRIMER (ou désactiver s\'il y a de l\'historique) ===');
// Employé sans aucun historique : supprimé pour vrai
r = await appel(joe, { action: 'supprimer', id: oscar });
eq('sans historique : supprimé', [r.statut, r.json.resultat, r.json.employe.nom], [200, 'supprime', 'Oscar']);
eq('… le compte Auth ET le profil n\'existent plus', [await compte(oscar), await profil(oscar)], [undefined, undefined]);
r = await appel(joe, { action: 'supprimer', id: oscar });
eq('supprimer deux fois : 404 (déjà parti)', [r.statut, r.json.erreur], [404, 'employe_introuvable']);
// Le numéro redevient disponible
r = await appel(joe, { action: 'creer', nom: 'Oscar revenu', telephone: '8195550203', nip: nip('135790') });
eq('le numéro d\'un employé supprimé peut être réutilisé', [r.statut, r.json.employe?.nom], [200, 'Oscar revenu']);
const oscar2 = r.json.employe?.id;

// Employés avec de l'historique, de chaque sorte
const hist = {};
const ajouterEmploye = async (nom, tel) => (await appel(joe, { action: 'creer', nom, telephone: tel, nip: nip('482915') })).json.employe.id;
const nord = (await q(`select id from routes where nom = 'Route Nord'`))[0].id;
const camion = (await q(`insert into equipes(nom) values ('Camion test') returning id`))[0].id;
const camion2 = (await q(`insert into equipes(nom) values ('Camion test 2') returning id`))[0].id;
const stops = (await q(`select id from stops where route_id = $1 order by id limit 3`, [nord])).map((x) => x.id);

hist.quart = await ajouterEmploye('Quinn quart', '8195550401');
await fn(hist.quart, `quart_commencer($1::uuid, $2::timestamptz, null, null, null)`, [uuid(), at(120)]);
await fn(hist.quart, `quart_terminer((select id from public.quarts where utilisateur_id = '${hist.quart}'), $1::timestamptz, null, null, null)`, [at(60)]);

hist.chauffeur = await ajouterEmploye('Charles chauffeur', '8195550402');
const passe = uuid();
await fn(hist.chauffeur, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real)`, [passe, nord, camion, at(50)]);
await fn(hist.chauffeur, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,'manuel',46.5::float8,-72.7::float8)`, [passe, stops[0], at(40)]);
await fn(hist.chauffeur, `envoyer_position($1::uuid, 46.51::float8, -72.71::float8, 5::real, $2::timestamptz)`, [passe, at(1)]);

hist.passager = await ajouterEmploye('Paul passager', '8195550403');
await fn(hist.chauffeur, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,null,null,false)`, [uuid(), passe, hist.passager, at(30)]);

hist.probleme = await ajouterEmploye('Priscilla problème', '8195550404');
await commeRole('authenticated', hist.probleme, `insert into public.problemes(stop_id, note) values ($1, 'chien méchant')`, [stops[1]]);

const propre = await ajouterEmploye('Nadia neuve', '8195550405');

const a = (id) => commeRole('service_role', '', 'select public._utilisateur_a_de_l_historique($1) as r', [id]).then((x) => x[0].r);
eq('historique détecté : un quart', await a(hist.quart), true);
eq('historique détecté : chauffeur (passe, arrêt complété, position)', await a(hist.chauffeur), true);
eq('historique détecté : passager d\'un équipage (période d\'équipage)', await a(hist.passager), true);
eq('historique détecté : un problème signalé', await a(hist.probleme), true);
eq('aucun historique : employé qui n\'a rien fait', await a(propre), false);
eq('aucun historique : UUID inconnu', await a(uuid()), false);

// Chaque table isolément (le chauffeur/passager ont plusieurs traces : on vérifie table par table)
for (const [table, colonne] of [['quarts', 'utilisateur_id'], ['passes', 'chauffeur_id'], ['passe_arrets', 'complete_par'], ['positions', 'chauffeur_id'],
  ['equipage_periodes', 'utilisateur_id'], ['problemes', 'utilisateur_id']]) {
  const qui = (await q(`select ${colonne} as u from ${table} where ${colonne} is not null limit 1`))[0]?.u;
  vrai(`la table « ${table} » (colonne ${colonne}) est comptée`, qui && (await a(qui)) === true, 'aucune ligne de test');
}

// Une table AJOUTÉE PLUS TARD est comptée automatiquement
await sup(`create table public.zz_future_table(ref uuid references public.utilisateurs(id))`);
const futur = await ajouterEmploye('Fabrice futur', '8195550406');
eq('nouvelle table (pas encore utilisée) : aucun historique', await a(futur), false);
await sup(`insert into public.zz_future_table(ref) values ($1)`, [futur]);
eq('nouvelle table (une ligne pour lui) : historique détecté SANS modifier la fonction', await a(futur), true);
await sup(`drop table public.zz_future_table`);

// Suppression avec historique : désactivation à la place
r = await appel(joe, { action: 'supprimer', id: hist.quart });
eq('avec historique : PAS supprimé, désactivé à la place', [r.statut, r.json.resultat, r.json.raison, r.json.employe.actif], [200, 'desactive', 'historique', false]);
eq('… le profil existe toujours, inactif, et la connexion est bloquée', [(await profil(hist.quart)).actif, bannis.has(hist.quart), (await compte(hist.quart)) !== undefined], [false, true, true]);
eq('… son historique est intact', (await q('select count(*)::int n from quarts where utilisateur_id = $1', [hist.quart]))[0].n, 1);
vrai('… la réponse explique pourquoi', /historique/.test(r.json.message));
for (const k of ['chauffeur', 'passager', 'probleme']) {
  r = await appel(joe, { action: 'supprimer', id: hist[k] });
  eq(`« ${k} » : désactivé au lieu de supprimé`, [r.json.resultat, (await profil(hist[k])) !== undefined], ['desactive', true]);
}
eq('la passe du chauffeur désactivé existe toujours', (await q('select count(*)::int n from passes where id = $1', [passe]))[0].n, 1);
r = await appel(joe, { action: 'supprimer', id: hist.chauffeur });
eq('supprimer un employé déjà désactivé qui a de l\'historique : reste désactivé, sans erreur', [r.statut, r.json.resultat], [200, 'desactive']);
r = await appel(joe, { action: 'supprimer', id: hist.quart }, { deps: fabriquerDeps({ authBloquer: async () => false }) });
eq('… si le blocage de connexion échoue : erreur claire', [r.statut, r.json.erreur], [500, 'connexion_non_modifiee']);

// Course : l'historique apparaît entre la vérification et la suppression → la clé étrangère protège
{
  const cobaye = await ajouterEmploye('Cobaye course', '8195550407');
  await fn(cobaye, `quart_commencer($1::uuid, $2::timestamptz, null, null, null)`, [uuid(), at(10)]);
  r = await appel(joe, { action: 'supprimer', id: cobaye }, { deps: fabriquerDeps({ aUnHistorique: async () => false }) });
  eq('la vérification se trompe : la base REFUSE quand même de supprimer', [r.statut, r.json.erreur], [500, 'suppression_echouee']);
  eq('… rien n\'a été supprimé (ni le compte, ni le profil, ni le quart)', [(await compte(cobaye)) !== undefined, (await profil(cobaye)) !== undefined,
    (await q('select count(*)::int n from quarts where utilisateur_id = $1', [cobaye]))[0].n], [true, true, 1]);
}

// =====================================================================
log('\n=== RÉINITIALISER LE NIP ===');
const ancien = motsDePasse.get(luc);
r = await appel(joe, { action: 'reinitialiser_nip', id: luc, nip: nip('975310') });
eq('NIP choisi : 200 et redonné', [r.statut, r.json.nip, r.json.nip_genere], [200, '975310', false]);
eq('le mot de passe du compte a changé', [ancien, motsDePasse.get(luc)], ['482915', '975310']);
eq('rien d\'autre n\'a changé sur le profil', [(await profil(luc)).nom, (await profil(luc)).role, (await profil(luc)).actif], ['Luc Tremblay', 'employe', true]);
r = await appel(joe, { action: 'reinitialiser_nip', id: luc });
vrai('sans NIP : un NIP tiré au hasard est renvoyé et appliqué', r.statut === 200 && r.json.nip_genere === true && /^[0-9]{6}$/.test(r.json.nip) && motsDePasse.get(luc) === r.json.nip);
NIPS_UTILISES.add(r.json.nip);
for (const [libelle, n, code] of [['trop court', '12345', 'nip_invalide'], ['lettres', 'abcdef', 'nip_invalide'], ['nombre', 975310, 'nip_invalide'], ['facile', '111111', 'nip_trop_facile']]) {
  const avantPw = motsDePasse.get(luc);
  r = await appel(joe, { action: 'reinitialiser_nip', id: luc, nip: n });
  eq(`NIP ${libelle} : refusé, mot de passe inchangé`, [r.statut, r.json.erreur, motsDePasse.get(luc) === avantPw], [400, code, true]);
}
r = await appel(joe, { action: 'reinitialiser_nip', id: inactif, nip: nip('975310') });
eq('on peut changer le NIP d\'un employé désactivé (il le recevra en le réactivant)', [r.statut, motsDePasse.get(inactif)], [200, '975310']);
r = await appel(joe, { action: 'reinitialiser_nip', id: luc, nip: nip('864209') }, { deps: fabriquerDeps({ authChangerMotDePasse: async () => false }) });
eq('Auth refuse le changement : erreur claire', [r.statut, r.json.erreur], [500, 'nip_non_change']);

// =====================================================================
log('\n=== ERREURS INATTENDUES ET JOURNAL ===');
r = await appel(joe, { action: 'reinitialiser_nip', id: luc, nip: nip('864209') }, { deps: fabriquerDeps({ profilParId: async () => { throw new Error('boum: 8195550201 / 864209'); } }) });
eq('exception interne : 500 générique', [r.statut, r.json.erreur], [500, 'erreur_interne']);
vrai('… le message de l\'exception (qui pourrait contenir un NIP) n\'est ni renvoyé ni journalisé', !JSON.stringify(r.json).includes('boum') && !journal.some((l) => l.includes('boum')));
{
  const avantPlantage = await nbUsers();
  r = await appel(joe, { action: 'creer', nom: 'Jamais', telephone: '8195550777', nip: nip('482915') }, { deps: fabriquerDeps({ estAdmin: async () => { throw new Error('réseau'); } }) });
  eq('la vérification d\'administrateur plante : erreur, jamais d\'accès par défaut', [r.statut, r.json.ok], [500, false]);
  eq('… et rien n\'a été créé', [await nbUsers(), (await sup(`select 1 from utilisateurs where telephone = '8195550777'`)).length], [avantPlantage, 0]);
}

const lignes = journal.join('\n');
vrai('le journal contient des lignes (une par appel)', journal.length > 40, String(journal.length));
const fuite = [...NIPS_UTILISES].filter((n) => lignes.includes(n));
eq('AUCUN NIP n\'apparaît dans le journal', fuite, []);
const fuiteTel = ['8195550201', '8195550202', '8195550401', 'Luc', 'Tremblay', 'Charles'].filter((s) => lignes.includes(s));
eq('aucun nom ni téléphone dans le journal', fuiteTel, []);
vrai('le journal note l\'action et le résultat', /creer -> ok/.test(lignes) && /supprimer -> ok/.test(lignes) && /refus non_autorise/.test(lignes));
r = await appel(joe, { action: 'desactiver\nFAUX -> ok', id: "x\ny" });
vrai('une action / un identifiant piégé ne peut pas fabriquer de fausses lignes de journal', !journal.some((l) => l.includes('FAUX')) && journal.every((l) => !l.includes('\n')));

// =====================================================================
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
