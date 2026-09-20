// Étape 15 — ESSAI SUR LA VRAIE BASE : l'équipage (précédent, au départ, pendant la passe : avertissements, transferts, retraits).
// Ne fait PAS partie de « npm test ».   node reel-etape-15.mjs   (environ 1 minute, puis il attend que tu aies regardé l'application)
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton n'est affiché ;
//   • comptes d'essai « ZZTEST Eq A à G » (819 555 0191 à 0197), véhicules « ZZTEST Camion 1 / 2 / 3 » ;
//   • SEULS ces comptes font des gestes (l'administrateur crée les comptes et lit), sinon le nettoyage refuserait de tout effacer ;
//   • SEUL le NIP du compte « ZZTEST Eq D » (celui que TU utilises dans l'application) est affiché, dans ce terminal seulement
//     (pas dans le fichier de résultat) : c'est un compte d'essai jetable, effacé par le nettoyage ;
//   • l'affichage est aussi gardé dans %TEMP%\reel-15-resultat.txt ;
//   • ensuite : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour tout effacer.
// PRÉREQUIS : le fichier 17 (17-etape15-equipage-precedent.sql) doit avoir été exécuté sur la vraie base.
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';

const FICHIER_SORTIE = path.join(os.tmpdir(), 'reel-15-resultat.txt');
try { fs.writeFileSync(FICHIER_SORTIE, ''); } catch { /* pas grave */ }
const propre = (s) => String(s).split('').map((c) => { const k = c.charCodeAt(0); return (k < 32 && k !== 9 && k !== 10) || k === 127 ? ' ' : c; }).join('');
let ok = 0, ko = 0;
const log = (s) => { const t = propre(s); console.log(t); try { fs.appendFileSync(FICHIER_SORTIE, t + '\n'); } catch { /* pas grave */ } };
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const minutes = (n) => new Date(Date.now() - n * 60000).toISOString();

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
const refuseAvec = (r, motif) => r.statut >= 400 && String(r.json?.message ?? '').includes(motif);
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
pass('connexion de l\'administrateur, aucun reste d\'essai, aucune passe dans la base');

const charette = ((await lire(A0, 'routes?select=id,nom,actif')).json ?? []).find((r) => r.nom === 'Charette' && r.actif);
if (!charette) arret('route « Charette » introuvable');
const T3 = ((await lire(A0, `stops?select=id,client,service,lat,lon&route_id=eq.${charette.id}&actif=eq.true`)).json ?? []).find((a) => a.client === 'TEST 3');
if (!T3) arret('l\'arrêt « TEST 3 » de Charette est introuvable');
const TACHE = T3.service;

const vehicules = [];
for (let i = 1; i <= 3; i++) {
  const c = await ecrire(A0, 'POST', 'equipes', { nom: `ZZTEST Camion ${i}` });
  if (c.statut !== 201) arret(`création du véhicule d'essai « ZZTEST Camion ${i} » impossible (${detail(c)})`);
  vehicules.push(c.json[0].id);
}
const employes = {};
let nipD = null;
async function nouvelEmploye(cle, nom, tel) {
  const r = await edge(A0, { action: 'creer', nom, telephone: tel });
  if (r.statut !== 200) arret(`création de ${nom} impossible (${detail(r)})`);
  const jeton = await connexion(`${tel}@${DOMAINE}`, r.json.nip);
  if (!jeton) arret(`connexion de ${nom} impossible`);
  employes[cle] = { id: r.json.employe.id, jeton, nom };
  if (cle === 'D') nipD = r.json.nip;   // le SEUL NIP montré (compte d'essai jetable), et seulement à l'écran
}
const COMPTES = [['A', 'ZZTEST Eq A', '8195550191'], ['B', 'ZZTEST Eq B', '8195550192'], ['C', 'ZZTEST Eq C', '8195550193'], ['D', 'ZZTEST Eq D', '8195550194'],
  ['E', 'ZZTEST Eq E', '8195550195'], ['F', 'ZZTEST Eq F', '8195550196'], ['G', 'ZZTEST Eq G', '8195550197']];
for (const [cle, nom, tel] of COMPTES) await nouvelEmploye(cle, nom, tel);
const { A, B, C, D, E, F, G } = employes;
const dF = await edge(A0, { action: 'desactiver', id: F.id });
vrai('7 employés d\'essai créés (A et B chauffeurs, C/E/G équipiers, D = ton compte d\'essai, F désactivé)', dF.statut === 200, detail(dF));

