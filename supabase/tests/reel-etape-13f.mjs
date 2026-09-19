// Étape 13f — ESSAI SUR LA VRAIE BASE : les camions sur la carte, avec leur équipage complet.
// Ne fait PAS partie de « npm test ».   node reel-etape-13f.mjs   (environ 1 minute, puis il attend que tu aies regardé)
//   • le mot de passe de l'administrateur est tapé masqué, jamais affiché ni enregistré ; aucun jeton ni NIP n'est affiché ;
//   • comptes d'essai « ZZTEST Eq A / B / C / D » (819 555 0191 à 0194), véhicules « ZZTEST Camion 1 / 2 » ;
//   • SEULS ces comptes font des gestes (l'administrateur crée les comptes et lit), sinon le nettoyage refuserait de tout effacer ;
//   • à la fin de la vérification, le script joue le rôle de 2 téléphones (position toutes les 10 s) et fait monter puis
//     descendre le passager D toutes les 30 s pour que tu voies la bulle du camion se mettre à jour ; Entrée = terminer ;
//   • l'affichage est aussi gardé dans %TEMP%\reel-13f-resultat.txt ;
//   • ensuite : exécuter 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour tout effacer.
import fs from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline/promises';
import { fileURLToPath } from 'url';

const config = fs.readFileSync(fileURLToPath(new URL('../../www/js/config.js', import.meta.url)), 'utf8');
const URL_PROJET = config.match(/SUPA_URL\s*=\s*'([^']+)'/)[1];
const CLE_PUBLIQUE = config.match(/SUPA_KEY\s*=\s*'([^']+)'/)[1];
const DOMAINE = 'tel.entretienlapointe.ca';

const FICHIER_SORTIE = path.join(os.tmpdir(), 'reel-13f-resultat.txt');
try { fs.writeFileSync(FICHIER_SORTIE, ''); } catch { /* pas grave */ }
// Aucun caractère de contrôle dans l'affichage (un « retour chariot » ferait écraser des lignes du terminal)
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
pass('connexion de l\'administrateur, aucun reste d\'essai, aucune passe dans la base');

const charette = ((await lire(A0, 'routes?select=id,nom,actif')).json ?? []).find((r) => r.nom === 'Charette' && r.actif);
if (!charette) arret('route « Charette » introuvable');
const arrets = (await lire(A0, `stops?select=id,client,service,lat,lon&route_id=eq.${charette.id}&actif=eq.true`)).json ?? [];
const T3 = arrets.find((a) => a.client === 'TEST 3'), T5 = arrets.find((a) => a.client === 'TEST 5');
if (!T3 || !T5 || T3.service !== T5.service) arret('les arrêts « TEST 3 » et « TEST 5 » de Charette (même tâche) sont introuvables');
const TACHE = T3.service;

