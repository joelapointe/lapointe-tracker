// Fichier 12 (étape 13) — remplacement des arrêts de test : ce qu'il fait, ce qu'il refuse, et ce qu'il ne touche jamais.
import { fileURLToPath } from 'url';
import { prepare } from './prepare.mjs';
import fs from 'fs';

const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
async function echoue(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 110)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql', '05-etape9b-passes-fermetures-export.sql',
  '06-etape10-outils-admin-employes.sql', '07-etape11-profil-sans-telephone.sql', '09-etape11-profil-employe-par-le-serveur.sql'];
const SQL12 = fs.readFileSync(SQL_DIR + '12-etape13-arrets-de-test-neufs.sql', 'utf8');
const lancer = async (db) => { const r = await db.exec(SQL12); return r[r.length - 1].rows[0].verification; };

// Reproduit la vraie base vérifiée le 19 septembre 2026 : 13 arrêts, 7 sans route, 6 sur « Saint-étienne-des-grès », 0 historique.
async function baseReelle() {
  const db = await prepare(FILES);
  const sup = async (sql, p) => (await db.query(sql, p)).rows;
  await sup(`delete from stops`);   // la base simulée arrive avec ses propres arrêts de départ : on repart de la situation réelle
  await sup(`delete from routes`);
  await sup(`insert into routes(nom) values ('Charette'), ('Saint-étienne-des-grès')`);
  const se = (await sup(`select id from routes where nom = 'Saint-étienne-des-grès'`))[0].id;
  const sansRoute = ['331 petit bellechasse N', '215 rue Bellerive', '50 rue Notre-Dame', '390, 2e rang', '50 notre-dame', '351 petit bellechasse nord', '230 du moulin'];
  const avecRoute = ['110 des gouverneurs', '147 des pins', '10 place J Arthur Lemire', '10 de la terrasse', '81 rue du couvent', '120 Rue Jonette'];
  let i = 0;
  for (const a of sansRoute) await sup(`insert into stops(adresse, client, ordre) values ($1, 'Ancien client', $2)`, [a, i++]);
  for (const a of avecRoute) await sup(`insert into stops(adresse, client, ordre, route_id) values ($1, 'Ancien client', $2, $3)`, [a, i++, se]);
  return { db, sup };
}