const cle = () => crypto.randomUUID();
const debuter = (Ch, id, equipe, min, equipage = []) => rpc(Ch.jeton, 'debuter_passe', { p_id: id, p_route_id: charette.id, p_equipe_id: equipe, p_equipage: equipage, p_moment: minutes(min), p_lat: T3.lat, p_lon: T3.lon, p_precision: 8, p_tache: TACHE });
const membres = (...l) => l.map((E_) => ({ utilisateur_id: E_.id, cle_client: cle(), forcer: false }));
const ajouter = (Ch, passe, Qui, min, forcer = false, k = cle()) => rpc(Ch.jeton, 'equipage_ajouter', { p_cle_client: k, p_passe_id: passe, p_utilisateur_id: Qui.id, p_moment: minutes(min), p_lat: T3.lat, p_lon: T3.lon, p_forcer: forcer });
const retirer = (Ch, passe, Qui, min, k = cle()) => rpc(Ch.jeton, 'equipage_retirer', { p_cle_client: k, p_passe_id: passe, p_utilisateur_id: Qui.id, p_moment: minutes(min), p_lat: T3.lat, p_lon: T3.lon });
const terminer = (Ch, passe, min) => rpc(Ch.jeton, 'terminer_passe', { p_passe_id: passe, p_moment: minutes(min) });
const precedent = async (Ch) => (await rpc(Ch.jeton, 'equipage_precedent')).json;
const nomsDe = (r) => (r?.membres ?? []).map((m) => m.nom);
const periodes = async (passe) => (await lire(A0, `equipage_periodes?select=id,passe_id,utilisateur_id,role,debut,fin,transfert_id&passe_id=eq.${passe}&order=debut`)).json ?? [];
const nomAbord = async (passe) => { const ids = Object.fromEntries(Object.values(employes).map((x) => [x.id, x.nom.replace('ZZTEST Eq ', '')])); return (await periodes(passe)).filter((p) => p.fin === null).map((p) => ids[p.utilisateur_id]).sort(); };
const statutDe = (r, uid) => r.json?.equipage?.find((x) => x.utilisateur_id === uid);

// =====================================================================
log('\n=== 1. LE VISITEUR, ET UN EMPLOYÉ SANS PASSE ===');
{
  const v = await rpc(null, 'equipage_precedent');
  vrai('un visiteur sans connexion ne peut pas appeler equipage_precedent', refuse(v), detail(v));
  eq('A n\'a encore fait aucune passe : aucun nom', await precedent(A), { fin: null, membres: [], passe_id: null });
  const tel = await lire(C.jeton, 'utilisateurs?select=telephone');
  vrai('un employé ne peut pas lire les téléphones de ses collègues', refuse(tel), detail(tel));
}

log('\n=== 2. L\'ÉQUIPAGE PRÉCÉDENT (les personnes à bord AVEC MOI à ma dernière passe) ===');
const pD0 = crypto.randomUUID(), pA1 = crypto.randomUUID(), pA2 = crypto.randomUUID();
{
  // D a déjà conduit avec C, E et G (c'est ce que tu verras à l'écran en ouvrant « Débuter la passe » avec ce compte)
  let r = await debuter(D, pD0, vehicules[2], 150, membres(C, E, G));
  if (r.statut !== 200) arret(`D n'a pas pu démarrer sa passe d'avant (${detail(r)})`);
  eq('D débute avec C, E et G : les trois « ajoutés » d\'un coup (p_equipage)', ['ZZTEST Eq C', 'ZZTEST Eq E', 'ZZTEST Eq G'].map((n) => r.json.equipage.find((x) => x.utilisateur_id === ({ 'ZZTEST Eq C': C, 'ZZTEST Eq E': E, 'ZZTEST Eq G': G })[n].id)?.statut), ['ajoute', 'ajoute', 'ajoute']);
  await terminer(D, pD0, 140);
  eq('D a terminé : son équipage précédent = C, E, G (en ordre alphabétique)', nomsDe(await precedent(D)), ['ZZTEST Eq C', 'ZZTEST Eq E', 'ZZTEST Eq G']);

  r = await debuter(A, pA1, vehicules[0], 100, membres(C, E));
  eq('A débute avec C et E : ajoutés', [statutDe(r, C.id)?.statut, statutDe(r, E.id)?.statut], ['ajoute', 'ajoute']);
  eq('… le chauffeur, C et E sont à bord', await nomAbord(pA1), ['A', 'C', 'E']);
  eq('pendant la passe (pas terminée) : rien (seule une passe terminée compte)', nomsDe(await precedent(A)), []);
  await terminer(A, pA1, 90);
  eq('A a terminé : son équipage précédent = C et E', nomsDe(await precedent(A)), ['ZZTEST Eq C', 'ZZTEST Eq E']);
  eq('B (jamais chauffeur) : aucun nom ; C (passager) : aucun nom — chacun ne voit que le sien', [nomsDe(await precedent(B)), nomsDe(await precedent(C))], [[], []]);

  // Une personne retirée avant la fin n'est PAS dans l'équipage précédent
  r = await debuter(A, pA2, vehicules[0], 80, membres(C, E));
  const rr = await retirer(A, pA2, E, 70);
  eq('A retire E 10 minutes après (au-delà de 2 minutes : « retiré », pas « annulé »)', [rr.statut, rr.json?.statut], [200, 'retire']);
  await terminer(A, pA2, 60);
  eq('équipage précédent de A = C seulement (E est descendu avant la fin)', nomsDe(await precedent(A)), ['ZZTEST Eq C']);
}

