// Étape 13c — ESSAI SUR LA VRAIE BASE : positions des camions et client « en cours ».
// Ne fait PAS partie de « npm test ».   node reel-etape-13c.mjs
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton ni NIP n'est affiché ;
//   • comptes d'essai « ZZTEST Tour A / B / C » (819 555 0191 à 0193) et véhicules « ZZTEST Camion 1 / 2 » ;
//   • SEULS ces comptes font des gestes (l'administrateur crée les comptes et lit), sinon le nettoyage refuserait de tout effacer ;
//   • à la fin de la vérification, le script reste actif et ENVOIE LA POSITION DES DEUX CAMIONS TOUTES LES 10 SECONDES
//     (comme un vrai téléphone) pour que tu puisses regarder l'application ; Entrée = terminer ;
//   • ensuite : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour tout effacer.
import fs from 'fs';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const RAYON = Number(config.match(/RAYON_EN_COURS_M=(\d+)/)[1]);
const PERIMEE_MIN = Number(config.match(/POSITION_PERIMEE_MIN=(\d+)/)[1]);
const PRECISION_MAX = Number(config.match(/PRECISION_MAX_M=(\d+)/)[1]);
const DOMAINE = 'tel.entretienlapointe.ca';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const minutes = (n) => new Date(Date.now() + n * 60000).toISOString();

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
function distanceMetres(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// =====================================================================
log(`Projet : ${URL_PROJET}   (rayon ${RAYON} m, position valable ${PERIMEE_MIN} min, précision ${PRECISION_MAX} m)`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const courrielAdmin = (await rl.question('Courriel du compte administrateur : ')).trim();
rl.close();   // fermée AVANT la saisie masquée du mot de passe (sinon il pourrait s'afficher)
const A0 = await connexion(courrielAdmin, await lireSecret('Mot de passe (masqué, ne s\'affiche pas) : '));
if (!A0) arret('connexion de l\'administrateur impossible');
const admins = (await rpc(A0, 'admin_lister_utilisateurs')).json ?? [];
if (admins.some((u) => (u.nom ?? '').startsWith('ZZTEST'))) arret('restes d\'un essai précédent : exécute d\'abord 10-nettoyage-comptes-zztest.sql');
const dejaPasses = (await rest(A0, 'passes?select=id')).json ?? [];
if (dejaPasses.length) arret(`la base contient déjà ${dejaPasses.length} passe(s) : cet essai suppose 0`);
pass('connexion de l\'administrateur, aucun reste d\'essai, aucune passe dans la base');

// ----- Les arrêts « TEST » de Charette (leurs vraies coordonnées viennent de la base) -----
const charette = ((await rest(A0, 'routes?select=id,nom,actif')).json ?? []).find((r) => r.nom === 'Charette' && r.actif);
if (!charette) arret('route « Charette » introuvable');
const arrets = (await rest(A0, `stops?select=id,client,service,lat,lon&route_id=eq.${charette.id}&actif=eq.true`)).json ?? [];
const test = (n) => arrets.find((a) => a.client === 'TEST ' + n);
const [T1, T2, T3, T5] = [1, 2, 3, 5].map(test);
if (![T1, T2, T3, T5].every(Boolean)) arret('les arrêts « TEST 1, 2, 3 et 5 » de Charette sont introuvables');
const TACHE = T1.service;
if (T3.service !== TACHE || T5.service !== TACHE || T2.service === TACHE) arret(`attendu : TEST 1, 3 et 5 de la même tâche, TEST 2 d'une autre (trouvé : ${[T1, T2, T3, T5].map((t) => t.service).join(' / ')})`);
log(`Route « ${charette.nom} » — tâche « ${TACHE} » : TEST 1, 3, 5 ; TEST 2 (« ${T2.service} ») est à ${Math.round(distanceMetres(T1.lat, T1.lon, T2.lat, T2.lon))} m de TEST 1.`);

// ----- Véhicules et employés d'essai -----
const vehicules = [];
for (let i = 1; i <= 2; i++) {
  const c = await rest(A0, 'equipes', 'POST', { nom: `ZZTEST Camion ${i}` });
  if (c.statut !== 201) arret(`création du véhicule d'essai « ZZTEST Camion ${i} » impossible (${detail(c)})`);
  vehicules.push(c.json[0].id);
}
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
const { A, B, C } = employes;
pass('2 véhicules et 3 employés d\'essai créés et connectés (A et B = chauffeurs du même tour, C = simple observateur)');

// La règle du client « en cours », la même que dans l'application (tours.js), appliquée aux VRAIES données lues par un employé
async function vueDe(E) {
  const tours = (await rpc(E.jeton, 'tours_en_cours')).json ?? [];
  const positions = (await rest(E.jeton, 'positions?select=passe_id,lat,lon,precision_m,maj_le')).json ?? [];
  const tour = tours.find((t) => t.route_id === charette.id && t.tache === TACHE);
  const passes = (tour?.passes ?? []).map((p) => p.passe_id);
  const maintenant = Date.now();
  const enCours = arrets.filter((s) => {
    if ((tour?.arrets_faits ?? []).includes(s.id) || s.service !== TACHE || !tour) return false;
    return positions.some((p) => passes.includes(p.passe_id) && maintenant - Date.parse(p.maj_le) <= PERIMEE_MIN * 60000
      && (p.precision_m == null || p.precision_m <= PRECISION_MAX) && distanceMetres(p.lat, p.lon, s.lat, s.lon) <= RAYON);
  }).map((s) => s.client).sort();
  return { tours, positions, tour, enCours };
}
const noms = (l) => l.sort((a, b) => Number(a.split(' ')[1]) - Number(b.split(' ')[1]));

// =====================================================================
log('\n=== 1. LE VISITEUR NE VOIT PAS LES POSITIONS ===');
{
  const r = await rest(null, 'positions?select=passe_id,lat,lon');
  vrai('lecture des positions sans connexion : refusée', refuse(r), detail(r));
}

log('\n=== 2. UN CAMION DÉMARRE À TEST 1 ===');
const pA = crypto.randomUUID(), pB = crypto.randomUUID();
{
  let r = await rpc(A.jeton, 'debuter_passe', { p_id: pA, p_route_id: charette.id, p_equipe_id: vehicules[0], p_equipage: [], p_lat: T1.lat, p_lon: T1.lon, p_precision: 8, p_tache: TACHE });
  eq('A démarre le tour n° 1 avec la position de son camion (TEST 1)', [r.statut, r.json?.numero], [200, 1]);
  const vu = await vueDe(C);
  eq('C (observateur, dans aucun camion) lit la position du camion', vu.positions.map((p) => p.passe_id), [pA]);
  vrai('… elle est fraîche (moins de 30 s) et de précision 8 m', vu.positions.length === 1 && Date.now() - Date.parse(vu.positions[0].maj_le) < 30000 && vu.positions[0].precision_m === 8, JSON.stringify(vu.positions));
  eq('client « en cours » : seulement TEST 1 (TEST 2 est à 15 m mais d\'une AUTRE tâche)', vu.enCours, ['TEST 1']);
  eq('arriver chez un client ne le complète PAS : 0 arrêt fait dans le tour', vu.tour?.faits, 0);
}

log('\n=== 3. UN 2E CAMION DU MÊME TOUR ===');
{
  let r = await rpc(B.jeton, 'debuter_passe', { p_id: pB, p_route_id: charette.id, p_equipe_id: vehicules[1], p_equipage: [], p_lat: T5.lat, p_lon: T5.lon, p_precision: 10, p_tache: TACHE });
  eq('B démarre : il rejoint le tour n° 1', [r.statut, r.json?.numero, r.json?.tour_rejoint], [200, 1, true]);
  const vu = await vueDe(C);
  eq('C voit maintenant 2 positions (un point par camion)', vu.positions.length, 2);
  eq('clients « en cours » : TEST 1 (camion A) et TEST 5 (camion B)', noms(vu.enCours), ['TEST 1', 'TEST 5']);
}

log('\n=== 4. LES CAMIONS BOUGENT ===');
{
  let r = await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: T3.lat, p_lon: T3.lon, p_precision: 8 });
  eq('A envoie sa nouvelle position (TEST 3)', r.json?.statut, 'ok');
  let vu = await vueDe(C);
  eq('TEST 1 n\'est plus « en cours », TEST 3 le devient', noms(vu.enCours), ['TEST 3', 'TEST 5']);
  eq('toujours UNE seule ligne de position par camion', vu.positions.length, 2);

  r = await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: T1.lat, p_lon: T1.lon, p_precision: 8, p_moment: minutes(-10) });
  vu = await vueDe(C);
  const pos = vu.positions.find((p) => p.passe_id === pA);
  vrai('une position plus ANCIENNE (envoi hors réseau) n\'écrase jamais la plus récente', Math.abs(pos.lat - T3.lat) < 1e-9, JSON.stringify(pos));

  r = await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: T2.lat, p_lon: T2.lon, p_precision: 45 });
  vu = await vueDe(C);
  eq('un GPS trop imprécis (45 m) ne rend aucun client « en cours » (TEST 3 ne l\'est plus, TEST 2 non plus)', noms(vu.enCours), ['TEST 5']);

  r = await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: T3.lat + 0.00023, p_lon: T3.lon, p_precision: 8 });
  vu = await vueDe(C);
  eq('à environ 25 m de TEST 3 (hors du rayon de 20 m) : pas « en cours »', noms(vu.enCours), ['TEST 5']);

  r = await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: T3.lat, p_lon: T3.lon, p_precision: 8 });
  vu = await vueDe(C);
  eq('de retour chez TEST 3 : « en cours » de nouveau', noms(vu.enCours), ['TEST 3', 'TEST 5']);
}