log('— Situation réelle : 13 anciens arrêts, aucun historique —');
{
  const { db, sup } = await baseReelle();
  const avant = (await sup(`select count(*)::int n from stops`))[0].n;
  eq('départ : 13 arrêts, dont 7 sans route', [avant, (await sup(`select count(*)::int n from stops where route_id is null`))[0].n], [13, 7]);

  const v = await lancer(db);
  eq('résultat : 12 arrêts, tous actifs, tous « TEST », aucun sans route', [v.arrets_total, v.arrets_actifs, v.arrets_test, v.arrets_sans_route], [12, 12, 12, 0]);
  eq('6 arrêts par route', v.par_route, { 'Charette': 6, 'Saint-étienne-des-grès': 6 });
  eq('les 13 anciens arrêts ont disparu', (await sup(`select count(*)::int n from stops where client = 'Ancien client'`))[0].n, 0);
  eq('aucune passe ni problème créés', [v.passes, v.problemes], [0, 0]);

  const st = await sup(`select s.client, s.adresse, s.service, s.lat, s.lon, s.ordre, s.fait, s.actif, r.nom as route from stops s join routes r on r.id = s.route_id order by s.ordre`);
  eq('ordre 0 à 11, sans trou ni doublon', st.map((x) => x.ordre), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  eq('noms « TEST 1 » à « TEST 12 »', st.map((x) => x.client), Array.from({ length: 12 }, (_, k) => 'TEST ' + (k + 1)));
  eq('les 6 premiers sont sur « Charette », les 6 suivants sur « Saint-étienne-des-grès »',
    st.map((x) => x.route), [...Array(6).fill('Charette'), ...Array(6).fill('Saint-étienne-des-grès')]);
  vrai('aucun arrêt n\'est « fait » au départ', st.every((x) => x.fait === false));
  vrai('tous ont des coordonnées dans la région (46.4 à 46.5 N, -73.0 à -72.7 O)',
    st.every((x) => x.lat > 46.4 && x.lat < 46.5 && x.lon > -73.0 && x.lon < -72.7), JSON.stringify(st.filter((x) => !(x.lat > 46.4 && x.lat < 46.5 && x.lon > -73.0 && x.lon < -72.7))));
  vrai('les adresses sont toutes distinctes', new Set(st.map((x) => x.adresse)).size === 12);
  vrai('au moins 3 types de service différents sur chaque route (mécanique, manuel, sel)',
    ['Charette', 'Saint-étienne-des-grès'].every((r) => new Set(st.filter((x) => x.route === r).map((x) => x.service)).size >= 3));
  const s8 = st.find((x) => x.client === 'TEST 8'), s11 = st.find((x) => x.client === 'TEST 11');
  eq('les coordonnées de Joé sont exactement celles reçues (TEST 8 = Terrasse, TEST 11 = route des Pins)',
    [s8.adresse.slice(0, 21), s8.lat, s8.lon, s11.adresse.slice(0, 18), s11.lat, s11.lon],
    ['10 rue de la Terrasse', 46.442077, -72.765319, '147 route des Pins', 46.431652, -72.767572]);

  await echoue('ré-exécuter : REFUSÉ (déjà exécuté)', () => lancer(db), 'déjà été exécuté');
  eq('… et rien n\'a changé (toujours 12)', (await sup(`select count(*)::int n from stops`))[0].n, 12);
}

log('\n— Protections : la base n\'est pas dans l\'état vérifié —');
{
  const { db, sup } = await baseReelle();
  await sup(`insert into stops(adresse, client) values ('Un 14e arrêt ajouté entre-temps', 'Vrai client')`);
  await echoue('14 arrêts au lieu de 13 : REFUSÉ', () => lancer(db), '14 arrêts, 13 attendus');
  eq('… rien n\'a été supprimé ni ajouté', (await sup(`select count(*)::int n from stops`))[0].n, 14);
}
{
  const { db, sup } = await baseReelle();
  await sup(`delete from stops where adresse = '230 du moulin'`);
  await echoue('12 arrêts au lieu de 13 : REFUSÉ', () => lancer(db), '12 arrêts, 13 attendus');
}
{
  const { db, sup } = await baseReelle();
  await sup(`update routes set nom = 'Charette (renommée)' where nom = 'Charette'`);
  await echoue('route « Charette » introuvable : REFUSÉ', () => lancer(db), '« Charette » : 0 trouvée');
  eq('… rien n\'a bougé (13 arrêts, dont 7 sans route)', (await sup(`select count(*)::int n, count(*) filter (where route_id is null)::int s from stops`))[0], { n: 13, s: 7 });
}
{
  const { db, sup } = await baseReelle();
  await sup(`insert into routes(nom) values ('Saint-étienne-des-grès')`);
  await echoue('route en double : REFUSÉ', () => lancer(db), '2 trouvée(s)');
}

log('\n— Sécurité : un ancien arrêt qui AURAIT un historique est archivé, jamais supprimé —');
{
  const { db, sup } = await baseReelle();
  await sup(`insert into auth.users(email, raw_app_meta_data) values ('8195550101@tel.entretienlapointe.ca', '{"nom":"Marc","telephone":"8195550101"}'::jsonb)`);
  const marc = (await sup(`select id from public.utilisateurs where nom = 'Marc'`))[0]?.id;
  vrai('(préparation) le profil de Marc existe', !!marc);
  const camion = (await sup(`insert into equipes(nom) values ('Camion') returning id`))[0].id;
  const se = (await sup(`select id from routes where nom = 'Saint-étienne-des-grès'`))[0].id;
  const passe = (await sup(`insert into passes(route_id, equipe_id, chauffeur_id, numero) values ($1,$2,$3,1) returning id`, [se, camion, marc]))[0].id;
  const [avecPasse, avecProbleme] = (await sup(`select id from stops where adresse in ('110 des gouverneurs','147 des pins') order by adresse`)).map((x) => x.id);
  await sup(`insert into passe_arrets(passe_id, stop_id, complete_par) values ($1,$2,$3)`, [passe, avecPasse, marc]);
  await sup(`insert into problemes(stop_id, passe_id, utilisateur_id, note) values ($1,$2,$3,'Chien méchant')`, [avecProbleme, passe, marc]);

  const v = await lancer(db);
  eq('les 2 anciens arrêts avec historique sont CONSERVÉS mais archivés (actif = false)',
    (await sup(`select actif from stops where id = any($1::uuid[]) order by actif`, [[avecPasse, avecProbleme]])).map((x) => x.actif), [false, false]);
  eq('… les 11 autres anciens sont supprimés : 2 anciens + 12 neufs = 14 au total, 12 actifs',
    [v.arrets_total, v.arrets_actifs, v.arrets_test], [14, 12, 12]);
  eq('… la passe, l\'arrêt complété et le problème sont intacts',
    [(await sup(`select count(*)::int n from passes`))[0].n, (await sup(`select count(*)::int n from passe_arrets`))[0].n, (await sup(`select count(*)::int n from problemes`))[0].n], [1, 1, 1]);
}

log('\n— Le fichier lui-même —');
{
  const lat = [...SQL12.matchAll(/'TEST (\d+)'/g)].map((m) => Number(m[1]));
  eq('12 arrêts « TEST 1 » à « TEST 12 » dans le fichier', lat, Array.from({ length: 12 }, (_, k) => k + 1));
  vrai('aucune clé secrète ni mot de passe dans le fichier', !/service_role|password|eyJ[A-Za-z0-9_-]{20,}/i.test(SQL12));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