log('\n=== 3. AU DÉPART : AVERTISSEMENT NOMMÉ, PUIS TRANSFERT ===');
const pB = crypto.randomUUID(), pA3 = crypto.randomUUID();
const cleC = cle(), cleE = cle();
{
  let r = await debuter(B, pB, vehicules[1], 50);
  if (r.statut !== 200) arret(`B n'a pas pu démarrer sa passe (${detail(r)})`);
  r = await ajouter(B, pB, C, 45);
  eq('B fait monter C dans « ZZTEST Camion 2 »', [r.json?.statut], ['ajoute']);

  r = await debuter(A, pA3, vehicules[0], 40, [{ utilisateur_id: C.id, cle_client: cleC, forcer: false }, { utilisateur_id: E.id, cle_client: cleE, forcer: false }]);
  if (r.statut !== 200) arret(`A n'a pas pu démarrer pA3 (${detail(r)})`);
  const rc = statutDe(r, C.id), re = statutDe(r, E.id);
  eq('A débute avec C (déjà à bord de Camion 2) et E : C est un AVERTISSEMENT, E est ajouté', [rc?.statut, re?.statut], ['avertissement', 'ajoute']);
  eq('… l\'avertissement NOMME le véhicule (« ZZTEST Camion 2 »)', rc?.avertissements?.map((a) => [a.type, a.vehicule]), [['conflit_vehicule', 'ZZTEST Camion 2']]);
  eq('… A rejoint le tour de B (même route et même tâche) ; C n\'a PAS bougé', [r.json.tour_rejoint, await nomAbord(pB)], [true, ['B', 'C']]);

  const t = await ajouter(A, pA3, C, 35, true, cleC);
  eq('A confirme (« forcer ») avec la MÊME clé : C est TRANSFÉRÉ', [t.json?.statut, t.json?.de_passe_id === pB], ['transfere', true]);
  const pPB = (await periodes(pB)).find((p) => p.utilisateur_id === C.id), pPA = (await periodes(pA3)).find((p) => p.utilisateur_id === C.id);
  vrai('… sortie de Camion 2 et entrée dans Camion 1 à la MÊME heure (aucun trou, aucun chevauchement), avec le même numéro de transfert',
    pPB.fin === pPA.debut && pPB.transfert_id && pPB.transfert_id === pPA.transfert_id, JSON.stringify([pPB, pPA]));
  eq('… Camion 1 : A, C, E ; Camion 2 : B seulement', [await nomAbord(pA3), await nomAbord(pB)], [['A', 'C', 'E'], ['B']]);
  const t2 = await ajouter(A, pA3, C, 35, true, cleC);
  eq('le MÊME geste renvoyé (même clé) : rejoué sans rien refaire, jamais de doublon', [t2.json?.statut, t2.json?.rejoue, (await periodes(pA3)).filter((p) => p.utilisateur_id === C.id).length], ['transfere', true, 1]);
  const vueC = ((await rpc(C.jeton, 'tours_en_cours')).json ?? []).flatMap((x) => x.passes).map((p) => [p.passe_id === pA3 ? 'A3' : p.passe_id === pB ? 'B' : '?', p.je_suis_a_bord]);
  eq('C voit qu\'il est à bord de Camion 1 (et plus de Camion 2)', vueC.sort(), [['A3', true], ['B', false]]);
}

