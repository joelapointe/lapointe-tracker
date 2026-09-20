// Fichier 17 (étape 15a) — equipage_precedent() : les personnes qui étaient à bord avec MOI à ma dernière passe.
// Banc d'essai local (base PGlite) : le vrai Supabase sera essayé par reel-etape-15.mjs.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';
import { randomUUID as uuid } from 'crypto';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql'];
const SQL17 = fs.readFileSync(SQL_DIR + FILES[9], 'utf8');
const MEC = 'Déneigement mécanique';

const db = await prepare(FILES);
const q = async (sql, p) => (await db.query(sql, p)).rows;
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
let tel = 8197500000;
const emp = (nom) => ins(nom + uuid().slice(0, 4) + '@t.ca', { nom, telephone: String(++tel) });

const debuter = (uid, id, route, equipe, min = 0) =>
  fn(uid, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [id, route, equipe, at(min), MEC]);
const ajouter = (uid, passe, user, min, forcer = false) =>
  fn(uid, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::boolean)`, [uuid(), passe, user, at(min), forcer]);
const retirer = (uid, passe, user, min) =>
  fn(uid, `equipage_retirer($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real)`, [uuid(), passe, user, at(min)]);
const terminer = (uid, passe, min = 0) => fn(uid, `terminer_passe($1::uuid,$2::timestamptz)`, [passe, at(min)]);
const precedent = (uid) => fn(uid, `equipage_precedent()`);
const AUCUN = { fin: null, membres: [], passe_id: null };   // (la base range les champs dans son propre ordre)
const noms = (r) => r.membres.map((m) => m.nom);

const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const U = {}; for (const n of ['Luc', 'Marc', 'Gaby', 'Eric', 'Nina', 'Oscar', 'Paul', 'Zoe']) U[n] = await emp(n);
const C = {}; for (const n of ['C1', 'C2', 'C3']) C[n] = (await q(`insert into equipes(nom) values ($1) returning id`, [n]))[0].id;
const route = async (nom) => (await q(`insert into routes(nom) values ($1) returning id`, [nom]))[0].id;
const rA = await route('T15 A'), rB = await route('T15 B');
let n = 0;
for (const r of [rA, rA, rB, rB]) await q(`insert into stops(adresse, route_id, service, lat, lon) values ($1,$2,$3,46.5,-72.7)`, ['Adresse ' + (++n), r, MEC]);

log('=== LE FICHIER LUI-MÊME ===');
{
  const av = [(await q(`select count(*)::int n from passes`))[0].n, (await q(`select count(*)::int n from equipage_periodes`))[0].n, (await q(`select count(*)::int n from utilisateurs`))[0].n];
  await db.exec(SQL17);
  eq('ré-exécuter le fichier : accepté, rien n\'est modifié', [(await q(`select count(*)::int n from passes`))[0].n, (await q(`select count(*)::int n from equipage_periodes`))[0].n, (await q(`select count(*)::int n from utilisateurs`))[0].n], av);
  eq('une seule version de la fonction', (await q(`select count(*)::int n from pg_proc where proname = 'equipage_precedent'`))[0].n, 1);
  await err('un visiteur ne peut pas l\'appeler', () => fn(null, `equipage_precedent()`, [], 'anon'), 'permission denied');
  eq('aucune fonction ouverte au visiteur', (await q(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')`))[0].n, 0);
  const sansCommentaires = SQL17.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  vrai('le fichier ne modifie rien (ni insert, ni update, ni delete, ni drop, ni truncate, ni alter)', !/\b(insert\s+into|update\s+public|delete\s+from|drop\s|truncate|alter\s)\b/i.test(sansCommentaires));
  vrai('aucune clé secrète ni mot de passe', !/service_role|sb_secret|password/i.test(SQL17));
  const verif = (await q(SQL17.slice(SQL17.indexOf('select jsonb_build_object(', SQL17.lastIndexOf('-- VÉRIFICATION'))).replace(/;\s*$/, '')))[0].verification;
  eq('la requête « vérification » du bas : 1 version, visiteur refusé, employé permis, fonction verrouillée',
    [verif.equipage_precedent_versions, verif.visiteur_peut_appeler, verif.employe_peut_appeler, verif.fonction_verrouillee_search_path, verif.fonctions_appelables_par_un_visiteur], [1, false, true, true, []]);
  const sans = await prepare(FILES.slice(0, 3));
  await err('sans les fichiers d\'équipage : REFUSÉ, avec un message clair', () => sans.exec(SQL17), 'n\'ont pas été exécutés');
}

log('\n=== AUCUNE PASSE TERMINÉE : aucun nom ===');
{
  eq('Luc n\'a encore fait aucune passe', await precedent(U.Luc), AUCUN);
  eq('l\'administrateur non plus', await precedent(admin), AUCUN);
}

