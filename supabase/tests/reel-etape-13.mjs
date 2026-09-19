// Étape 13a — ESSAIS SUR LA VRAIE BASE : tâche d'une passe et tour partagé entre camions (fichier 13).
// Ne fait PAS partie de « npm test ».   node reel-etape-13.mjs   (environ 1 minute)
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton ni NIP n'est affiché ;
//   • quatre comptes d'essai « ZZTEST Tour A / B / C / D » (819 555 0191 à 0194) et trois véhicules « ZZTEST Camion 1 à 3 » ;
//   • SEULS ces comptes font des gestes (démarrer, compléter, annuler) : l'administrateur ne fait que créer les comptes et lire,
//     sinon le nettoyage (10-nettoyage-comptes-zztest.sql) refuserait de tout effacer ;
//   • travaille sur la route « Charette » et ses arrêts « TEST » ; ne modifie AUCUN arrêt ;
//   • à la fin, exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour tout effacer (passes comprises).
import fs from 'fs';
import readline from 'readline/promises';
import { randomUUID as uuid } from 'crypto';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const minutes = (n) => new Date(Date.now() + n * 60000).toISOString();   // n négatif = dans le passé
const tri = (a) => [...a].sort();

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
const rest = (jeton, chemin, methode = 'GET', corps) => http(methode, '/rest/v1/' + chemin, { jeton, corps, entetes: methode === 'GET' ? {} : { Prefer: 'return=representation' } });
const detail = (r) => `HTTP ${r.statut}${r.json?.message ? ' ' + String(r.json.message).slice(0, 70) : r.json?.erreur ? ' ' + r.json.erreur : ''}`;
const refuse = (r) => r.statut >= 400;
const message = (r) => String(r.json?.message ?? r.json?.erreur ?? '');
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
  console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués (arrêt anticipé) =====`);
  log('N\'oublie pas d\'exécuter 10-nettoyage-comptes-zztest.sql dans Supabase pour effacer les comptes et passes d\'essai.');
  process.exit(1);
}

// =====================================================================
log(`Projet : ${URL_PROJET}`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courrielAdmin = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();
const A0 = await connexion(courrielAdmin, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : '));
if (!A0) arret('connexion de l\'administrateur impossible');
const admins = (await rpc(A0, 'admin_lister_utilisateurs')).json ?? [];
if (admins.some((u) => (u.nom ?? '').startsWith('ZZTEST'))) arret('restes d\'un essai précédent : exécute d\'abord 10-nettoyage-comptes-zztest.sql');
const dejaPasses = (await rest(A0, 'passes?select=id')).json ?? [];
if (dejaPasses.length) arret(`la base contient déjà ${dejaPasses.length} passe(s) : cet essai suppose 0 (le nettoyage ne les effacerait pas)`);
pass('connexion de l\'administrateur, aucun reste d\'essai, aucune passe dans la base');

// ----- Les données réelles : route « Charette » et ses arrêts, groupés par type de service -----
const routes = (await rest(A0, 'routes?select=id,nom,actif')).json ?? [];
const charette = routes.find((r) => r.nom === 'Charette' && r.actif);
const autre = routes.find((r) => r.nom !== 'Charette' && r.actif);
if (!charette) arret('route « Charette » introuvable');
const arrets = (await rest(A0, `stops?select=id,adresse,client,service,actif&route_id=eq.${charette.id}&actif=eq.true`)).json ?? [];
const parService = {}; for (const a of arrets) (parService[a.service] ??= []).push(a.id);
const services = Object.keys(parService).sort((x, y) => parService[y].length - parService[x].length);
if (services.length < 2 || parService[services[0]].length < 3) arret(`« Charette » doit avoir au moins 2 types de service, dont un avec 3 arrêts ou plus (trouvé : ${JSON.stringify(Object.fromEntries(services.map((s) => [s, parService[s].length])))})`);
const TACHE1 = services[0], TACHE2 = services[services.length - 1];        // la plus fréquente (tour partagé) et la moins fréquente (tour à part)
const T1 = parService[TACHE1], T2 = parService[TACHE2];
const stopAutreRoute = autre ? ((await rest(A0, `stops?select=id&route_id=eq.${autre.id}&actif=eq.true&limit=1`)).json ?? [])[0]?.id : null;
log(`Route « ${charette.nom} » : ${services.map((s) => `${parService[s].length} × « ${s} »`).join(', ')}`);
log(`   Tour partagé : « ${TACHE1} » (${T1.length} arrêts) ; tour à part : « ${TACHE2} » (${T2.length} arrêt(s))`);

// ----- Véhicules et employés d'essai (créés par l'administrateur, qui ne fera ensuite AUCUN geste) -----
const vehicules = [];
for (let i = 1; i <= 3; i++) {
  const c = await rest(A0, 'equipes', 'POST', { nom: `ZZTEST Camion ${i}` });
  if (c.statut !== 201) arret(`création du véhicule d'essai « ZZTEST Camion ${i} » impossible (${detail(c)})`);
  vehicules.push(c.json[0].id);
}
const [V1, V2, V3] = vehicules;
const employes = {};
async function nouvelEmploye(cle, nom, tel) {
  const r = await edge(A0, { action: 'creer', nom, telephone: tel });
  if (r.statut !== 200) arret(`création de ${nom} impossible (${detail(r)})`);
  const jeton = await connexion(`${tel}@${DOMAINE}`, r.json.nip);
  if (!jeton) arret(`connexion de ${nom} impossible`);
  employes[cle] = { id: r.json.employe.id, jeton };
}
await nouvelEmploye('A', 'ZZTEST Tour A', '8195550191');
await nouvelEmploye('B', 'ZZTEST Tour B', '8195550192');
await nouvelEmploye('C', 'ZZTEST Tour C', '8195550193');
await nouvelEmploye('D', 'ZZTEST Tour D', '8195550194');
const { A, B, C, D } = employes;
pass('3 véhicules et 4 employés d\'essai créés et connectés (A et B = chauffeurs du même tour, C = chauffeur d\'une autre tâche, D = passager de A)');

