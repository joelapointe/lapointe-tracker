// Étape 14 — ESSAI SUR LA VRAIE BASE : débuter / terminer une passe, le dernier tour reste visible, annuler un arrêt, résumé de fin.
// Ne fait PAS partie de « npm test ».   node reel-etape-14.mjs   (environ 1 minute, puis il attend que tu aies regardé l'application)
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton n'est affiché ;
//   • comptes d'essai « ZZTEST Eq A / B / C / D » (819 555 0191 à 0194), véhicules « ZZTEST Camion 1 / 2 » ;
//   • SEULS ces comptes font des gestes (l'administrateur crée les comptes et lit), sinon le nettoyage refuserait de tout effacer ;
//   • SEUL le NIP du compte « ZZTEST Eq D » (celui que TU utilises dans l'application) est affiché, dans ce terminal seulement
//     (pas dans le fichier de résultat) : c'est un compte d'essai jetable, effacé par le nettoyage ;
//   • l'affichage est aussi gardé dans %TEMP%\reel-14-resultat.txt ;
//   • ensuite : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour tout effacer.
// PRÉREQUIS : le fichier 15 (15-etape14c-dernier-tour-visible.sql) doit avoir été exécuté sur la vraie base.
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const dossierApp = (f) => fs.readFileSync(fileURLToPath(new URL('../../www/js/' + f, import.meta.url)), 'utf8');
const config = dossierApp('config.js');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const COLONNES_PASSE = dossierApp('resume-passe.js').match(/COLONNES_PASSE\s*=\s*'([^']+)'/)[1].replace(/\s+/g, '');   // EXACTEMENT ce que l'application lit
const DOMAINE = 'tel.entretienlapointe.ca';

const FICHIER_SORTIE = path.join(os.tmpdir(), 'reel-14-resultat.txt');
try { fs.writeFileSync(FICHIER_SORTIE, ''); } catch { /* pas grave */ }
// Aucun caractère de contrôle dans l'affichage (un « retour chariot » ferait écraser des lignes du terminal)
const propre = (s) => String(s).split('').map((c) => { const k = c.charCodeAt(0); return (k < 32 && k !== 9 && k !== 10) || k === 127 ? ' ' : c; }).join('');
let ok = 0, ko = 0;
const log = (s) => { const t = propre(s); console.log(t); try { fs.appendFileSync(FICHIER_SORTIE, t + '\n'); } catch { /* pas grave */ } };
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const tri = (a) => [...a].sort();
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
const arrets = (await lire(A0, `stops?select=id,client,service,lat,lon&route_id=eq.${charette.id}&actif=eq.true&order=ordre`)).json ?? [];
const T3 = arrets.find((a) => a.client === 'TEST 3');
if (!T3) arret('l\'arrêt « TEST 3 » de Charette est introuvable');
const TACHE = T3.service;
const S = arrets.filter((a) => a.service === TACHE);          // les arrêts de la tâche : ce que la passe doit compléter
if (S.length < 3) arret(`il faut au moins 3 arrêts « ${TACHE} » sur Charette (il y en a ${S.length})`);
const N = S.length, ids = S.map((a) => a.id);
log(`Charette : ${arrets.length} arrêts, dont ${N} de « ${TACHE} » (la tâche de l'essai).`);

const vehicules = [];
for (let i = 1; i <= 2; i++) {
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
  employes[cle] = { id: r.json.employe.id, jeton };
  if (cle === 'D') nipD = r.json.nip;   // le SEUL NIP montré (compte d'essai jetable), et seulement à l'écran
}
await nouvelEmploye('A', 'ZZTEST Eq A', '8195550191');
await nouvelEmploye('B', 'ZZTEST Eq B', '8195550192');
await nouvelEmploye('C', 'ZZTEST Eq C', '8195550193');
await nouvelEmploye('D', 'ZZTEST Eq D', '8195550194');
const { A, B, C, D } = employes;
pass('2 véhicules et 4 employés d\'essai créés (A et B = chauffeurs, C = observateur, D = ton compte d\'essai pour regarder l\'application)');

