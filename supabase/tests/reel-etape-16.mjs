// Étape 16e — ESSAI SUR LA VRAIE BASE : les gestes faits sans réseau puis rejoués (heure du geste, aucun doublon), les règles d'annulation,
// l'heure d'un problème, et la sécurité des arrêts (un employé ne peut JAMAIS ajouter, modifier ni supprimer un arrêt).
// Ne fait PAS partie de « npm test ».   Trois façons de le lancer (dans PowerShell, dossier supabase\tests) :
//   node reel-etape-16.mjs                    l'essai complet (environ 2 minutes), puis il te dit quoi faire dans l'application ;
//   node reel-etape-16.mjs --verifier-essai   APRÈS ton essai dans l'application avec le compte « ZZTEST Eq D » : il LIT la base et résume ce qu'il y trouve ;
//   node reel-etape-16.mjs --nettoyer         efface les photos d'essai (le reste s'efface avec 10-nettoyage-comptes-zztest.sql).
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton n'est affiché ;
//   • comptes d'essai « ZZTEST Eq A à E » (819 555 0191 à 0195), véhicules « ZZTEST Camion 1 / 2 / 3 » ;
//   • SEULS ces comptes font des gestes (l'administrateur crée les comptes et LIT), sinon le nettoyage refuserait de tout effacer ;
//   • SEUL le NIP du compte « ZZTEST Eq D » (celui que TU utilises dans l'application) est affiché, dans ce terminal seulement
//     (pas dans le fichier de résultat) : c'est un compte d'essai jetable, effacé par le nettoyage ;
//   • l'affichage est aussi gardé dans %TEMP%\reel-16-resultat.txt ;
//   • à la fin de TOUT : exécuter node reel-etape-16.mjs --nettoyer, puis 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor).
// PRÉREQUIS : les fichiers 18 et 19 doivent avoir été exécutés sur la vraie base (fait le 20 septembre 2026).
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const MODE = process.argv.includes('--nettoyer') ? 'nettoyer' : process.argv.includes('--verifier-essai') ? 'verifier' : 'complet';
const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';
const BUCKET = 'photos-problemes';

const FICHIER_SORTIE = path.join(os.tmpdir(), 'reel-16-resultat.txt');
try { fs.writeFileSync(FICHIER_SORTIE, ''); } catch { /* pas grave */ }
const propre = (s) => String(s).split('').map((c) => { const k = c.charCodeAt(0); return (k < 32 && k !== 9 && k !== 10) || k === 127 ? ' ' : c; }).join('');
let ok = 0, ko = 0;
const log = (s) => { const t = propre(s); console.log(t); try { fs.appendFileSync(FICHIER_SORTIE, t + '\n'); } catch { /* pas grave */ } };
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));

// Les heures des gestes : fixées UNE fois (« il y a n minutes »), pour pouvoir comparer exactement ce que la base a gardé
const HEURES = {};
const h = (nom, minutes) => (HEURES[nom] ??= new Date(Date.now() - minutes * 60000).toISOString());
const ms = (t) => Date.parse(t);