const debuter = (E, id, camion, tache, membres = [], min = 0) =>
  rpc(E.jeton, 'debuter_passe', { p_id: id, p_route_id: charette.id, p_equipe_id: camion, p_equipage: membres, p_moment: minutes(min), p_lat: 46.44, p_lon: -72.92, p_tache: tache });
const completer = (E, passe, stop, min = 0) => rpc(E.jeton, 'completer_arret', { p_passe_id: passe, p_stop_id: stop, p_moment: minutes(min), p_mode: 'manuel', p_lat: 46.44, p_lon: -72.92 });
const tours = async (E) => (await rpc(E.jeton, 'tours_en_cours')).json ?? [];
const passesVues = async (E) => (await rest(E.jeton, 'passes?select=id,numero,tache,statut,fin_type,nb_arrets_total,nb_arrets_faits&order=debut')).json ?? [];

// =====================================================================
log('\n=== 1. LE VISITEUR (sans connexion) NE VOIT ET NE FAIT RIEN ===');
{
  const anon = { jeton: null };
  let r = await rpc(null, 'tours_en_cours');
  vrai('tours_en_cours refusé', refuse(r), detail(r));
  r = await rpc(null, 'completer_arret', { p_passe_id: uuid(), p_stop_id: T1[0] });
  vrai('completer_arret refusé', refuse(r), detail(r));
  r = await rpc(null, 'debuter_passe', { p_id: uuid(), p_route_id: charette.id, p_equipe_id: V1 });
  vrai('debuter_passe refusé', refuse(r), detail(r));
  r = await rest(anon.jeton, 'passes?select=id');
  vrai('lecture directe des passes refusée', refuse(r), detail(r));
  r = await rest(anon.jeton, 'passe_arrets?select=id');
  vrai('lecture directe des arrêts complétés refusée', refuse(r), detail(r));
}

log('\n=== 2. LA TÂCHE : REQUISE QUAND LA ROUTE EN A PLUSIEURS ===');
{
  let r = await debuter(A, uuid(), V1, null);
  vrai('sans tâche sur une route à plusieurs services : refusé (tache_requise)', refuse(r) && message(r).includes('tache_requise'), detail(r));
  r = await debuter(A, uuid(), V1, 'Tâche inventée');
  vrai('tâche qui n\'existe pas sur la route : refusé (tache_sans_arret)', refuse(r) && message(r).includes('tache_sans_arret'), detail(r));
  eq('… aucune passe n\'a été créée par ces refus', ((await rest(A0, 'passes?select=id')).json ?? []).length, 0);
}

