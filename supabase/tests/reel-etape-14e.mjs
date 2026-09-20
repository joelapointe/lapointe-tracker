// Étape 14e — ESSAI SUR LA VRAIE BASE ET LE VRAI STOCKAGE : une photo par problème signalé.
// Ne fait PAS partie de « npm test ».   node reel-etape-14e.mjs   (environ 1 minute, puis il attend que tu aies regardé l'application)
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton n'est affiché ;
//   • comptes d'essai « ZZTEST Eq A / B / D » (819 555 0191, 0192 et 0194) ;
//   • SEULS ces comptes font des gestes (l'administrateur crée les comptes, marque « lu » et supprime les photos d'essai) ;
//   • SEUL le NIP du compte « ZZTEST Eq D » (celui que TU utilises dans l'application) est affiché, dans ce terminal seulement
//     (pas dans le fichier de résultat) : c'est un compte d'essai jetable, effacé par le nettoyage ;
//   • à la fin, le script SUPPRIME lui-même les photos d'essai du stockage (par l'administrateur, comme le fera l'application) ;
//   • l'affichage est aussi gardé dans %TEMP%\reel-14e-resultat.txt ;
//   • ensuite : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer comptes et problèmes d'essai.
// PRÉREQUIS : le fichier 16 (16-etape14e-photo-probleme.sql) doit avoir été exécuté sur la vraie base.
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';
const BUCKET = 'photos-problemes';

const FICHIER_SORTIE = path.join(os.tmpdir(), 'reel-14e-resultat.txt');
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
const detail = (r) => `HTTP ${r.statut}${r.json?.message ? ' ' + String(r.json.message).slice(0, 90) : r.json?.erreur ? ' ' + r.json.erreur : r.json?.error ? ' ' + String(r.json.error).slice(0, 60) : ''}`;
const refuse = (r) => r.statut >= 400;
const refuseAvec = (r, motif) => r.statut >= 400 && String(r.json?.message ?? '').includes(motif);
async function connexion(courriel, motDePasse) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: motDePasse } });
  return r.statut === 200 && r.json?.access_token ? r.json.access_token : null;
}
const idDuJeton = (jeton) => JSON.parse(Buffer.from(jeton.split('.')[1], 'base64url').toString()).sub;

// Le stockage de fichiers (Storage) : envoyer des octets, demander un lien signé, le lire, lire l'adresse publique, supprimer, lister
async function stockage(methode, chemin, { jeton, octets, type, upsert, corps } = {}) {
  const h = { apikey: CLE_PUBLIQUE, Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE) };
  if (type) h['Content-Type'] = type; else if (corps !== undefined) h['Content-Type'] = 'application/json';
  if (upsert !== undefined) h['x-upsert'] = String(upsert);
  let r;
  try { r = await fetch(URL_PROJET + '/storage/v1' + chemin, { method: methode, headers: h, body: octets ?? (corps === undefined ? undefined : JSON.stringify(corps)) }); }
  catch { return { statut: 0, json: null, octets: null }; }
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch { /* pas du JSON : ce sont des octets */ }
  return { statut: r.status, json, octets: buf };
}
const envoyer = (jeton, chemin, octets, o = {}) => stockage('POST', `/object/${BUCKET}/${chemin}`, { jeton, octets, type: o.type ?? 'image/jpeg', upsert: o.upsert ?? false });
const signer = (jeton, chemin) => stockage('POST', `/object/sign/${BUCKET}/${chemin}`, { jeton, corps: { expiresIn: 3600 } });
const lireSigne = async (jeton, chemin) => {
  const s = await signer(jeton, chemin);
  if (s.statut !== 200 || !s.json?.signedURL) return { statut: s.statut, octets: null };
  const r = await fetch(URL_PROJET + '/storage/v1' + s.json.signedURL);
  return { statut: r.status, octets: Buffer.from(await r.arrayBuffer()) };
};
const supprimer = (jeton, chemins) => stockage('DELETE', `/object/${BUCKET}`, { jeton, corps: { prefixes: chemins } });
const lister = (jeton, dossier) => stockage('POST', `/object/list/${BUCKET}`, { jeton, corps: { prefix: dossier, limit: 100, offset: 0 } });

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
  log('N\'oublie pas d\'exécuter 10-nettoyage-comptes-zztest.sql dans Supabase pour effacer les comptes et problèmes d\'essai.');
  process.exit(1);
}

