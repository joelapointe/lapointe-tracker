// Fichier SQL 25 — « Nouvelle saison » d'une route : routes.numero_base, tours_en_cours() ajusté, admin_nouvelle_saison_route().
// Banc d'essai local (base PGlite), sur le modèle de test-etape-19.mjs. Ce que ce test NE peut PAS vérifier : le vrai Supabase
// (à exécuter par Joé, comme les fichiers SQL précédents).
// SQL25_TEST (variable d'environnement) : une COPIE abîmée du fichier 25, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const il = (heuresAvant) => new Date(Date.now() - heuresAvant * 3600000).toISOString();

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql',
  '23-etape19-types-service.sql', '24-etape19-corriger-quart.sql'];
const FICHIER25 = '25-etape-nouvelle-saison-route.sql';
const SQL25 = fs.readFileSync(process.env.SQL25_TEST || (SQL_DIR + FICHIER25), 'utf8');

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
const MEC = 'Déneigement mécanique';

const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const luc = await ins('luc@t.ca', { nom: 'Luc', telephone: '8195550001' });

await db.exec(SQL25);

const route = (await q(`insert into routes(nom) values ('Route Test') returning id`))[0].id;
const equipe = (await q(`insert into equipes(nom) values ('Camion Test') returning id`))[0].id;
// (passes : pas de debut_source/fin_source — ces colonnes sont sur « quarts », une AUTRE table ; fin_type est requis dès que statut ≠ en_cours)
const passeTerminee = (numero, debutIl, finIl) => q(
  `insert into passes(route_id, equipe_id, chauffeur_id, numero, debut, fin, statut, fin_type, nb_arrets_total, tache)
   values ($1,$2,$3,$4,$5,$6,'terminee','manuelle',0,$7)`,
  [route, equipe, luc, numero, il(debutIl), il(finIl), MEC]);
const passeEnCoursNo = (numero) => q(
  `insert into passes(route_id, equipe_id, chauffeur_id, numero, debut, statut, nb_arrets_total, tache)
   values ($1,$2,$3,$4,now(),'en_cours',0,$5) returning id`,
  [route, equipe, luc, numero, MEC]);

log('=== routes.numero_base, TOURS_EN_COURS() AJUSTÉ ===');
{
  eq('routes.numero_base existe, 0 par défaut (aucun changement d\'affichage tant qu\'il n\'a pas servi)', (await q(`select numero_base from routes where id = $1`, [route]))[0].numero_base, 0);

  await passeTerminee(1, 50, 46);   // il y a ~2 jours, 4 h de travail
  await passeTerminee(2, 26, 23);   // il y a ~1 jour, 3 h de travail

  const tour1 = (await sqlAs(luc, `select public.tours_en_cours() as r`))[0].r.find((t) => t.route_id === route);
  eq('tours_en_cours() : le numéro montré est le VRAI numero tant que numero_base = 0', tour1 && tour1.numero, 2);
}

log('\n=== « NOUVELLE SAISON » : REFUSÉE TANT QU\'UNE PASSE EST EN COURS ===');
{
  const passeEnCours = (await passeEnCoursNo(3))[0].id;

  await err('un employé ne peut pas appeler admin_nouvelle_saison_route (refusé)', () => fn(luc, `admin_nouvelle_saison_route($1::uuid)`, [route]), 'non_autorise');

  const refus = await fn(admin, `admin_nouvelle_saison_route($1::uuid)`, [route]);
  // (jsonb ne garde pas l'ordre d'écriture des clés : « raison » ressort avant « statut »)
  eq('l\'administrateur : REFUSÉ tant qu\'une passe de la route est encore en cours', refus, { raison: 'passe_en_cours', statut: 'refuse' });
  eq('… numero_base n\'a pas bougé', (await q(`select numero_base from routes where id = $1`, [route]))[0].numero_base, 0);

  await q(`update passes set statut = 'terminee', fin = now(), fin_type = 'manuelle' where id = $1`, [passeEnCours]);

  const succes = await fn(admin, `admin_nouvelle_saison_route($1::uuid)`, [route]);
  eq('plus aucune passe en cours : l\'administrateur avance la saison (numero_base = 3, le dernier numero utilisé)', succes, { statut: 'ok', route_id: route, numero_base: 3 });
  eq('routes.numero_base est bien mis à jour', (await q(`select numero_base from routes where id = $1`, [route]))[0].numero_base, 3);
}

log('\n=== LE VRAI numero NE CHANGE JAMAIS : L\'HISTORIQUE RESTE INTACT ===');
{
  await passeEnCoursNo(4);
  const tour2 = (await sqlAs(luc, `select public.tours_en_cours() as r`))[0].r.find((t) => t.route_id === route);
  eq('le VRAI numero (4) n\'a JAMAIS été touché, mais l\'AFFICHAGE redevient « 1 »', tour2 && tour2.numero, 1);
  eq('… en base, le vrai numero est toujours 4 (rien n\'a été renommé : l\'historique reste intact)', (await q(`select numero from passes where route_id = $1 and statut = 'en_cours'`, [route]))[0].numero, 4);
  eq('les 3 anciennes passes gardent aussi leur vrai numero (1, 2, 3), jamais recyclé', (await q(`select numero from passes where route_id = $1 and statut = 'terminee' order by numero`, [route])).map((x) => x.numero), [1, 2, 3]);
}

log('\n=== VISITEUR, ROUTE INTROUVABLE, RÉ-EXÉCUTION DU FICHIER ===');
{
  eq('un visiteur ne peut pas appeler la fonction', (await q(`select has_function_privilege('anon', 'public.admin_nouvelle_saison_route(uuid)', 'execute') as r`))[0].r, false);
  await err('une route introuvable est refusée', () => fn(admin, `admin_nouvelle_saison_route($1::uuid)`, ['00000000-0000-0000-0000-000000000000']), 'route_introuvable');
  await db.exec(SQL25);
  eq('ré-exécuter le fichier ne touche pas numero_base déjà avancé', (await q(`select numero_base from routes where id = $1`, [route]))[0].numero_base, 3);
  const tour3 = (await sqlAs(luc, `select public.tours_en_cours() as r`))[0].r.find((t) => t.route_id === route);
  vrai('… la fonction répond toujours après la ré-exécution', tour3 && tour3.numero === 1);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