log('\n=== 3. TOUR PARTAGÉ : A et B (même tâche) ; C (autre tâche) ===');
const pA = uuid(), pB = uuid(), pC = uuid();
{
  let r = await debuter(A, pA, V1, TACHE1, [{ utilisateur_id: D.id, cle_client: uuid() }], -30);
  eq('A démarre : tour n° 1, nouveau tour', [r.statut, r.json?.numero, r.json?.tour_rejoint, r.json?.nb_arrets_total, r.json?.tache], [200, 1, false, T1.length, TACHE1]);
  vrai('… D est monté à bord (équipage)', (r.json?.equipage ?? []).some((e) => e.utilisateur_id === D.id && e.statut !== 'erreur'), JSON.stringify(r.json?.equipage));
  r = await debuter(B, pB, V2, TACHE1, [], -29);
  eq('B démarre, même tâche : il REJOINT le tour n° 1', [r.statut, r.json?.numero, r.json?.tour_rejoint], [200, 1, true]);
  r = await debuter(C, pC, V3, TACHE2, [], -28);
  eq('C démarre une AUTRE tâche : son propre tour n° 2', [r.statut, r.json?.numero, r.json?.tour_rejoint, r.json?.nb_arrets_total, r.json?.tache], [200, 2, false, T2.length, TACHE2]);

  r = await completer(A, pA, T1[0], -20);
  eq('A complète un arrêt', [r.statut, r.json?.statut, r.json?.faits, r.json?.total], [200, 'complete', 1, T1.length]);
  r = await completer(B, pB, T1[0], -19);
  eq('B complète le MÊME arrêt : « déjà complété » (partagé)', [r.statut, r.json?.statut, r.json?.faits], [200, 'deja_complete', 1]);
  r = await completer(B, pB, T1[1], -18);
  eq('B complète un 2e arrêt', [r.json?.statut, r.json?.faits], ['complete', 2]);
  const vu = await passesVues(A);
  const nA = vu.find((p) => p.id === pA), nB = vu.find((p) => p.id === pB), nC = vu.find((p) => p.id === pC);
  eq('les passes de A et B affichent toutes deux 2 arrêts faits', [nA?.nb_arrets_faits, nB?.nb_arrets_faits], [2, 2]);
  eq('la passe de C n\'est pas touchée', [nC?.nb_arrets_faits, nC?.nb_arrets_total], [0, T2.length]);

  r = await completer(C, pC, T1[2], -17);
  vrai('C ne peut pas compléter un arrêt d\'une autre tâche (arret_hors_tache)', refuse(r) && message(r).includes('arret_hors_tache'), detail(r));
  r = await completer(A, pA, T2[0], -17);
  vrai('A ne peut pas compléter un arrêt de la tâche de C (arret_hors_tache)', refuse(r) && message(r).includes('arret_hors_tache'), detail(r));
  if (stopAutreRoute) {
    r = await completer(A, pA, stopAutreRoute, -17);
    vrai('un arrêt d\'une autre route est refusé (arret_hors_route)', refuse(r) && message(r).includes('arret_hors_route'), detail(r));
  }
  r = await completer(D, pA, T1[2], -17);
  vrai('D (passager) ne peut pas compléter (non_autorise)', refuse(r) && message(r).includes('non_autorise'), detail(r));
}