const vehicules = [];
for (let i = 1; i <= 2; i++) {
  const c = await ecrire(A0, 'POST', 'equipes', { nom: `ZZTEST Camion ${i}` });
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
await nouvelEmploye('A', 'ZZTEST Eq A', '8195550191');
await nouvelEmploye('B', 'ZZTEST Eq B', '8195550192');
await nouvelEmploye('C', 'ZZTEST Eq C', '8195550193');
await nouvelEmploye('D', 'ZZTEST Eq D', '8195550194');
const { A, B, C, D } = employes;
pass('2 véhicules et 4 employés d\'essai créés (A et B = chauffeurs, D = passager de A, C = simple observateur)');

const pA = crypto.randomUUID(), pB = crypto.randomUUID();
let r = await rpc(A.jeton, 'debuter_passe', { p_id: pA, p_route_id: charette.id, p_equipe_id: vehicules[0], p_equipage: [{ utilisateur_id: D.id, cle_client: crypto.randomUUID() }], p_lat: T3.lat, p_lon: T3.lon, p_precision: 8, p_tache: TACHE });
if (r.statut !== 200) arret(`A n'a pas pu démarrer sa passe (${detail(r)})`);
r = await rpc(B.jeton, 'debuter_passe', { p_id: pB, p_route_id: charette.id, p_equipe_id: vehicules[1], p_equipage: [], p_lat: T5.lat, p_lon: T5.lon, p_precision: 10, p_tache: TACHE });
if (r.statut !== 200) arret(`B n'a pas pu démarrer sa passe (${detail(r)})`);
pass('A (avec D à bord) et B ont démarré leur passe : même route, même tâche, chacun avec la position de son camion');

// Ce que lit l'application : les mêmes requêtes que vehicules.js, faites par un simple employé
async function vueDe(E) {
  const [eq, ep, po, to] = await Promise.all([
    lire(E.jeton, 'equipes?select=id,nom'),
    lire(E.jeton, 'equipage_periodes?select=passe_id,role,utilisateur_id,utilisateurs!utilisateur_id(nom)&fin=is.null'),
    lire(E.jeton, 'positions?select=passe_id,lat,lon,precision_m,maj_le'),
    rpc(E.jeton, 'tours_en_cours'),
  ]);
  const noms = Object.fromEntries((eq.json ?? []).map((x) => [x.id, x.nom]));
  const equipage = {};
  for (const x of ep.json ?? []) (equipage[x.passe_id] ??= []).push({ role: x.role, nom: x.utilisateurs?.nom ?? '' });
  for (const l of Object.values(equipage)) l.sort((a, b) => (a.role === 'chauffeur' ? 0 : 1) - (b.role === 'chauffeur' ? 0 : 1) || a.nom.localeCompare(b.nom, 'fr'));
  const camions = [];
  for (const t of to.json ?? []) for (const p of t.passes) {
    const pos = (po.json ?? []).find((x) => x.passe_id === p.passe_id);
    if (pos) camions.push({ nom: noms[p.equipe_id], passe: p.passe_id, numero: t.numero, faits: t.faits, total: t.total, equipage: (equipage[p.passe_id] ?? []).map((x) => `${x.role === 'chauffeur' ? 'chauffeur' : 'à bord'}:${x.nom}`), lat: pos.lat });
  }
  return { statuts: [eq.statut, ep.statut, po.statut, to.statut], camions: camions.sort((a, b) => (a.nom ?? '').localeCompare(b.nom ?? '')) };
}

log('\n=== 1. LE VISITEUR NE VOIT AUCUN ÉQUIPAGE ===');
{
  for (const t of ['equipage_periodes?select=passe_id', 'equipes?select=id', 'positions?select=passe_id']) {
    const x = await lire(null, t);
    vrai(`lecture de « ${t.split('?')[0]} » sans connexion : refusée`, refuse(x), detail(x));
  }
}

log('\n=== 2. CE QUE LIT UN SIMPLE EMPLOYÉ (C, dans aucun camion) : les camions et leur équipage ===');
{
  const v = await vueDe(C);
  eq('les 4 lectures réussissent (véhicules, équipages avec noms, positions, tours)', v.statuts, [200, 200, 200, 200]);
  eq('DEUX camions avec une position (un point chacun), nommés', v.camions.map((c) => c.nom), ['ZZTEST Camion 1', 'ZZTEST Camion 2']);
  eq('Camion 1 : le chauffeur d\'abord, puis la personne à bord (noms lisibles par un collègue)', v.camions[0].equipage, ['chauffeur:ZZTEST Eq A', 'à bord:ZZTEST Eq D']);
  eq('Camion 2 : son chauffeur seulement', v.camions[1].equipage, ['chauffeur:ZZTEST Eq B']);
  eq('les deux camions sont dans le même tour n° 1 (0 arrêt fait sur ' + '3 ou plus)', [v.camions[0].numero, v.camions[1].numero, v.camions[0].faits], [1, 1, 0]);
  const tel = await lire(C.jeton, 'utilisateurs?select=telephone');
  vrai('les téléphones des collègues restent invisibles', refuse(tel), detail(tel));
  const ecr = await ecrire(C.jeton, 'POST', 'equipage_periodes', { passe_id: pA, utilisateur_id: C.id, debut: new Date().toISOString() });
  vrai('un employé ne peut pas s\'ajouter à un équipage directement (il faut passer par le chauffeur)', refuse(ecr), detail(ecr));
}

log('\n=== 3. L\'ÉQUIPAGE CHANGE : D descend, puis remonte ===');
{
  let x = await rpc(A.jeton, 'equipage_retirer', { p_cle_client: crypto.randomUUID(), p_passe_id: pA, p_utilisateur_id: D.id });
  vrai('le chauffeur A retire D de son camion', x.statut === 200, detail(x));
  let v = await vueDe(C);
  eq('C voit maintenant Camion 1 avec son chauffeur seulement (l\'ancien équipier n\'apparaît plus)', v.camions[0].equipage, ['chauffeur:ZZTEST Eq A']);
  x = await rpc(A.jeton, 'equipage_ajouter', { p_cle_client: crypto.randomUUID(), p_passe_id: pA, p_utilisateur_id: D.id });
  vrai('A fait remonter D à bord', x.statut === 200, detail(x));
  v = await vueDe(C);
  eq('C voit de nouveau D à bord de Camion 1', v.camions[0].equipage, ['chauffeur:ZZTEST Eq A', 'à bord:ZZTEST Eq D']);
}

// =====================================================================
log(`\n===== VÉRIFICATION : ${ok} réussis, ${ko} échoués =====`);
if (ko) { log('Des vérifications ont échoué. Exécute 10-nettoyage-comptes-zztest.sql.'); process.exit(1); }
log('\n>>> MAINTENANT, REGARDE L\'APPLICATION (ce script joue le rôle de 2 téléphones) :');
log('    1. Ouvre http://localhost:8123 dans ton navigateur (Ctrl+F5) et connecte-toi avec TON compte (administrateur).');
log('    2. Laisse « Toutes les routes » ou choisis « Charette ». Tu dois voir 2 camions sur la carte :');
log('       « ZZTEST Camion 1 » avec « 👤 2 » chez TEST 3 (dont la zone et le marqueur sont BLEUS : le camion est sur place),');
log('       « ZZTEST Camion 2 » avec « 👤 1 » près de TEST 5.');
log('    3. Touche un camion : une bulle donne la passe, la tâche, l\'avancement, le chauffeur et les personnes à bord.');
log('    4. Toutes les 30 secondes, D descend du Camion 1 puis remonte : la bulle et « 👤 » doivent changer SANS rien toucher.');
log('    Ce script envoie la position des 2 camions toutes les 10 secondes. Appuie sur ENTRÉE ici quand tu as fini.\n');
let tick = 0, dABord = true;
const battement = setInterval(async () => {
  tick++;
  await rpc(A.jeton, 'envoyer_position', { p_passe_id: pA, p_lat: T3.lat, p_lon: T3.lon, p_precision: 8 });
  await rpc(B.jeton, 'envoyer_position', { p_passe_id: pB, p_lat: T5.lat, p_lon: T5.lon, p_precision: 10 });
  if (tick % 3 === 0) {
    if (dABord) { await rpc(A.jeton, 'equipage_retirer', { p_cle_client: crypto.randomUUID(), p_passe_id: pA, p_utilisateur_id: D.id }); log('  → D est DESCENDU de « ZZTEST Camion 1 » (la bulle doit dire : personne d\'autre à bord)'); }
    else { await rpc(A.jeton, 'equipage_ajouter', { p_cle_client: crypto.randomUUID(), p_passe_id: pA, p_utilisateur_id: D.id }); log('  → D est REMONTÉ à bord de « ZZTEST Camion 1 » (la bulle doit de nouveau nommer ZZTEST Eq D)'); }
    dABord = !dABord;
  }
}, 10000);
const rlFin = readline.createInterface({ input: process.stdin, output: process.stdout });
await rlFin.question('');
clearInterval(battement);
rlFin.close();
log('\nPositions arrêtées. Les camions resteront affichés en pâle après 3 minutes, puis disparaîtront avec le nettoyage.');
log('MAINTENANT : exécute 10-nettoyage-comptes-zztest.sql dans Supabase (SQL Editor) pour effacer les comptes, véhicules et passes d\'essai.');
process.exit(0);