// =====================================================================
log(`Projet : ${URL_PROJET}`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courrielAdmin = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();   // fermée AVANT la saisie masquée du mot de passe
const A0 = await connexion(courrielAdmin, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : '));
if (!A0) arret('connexion de l\'administrateur impossible');
const idAdmin = idDuJeton(A0);
const admins = (await rpc(A0, 'admin_lister_utilisateurs')).json ?? [];
if (admins.some((u) => (u.nom ?? '').startsWith('ZZTEST'))) arret('restes d\'un essai précédent : exécute d\'abord 10-nettoyage-comptes-zztest.sql');
if (((await lire(A0, 'problemes?select=id')).json ?? []).length) arret('la base contient déjà des problèmes : cet essai suppose 0');
pass('connexion de l\'administrateur, aucun reste d\'essai, aucun problème dans la base');

const charette = ((await lire(A0, 'routes?select=id,nom,actif')).json ?? []).find((r) => r.nom === 'Charette' && r.actif);
if (!charette) arret('route « Charette » introuvable');
const arrets = (await lire(A0, `stops?select=id,client&route_id=eq.${charette.id}&actif=eq.true&order=ordre`)).json ?? [];
const T1 = arrets.find((a) => a.client === 'TEST 1') ?? arrets[0];
if (!T1) arret('aucun arrêt sur Charette');

const employes = {};
let nipD = null;
async function nouvelEmploye(cle, nom, tel) {
  const r = await edge(A0, { action: 'creer', nom, telephone: tel });
  if (r.statut !== 200) arret(`création de ${nom} impossible (${detail(r)})`);
  const jeton = await connexion(`${tel}@${DOMAINE}`, r.json.nip);
  if (!jeton) arret(`connexion de ${nom} impossible`);
  employes[cle] = { id: r.json.employe.id, jeton };
  if (cle === 'D') nipD = r.json.nip;   // le SEUL NIP montré (compte d'essai jetable), et seulement à l'écran
}
await nouvelEmploye('A', 'ZZTEST Eq A', '8195550191');
await nouvelEmploye('B', 'ZZTEST Eq B', '8195550192');
await nouvelEmploye('D', 'ZZTEST Eq D', '8195550194');
const { A, B, D } = employes;
pass('3 employés d\'essai créés (A = auteur d\'un problème, B = un collègue, D = ton compte d\'essai pour regarder l\'application)');

// Des « photos » d'essai : des octets avec l'en-tête d'un JPEG (le stockage vérifie le type annoncé, la taille et les règles d'accès)
const photo = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(n)]);
const nouveauProbleme = async (E, note) => {
  const id = crypto.randomUUID();
  const r = await ecrire(E.jeton, 'POST', 'problemes', { id, stop_id: T1.id, note }, false);
  if (r.statut !== 201) arret(`le problème « ${note} » n'a pas pu être signalé (${detail(r)})`);
  return id;
};
const chemin = (E, id) => `${E.id}/${id}.jpg`;
const P1 = await nouveauProbleme(A, 'ZZTEST photo 1'), P2 = await nouveauProbleme(A, 'ZZTEST photo 2 (refus)'), PB = await nouveauProbleme(B, 'ZZTEST problème de B');
const octetsP1 = photo(30000);
const aEffacer = [];   // toutes les photos d'essai envoyées : supprimées à la fin