log('\n=== 4. CE QUE VOIT CHAQUE EMPLOYÉ (lecture pour l\'application) ===');
{
  const tC = await tours(C);
  eq('C voit 2 tours en cours sur la route', tC.map((t) => [t.numero, t.tache]).sort((x, y) => x[0] - y[0]), [[1, TACHE1], [2, TACHE2]]);
  const t1 = tC.find((t) => t.numero === 1);
  eq('… le tour n° 1 : 2 arrêts faits sur ' + T1.length + ', ceux des DEUX camions', [t1?.faits, t1?.total, tri(t1?.arrets_faits ?? [])], [2, T1.length, tri([T1[0], T1[1]])]);
  vrai('… 2 camions dans le tour, C n\'y est pas', t1?.passes.length === 2 && t1.passes.every((p) => !p.je_suis_chauffeur && !p.je_suis_a_bord), JSON.stringify(t1?.passes));
  const tD = (await tours(D)).find((t) => t.numero === 1);
  vrai('D (passager de A) est « à bord », pas chauffeur', tD?.passes.some((p) => p.passe_id === pA && p.je_suis_a_bord && !p.je_suis_chauffeur), JSON.stringify(tD?.passes));
  const tA = (await tours(A)).find((t) => t.numero === 1);
  vrai('A est chauffeur de SA passe seulement', tA?.passes.filter((p) => p.je_suis_chauffeur).map((p) => p.passe_id).join() === pA, JSON.stringify(tA?.passes));
  vrai('aucun nom ni téléphone dans la réponse', !/telephone|"nom"/.test(JSON.stringify(tC)), '');
  eq('C voit les 3 passes en cours par lecture directe (règles d\'accès)', (await passesVues(C)).length, 3);
  const lignes = (await rest(C.jeton, 'passe_arrets?select=stop_id,passe_id')).json ?? [];
  eq('… et les 2 arrêts complétés', lignes.length, 2);
  let r = await rest(A.jeton, 'passes', 'POST', { route_id: charette.id, equipe_id: V1, chauffeur_id: A.id, numero: 99, tache: TACHE1 });
  vrai('un employé ne peut pas créer une passe directement', refuse(r), detail(r));
  r = await rest(A.jeton, 'passe_arrets', 'POST', { passe_id: pA, stop_id: T1[2], complete_par: A.id });
  vrai('… ni ajouter un arrêt complété directement', refuse(r), detail(r));
  r = await rest(A.jeton, `passes?id=eq.${pA}`, 'PATCH', { tache: TACHE2 });
  vrai('… ni changer la tâche d\'une passe', refuse(r) || (Array.isArray(r.json) && r.json.length === 0), detail(r));
  eq('… la tâche de la passe de A n\'a pas changé', (await passesVues(A)).find((p) => p.id === pA)?.tache, TACHE1);
}

log('\n=== 5. POSITIONS : UN POINT PAR CAMION ===');
{
  let r = await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: 46.441, p_lon: -72.921 });
  eq('le chauffeur A envoie la position de son camion', r.json?.statut, 'ok');
  r = await rpc(D.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: 46.441, p_lon: -72.921 });
  vrai('le passager D ne peut pas', refuse(r) && message(r).includes('non_autorise'), detail(r));
  r = await rpc(B.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: 46.441, p_lon: -72.921 });
  vrai('un autre chauffeur du même tour ne peut pas envoyer la position du camion de A', refuse(r) && message(r).includes('non_autorise'), detail(r));
  const pos = (await rest(C.jeton, 'positions?select=passe_id,equipe_id')).json ?? [];
  eq('C voit 3 points (un par camion)', pos.length, 3);
}

log('\n=== 6. « TERMINER » NE FERME QUE SON CAMION ===');
const pA2 = uuid();
{
  let r = await rpc(B.jeton, 'terminer_passe', { p_passe_id: pA, p_moment: minutes(-12) });
  vrai('B ne peut pas terminer la passe de A', refuse(r) && message(r).includes('non_autorise'), detail(r));
  r = await rpc(A.jeton, 'terminer_passe', { p_passe_id: pA, p_moment: minutes(-12) });
  eq('A termine sa passe', [r.json?.statut, r.json?.faits], ['terminee', 2]);
  const t1 = (await tours(C)).find((t) => t.numero === 1);
  eq('le tour n° 1 continue avec B seulement, 2 arrêts faits', [t1?.passes.length, t1?.faits], [1, 2]);
  r = await debuter(A, pA2, V1, TACHE1, [], -11);
  eq('A redémarre : il REJOINT le tour n° 1 avec les 2 arrêts déjà faits', [r.json?.numero, r.json?.tour_rejoint, r.json?.nb_arrets_faits], [1, true, '2']);
}

log('\n=== 7. 100 % : TOUS LES CAMIONS DU TOUR SE TERMINENT ENSEMBLE ===');
{
  let r = await completer(B, pB, T1[2], -3);
  eq('B complète le dernier arrêt : 100 %, passe fermée', [r.json?.statut, r.json?.pourcentage, r.json?.passe_fermee], ['complete', 100, true]);
  const vu = await passesVues(A0);   // lecture par l'administrateur : un employé ne voit PAS la passe terminée d'un collègue (voulu)
  const a2 = vu.find((p) => p.id === pA2), b = vu.find((p) => p.id === pB), c = vu.find((p) => p.id === pC);
  eq('les passes de A et de B sont « terminee / complete »', [a2?.statut, a2?.fin_type, b?.statut, b?.fin_type], ['terminee', 'complete', 'terminee', 'complete']);
  eq('la passe de C (autre tâche) continue', c?.statut, 'en_cours');
  eq('le tour n° 1 n\'apparaît plus dans la lecture', (await tours(C)).map((t) => t.numero), [2]);
  eq('les positions de A et B sont effacées (il reste celle de C)', ((await rest(C.jeton, 'positions?select=passe_id')).json ?? []).map((p) => p.passe_id), [pC]);
}

