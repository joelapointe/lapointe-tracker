// Étape 13e — ESSAI SUR LA VRAIE BASE : problèmes signalés (plusieurs par arrêt, jamais effacés, panneau administrateur).
// Ne fait PAS partie de « npm test ».   node reel-etape-13e.mjs   (environ 1 minute)
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton ni NIP n'est affiché ;
//   • comptes d'essai « ZZTEST Prob A / B » (819 555 0191 et 0192) et véhicule « ZZTEST Camion 1 » ;
//   • les employés d'essai signalent ; l'administrateur LIT et marque UN problème « lu » (permis : le nettoyage l'accepte) ;
//   • travaille sur la route « Charette » (arrêts « TEST ») ; ne modifie AUCUN arrêt ;
//   • à la fin, le script attend : regarde l'application (arrêt orange, panneau ADMIN), puis Entrée ;
//   • ensuite : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour tout effacer.
import fs from 'fs';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';

// L'affichage est aussi gardé dans un fichier (dans le dossier temporaire) pour pouvoir le relire, et nettoyé des caractères de
// contrôle (un « retour chariot » dans un message du serveur fait écraser les lignes précédentes du terminal).
import os from 'os';
import path from 'path';
const FICHIER_SORTIE = path.join(os.tmpdir(), 'reel-13e-resultat.txt');
try { fs.writeFileSync(FICHIER_SORTIE, ''); } catch { /* pas grave */ }
const propre = (s) => String(s).split('').map((c) => { const k = c.charCodeAt(0); return (k < 32 && k !== 9 && k !== 10) || k === 127 ? ' ' : c; }).join('');
let ok = 0, ko = 0;
const log = (s) => { const t = propre(s); console.log(t); try { fs.appendFileSync(FICHIER_SORTIE, t + '\n'); } catch { /* pas grave */ } };
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));

async function http(methode, chemin, { jeton, corps, entetes } = {}) {
  const h = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE), ...entetes };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: h, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}