// =====================================================================
log('\n=== 1. LE VISITEUR N\'A AUCUN ACCÈS ===');
{
  let r = await envoyer(null, chemin(A, P2), photo(500));
  vrai('un visiteur (sans connexion) ne peut pas envoyer de photo', refuse(r), detail(r));
  r = await stockage('GET', `/object/public/${BUCKET}/${chemin(A, P1)}`);
  vrai('l\'adresse PUBLIQUE d\'une photo ne marche pas : l\'espace est bien privé', refuse(r), detail(r));
  r = await signer(null, chemin(A, P1));
  vrai('un visiteur ne peut pas demander de lien signé', refuse(r), detail(r));
  r = await rpc(null, 'probleme_attacher_photo', { p_probleme_id: P1 });
  vrai('un visiteur ne peut pas appeler probleme_attacher_photo', refuse(r), detail(r));
}

log('\n=== 2. ENVOYER UNE PHOTO : SON DOSSIER, SON PROBLÈME, LE CHEMIN EXACT, JPEG, MOINS DE 2 Mo ===');
{
  let r = await envoyer(A.jeton, chemin(A, P1), octetsP1);
  vrai('A envoie la photo de SON problème au chemin exact : acceptée', r.statut === 200, detail(r));
  if (r.statut === 200) aEffacer.push(chemin(A, P1));
  r = await envoyer(A.jeton, chemin(A, P1), photo(500));
  vrai('la même photo une 2e fois : refusée (elle existe déjà)', refuse(r), detail(r));
  r = await envoyer(A.jeton, chemin(A, P1), photo(500), { upsert: true });
  vrai('… même en demandant de la REMPLACER (upsert) : refusé, personne ne peut remplacer une photo', refuse(r), detail(r));
  r = await envoyer(A.jeton, chemin(A, P2), photo(500), { type: 'image/png' });
  vrai('un autre format que JPEG (PNG) : refusé', refuse(r), detail(r));
  r = await envoyer(A.jeton, chemin(A, P2), Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2200000, 1)]));
  vrai('une photo de plus de 2 Mo : refusée', refuse(r), detail(r));
  r = await envoyer(A.jeton, `${B.id}/${P2}.jpg`, photo(500));
  vrai('A envoie dans le dossier de B : refusé', refuse(r), detail(r));
  r = await envoyer(B.jeton, `${B.id}/${P2}.jpg`, photo(500));
  vrai('B envoie une photo pour un problème qui est à A (dans son propre dossier) : refusé', refuse(r), detail(r));
  r = await envoyer(A.jeton, `${A.id}/photo.jpg`, photo(500));
  vrai('un nom quelconque (« photo.jpg ») : refusé', refuse(r), detail(r));
  r = await envoyer(A.jeton, `${A.id}/${crypto.randomUUID()}.jpg`, photo(500));
  vrai('un problème qui n\'existe pas : refusé', refuse(r), detail(r));
  r = await envoyer(A.jeton, `${A.id}/${P2}.png`, photo(500));
  vrai('une mauvaise extension (.png) : refusé', refuse(r), detail(r));
  r = await envoyer(B.jeton, chemin(B, PB), photo(20000));
  vrai('B envoie la photo de SON propre problème : acceptée', r.statut === 200, detail(r));
  if (r.statut === 200) aEffacer.push(chemin(B, PB));
}