async function http(methode, chemin, { jeton, corps, entetes } = {}) {
  const en = { apikey: CLE_PUBLIQUE, 'Content-Type': 'application/json', Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE), ...entetes };
  let r;
  try { r = await fetch(URL_PROJET + chemin, { method: methode, headers: en, body: corps === undefined ? undefined : JSON.stringify(corps) }); }
  catch { return { statut: 0, json: null }; }
  let json = null; try { json = await r.json(); } catch { /* vide */ }
  return { statut: r.status, json };
}
const edge = (jeton, corps) => http('POST', '/functions/v1/admin-employes', { jeton, corps });
const rpc = (jeton, nom, args = {}) => http('POST', '/rest/v1/rpc/' + nom, { jeton, corps: args });
const lire = (jeton, chemin) => http('GET', '/rest/v1/' + chemin, { jeton });
const ecrire = (jeton, methode, chemin, corps, retour = true) => http(methode, '/rest/v1/' + chemin, { jeton, corps, entetes: retour ? { Prefer: 'return=representation' } : {} });
const detail = (r) => `HTTP ${r.statut}${r.json?.message ? ' ' + String(r.json.message).slice(0, 90) : r.json?.erreur ? ' ' + r.json.erreur : ''}`;
const refuse = (r) => r.statut >= 400 || r.statut === 0;
const refuseAvec = (r, motif) => r.statut >= 400 && String(r.json?.message ?? '').includes(motif);
// Modifier ou supprimer une ligne qu'on n'a pas le droit de toucher : la base répond « 0 ligne » (ou une erreur) : dans les deux cas RIEN n'a changé
const sansEffet = (r) => refuse(r) || (Array.isArray(r.json) && r.json.length === 0);
async function connexion(courriel, motDePasse) {
  const r = await http('POST', '/auth/v1/token?grant_type=password', { corps: { email: courriel, password: motDePasse } });
  return r.statut === 200 && r.json?.access_token ? r.json.access_token : null;
}
// Le stockage de fichiers (Storage)
async function stockage(methode, chemin, { jeton, octets, type, upsert, corps } = {}) {
  const en = { apikey: CLE_PUBLIQUE, Authorization: 'Bearer ' + (jeton || CLE_PUBLIQUE) };
  if (type) en['Content-Type'] = type; else if (corps !== undefined) en['Content-Type'] = 'application/json';
  if (upsert !== undefined) en['x-upsert'] = String(upsert);
  let r;
  try { r = await fetch(URL_PROJET + '/storage/v1' + chemin, { method: methode, headers: en, body: octets ?? (corps === undefined ? undefined : JSON.stringify(corps)) }); }
  catch { return { statut: 0, json: null }; }
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch { /* pas du JSON */ }
  return { statut: r.status, json };
}
const envoyerPhoto = (jeton, chemin, octets) => stockage('POST', `/object/${BUCKET}/${chemin}`, { jeton, octets, type: 'image/jpeg', upsert: false });
const supprimerPhotos = (jeton, chemins) => stockage('DELETE', `/object/${BUCKET}`, { jeton, corps: { prefixes: chemins } });
const listerPhotos = (jeton, dossier) => stockage('POST', `/object/list/${BUCKET}`, { jeton, corps: { prefix: dossier, limit: 100, offset: 0 } });
const photo = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(300)]);   // (des octets avec l'en-tête d'un JPEG : le stockage vérifie le type annoncé, la taille et les règles d'accès)

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
  log('N\'oublie pas : node reel-etape-16.mjs --nettoyer, puis 10-nettoyage-comptes-zztest.sql dans Supabase, pour effacer les comptes, passes et photos d\'essai.');
  process.exit(1);
}
const nomCourt = (n) => String(n ?? '').replace('ZZTEST Eq ', '');
const local = (t) => (t ? new Date(t).toLocaleString('fr-CA', { hour12: false }) : '—');

