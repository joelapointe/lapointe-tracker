// Étape 19b — Copier des clients d'une route à une autre (route personnalisée « route Ghislain 24 septembre », ou un client
// qui change de service, ex. engrais → coupe de gazon), et désactiver/réactiver une route.
// AUCUNE nouvelle fonction serveur ni nouveau fichier SQL : les règles d'accès existantes (routes_admin, stops_admin, étape 8)
// laissent déjà l'administrateur créer une route et copier un arrêt par une écriture directe (même principe que Véhicules et
// Types de service, étape 19 : voir www/js/admin-routes.js). Ce test vérifie que ces écritures directes se comportent comme
// admin-routes.js les fait, et surtout que le mécanisme des tâches (étape 13 : une route peut mélanger plusieurs services)
// accepte bien une copie avec un service différent de l'original — c'est ce qui rend la fonctionnalité utile pour de vrai.
// Banc d'essai local (base PGlite), sur le modèle de test-nouvelle-saison.mjs.
import { prepare } from './prepare.mjs';
import { randomUUID } from 'crypto';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql',
  '23-etape19-types-service.sql', '24-etape19-corriger-quart.sql', '25-etape-nouvelle-saison-route.sql'];

const db = await prepare(FILES);
const q = async (sql, p) => (await db.query(sql, p)).rows;
async function sqlAs(uid, sql, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(sql, params)).rows; } finally { await db.query('reset role'); }
}
async function fn(uid, call, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(`select public.${call} as r`, params)).rows[0].r; } finally { await db.query('reset role'); }
}
async function err(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 80)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;

const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const luc = await ins('luc@t.ca', { nom: 'Luc', telephone: '8195550001' });

// Noms distincts des 2 routes déjà pré-remplies par prepare.mjs (« Route Nord »/« Route Sud », 13 arrêts de test) : pas d'interférence
const routeNeige = (await q(`insert into routes(nom) values ('Route Test Neige') returning id`))[0].id;
const routeEngrais = (await q(`insert into routes(nom) values ('Route Test Engrais') returning id`))[0].id;
const equipe = (await q(`insert into equipes(nom) values ('Camion Test 19b') returning id`))[0].id;
const clientEngrais = (await q(
  `insert into stops(adresse, client, service, lat, lon, route_id) values ($1,$2,$3,$4,$5,$6) returning id`,
  ['456 rue B', 'Client Engrais', 'Engrais', 46.5, -72.7, routeEngrais]))[0].id;

log('=== CRÉER UNE ROUTE (écriture directe, comme le bouton « Nouvelle route » existant) ===');
{
  const r = await sqlAs(admin, `insert into routes(nom) values ($1) returning actif`, ['Route Ghislain 24 septembre']);
  vrai('l\'administrateur crée une route directement, active par défaut', r.length === 1 && r[0].actif === true);
  await err('un employé ne peut pas créer une route (refusé)', () => sqlAs(luc, `insert into routes(nom) values ($1)`, ['Route pirate']), 'row-level security');
  await err('un visiteur ne peut pas créer une route (refusé)', () => sqlAs(null, `insert into routes(nom) values ($1)`, ['Route pirate'], 'anon'), 'permission denied');
}