log('\n=== 3. RELIER LA PHOTO AU PROBLÈME (probleme_attacher_photo) ===');
{
  let r = await signer(A.jeton, chemin(A, P1));
  vrai('AVANT d\'être reliée, la photo est invisible, même pour son auteur', refuse(r), detail(r));
  r = await signer(A0, chemin(A, P1));
  vrai('… et pour l\'administrateur', refuse(r), detail(r));
  r = await rpc(B.jeton, 'probleme_attacher_photo', { p_probleme_id: P1 });
  vrai('B ne peut pas relier une photo au problème de A', refuseAvec(r, 'non_autorise'), detail(r));
  r = await rpc(A.jeton, 'probleme_attacher_photo', { p_probleme_id: P2 });
  vrai('A ne peut pas relier un problème dont la photo n\'est pas arrivée (« photo_introuvable »)', refuseAvec(r, 'photo_introuvable'), detail(r));
  r = await rpc(A.jeton, 'probleme_attacher_photo', { p_probleme_id: crypto.randomUUID() });
  vrai('un problème qui n\'existe pas : « probleme_introuvable »', refuseAvec(r, 'probleme_introuvable'), detail(r));
  r = await rpc(A.jeton, 'probleme_attacher_photo', { p_probleme_id: P1 });
  eq('A relie la photo à SON problème', [r.statut, r.json?.statut, r.json?.chemin], [200, 'attachee', chemin(A, P1)]);
  r = await rpc(A.jeton, 'probleme_attacher_photo', { p_probleme_id: P1 });
  eq('geste renvoyé : « déjà reliée »', [r.statut, r.json?.statut], [200, 'deja_attachee']);
  r = await rpc(B.jeton, 'probleme_attacher_photo', { p_probleme_id: PB });
  eq('B relie la photo de son propre problème', [r.statut, r.json?.statut], [200, 'attachee']);
  r = await ecrire(A.jeton, 'PATCH', `problemes?id=eq.${P2}`, { photo_chemin: chemin(A, P2) });
  vrai('un employé ne peut pas écrire photo_chemin lui-même (aucun droit sur cette colonne)', refuse(r), detail(r));
  const vu = (await lire(B.jeton, `problemes?select=id,photo_chemin&id=eq.${P1}`)).json ?? [];
  eq('le collègue B lit le problème de A avec le chemin de la photo', vu.map((x) => x.photo_chemin), [chemin(A, P1)]);
}

log('\n=== 4. QUI PEUT VOIR LA PHOTO : COMME LE PROBLÈME (liens temporaires signés) ===');
{
  const okLecture = async (nom, E) => {
    const r = await lireSigne(E.jeton, chemin(A, P1));
    vrai(`${nom} obtient un lien signé et la photo est IDENTIQUE à celle envoyée (${octetsP1.length} octets)`, r.statut === 200 && r.octets && Buffer.compare(r.octets, octetsP1) === 0, `HTTP ${r.statut}, ${r.octets?.length} octets`);
  };
  await okLecture('A (l\'auteur)', A);
  await okLecture('B (un collègue, problème non lu)', B);
  await okLecture('D (un autre employé)', D);
  await okLecture('l\'administrateur', { jeton: A0 });
  let r = await stockage('GET', `/object/public/${BUCKET}/${chemin(A, P1)}`);
  vrai('l\'adresse publique ne marche toujours pas', refuse(r), detail(r));
  r = await signer(B.jeton, chemin(A, P2));
  vrai('la photo d\'un problème qui n\'a pas de photo reliée (P2) : introuvable', refuse(r), detail(r));
  r = await ecrire(A0, 'PATCH', `problemes?id=eq.${P1}`, { lu: true, lu_par: idAdmin, lu_le: new Date().toISOString() });
  vrai('l\'administrateur marque le problème de A comme « lu »', r.statut < 300, detail(r));
  const rB = await signer(B.jeton, chemin(A, P1));
  vrai('problème « lu » : sa photo disparaît pour le collègue B (comme le problème lui-même)', refuse(rB), detail(rB));
  const rA = await lireSigne(A.jeton, chemin(A, P1));
  vrai('… mais A (l\'auteur) la voit toujours', rA.statut === 200 && Buffer.compare(rA.octets, octetsP1) === 0, `HTTP ${rA.statut}`);
  const rAd = await lireSigne(A0, chemin(A, P1));
  vrai('… et l\'administrateur aussi', rAd.statut === 200, `HTTP ${rAd.statut}`);
}