// =====================================================================
log(`Projet : ${URL_PROJET}   (mode : ${MODE})`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courrielAdmin = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();   // fermée AVANT la saisie masquée du mot de passe
const A0 = await connexion(courrielAdmin, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : '));
if (!A0) arret('connexion de l\'administrateur impossible');
const utilisateurs = (await rpc(A0, 'admin_lister_utilisateurs')).json ?? [];
const zz = utilisateurs.filter((u) => (u.nom ?? '').startsWith('ZZTEST'));

// ─────────────────────────── MODE : NETTOYER LES PHOTOS ───────────────────────────
if (MODE === 'nettoyer') {
  let n = 0;
  for (const u of zz) {
    const l = await listerPhotos(A0, u.id);
    const noms = Array.isArray(l.json) ? l.json.filter((x) => x.name && x.name !== '.emptyFolderPlaceholder').map((x) => `${u.id}/${x.name}`) : [];
    if (noms.length) { const s = await supprimerPhotos(A0, noms); if (s.statut === 200) n += noms.length; else log('  (suppression refusée : ' + detail(s) + ')'); }
  }
  log(`${n} photo(s) d'essai supprimée(s) du stockage (${zz.length} compte(s) d'essai trouvé(s)).`);
  log('Il reste à exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes, passes, arrêts complétés et problèmes d\'essai.');
  process.exit(0);
}

// ─────────────────────────── MODE : VÉRIFIER TON ESSAI DANS L'APPLICATION ───────────────────────────
if (MODE === 'verifier') {
  const D = zz.find((u) => u.nom === 'ZZTEST Eq D');
  if (!D) arret('le compte « ZZTEST Eq D » est introuvable (as-tu lancé l\'essai complet ?)');
  const passes = (await lire(A0, `passes?select=id,numero,tache,debut,fin,fin_type,statut,equipe_id,nb_arrets_total,nb_arrets_faits&chauffeur_id=eq.${D.id}&order=debut`)).json ?? [];
  const arrets = new Map(((await lire(A0, 'stops?select=id,client,adresse')).json ?? []).map((s) => [s.id, s.client ?? s.adresse]));
  const nomVeh = new Map(((await lire(A0, 'equipes?select=id,nom')).json ?? []).map((e) => [e.id, e.nom]));
  log(`\nCompte d'essai « ZZTEST Eq D » : ${passes.length} passe(s).`);
  let toutesLesPasses = [];
  for (const p of passes) {
    toutesLesPasses.push(p.id);
    log(`\n— Passe n° ${p.numero} · ${p.tache} · ${nomVeh.get(p.equipe_id) ?? '?'} · ${p.statut}${p.fin_type ? ' (' + p.fin_type + ')' : ''}`);
    log(`   débutée le ${local(p.debut)}  ·  terminée le ${local(p.fin)}  ·  arrêts faits ${p.nb_arrets_faits}/${p.nb_arrets_total}`);
    const pa = (await lire(A0, `passe_arrets?select=stop_id,complete_le&passe_id=eq.${p.id}&order=complete_le`)).json ?? [];
    pa.forEach((x) => log(`   ✔ arrêt « ${arrets.get(x.stop_id) ?? '?'} » complété le ${local(x.complete_le)}`));
    const eqp = (await lire(A0, `equipage_periodes?select=role,debut,fin,utilisateurs!utilisateur_id(nom)&passe_id=eq.${p.id}&order=debut`)).json ?? [];
    eqp.forEach((x) => log(`   👤 ${nomCourt(x.utilisateurs?.nom)} (${x.role}) : de ${local(x.debut)} à ${local(x.fin)}`));
  }
  const pbs = (await lire(A0, `problemes?select=id,stop_id,passe_id,note,cree_le,photo_chemin&utilisateur_id=eq.${D.id}&order=cree_le`)).json ?? [];
  log(`\nProblèmes signalés par « ZZTEST Eq D » : ${pbs.length}`);
  pbs.forEach((x) => log(`   ⚠ « ${x.note} » sur « ${arrets.get(x.stop_id) ?? '?'} » le ${local(x.cree_le)}${x.photo_chemin ? '  📷 photo reliée' : '  (sans photo)'}`));
  const l = await listerPhotos(A0, D.id);
  const fichiers = Array.isArray(l.json) ? l.json.filter((x) => x.name && x.name !== '.emptyFolderPlaceholder') : [];
  log(`\nPhotos dans le stockage privé pour ce compte : ${fichiers.length}`);
  log('\n=== VÉRIFICATIONS AUTOMATIQUES ===');
  vrai('aucune passe en double (deux passes avec le même véhicule et la même heure de départ)', new Set(passes.map((p) => p.equipe_id + '|' + p.debut)).size === passes.length);
  vrai('chaque photo du stockage est reliée à UN problème (et inversement)', fichiers.length === pbs.filter((x) => x.photo_chemin).length, `${fichiers.length} fichier(s), ${pbs.filter((x) => x.photo_chemin).length} problème(s) avec photo`);
  vrai('aucun problème en double (même arrêt, même note, même heure)', new Set(pbs.map((x) => x.stop_id + '|' + x.note + '|' + x.cree_le)).size === pbs.length);
  log('\nCompare avec ce que TU as fait dans l\'application : chaque geste doit apparaître UNE seule fois, avec l\'heure où tu l\'as FAIT (pas celle du retour du signal).');
  log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
  process.exit(ko ? 1 : 0);
}

// ─────────────────────────── MODE : L'ESSAI COMPLET ───────────────────────────
if (zz.length) arret('restes d\'un essai précédent : exécute d\'abord node reel-etape-16.mjs --nettoyer puis 10-nettoyage-comptes-zztest.sql');
if (((await lire(A0, 'passes?select=id')).json ?? []).length) arret('la base contient déjà des passes : cet essai suppose 0');
pass('connexion de l\'administrateur, aucun reste d\'essai, aucune passe dans la base');

const charette = ((await lire(A0, 'routes?select=id,nom,actif')).json ?? []).find((r) => r.nom === 'Charette' && r.actif);
if (!charette) arret('route « Charette » introuvable');
const arretsRoute = (await lire(A0, `stops?select=id,client,service,lat,lon,adresse&route_id=eq.${charette.id}&actif=eq.true`)).json ?? [];
const T1 = arretsRoute.find((a) => a.client === 'TEST 1'), T3 = arretsRoute.find((a) => a.client === 'TEST 3'), T5 = arretsRoute.find((a) => a.client === 'TEST 5');
if (!T1 || !T3 || !T5 || new Set([T1.service, T3.service, T5.service]).size !== 1) arret('les arrêts « TEST 1 », « TEST 3 » et « TEST 5 » de Charette (même type de service) sont introuvables');
const TACHE = T1.service;
const POS = { p_lat: T1.lat, p_lon: T1.lon };
const instantane = async () => JSON.stringify(((await lire(A0, 'stops?select=id,adresse,client,service,actif,route_id,lat,lon,ordre&order=id')).json ?? []));

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
for (const [cle, nom, tel] of [['A', 'ZZTEST Eq A', '8195550191'], ['B', 'ZZTEST Eq B', '8195550192'], ['C', 'ZZTEST Eq C', '8195550193'], ['D', 'ZZTEST Eq D', '8195550194'], ['E', 'ZZTEST Eq E', '8195550195']]) await nouvelEmploye(cle, nom, tel);
const { A, B, C } = employes;
pass('5 employés d\'essai créés (A et C chauffeurs, B équipier, D = ton compte d\'essai, E en réserve) et 3 véhicules d\'essai');

const uuid = () => crypto.randomUUID();
// Les gestes, comme le fait l'application quand elle les rejoue (mêmes fonctions du serveur, mêmes arguments, l'heure du GESTE)
const debuter = (Ch, id, equipe, moment, equipage = []) => rpc(Ch.jeton, 'debuter_passe', { p_id: id, p_route_id: charette.id, p_equipe_id: equipe, p_equipage: equipage, p_moment: moment, ...POS, p_tache: TACHE });
const completer = (Ch, passe, stop, moment) => rpc(Ch.jeton, 'completer_arret', { p_passe_id: passe, p_stop_id: stop.id, p_moment: moment, p_mode: 'manuel', ...POS });
const annuler = (Ch, passe, stop, moment) => rpc(Ch.jeton, 'annuler_arret', { p_passe_id: passe, p_stop_id: stop.id, ...(moment ? { p_moment: moment } : {}) });
const terminer = (Ch, passe, moment) => rpc(Ch.jeton, 'terminer_passe', { p_passe_id: passe, p_moment: moment });
const retirer = (Ch, passe, Qui, moment, cle) => rpc(Ch.jeton, 'equipage_retirer', { p_cle_client: cle, p_passe_id: passe, p_utilisateur_id: Qui.id, p_moment: moment, ...POS });
const signaler = (Ch, id, stop, passe, note, creeLe) => ecrire(Ch.jeton, 'POST', 'problemes', { id, stop_id: stop.id, passe_id: passe, note, ...(creeLe ? { cree_le: creeLe } : {}) }, false);
const attacher = (Ch, id) => rpc(Ch.jeton, 'probleme_attacher_photo', { p_probleme_id: id });
const ligne = async (table, filtre) => ((await lire(A0, `${table}?select=*&${filtre}`)).json ?? []);

// =====================================================================
log('\n=== 1. UNE FILE DE GESTES DATÉS DU PASSÉ, REJOUÉE DEUX FOIS : AUCUN DOUBLON, L\'HEURE DU GESTE ===');
const pA = uuid(), kB = uuid(), kRetrait = uuid(), pb1 = uuid();
const photoA = photo();
const H = { debut: h('debut', 60), complete1: h('complete1', 55), annule1: h('annule1', 53), retrait: h('retrait', 40), probleme: h('probleme', 50), complete2: h('complete2', 45), fin: h('fin', 20) };
// Le rejeu : les 8 gestes, dans l'ordre où l'employé les a faits. Renvoie ce que la base a répondu à chacun.
async function rejouer() {
  const r = {};
  r.debuter = await debuter(A, pA, vehicules[0], H.debut, [{ utilisateur_id: B.id, cle_client: kB, forcer: true }]);
  r.completer1 = await completer(A, pA, T1, H.complete1);
  r.annuler = await annuler(A, pA, T1, H.annule1);
  r.completer2 = await completer(A, pA, T1, H.complete2);
  r.retirer = await retirer(A, pA, B, H.retrait, kRetrait);
  r.probleme = await signaler(A, pb1, T3, pA, 'Barrière brisée (essai 16e)', H.probleme);
  r.upload = await envoyerPhoto(A.jeton, `${A.id}/${pb1}.jpg`, photoA);
  r.attacher = await attacher(A, pb1);
  r.terminer = await terminer(A, pA, H.fin);
  return r;
}
const compter = async () => ({
  passes: (await ligne('passes', `id=eq.${pA}`)).length,
  arrets: (await ligne('passe_arrets', `passe_id=eq.${pA}`)).length,
  equipage: (await ligne('equipage_periodes', `passe_id=eq.${pA}`)).length,
  problemes: (await ligne('problemes', `id=eq.${pb1}`)).length,
  photos: (Array.isArray((await listerPhotos(A0, A.id)).json) ? (await listerPhotos(A0, A.id)).json.filter((x) => x.name && x.name !== '.emptyFolderPlaceholder') : []).length,
});
const r1 = await rejouer();
{
  vrai('1er rejeu : le départ est accepté, l\'arrêt complété, l\'équipier retiré, le problème enregistré, la photo envoyée et reliée, la passe terminée',
    r1.debuter.statut === 200 && r1.completer1.statut === 200 && r1.retirer.statut === 200 && r1.probleme.statut === 201 && r1.upload.statut === 200 && r1.attacher.statut === 200 && r1.terminer.statut === 200,
    ['debuter', 'completer1', 'retirer', 'probleme', 'upload', 'attacher', 'terminer'].map((k) => k + ':' + detail(r1[k])).join(' | '));
  eq('l\'annulation faite 2 minutes après le « Complété » est acceptée', r1.annuler.json?.statut, 'annule');
  eq('… et l\'arrêt refait ensuite est complété', r1.completer2.json?.statut, 'complete');
  const p = (await ligne('passes', `id=eq.${pA}`))[0] ?? {};
  eq('la passe a DÉBUTÉ à l\'heure du geste (il y a 60 min), pas à l\'heure du rejeu', ms(p.debut), ms(H.debut));
  eq('… et TERMINÉ à l\'heure du geste (il y a 20 min)', [ms(p.fin), p.statut, p.fin_type], [ms(H.fin), 'terminee', 'manuelle']);
  const pa = await ligne('passe_arrets', `passe_id=eq.${pA}`);
  eq('l\'arrêt est complété UNE fois, à l\'heure du 2e « Complété » (il y a 45 min)', [pa.length, ms(pa[0]?.complete_le)], [1, ms(H.complete2)]);
  const eqp = await ligne('equipage_periodes', `passe_id=eq.${pA}`);
  const pB = eqp.find((x) => x.utilisateur_id === B.id), pAc = eqp.find((x) => x.utilisateur_id === A.id);
  eq('l\'équipier est monté à l\'heure du départ et descendu à l\'heure du retrait (il y a 40 min)', [ms(pB?.debut), ms(pB?.fin)], [ms(H.debut), ms(H.retrait)]);
  eq('le chauffeur est à bord de l\'heure du départ à l\'heure de la fin', [ms(pAc?.debut), ms(pAc?.fin)], [ms(H.debut), ms(H.fin)]);
  const pb = (await ligne('problemes', `id=eq.${pb1}`))[0] ?? {};
  eq('le problème porte l\'heure où il a été SIGNALÉ (il y a 50 min), sa passe, et sa photo reliée', [ms(pb.cree_le), pb.passe_id, pb.photo_chemin], [ms(H.probleme), pA, `${A.id}/${pb1}.jpg`]);
}
const avant = await compter();
eq('après le 1er rejeu : 1 passe, 1 arrêt complété, 2 périodes d\'équipage, 1 problème, 1 photo', avant, { passes: 1, arrets: 1, equipage: 2, problemes: 1, photos: 1 });
const r2 = await rejouer();   // EXACTEMENT les mêmes gestes (mêmes identifiants, mêmes clés) : la réponse d'un envoi s'était perdue
{
  eq('2e rejeu : le départ est reconnu (« déjà enregistré »), pas recréé', r2.debuter.json?.statut, 'deja_enregistre');
  eq('… la passe est reconnue comme déjà terminée', r2.terminer.json?.statut, 'deja_terminee');
  eq('… le problème renvoyé : « doublon de clé » (23505), ce que l\'application traite comme un succès', [r2.probleme.statut, r2.probleme.json?.code], [409, '23505']);
  vrai('… la photo déjà envoyée : refus d\'écraser (jamais remplacée), et la liaison renvoyée répond « déjà attachée » sans erreur', r2.upload.statut >= 400 && r2.attacher.statut === 200 && r2.attacher.json?.statut === 'deja_attachee', `${detail(r2.upload)} / ${detail(r2.attacher)}`);
  eq('… l\'annulation renvoyée alors que l\'arrêt a été refait depuis : IGNORÉE, avec la raison « complete_apres » (c\'est ce qui affiche le message au chauffeur)', [r2.annuler.json?.statut, r2.annuler.json?.raison], ['pas_complete', 'complete_apres']);
  vrai('… le « Complété » renvoyé, et l\'équipier déjà retiré : aucune erreur', r2.completer1.statut === 200 && r2.completer2.statut === 200 && r2.retirer.statut === 200, `${detail(r2.completer1)} / ${detail(r2.retirer)}`);
  const apres = await compter();
  eq('APRÈS LE 2e REJEU : exactement les mêmes nombres (rien n\'a été créé deux fois)', apres, avant);
  const pa = await ligne('passe_arrets', `passe_id=eq.${pA}`);
  eq('l\'arrêt reste complété à la même heure (l\'annulation ignorée ne l\'a pas défait)', [pa.length, ms(pa[0]?.complete_le)], [1, ms(H.complete2)]);
}

// =====================================================================
log('\n=== 2. LES RÈGLES D\'ANNULATION ET L\'HEURE D\'UN PROBLÈME, SUR LA VRAIE BASE ===');
const pC = uuid();
{
  const d = await debuter(C, pC, vehicules[1], h('C_debut', 90));
  eq('C débute sa passe (il y a 90 min)', d.json?.statut, 'debutee');
  // a) 5 minutes après le « Complété » (heure du geste), envoyé 25 minutes plus tard : accepté
  await completer(C, pC, T1, h('C_a', 30));
  eq('a) « Annuler » FAIT 5 min après le « Complété » mais envoyé 25 min plus tard : accepté (avant l\'étape 16d : « trop tard »)', (await annuler(C, pC, T1, h('C_a_annule', 25))).json?.statut, 'annule');
  // b) plus rien à annuler
  const b = await annuler(C, pC, T1, h('C_a_annule', 25));
  eq('b) la même annulation renvoyée (plus rien à annuler) : « pas complété », SANS raison (aucun message ne doit s\'afficher)', [b.json?.statut, b.json?.raison], ['pas_complete', undefined]);
  // c) trop tard
  await completer(C, pC, T1, h('C_c', 20));
  const c = await annuler(C, pC, T1, h('C_c_annule', 5));
  vrai('c) « Annuler » fait 15 min après le « Complété » : refusé (« trop tard »)', refuseAvec(c, 'delai_depasse'), detail(c));
  // d) l'arrêt a été refait entre-temps
  await completer(C, pC, T3, h('C_d', 60));
  eq('d) « Complété » (il y a 60 min), annulé (il y a 55 min)…', (await annuler(C, pC, T3, h('C_d_annule', 55))).json?.statut, 'annule');
  await completer(C, pC, T3, h('C_d2', 20));
  const d2 = await annuler(C, pC, T3, h('C_d_annule', 55));   // la même annulation est renvoyée
  eq('… puis l\'arrêt est REFAIT (il y a 20 min) ; l\'annulation renvoyée est ignorée, avec la raison', [d2.json?.statut, d2.json?.raison], ['pas_complete', 'complete_apres']);
  eq('… et l\'arrêt reste complété', (await ligne('passe_arrets', `passe_id=eq.${pC}&stop_id=eq.${T3.id}`)).length, 1);
  // e) heures aberrantes
  const vieux = new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString();
  vrai('e) une annulation datée de 4 jours : refusée (« geste trop ancien »)', refuseAvec(await annuler(C, pC, T1, vieux), 'geste_trop_ancien'));
  vrai('   un « Complété » daté de 4 jours : refusé aussi', refuseAvec(await completer(C, pC, T5, vieux), 'geste_trop_ancien'));
  const f = await annuler(C, pC, T5, h('C_f', 5));
  eq('f) annuler un arrêt jamais complété : « pas complété », sans raison', [f.json?.statut, f.json?.raison], ['pas_complete', undefined]);
  // g) l'heure d'un problème
  const p1 = uuid(), p2 = uuid(), p3 = uuid(), p4 = uuid();
  eq('g) un problème signalé avec l\'heure du geste (il y a 2 h) : la base la garde', (await signaler(C, p1, T1, pC, 'Problème daté', h('C_p1', 120))).statut, 201);
  eq('   … heure exacte', ms((await ligne('problemes', `id=eq.${p1}`))[0]?.cree_le), ms(h('C_p1', 120)));
  await signaler(C, p2, T1, pC, 'Sans heure');
  vrai('   sans heure : maintenant', Math.abs(ms((await ligne('problemes', `id=eq.${p2}`))[0]?.cree_le) - Date.now()) < 60000);
  await signaler(C, p3, T1, pC, 'Horloge avancée', new Date(Date.now() + 24 * 3600 * 1000).toISOString());
  vrai('   une heure dans le futur : ramenée à maintenant', Math.abs(ms((await ligne('problemes', `id=eq.${p3}`))[0]?.cree_le) - Date.now()) < 60000);
  const p4r = await signaler(C, p4, T1, pC, 'Trop vieux', vieux);
  vrai('   un problème daté de 4 jours : REFUSÉ (« geste trop ancien »), rien d\'enregistré', refuseAvec(p4r, 'geste_trop_ancien') && (await ligne('problemes', `id=eq.${p4}`)).length === 0, detail(p4r));
  const modif = await ecrire(C.jeton, 'PATCH', `problemes?id=eq.${p1}`, { cree_le: new Date().toISOString() });
  vrai('   un employé ne peut PAS changer l\'heure d\'un problème après coup', refuse(modif) && ms((await ligne('problemes', `id=eq.${p1}`))[0]?.cree_le) === ms(h('C_p1', 120)), detail(modif));
  const auNom = await ecrire(C.jeton, 'POST', 'problemes', { id: uuid(), stop_id: T1.id, passe_id: pC, note: 'Au nom d\'un autre', utilisateur_id: A.id }, false);
  vrai('   signaler AU NOM d\'un autre employé : refusé', refuse(auNom), detail(auNom));
  eq('C termine sa passe', (await terminer(C, pC, new Date().toISOString())).json?.statut, 'terminee');
}

// =====================================================================
log('\n=== 3. SÉCURITÉ : UN CHAUFFEUR NE PEUT JAMAIS AJOUTER, MODIFIER NI SUPPRIMER UN ARRÊT ===');
{
  const avantArrets = await instantane();
  const ajout = await ecrire(C.jeton, 'POST', 'stops', { adresse: 'ZZTEST intrus 1 rue du Piratage', client: 'ZZTEST', service: TACHE, route_id: charette.id, lat: 46.4, lon: -72.9 });
  vrai('un employé essaie d\'AJOUTER un arrêt : REFUSÉ', refuse(ajout), detail(ajout));
  const modifA = await ecrire(C.jeton, 'PATCH', `stops?id=eq.${T1.id}`, { adresse: 'PIRATÉ' });
  vrai('… de MODIFIER l\'adresse d\'un arrêt : sans effet', sansEffet(modifA), detail(modifA));
  const modifB = await ecrire(C.jeton, 'PATCH', `stops?id=eq.${T1.id}`, { actif: false });
  vrai('… de DÉSACTIVER (archiver) un arrêt : sans effet', sansEffet(modifB), detail(modifB));
  const modifC = await ecrire(C.jeton, 'PATCH', `stops?id=eq.${T1.id}`, { lat: 0, lon: 0 });
  vrai('… de DÉPLACER un arrêt : sans effet', sansEffet(modifC), detail(modifC));
  const supp = await ecrire(C.jeton, 'DELETE', `stops?id=eq.${T3.id}`);
  vrai('… de SUPPRIMER un arrêt : sans effet', sansEffet(supp), detail(supp));
  const suppTous = await ecrire(C.jeton, 'DELETE', 'stops?id=not.is.null');
  vrai('… de supprimer TOUS les arrêts : sans effet', sansEffet(suppTous), detail(suppTous));
  const route = await ecrire(C.jeton, 'POST', 'routes', { nom: 'ZZTEST route intruse' });
  vrai('… de créer une ROUTE : REFUSÉ', refuse(route), detail(route));
  const veh = await ecrire(C.jeton, 'POST', 'equipes', { nom: 'ZZTEST véhicule intrus' });
  vrai('… de créer un VÉHICULE : REFUSÉ', refuse(veh), detail(veh));
  const modifRoute = await ecrire(C.jeton, 'PATCH', `routes?id=eq.${charette.id}`, { nom: 'PIRATÉE' });
  vrai('… de renommer la route : sans effet', sansEffet(modifRoute), detail(modifRoute));
  const visiteur = await ecrire(null, 'POST', 'stops', { adresse: 'ZZTEST visiteur', client: 'ZZTEST', service: TACHE, route_id: charette.id });
  vrai('un VISITEUR (sans connexion) essaie d\'ajouter un arrêt : REFUSÉ', refuse(visiteur), detail(visiteur));
  const lectureVisiteur = await lire(null, 'stops?select=id');
  vrai('… et il ne peut pas lire les arrêts', refuse(lectureVisiteur) || (Array.isArray(lectureVisiteur.json) && lectureVisiteur.json.length === 0), detail(lectureVisiteur));
  eq('APRÈS TOUS CES ESSAIS : les arrêts sont EXACTEMENT les mêmes (aucun ajouté, modifié, déplacé, archivé ni supprimé) ; la route a gardé son nom',
    [await instantane() === avantArrets, ((await lire(A0, `routes?select=nom&id=eq.${charette.id}`)).json ?? [])[0]?.nom], [true, 'Charette']);
}

// =====================================================================
log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
async function nettoyerPhotos() {
  let n = 0;
  for (const E of Object.values(employes)) {
    const l = await listerPhotos(A0, E.id);
    const noms = Array.isArray(l.json) ? l.json.filter((x) => x.name && x.name !== '.emptyFolderPlaceholder').map((x) => `${E.id}/${x.name}`) : [];
    if (noms.length) { await supprimerPhotos(A0, noms); n += noms.length; }
  }
  return n;
}
if (ko) {
  const n = await nettoyerPhotos();
  log(`Des vérifications ont échoué. ${n} photo(s) d'essai supprimée(s) du stockage. Exécute 10-nettoyage-comptes-zztest.sql (colle-moi le résultat ci-dessus).`);
  process.exit(1);
}
log('\n>>> TOUT EST BON SUR LA VRAIE BASE. MAINTENANT, TON ESSAI DANS L\'APPLICATION (parties 2 et 3).');
console.log('\n    Compte d\'essai à utiliser dans l\'application :');
console.log('        numéro : 819 555 0194');
console.log(`        NIP    : ${nipD}     (compte jetable « ZZTEST Eq D », effacé par le nettoyage)`);
log('\n    PARTIE 2 — le bouton « ＋ STOP » :');
log('    1. Ouvre http://localhost:8123 (Ctrl+F5) et connecte-toi avec CE compte d\'essai (pas le tien).');
log('    2. Regarde la barre du bas et les boutons : il ne doit y avoir NI « ＋ STOP », NI « ADMIN », NI « Nouveau », NI « Supprimer » (dans la fiche d\'un arrêt).');
log('    3. Dis-le moi : je regarde aussi la page (elle ne doit pas déborder sur la largeur d\'un téléphone).');
log('\n    PARTIE 3 — l\'essai « hors réseau » sans couper ton Wi-Fi : je te guide étape par étape dans la conversation.');
log('\n    QUAND TOUT EST FINI :  node reel-etape-16.mjs --verifier-essai   (lit ce que ton essai a laissé dans la base),');
log('    puis  node reel-etape-16.mjs --nettoyer   et  10-nettoyage-comptes-zztest.sql  dans Supabase.');
process.exit(0);