log('\n=== 4. QUART TERMINÉ DEPUIS PEU : AVERTISSEMENT DU SERVEUR ===');
{
  const quarts = (await lire(E.jeton, 'quarts?select=id,debut,fin,a_valider&order=debut.desc')).json ?? [];
  const ouvert = quarts.find((q) => q.fin === null);
  vrai('E a un quart ouvert (ouvert automatiquement quand on l\'a fait monter à bord)', !!ouvert, JSON.stringify(quarts));
  const fin = await rpc(E.jeton, 'quart_terminer', { p_quart_id: ouvert?.id, p_moment: minutes(20), p_lat: T3.lat, p_lon: T3.lon });
  eq('E termine son quart il y a 20 minutes', [fin.statut, fin.json?.statut], [200, 'termine']);
  eq('… il descend du camion à ce moment-là : Camion 1 = A et C', await nomAbord(pA3), ['A', 'C']);
  let r = await ajouter(A, pA3, E, 0);
  eq('A veut le faire remonter : le serveur AVERTIT (quart terminé il y a moins de 4 h)', [r.json?.statut, r.json?.avertissements?.map((a) => a.type)], ['avertissement', ['quart_termine']]);
  eq('… rien n\'a changé', await nomAbord(pA3), ['A', 'C']);
  r = await ajouter(A, pA3, E, 0, true);
  eq('A confirme : E remonte, et un NOUVEAU quart s\'ouvre pour lui', [r.json?.statut, r.json?.quart_ouvert_automatiquement], ['ajoute', true]);
  const q2 = (await lire(E.jeton, 'quarts?select=id,fin,a_valider,debut_source&order=debut.desc')).json ?? [];
  eq('… ce nouveau quart est « à valider » (visible dans la liste de Joé)', [q2.length, q2[0]?.fin, q2[0]?.a_valider], [2, null, true]);
}

log('\n=== 5. REFUS ET ERREURS (messages du serveur) ===');
{
  let r = await ajouter(A, pA3, B, 0);
  eq('B CONDUIT « ZZTEST Camion 2 » : on ne peut pas le faire monter', [r.json?.statut, r.json?.raison, r.json?.vehicule], ['refuse', 'chauffeur_ailleurs', 'ZZTEST Camion 2']);
  r = await ajouter(A, pA3, F, 0);
  vrai('un employé DÉSACTIVÉ ne peut pas être ajouté (« utilisateur_inactif »)', refuseAvec(r, 'utilisateur_inactif'), detail(r));
  r = await ajouter(A, pA3, C, 0);
  eq('quelqu\'un déjà à bord : « déjà à bord »', r.json?.statut, 'deja_a_bord');
  r = await ajouter(C, pA3, G, 0);
  vrai('C (un passager) ne peut pas ajouter quelqu\'un à Camion 1 : « non_autorise »', refuseAvec(r, 'non_autorise'), detail(r));
  r = await retirer(B, pA3, C, 0);
  vrai('B (chauffeur d\'un AUTRE camion) ne peut pas retirer quelqu\'un de Camion 1', refuseAvec(r, 'non_autorise'), detail(r));
  r = await retirer(A, pA3, A, 0);
  vrai('le chauffeur ne peut pas être retiré (« chauffeur_ne_peut_etre_retire »)', refuseAvec(r, 'chauffeur_ne_peut_etre_retire'), detail(r));
  r = await retirer(A, pA3, G, 0);
  eq('retirer quelqu\'un qui n\'est pas à bord : « pas à bord »', r.json?.statut, 'pas_a_bord');
  const ecr = await ecrire(C.jeton, 'POST', 'equipage_periodes', { passe_id: pA3, utilisateur_id: G.id, debut: new Date().toISOString() });
  vrai('un employé ne peut PAS écrire directement dans l\'équipage (seulement par les fonctions)', refuse(ecr), detail(ecr));
}

log('\n=== 6. RETIRER : « RETIRÉ » APRÈS 2 MINUTES, « ANNULÉ » AVANT ===');
{
  let r = await ajouter(A, pA3, G, 10);
  eq('G monte à bord (il y a 10 minutes)', r.json?.statut, 'ajoute');
  r = await retirer(A, pA3, G, 0);
  eq('A retire G maintenant : « retiré » (plus de 2 minutes à bord)', r.json?.statut, 'retire');
  eq('… G n\'est plus à bord', await nomAbord(pA3), ['A', 'C', 'E']);
  r = await ajouter(A, pA3, G, 0);
  eq('G remonte à l\'instant', r.json?.statut, 'ajoute');
  const kR = cle();
  r = await retirer(A, pA3, G, 0, kR);
  eq('A le retire tout de suite (moins de 2 minutes) : le serveur ANNULE l\'ajout (aucune trace de quelques secondes)', [r.json?.statut], ['annule']);
  const r2 = await retirer(A, pA3, G, 0, kR);
  eq('le même geste renvoyé (même clé) : rejoué, rien n\'est refait', [r2.json?.statut, r2.json?.rejoue], ['annule', true]);
  eq('l\'état final de Camion 1 : A, C, E', await nomAbord(pA3), ['A', 'C', 'E']);
}