log('\n=== 8. NOUVEAU TOUR, PUIS ANNULATION QUI ROUVRE L\'ANCIEN ===');
const pA3 = uuid();
{
  let r = await debuter(A, pA3, V1, TACHE1, [], -2);
  eq('A démarre après la fermeture : NOUVEAU tour n° 3, 0 arrêt fait', [r.json?.numero, r.json?.tour_rejoint, r.json?.nb_arrets_faits], [3, false, '0']);
  r = await rpc(B.jeton, 'annuler_arret', { p_passe_id: pB, p_stop_id: T1[2] });
  vrai('annuler le dernier arrêt de l\'ancien tour pendant qu\'un nouveau est ouvert : refusé (impossible_de_rouvrir)', refuse(r) && message(r).includes('impossible_de_rouvrir'), detail(r));
  eq('… rien n\'a changé (la passe de B est toujours terminée)', (await passesVues(B)).find((p) => p.id === pB)?.statut, 'terminee');
  r = await rpc(A.jeton, 'terminer_passe', { p_passe_id: pA3, p_moment: minutes(-1) });
  eq('A termine le tour n° 3', r.json?.statut, 'terminee');
  r = await rpc(B.jeton, 'annuler_arret', { p_passe_id: pB, p_stop_id: T1[2] });
  eq('B annule le dernier arrêt (fait il y a moins de 10 min) : les camions du tour reprennent', [r.json?.statut, r.json?.passe_rouverte, r.json?.faits], ['annule', true, 2]);
  const vu = await passesVues(A);
  eq('… les passes de A et de B sont de nouveau en cours', [vu.find((p) => p.id === pA2)?.statut, vu.find((p) => p.id === pB)?.statut], ['en_cours', 'en_cours']);
  const t1 = (await tours(C)).find((t) => t.numero === 1);
  eq('… le tour n° 1 est de retour : 2 camions, 2 arrêts faits', [t1?.passes.length, t1?.faits], [2, 2]);
  r = await rpc(B.jeton, 'annuler_arret', { p_passe_id: pB, p_stop_id: T1[2] });
  eq('annuler un arrêt qui n\'est pas fait : « pas_complete »', r.json?.statut, 'pas_complete');
}

log('\n=== 9. LE TOUR À PART SE FERME SEUL, SANS TOUCHER À L\'AUTRE ===');
{
  let r = { json: null };
  for (const s of T2) r = await completer(C, pC, s, -1);
  eq(`C complète ses ${T2.length} arrêt(s) : 100 %, passe fermée`, [r.json?.pourcentage, r.json?.passe_fermee], [100, true]);
  const vu = await passesVues(A0);   // lecture par l'administrateur (un employé ne voit pas la passe terminée d'un collègue)
  eq('la passe de C est « terminee / complete »', [vu.find((p) => p.id === pC)?.statut, vu.find((p) => p.id === pC)?.fin_type], ['terminee', 'complete']);
  eq('… le tour de A et B est toujours ouvert (2 arrêts sur ' + T1.length + ')', ((await tours(A)).map((t) => [t.numero, t.faits])), [[1, 2]]);
}

log('\n=== 10. PASSE DE VUE D\'ENSEMBLE (ce que l\'administrateur lira) ===');
{
  const toutes = (await rest(A0, 'passes?select=numero,tache,statut,fin_type,nb_arrets_faits,nb_arrets_total&order=numero,debut')).json ?? [];
  for (const p of toutes) log(`   tour ${p.numero} · ${p.tache} · ${p.statut}${p.fin_type ? ' (' + p.fin_type + ')' : ''} · ${p.nb_arrets_faits}/${p.nb_arrets_total}`);
  eq('numéros de tour distincts créés : 1, 2 et 3', [...new Set(toutes.map((p) => p.numero))].sort(), [1, 2, 3]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
log('\nMAINTENANT : exécute 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes, véhicules et passes d\'essai.');
process.exit(ko ? 1 : 0);