// Ce que lit l'application : les mêmes requêtes que tours.js et resume-passe.js
const tours = async (E) => (await rpc(E.jeton, 'tours_en_cours')).json ?? [];
const tourCh = async (E) => (await tours(E)).filter((t) => t.route_id === charette.id && t.tache === TACHE);
const debuter = (E, id, equipe, min = 0) => rpc(E.jeton, 'debuter_passe', { p_id: id, p_route_id: charette.id, p_equipe_id: equipe, p_equipage: [], p_moment: minutes(min), p_lat: T3.lat, p_lon: T3.lon, p_precision: 8, p_tache: TACHE });
const completer = (E, passe, stop, min = 0) => rpc(E.jeton, 'completer_arret', { p_passe_id: passe, p_stop_id: stop, p_moment: minutes(min), p_mode: 'manuel', p_lat: T3.lat, p_lon: T3.lon });
const annuler = (E, passe, stop) => rpc(E.jeton, 'annuler_arret', { p_passe_id: passe, p_stop_id: stop });
const terminer = (E, passe) => rpc(E.jeton, 'terminer_passe', { p_passe_id: passe });
const maDernierePasse = async (E) => ((await lire(E.jeton, `passes?select=${COLONNES_PASSE}&chauffeur_id=eq.${E.id}&order=debut.desc&limit=1`)).json ?? [])[0];

// =====================================================================
log('\n=== 1. LE VISITEUR ET LE FICHIER 15 ===');
{
  const v = await rpc(null, 'tours_en_cours');
  vrai('un visiteur sans connexion ne peut pas lire les tours', refuse(v), detail(v));
  eq('aucun tour au départ (employé C)', await tours(C), []);
}

log('\n=== 2. UNE PASSE COMPLÉTÉE À 100 % : LE TOUR RESTE VISIBLE ===');
const pA1 = crypto.randomUUID();
let dernier;
{
  let r = await debuter(A, pA1, vehicules[0], 40);
  if (r.statut !== 200) arret(`A n'a pas pu démarrer sa passe (${detail(r)})`);
  eq('A débute : tour n° 1, nouveau tour, tâche et total corrects', [r.json.numero, r.json.tour_rejoint, r.json.tache, r.json.nb_arrets_total], [1, false, TACHE, N]);
  let t = (await tourCh(C))[0];
  eq('C (observateur) voit un tour EN COURS, 0 fait', [t?.en_cours, t?.faits, t?.total, t?.pourcentage], [true, 0, N, 0]);
  eq('… avec le camion de A', t?.passes.map((p) => [p.passe_id, p.je_suis_chauffeur]), [[pA1, false]]);
  vrai('A voit « je suis chauffeur » sur sa passe', (await tourCh(A))[0]?.passes[0]?.je_suis_chauffeur === true);

  r = await completer(A, pA1, ids[0], 30);       // le premier arrêt : fait il y a 30 minutes (pour essayer le délai de 10 minutes)
  vrai('A complète le 1er arrêt (daté d\'il y a 30 min)', r.statut === 200 && r.json.statut === 'complete', detail(r));
  for (let i = 1; i < N; i++) {
    r = await completer(A, pA1, ids[i], 0);
    if (r.statut !== 200) arret(`A n'a pas pu compléter l'arrêt ${i + 1} (${detail(r)})`);
  }
  eq('le dernier arrêt ferme la passe', [r.json.statut, r.json.passe_fermee, r.json.pourcentage], ['complete', true, 100]);

  const vueC = await tourCh(C);
  if (!vueC.length) arret('le tour terminé n\'est plus renvoyé : le fichier 15 n\'a sans doute pas été exécuté sur la vraie base');
  t = vueC[0];
  eq('C voit ENCORE le tour, terminé : en_cours faux, 100 %, fin « complete »', [vueC.length, t.en_cours, t.pourcentage, t.fin_type], [1, false, 100, 'complete']);
  eq('… tous les arrêts de la tâche sont faits (verts)', [t.faits, t.total, tri(t.arrets_faits)], [N, N, tri(ids)]);
  eq('… plus aucun camion dessus', t.passes, []);
  eq('… C n\'a aucune passe annulable', t.mes_passes_annulables, []);
  vrai('… une date de fin', typeof t.fin === 'string' && t.fin.length > 10, String(t.fin));
  const tA = (await tourCh(A))[0];
  eq('A voit sa passe terminée à 100 % parmi ses passes annulables', tA.mes_passes_annulables, [pA1]);
  const age = tA.faits_il_y_a;
  eq('« faits_il_y_a » : un âge pour chaque arrêt', tri(Object.keys(age)), tri(ids));
  vrai('… le 1er arrêt a environ 30 minutes (1750 à 1900 s), le dernier presque 0', age[ids[0]] >= 1750 && age[ids[0]] <= 1900 && age[ids[N - 1]] < 60, JSON.stringify(age));

  dernier = await maDernierePasse(A);
  eq('le résumé de A (lecture de SA passe, colonnes de l\'application) : terminée, « complete », 100 %', [dernier?.id, dernier?.statut, dernier?.fin_type, dernier?.pourcentage, dernier?.nb_arrets_faits], [pA1, 'terminee', 'complete', 100, N]);
  const lC = await lire(C.jeton, `passes?select=${COLONNES_PASSE}`);
  eq('C ne voit aucune passe terminée d\'un autre chauffeur', [lC.statut, lC.json], [200, []]);
}