log('\n=== 7. QUI VOIT QUOI ===');
{
  const vue = ((await lire(D.jeton, `equipage_periodes?select=utilisateur_id,role,utilisateurs!utilisateur_id(nom)&passe_id=eq.${pA3}&fin=is.null`)).json ?? []).map((x) => `${x.role}:${x.utilisateurs?.nom}`).sort();
  eq('D (un autre employé) voit les noms de ceux qui sont À BORD de Camion 1 (jamais leurs téléphones)', vue, ['chauffeur:ZZTEST Eq A', 'passager:ZZTEST Eq C', 'passager:ZZTEST Eq E']);
  const passees = ((await lire(D.jeton, `equipage_periodes?select=id&passe_id=eq.${pA2}`)).json ?? []);
  eq('D ne voit PAS les périodes passées des autres (l\'historique est réservé à l\'administrateur)', passees.length, 0);
  const admin = ((await lire(A0, `equipage_periodes?select=id&passe_id=eq.${pA2}`)).json ?? []);
  vrai('l\'administrateur, lui, voit l\'historique', admin.length >= 2, admin.length);
}

// =====================================================================
log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
if (ko) { log('Des vérifications ont échoué. Exécute 10-nettoyage-comptes-zztest.sql.'); process.exit(1); }
log('\n>>> MAINTENANT, REGARDE L\'APPLICATION (le serveur est prêt : Camion 1 roule avec A, C et E ; Camion 2 roule avec B).');
console.log('\n    Compte d\'essai à utiliser dans l\'application :');
console.log('        numéro : 819 555 0194');
console.log(`        NIP    : ${nipD}     (compte jetable « ZZTEST Eq D », effacé par le nettoyage)`);
log('\n    ⚠ IMPORTANT : ne fais monter à bord QUE des personnes « ZZTEST Eq … ». N\'ajoute JAMAIS Joé, Luc, Lionel, Ghislain ni Marc-Antoine :');
log('      leurs vraies données se mêleraient à l\'essai et le nettoyage refuserait de tout effacer.');
log('    Les véhicules à utiliser : « ZZTEST Camion 3 » (libre). « Camion 1 » et « Camion 2 » sont pris par A et B : ne les choisis pas.');
log('\n    1. Ouvre http://localhost:8123 (Ctrl+F5) et connecte-toi avec CE compte d\'essai (pas le tien).');
log('    2. Touche « ▶ Débuter la passe » : route Charette, la tâche, « ZZTEST Camion 3 ».');
log('    3. Section « À bord avec toi » : tu dois voir EN GROS « ZZTEST Eq C », « ZZTEST Eq E » et « ZZTEST Eq G » (ton équipage de la passe d\'avant),');
log('       chacun avec « À bord » / « Pas à bord », un bouton « ✔ Tous à bord », et « Démarrer » GRISÉ tant qu\'un nom n\'est pas tranché.');
log('    4. Touche « À bord » pour C : une question NOMME « ZZTEST Camion 1 » (il y est déjà). Réponds « Oui, le faire monter » (transfert).');
log('       Touche « Pas à bord » pour E. Touche « À bord » pour G (libre : aucune question). Touche « ▶ Démarrer » : « 2 à bord ».');
log('    5. Touche « 👤 Équipage · 3 à bord » sous le grand pourcentage : la liste (toi, C, G). Touche « ＋ AJOUTER », puis « ZZTEST Eq E » : il monte (transfert depuis Camion 1).');
log('    6. Touche « ✕ Retirer » à côté de G : une confirmation, puis « G est descendu » (ou « Ajout annulé » si c\'est dans les 2 premières minutes).');
log('    7. Avec TON compte administrateur (autre fenêtre) : tu vois les camions avec leur nombre de personnes et, en touchant un camion, qui est à bord.');
log('    Appuie sur ENTRÉE ici quand tu as fini.\n');
const rlFin = readline.createInterface({ input: process.stdin, output: process.stdout });
await rlFin.question('');
rlFin.close();
log('\nEssai terminé.');
log('MAINTENANT : exécute 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes, véhicules, passes, équipages et quarts d\'essai.');
process.exit(0);