log('\n=== L\'ÉQUIPAGE À LA FIN DE MA DERNIÈRE PASSE ===');
const p1 = uuid(), p2 = uuid(), p3 = uuid();
{
  await debuter(U.Luc, p1, rA, C.C1, 90);
  await ajouter(U.Luc, p1, U.Marc, 80); await ajouter(U.Luc, p1, U.Eric, 75); await ajouter(U.Luc, p1, U.Nina, 70);
  await ajouter(U.Luc, p1, U.Zoe, 65); await ajouter(U.Luc, p1, U.Paul, 60);
  eq('pendant que la passe est EN COURS : rien (seule une passe terminée compte)', await precedent(U.Luc), AUCUN);

  await debuter(U.Gaby, p2, rB, C.C2, 70);
  const r = await ajouter(U.Gaby, p2, U.Marc, 55);
  eq('(Gaby veut Marc, déjà à bord chez Luc : avertissement nommé, rien ne change)', [r.statut, r.avertissements?.[0]?.type], ['avertissement', 'conflit_vehicule']);
  const t = await ajouter(U.Gaby, p2, U.Marc, 55, true);
  eq('(Gaby confirme : Marc est TRANSFÉRÉ vers son camion)', t.statut, 'transfere');
  eq('(Nina descend du camion de Luc avant la fin)', (await retirer(U.Luc, p1, U.Nina, 40)).statut, 'retire');
  await ajouter(U.Luc, p1, U.Oscar, 20);
  await terminer(U.Luc, p1, 10);
  await q(`update utilisateurs set actif = false where id = $1`, [U.Zoe]);

  const r1 = await precedent(U.Luc);
  eq('MON équipage à la fin : Eric, Oscar, Paul (Marc est parti au transfert, Nina est descendue, Zoe est désactivée, je ne me compte pas)', noms(r1), ['Eric', 'Oscar', 'Paul']);
  eq('… avec leurs numéros, en ordre alphabétique', r1.membres.map((m) => m.utilisateur_id), [U.Eric, U.Oscar, U.Paul]);
  eq('… la passe concernée est la mienne, terminée', [r1.passe_id, typeof r1.fin], [p1, 'string']);
  eq('l\'appel est stable (deux lectures, même réponse)', await precedent(U.Luc), r1);
}

log('\n=== CHACUN NE VOIT QUE LE SIEN ===');
{
  eq('Marc (passager de Luc, puis de Gaby) n\'a jamais été chauffeur : aucun nom, il ne voit PAS l\'équipage de Luc', await precedent(U.Marc), AUCUN);
  eq('Eric (passager) : rien non plus', noms(await precedent(U.Eric)), []);
  eq('Gaby : sa passe est encore en cours, donc rien', noms(await precedent(U.Gaby)), []);
  await terminer(U.Gaby, p2, 5);
  const g = await precedent(U.Gaby);
  eq('Gaby termine : son équipage est Marc (arrivé par transfert et toujours à bord à la fin)', [noms(g), g.passe_id], [['Marc'], p2]);
  eq('celui de Luc n\'a pas bougé', noms(await precedent(U.Luc)), ['Eric', 'Oscar', 'Paul']);
  await err('un employé désactivé ne peut pas l\'appeler', () => precedent(U.Zoe), 'non_autorise');
}

log('\n=== SEULE LA DERNIÈRE PASSE COMPTE ===');
{
  await debuter(U.Luc, p3, rA, C.C1, 4);
  eq('nouvelle passe EN COURS de Luc : il retrouve encore l\'équipage de sa dernière passe TERMINÉE', noms(await precedent(U.Luc)), ['Eric', 'Oscar', 'Paul']);
  await terminer(U.Luc, p3, 1);
  const r = await precedent(U.Luc);
  eq('sa nouvelle passe (sans personne à bord) est maintenant la dernière : aucun nom', [r.passe_id, noms(r)], [p3, []]);
  eq('les passes plus anciennes ne reviennent pas (jamais de retour en arrière)', (await precedent(U.Luc)).membres.length, 0);
}

log('\n=== DROITS ET ÉTAT DE LA BASE ===');
{
  eq('aucune fonction ouverte au visiteur', (await q(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')`))[0].n, 0);
  eq('les anciennes fonctions d\'équipage existent toujours (une seule version chacune)', (await q(`select proname, count(*)::int n from pg_proc where proname in ('equipage_ajouter', 'equipage_retirer', 'debuter_passe') group by proname order by proname`)).map((x) => [x.proname, x.n]), [['debuter_passe', 1], ['equipage_ajouter', 1], ['equipage_retirer', 1]]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