log('\n=== 5. UN CLIENT FAIT N\'EST PLUS « EN COURS » ===');
{
  let r = await rpc(B.jeton, 'completer_arret', { p_passe_id: pB, p_stop_id: T5.id, p_mode: 'manuel', p_lat: T5.lat, p_lon: T5.lon });
  eq('B complète TEST 5 (le chauffeur touche « Complété »)', [r.json?.statut, r.json?.faits], ['complete', 1]);
  const vu = await vueDe(C);
  eq('TEST 5 est fait (vert) : plus « en cours ». Reste TEST 3 (camion de A)', [vu.tour?.arrets_faits.includes(T5.id), noms(vu.enCours)], [true, ['TEST 3']]);
}

// =====================================================================
log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
if (ko) {
  log('Des vérifications ont échoué : je n\'envoie pas de positions. Exécute 10-nettoyage-comptes-zztest.sql.');
  process.exit(1);
}
log('\n>>> MAINTENANT, REGARDE L\'APPLICATION (ce script joue le rôle de 2 téléphones) :');
log('    1. Ouvre http://localhost:8123 dans ton navigateur et connecte-toi avec TON compte (administrateur).');
log('    2. Choisis « Charette » (touche le nom de la zone en bas) ou laisse « Toutes les routes ».');
log('    3. Tu dois voir : TEST 5 en VERT (fait), TEST 3 en BLEU (camion de A sur place), les autres en jaune.');
log('       Touche TEST 3 : la fiche dit « camion sur place » ; le bouton reste grisé pour toi (« Chauffeur seulement »).');
log('       TEST 2, à 15 m de TEST 1, reste jaune : c\'est une autre tâche.');
log('    Ce script envoie la position des 2 camions toutes les 10 secondes (sinon le bleu disparaît après 3 minutes).');
log('    Appuie sur ENTRÉE ici quand tu as fini de regarder.\n');
const battement = setInterval(async () => {
  await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: T3.lat, p_lon: T3.lon, p_precision: 8 });
  await rpc(B.jeton, 'envoyer_position', { p_passe_id: pB, p_lat: T5.lat, p_lon: T5.lon, p_precision: 10 });
}, 10000);
const rlFin = readline.createInterface({ input: process.stdin, output: process.stdout });
await rlFin.question('');
clearInterval(battement);
rlFin.close();
log('\nPositions arrêtées. Le bleu disparaîtra de l\'écran dans 3 minutes.');
log('MAINTENANT : exécute 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes, véhicules et passes d\'essai.');
process.exit(0);