const edge = (jeton, corps) => http('POST', '/functions/v1/admin-employes', { jeton, corps });
const rpc = (jeton, nom, args = {}) => http('POST', '/rest/v1/rpc/' + nom, { jeton, corps: args });
const lire = (jeton, chemin) => http('GET', '/rest/v1/' + chemin, { jeton });
const ecrire = (jeton, methode, chemin, corps, retour = true) => http(methode, '/rest/v1/' + chemin, { jeton, corps, entetes: retour ? { Prefer: 'return=representation' } : {} });
const detail = (r) => `HTTP ${r.statut}${r.json?.message ? ' ' + String(r.json.message).slice(0, 90) : r.json?.erreur ? ' ' + r.json.erreur : ''}`;
const refuse = (r) => r.statut >= 400;
async function connexion(courriel, motDePasse) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: motDePasse } });
  return r.statut === 200 && r.json?.access_token ? r.json.access_token : null;
}
async function lireSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) { console.log('\n(Ce script doit être lancé dans un terminal.)'); process.exit(2); }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let s = '';
    const surDonnees = (c) => {
      for (const ch of c) {
        if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', surDonnees); process.stdout.write('\n'); return resolve(s); }
        if (ch === String.fromCharCode(3)) process.exit(130);
        if (ch === String.fromCharCode(127) || ch === String.fromCharCode(8)) s = s.slice(0, -1); else s += ch;
      }
    };
    stdin.on('data', surDonnees);
  });
}
function arret(raison) {
  log('\n>>> ARRÊT : ' + raison);
  log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués (arrêt anticipé) =====`);
  log('N\'oublie pas d\'exécuter 10-nettoyage-comptes-zztest.sql dans Supabase pour effacer les comptes et passes d\'essai.');
  process.exit(1);
}

// =====================================================================
log(`Projet : ${URL_PROJET}`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courrielAdmin = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();   // fermée AVANT la saisie masquée du mot de passe
const A0 = await connexion(courrielAdmin, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : '));
if (!A0) arret('connexion de l\'administrateur impossible');
const admins = (await rpc(A0, 'admin_lister_utilisateurs')).json ?? [];
if (admins.some((u) => (u.nom ?? '').startsWith('ZZTEST'))) arret('restes d\'un essai précédent : exécute d\'abord 10-nettoyage-comptes-zztest.sql');

if (((await lire(A0, 'passes?select=id')).json ?? []).length) arret('la base contient déjà des passes : cet essai suppose 0');
if (((await lire(A0, 'problemes?select=id')).json ?? []).length) arret('la base contient déjà des problèmes : cet essai suppose 0');
pass('connexion de l\'administrateur, aucun reste d\'essai, aucune passe ni problème dans la base');

// ----- Données réelles -----
const charette = ((await lire(A0, 'routes?select=id,nom,actif')).json ?? []).find((r) => r.nom === 'Charette' && r.actif);
if (!charette) arret('route « Charette » introuvable');
const arrets = (await lire(A0, `stops?select=id,client,service,adresse&route_id=eq.${charette.id}&actif=eq.true`)).json ?? [];
const T1 = arrets.find((a) => a.client === 'TEST 1'), T3 = arrets.find((a) => a.client === 'TEST 3');
if (!T1 || !T3) arret('les arrêts « TEST 1 » et « TEST 3 » de Charette sont introuvables');
const idAdmin = ((await http('GET', '/auth/v1/user', { jeton: A0 })).json ?? {}).id;

const cam = await ecrire(A0, 'POST', 'equipes', { nom: 'ZZTEST Camion 1' });
if (cam.statut !== 201) arret(`création du véhicule d'essai impossible (${detail(cam)})`);
const employes = {};
async function nouvelEmploye(cle, nom, tel) {
  const r = await edge(A0, { action: 'creer', nom, telephone: tel });
  if (r.statut !== 200) arret(`création de ${nom} impossible (${detail(r)})`);
  const jeton = await connexion(`${tel}@${DOMAINE}`, r.json.nip);
  if (!jeton) arret(`connexion de ${nom} impossible`);
  employes[cle] = { id: r.json.employe.id, jeton };
}
await nouvelEmploye('A', 'ZZTEST Prob A', '8195550191');
await nouvelEmploye('B', 'ZZTEST Prob B', '8195550192');
const { A, B } = employes;
const dp = await rpc(A.jeton, 'debuter_passe', { p_id: crypto.randomUUID(), p_route_id: charette.id, p_equipe_id: cam.json[0].id, p_equipage: [], p_lat: 46.44, p_lon: -72.92, p_tache: T1.service });
if (dp.statut !== 200) arret(`A n'a pas pu démarrer sa passe (${detail(dp)})`);
const pA = dp.json.passe_id;
pass('1 véhicule et 2 employés d\'essai créés ; A (chauffeur) a démarré une passe ; B n\'est dans aucun camion');

// =====================================================================
log('\n=== 1. SIGNALER : comme le fait maintenant l\'application ===');
{
  let r = await ecrire(A.jeton, 'POST', 'problemes', { stop_id: T1.id, passe_id: pA, note: 'ZZTEST barrière fermée' }, false);
  eq('A signale un problème (sans « lu », sans nom, avec sa passe) : accepté', r.statut, 201);
  r = await ecrire(A.jeton, 'POST', 'problemes', { stop_id: T1.id, passe_id: pA, note: 'ZZTEST chien méchant' }, false);
  eq('A en signale un DEUXIÈME sur le même arrêt : accepté', r.statut, 201);
  r = await ecrire(B.jeton, 'POST', 'problemes', { stop_id: T3.id, passe_id: null, note: 'ZZTEST <b>note piégée</b>' }, false);
  eq('B (dans aucun camion) signale sans passe : accepté', r.statut, 201);
  const tout = ((await lire(A0, 'problemes?select=id,stop_id,passe_id,utilisateur_id,lu,note&order=cree_le.asc')).json ?? []);
  eq('3 problèmes en base ; le nom de l\'auteur est mis par la base (A, A, B) ; tous non lus', [tout.length, tout.map((p) => p.utilisateur_id), tout.every((p) => p.lu === false)], [3, [A.id, A.id, B.id], true]);
  eq('les deux premiers sont rattachés à la passe de A, le 3e à aucune', tout.map((p) => p.passe_id), [pA, pA, null]);
}

log('\n=== 2. CE QUI EST INTERDIT (l\'ancienne façon de faire, et les triches) ===');
{
  let r = await ecrire(A.jeton, 'POST', 'problemes', { stop_id: T1.id, note: 'ZZTEST ancien', lu: false }, false);
  vrai('l\'ANCIENNE application envoyait « lu » : la base le REFUSE (c\'était la cause de « signaler ne marche plus »)', refuse(r), detail(r));
  r = await ecrire(A.jeton, 'POST', 'problemes', { stop_id: T1.id, note: 'ZZTEST au nom de B', utilisateur_id: B.id }, false);
  vrai('signaler AU NOM d\'un autre : refusé', refuse(r), detail(r));
  r = await ecrire(A.jeton, 'POST', 'problemes', { stop_id: T1.id, note: '   ' }, false);
  vrai('une note vide : refusée', refuse(r), detail(r));
  r = await ecrire(null, 'POST', 'problemes', { stop_id: T1.id, note: 'ZZTEST visiteur' }, false);
  vrai('un visiteur sans connexion ne peut rien signaler', refuse(r), detail(r));
  r = await ecrire(A.jeton, 'DELETE', 'problemes?note=like.ZZTEST*');
  const restants = ((await lire(A0, 'problemes?select=id')).json ?? []).length;
  vrai('un employé ne peut EFFACER aucun problème (l\'ancien code essayait, en silence)', (refuse(r) || (Array.isArray(r.json) && r.json.length === 0)) && restants === 3, `${detail(r)} ; restants=${restants}`);
  r = await ecrire(B.jeton, 'PATCH', `problemes?stop_id=eq.${T1.id}`, { lu: true, lu_par: B.id });
  vrai('un employé ne peut pas marquer « lu » (seul l\'administrateur)', refuse(r) || (Array.isArray(r.json) && r.json.length === 0), detail(r));
  eq('… rien n\'a changé : 3 problèmes, tous non lus', ((await lire(A0, 'problemes?select=lu')).json ?? []).map((p) => p.lu), [false, false, false]);
}

log('\n=== 3. CE QUE VOIT UN EMPLOYÉ (la même lecture que l\'application) ===');
{
  const r = await lire(B.jeton, 'problemes?select=id,stop_id,passe_id,utilisateur_id,note,cree_le&lu=eq.false&order=cree_le.asc');
  eq('B voit les 3 problèmes non lus, du plus ancien au plus récent (les siens ET ceux de A)', [r.statut, (r.json ?? []).map((p) => p.note)], [200, ['ZZTEST barrière fermée', 'ZZTEST chien méchant', 'ZZTEST <b>note piégée</b>']]);
  const dansT1 = (r.json ?? []).filter((p) => p.stop_id === T1.id).length;
  eq('… dont DEUX sur TEST 1 (plusieurs problèmes sur un même arrêt)', dansT1, 2);
  const nom = await lire(B.jeton, 'problemes?select=id,utilisateurs!utilisateur_id(nom)&lu=eq.false');
  vrai('B peut lire le NOM de son collègue A par le lien (voulu, étape 8 : les noms sont visibles par les employés actifs)', nom.statut === 200 && JSON.stringify(nom.json).includes('ZZTEST Prob A'), JSON.stringify(nom.json));
  const tel = await lire(B.jeton, 'utilisateurs?select=telephone');
  vrai('… mais PAS le téléphone : cette colonne est interdite aux employés', refuse(tel), detail(tel));
}

log('\n=== 4. LE PANNEAU ADMINISTRATEUR : la lecture exacte du panneau ===');
let idPremier;
{
  const q = 'problemes?select=id,note,cree_le,stops(adresse,service,client),utilisateurs!utilisateur_id(nom),passes(numero,tache)&lu=eq.false&order=cree_le.desc';
  const r = await lire(A0, q);
  eq('la lecture du panneau réussit (HTTP 200) avec les 3 problèmes, le plus récent d\'abord', [r.statut, (r.json ?? []).length], [200, 3]);
  const p = (r.json ?? []).find((x) => x.note === 'ZZTEST barrière fermée');
  vrai('… le premier : arrêt, auteur (nom lisible par l\'administrateur), passe n° 1', p?.stops?.adresse === T1.adresse && p?.utilisateurs?.nom === 'ZZTEST Prob A' && p?.passes?.numero === 1 && p?.passes?.tache === T1.service, JSON.stringify(p));
  const s = (r.json ?? []).find((x) => x.note.includes('piégée'));
  eq('… le problème sans passe : passe vide, auteur B', [s?.passes, s?.utilisateurs?.nom], [null, 'ZZTEST Prob B']);
  const ambigu = await lire(A0, 'problemes?select=id,utilisateurs(nom)');
  vrai('l\'ancienne forme « utilisateurs(nom) » sans précision est AMBIGUË pour la base (auteur et lu_par) : elle ne donne PAS de résultat (HTTP 300)', ambigu.statut !== 200, detail(ambigu));
  const ancien = await lire(A0, 'problemes?select=id&order=created_at.desc');
  vrai('l\'ancien tri sur « created_at » échoue (la colonne s\'appelle cree_le) : c\'était la cause du panneau vide', refuse(ancien), detail(ancien));
  idPremier = p?.id;
}

log('\n=== 5. « MARQUER COMME LU » : rien n\'est effacé ===');
{
  const maintenant = new Date().toISOString();
  let r = await ecrire(A0, 'PATCH', `problemes?id=eq.${idPremier}`, { lu: true, lu_par: idAdmin, lu_le: maintenant });
  eq('l\'administrateur marque le 1er « lu » (1 ligne changée)', [r.statut, (r.json ?? []).length], [200, 1]);
  const une = ((await lire(A0, `problemes?select=id,lu,lu_par,lu_le,note&id=eq.${idPremier}`)).json ?? [])[0];
  eq('… il reste en base, avec QUI l\'a lu et QUAND', [une?.lu, une?.lu_par === idAdmin, !!une?.lu_le], [true, true, true]);
  const nonLusAdmin = ((await lire(A0, 'problemes?select=note&lu=eq.false&order=cree_le.asc')).json ?? []).map((p) => p.note);
  eq('le panneau n\'en montre plus que 2', nonLusAdmin, ['ZZTEST chien méchant', 'ZZTEST <b>note piégée</b>']);
  const nonLusB = ((await lire(B.jeton, 'problemes?select=note&lu=eq.false')).json ?? []).map((p) => p.note).sort();
  eq('un employé non plus (le problème lu disparaît de l\'écran de tout le monde)', nonLusB, ['ZZTEST <b>note piégée</b>', 'ZZTEST chien méchant']);
  eq('… mais le total en base est toujours de 3', ((await lire(A0, 'problemes?select=id')).json ?? []).length, 3);
}

// =====================================================================
log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
if (ko) { log('Des vérifications ont échoué. Exécute 10-nettoyage-comptes-zztest.sql.'); process.exit(1); }
log('\n>>> MAINTENANT, REGARDE L\'APPLICATION :');
log('    1. Ouvre http://localhost:8123 dans ton navigateur et connecte-toi avec TON compte (administrateur).');
log('    2. TEST 1 (Charette) doit être ORANGE ; sa fiche dit « 1 problème signalé : chien méchant » (le 1er a été marqué lu).');
log('       TEST 3 est orange aussi (la note piégée doit s\'afficher comme du TEXTE, sans effet).');
log('    3. Touche ADMIN (en bas à droite) : « Problèmes signalés (2) », avec le nom ZZTEST Prob A / B, la date et « Passe n° 1 ».');
log('       Essaie « Marquer comme lu » sur l\'un des deux : il disparaît et l\'arrêt redevient jaune.');
log('    Appuie sur ENTRÉE ici quand tu as fini de regarder.\n');
const rlFin = readline.createInterface({ input: process.stdin, output: process.stdout });
await rlFin.question('');
rlFin.close();
log('\nTerminé. MAINTENANT : exécute 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes, véhicules, passes et problèmes d\'essai.');
process.exit(0);