log('\n=== 3. ANNULER UN ARRÊT (10 minutes) ===');
{
  let r = await annuler(A, pA1, ids[0]);
  vrai('un arrêt fait il y a 30 min : « delai_depasse » (le serveur refuse)', refuseAvec(r, 'delai_depasse'), detail(r));
  r = await annuler(C, pA1, ids[N - 1]);
  vrai('C (pas le chauffeur) ne peut pas annuler', refuseAvec(r, 'non_autorise'), detail(r));
  r = await annuler(A, pA1, ids[N - 1]);
  eq('A annule le DERNIER arrêt (fait à l\'instant) : annulé, passe rouverte', [r.statut, r.json?.statut, r.json?.passe_rouverte], [200, 'annule', true]);
  let t = (await tourCh(A))[0];
  eq('le tour est de nouveau EN COURS (N-1 faits), avec ma passe', [t.en_cours, t.faits, t.passes.map((p) => [p.passe_id, p.je_suis_chauffeur])], [true, N - 1, [[pA1, true]]]);
  eq('… le tour n\'est renvoyé qu\'une fois', (await tourCh(A)).length, 1);
  vrai('… l\'arrêt annulé n\'est plus dans les arrêts faits', !t.arrets_faits.includes(ids[N - 1]), JSON.stringify(t.arrets_faits));
  eq('… sa passe est de nouveau en cours dans la base (plus de fin)', [(await maDernierePasse(A)).statut, (await maDernierePasse(A)).fin], ['en_cours', null]);
  r = await completer(A, pA1, ids[N - 1], 0);
  vrai('A complète de nouveau le dernier arrêt : la passe se referme à 100 %', r.statut === 200 && r.json.passe_fermee === true, detail(r));
  eq('le tour redevient « terminé » (vert)', [(await tourCh(C))[0]?.en_cours, (await tourCh(C))[0]?.pourcentage], [false, 100]);
}

log('\n=== 4. « DÉBUTER » REMET À ZÉRO ; UNE PASSE ARRÊTÉE À LA MAIN GARDE SES ARRÊTS ===');
const pB = crypto.randomUUID();
{
  let r = await debuter(B, pB, vehicules[1], 0);
  if (r.statut !== 200) arret(`B n'a pas pu démarrer sa passe (${detail(r)})`);
  eq('B débute : NOUVEAU tour n° 2 (pas de « rejoint », le tour 1 est terminé)', [r.json.numero, r.json.tour_rejoint], [2, false]);
  let l = await tourCh(C);
  eq('C ne voit plus qu\'UN élément : le tour n° 2, en cours, 0 fait (tout est redevenu à faire)', [l.length, l[0].numero, l[0].en_cours, l[0].faits, l[0].arrets_faits], [1, 2, true, 0, []]);
  await completer(B, pB, ids[0]); await completer(B, pB, ids[1]);
  r = await terminer(B, pB);
  eq('B termine à la main à 2 arrêts', [r.statut, r.json?.statut, r.json?.faits], [200, 'terminee', 2]);
  l = await tourCh(C); const t = l[0];
  eq('le tour reste visible : terminé, fin « manuelle », 2 arrêts faits (verts), les autres à faire', [l.length, t.en_cours, t.fin_type, t.faits, tri(t.arrets_faits)], [1, false, 'manuelle', 2, tri([ids[0], ids[1]])]);
  eq('… B n\'a AUCUNE passe annulable (arrêtée à la main)', (await tourCh(B))[0].mes_passes_annulables, []);
  r = await annuler(B, pB, ids[1]);
  vrai('… et le serveur refuse d\'annuler dans une passe arrêtée à la main', refuseAvec(r, 'passe_terminee'), detail(r));
  const rB = await maDernierePasse(B);
  eq('le résumé de B : terminée, « manuelle »', [rB?.statut, rB?.fin_type, rB?.nb_arrets_faits], ['terminee', 'manuelle', 2]);
}