log('\n=== 5. PERSONNE NE REMPLACE NI NE SUPPRIME UNE PHOTO, SAUF L\'ADMINISTRATEUR ===');
{
  await supprimer(A.jeton, [chemin(A, P1)]);
  let r = await lireSigne(A.jeton, chemin(A, P1));
  vrai('A essaie de supprimer sa propre photo : elle est toujours là', r.statut === 200, `HTTP ${r.statut}`);
  await supprimer(B.jeton, [chemin(B, PB)]);
  r = await lireSigne(B.jeton, chemin(B, PB));
  vrai('B essaie de supprimer sa propre photo : elle est toujours là', r.statut === 200, `HTTP ${r.statut}`);
  r = await envoyer(A.jeton, chemin(A, P1), photo(500), { upsert: true });
  vrai('remplacer la photo (upsert) : refusé', refuse(r), detail(r));
  r = await lireSigne(A.jeton, chemin(A, P1));
  vrai('… la photo d\'origine n\'a pas changé', r.statut === 200 && Buffer.compare(r.octets, octetsP1) === 0);
  await supprimer(A0, [chemin(A, P1)]);
  r = await lireSigne(A0, chemin(A, P1));
  vrai('l\'administrateur supprime la photo : elle n\'existe plus', refuse(r) || r.octets === null, `HTTP ${r.statut}`);
  const pr = (await lire(A0, `problemes?select=id&id=eq.${P1}`)).json ?? [];
  eq('le PROBLÈME, lui, est conservé (jamais effacé)', pr.length, 1);
}

// =====================================================================
log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
async function nettoyerPhotos() {
  let restantes = 0;
  for (const E of [A, B, D]) {
    const l = await lister(A0, E.id);
    const noms = Array.isArray(l.json) ? l.json.map((x) => `${E.id}/${x.name}`) : [];
    if (noms.length) { await supprimer(A0, noms); restantes += noms.length; }
  }
  return restantes;
}
if (ko) {
  const n = await nettoyerPhotos();
  log(`Des vérifications ont échoué. ${n} photo(s) d'essai supprimée(s) du stockage. Exécute 10-nettoyage-comptes-zztest.sql.`);
  process.exit(1);
}
log('\n>>> MAINTENANT, REGARDE L\'APPLICATION avec une vraie photo de ton ordinateur (le serveur est prêt).');
console.log('\n    Compte d\'essai à utiliser dans l\'application :');
console.log('        numéro : 819 555 0194');
console.log(`        NIP    : ${nipD}     (compte jetable « ZZTEST Eq D », effacé par le nettoyage)`);
log('\n    1. Ouvre http://localhost:8123 (Ctrl+F5) et connecte-toi avec CE compte d\'essai (pas le tien).');
log('    2. Touche un client (ex. « TEST 2 »), puis « ⚠ Problème ». Écris une note.');
log('    3. Touche « 📷 Ajouter une photo » : ton navigateur ouvre une fenêtre pour choisir une image de ton ordinateur (sur un téléphone, ce serait l\'appareil photo).');
log('       Choisis une vraie photo : un aperçu s\'affiche avec sa taille réduite (quelques centaines de Ko au plus). Touche « Envoyer ».');
log('    4. Sur la fiche du client : la miniature de la photo. Touche-la : la photo s\'affiche en grand (✕ pour fermer).');
log('    5. Signale un 2e problème SANS photo, puis sur la fiche touche « 📷 Ajouter une photo » : la photo s\'ajoute après coup.');
log('    6. Avec TON compte administrateur (autre fenêtre) : bouton ADMIN → tu vois le problème avec sa photo ; « Marquer comme lu » le fait disparaître.');
log('    Appuie sur ENTRÉE ici quand tu as fini : le script supprime lui-même les photos d\'essai du stockage.\n');
const rlFin = readline.createInterface({ input: process.stdin, output: process.stdout });
await rlFin.question('');
rlFin.close();
const n = await nettoyerPhotos();
log(`\nEssai terminé. ${n} photo(s) d'essai supprimée(s) du stockage par l'administrateur.`);
log('MAINTENANT : exécute 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes et les problèmes d\'essai.');
process.exit(0);