log('\n=== COPIER UN ARRÊT VERS UNE AUTRE ROUTE : L\'ORIGINAL N\'EST JAMAIS TOUCHÉ ===');
let copieId;
{
  const avant = (await q(`select route_id, service, actif from stops where id = $1`, [clientEngrais]))[0];
  const r = await sqlAs(admin,
    `insert into stops(adresse, client, service, lat, lon, actif, route_id, ordre) values ($1,$2,$3,$4,$5,true,$6,$7) returning id, route_id, service`,
    ['456 rue B', 'Client Engrais', 'Coupe de gazon', 46.5, -72.7, routeNeige, 99]);
  copieId = r[0].id;
  vrai('la copie est un TOUT NOUVEL arrêt (id différent de l\'original)', copieId !== clientEngrais);
  eq('la copie porte le service choisi au moment de copier (Coupe de gazon)', r[0].service, 'Coupe de gazon');
  eq('la copie est sur la route destination (Route Test Neige)', r[0].route_id, routeNeige);
  const apres = (await q(`select route_id, service, actif from stops where id = $1`, [clientEngrais]))[0];
  eq('l\'original n\'a PAS changé de route', apres.route_id, avant.route_id);
  eq('l\'original n\'a PAS changé de service', apres.service, avant.service);
  vrai('l\'original est toujours actif (« apparaît aux deux », demande de Joé)', apres.actif);
  await err('un employé ne peut pas copier un arrêt (refusé)', () => sqlAs(luc,
    `insert into stops(adresse, service, actif, route_id) values ($1,$2,true,$3)`, ['x', 'x', routeNeige]), 'row-level security');
}

log('\n=== LA COPIE FONCTIONNE VRAIMENT DANS UNE PASSE, AVEC SON NOUVEAU SERVICE (étape 13, « tâche ») ===');
{
  const debut = await fn(luc, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,null,null,null,null,$4)`,
    [randomUUID(), routeNeige, equipe, 'Coupe de gazon']);
  eq('démarrer une passe « Coupe de gazon » sur la route destination : la copie est comptée', debut.nb_arrets_total, 1);
  eq('… la tâche choisie est bien celle de la copie', debut.tache, 'Coupe de gazon');
}

log('\n=== COMPLÉTER L\'ORIGINAL NE COMPLÈTE PAS LA COPIE : HISTORIQUES INDÉPENDANTS ===');
{
  const idPasse = randomUUID();
  await fn(luc, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,null,null,null,null,$4)`, [idPasse, routeEngrais, equipe, 'Engrais']);
  await fn(luc, `completer_arret($1::uuid,$2::uuid)`, [idPasse, clientEngrais]);
  const passagesOriginal = await q(`select complete_le from passe_arrets where stop_id = $1`, [clientEngrais]);
  const passagesCopie = await q(`select complete_le from passe_arrets where stop_id = $1`, [copieId]);
  eq('l\'original a un « dernier passage »', passagesOriginal.length, 1);
  eq('la copie n\'a AUCUN passage (afficherait « Jamais » dans l\'écran Routes)', passagesCopie.length, 0);
}

log('\n=== DÉSACTIVER / RÉACTIVER UNE ROUTE (comme un véhicule) ===');
{
  await sqlAs(admin, `update routes set actif = false where id = $1`, [routeEngrais]);
  eq('l\'administrateur désactive une route', (await q(`select actif from routes where id = $1`, [routeEngrais]))[0].actif, false);
  // Une UPDATE bloquée par RLS (clause USING) ne rejette rien : elle touche silencieusement 0 ligne (contrairement à un INSERT
  // refusé, qui lève une erreur) — même vérification que test-etape-19.mjs pour « ni désactiver » un véhicule/type de service.
  eq('un employé ne peut pas désactiver une route (refusé, 0 ligne touchée)',
    [(await sqlAs(luc, `update routes set actif = false where id = $1 returning id`, [routeNeige])).length, (await q(`select actif from routes where id = $1`, [routeNeige]))[0].actif],
    [0, true]);
  await sqlAs(admin, `update routes set actif = true where id = $1`, [routeEngrais]);
  eq('… et la réactive', (await q(`select actif from routes where id = $1`, [routeEngrais]))[0].actif, true);
}

log('\n=== VISITEUR : AUCUN ACCÈS EN ÉCRITURE ===');
{
  await err('un visiteur ne peut pas copier un arrêt', () => sqlAs(null, `insert into stops(adresse, actif, route_id) values ($1,true,$2)`, ['x', routeNeige], 'anon'), 'permission denied');
  await err('un visiteur ne peut pas désactiver une route', () => sqlAs(null, `update routes set actif = false where id = $1`, [routeNeige], 'anon'), 'permission denied');
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