log('\n=== 5. DEUX CAMIONS DANS LE MÊME TOUR ===');
const pA3 = crypto.randomUUID(), pB3 = crypto.randomUUID();
{
  let r = await debuter(A, pA3, vehicules[0], 0);
  eq('A débute : tour n° 3 (nouveau)', [r.json?.numero, r.json?.tour_rejoint], [3, false]);
  r = await debuter(B, pB3, vehicules[1], 0);
  eq('B débute sur la même route et la même tâche : il REJOINT le tour n° 3', [r.json?.numero, r.json?.tour_rejoint], [3, true]);
  eq('C voit le tour en cours avec DEUX camions', (await tourCh(C))[0].passes.length, 2);
  await completer(A, pA3, ids[0]);
  r = await terminer(A, pA3);
  eq('A termine sa passe à la main : le tour CONTINUE pour B (en cours, 1 fait, un camion)', [r.json?.statut, (await tourCh(C))[0].en_cours, (await tourCh(C))[0].faits, (await tourCh(C))[0].passes.map((p) => p.passe_id)], ['terminee', true, 1, [pB3]]);
  for (let i = 1; i < N; i++) r = await completer(B, pB3, ids[i]);
  eq('B complète tous les arrêts restants : le tour se ferme à 100 %', [r.json?.passe_fermee, r.json?.pourcentage], [true, 100]);
  const t = (await tourCh(C))[0];
  eq('le tour est terminé, « complete », 100 %, vert', [t.en_cours, t.fin_type, t.pourcentage, t.faits], [false, 'complete', 100, N]);
  eq('B peut annuler (sa passe est terminée à 100 %) ; A ne le peut pas (arrêtée à la main)', [(await tourCh(B))[0].mes_passes_annulables, (await tourCh(A))[0].mes_passes_annulables], [[pB3], []]);
}

// =====================================================================
log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
if (ko) { log('Des vérifications ont échoué. Exécute 10-nettoyage-comptes-zztest.sql.'); process.exit(1); }
log('\n>>> MAINTENANT, REGARDE L\'APPLICATION (le serveur est prêt : tous les camions d\'essai sont arrêtés).');
console.log('\n    Compte d\'essai à utiliser dans l\'application :');
console.log('        numéro : 819 555 0194');
console.log(`        NIP    : ${nipD}     (compte jetable « ZZTEST Eq D », effacé par le nettoyage)`);
log('\n    1. Ouvre http://localhost:8123 (Ctrl+F5) et connecte-toi avec CE compte d\'essai (pas le tien).');
log('    2. La route Charette doit être VERTE (la dernière passe est complétée à 100 %) et le bouton « ▶ Débuter la passe » visible.');
log('    3. Touche « Débuter la passe » : route Charette, la tâche, un véhicule « ZZTEST Camion » → Démarrer.');
log('       Le bandeau montre 0 % en gros et « ■ Terminer la passe » ; la carte repart à zéro (jaune).');
log('    4. Ouvre un client, touche « ✔ Complété » : le pourcentage monte. Sur le client fait, un bouton orange « ↩ Annuler » apparaît : essaie-le.');
log('    5. Complète TOUS les clients de la tâche : la carte « 🎉 Passe complétée : 100 % » s\'ouvre. Touche OK : la route reste verte.');
log('    6. Refais « Débuter la passe », complète 2 clients, puis « ■ Terminer la passe » (confirmation) : le vert reste sur les 2 clients faits.');
log('    7. Avec TON compte administrateur (autre fenêtre) : tu vois les mêmes couleurs et le pourcentage sur l\'étiquette des camions.');
log('    Appuie sur ENTRÉE ici quand tu as fini.\n');
const rlFin = readline.createInterface({ input: process.stdin, output: process.stdout });
await rlFin.question('');
rlFin.close();
log('\nEssai terminé.');
log('MAINTENANT : exécute 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes, véhicules et passes d\'essai.');
process.exit(0);
