// Étape 19 (morceaux 4 et 5) — Fichiers SQL 23 (types_service) et 24 (admin_corriger_quart, corriger l'heure d'un quart à la main).
// Banc d'essai local (base PGlite), sur le modèle de test-etape-17.mjs. Ce que ce test NE peut PAS vérifier : le vrai Supabase
// (à exécuter par Joé, comme les fichiers SQL précédents).
// SQL23_TEST/SQL24_TEST (variables d'environnement) : une COPIE abîmée du fichier, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
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

const FILES19 = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const FICHIER23 = '23-etape19-types-service.sql';
const SQL23 = fs.readFileSync(process.env.SQL23_TEST || (SQL_DIR + FICHIER23), 'utf8');
const FICHIER24 = '24-etape19-corriger-quart.sql';
const SQL24 = fs.readFileSync(process.env.SQL24_TEST || (SQL_DIR + FICHIER24), 'utf8');

const db = await prepare(FILES19);
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
const nina = await ins('nina@t.ca', { nom: 'Nina', telephone: '8195550001' });

await db.exec(SQL23);
await db.exec(SQL24);

// L'ordre vient de la collation PostgreSQL par défaut de PGlite (tri par octet, pas français) : Épandage (É) se classe après Ramassage.
const NOMS_DEPART = ['Autre', 'Coupe de gazon', 'Déneigement manuel', 'Déneigement mécanique', 'Engrais', 'Entretien paysager', 'Ramassage de feuilles', 'Épandage de sel'];

log('=== LA TABLE, PRÉ-REMPLIE ===');
{
  eq('les 8 types déjà utilisés (menu déroulant d\'avant l\'étape 19), tous actifs', (await q(`select nom from types_service order by nom`)).map((x) => x.nom), NOMS_DEPART);
  eq('… tous actifs par défaut', (await q(`select count(*)::int n from types_service where actif`))[0].n, 8);
  const avant = (await q(`select nom, actif from types_service order by nom`)).map((x) => [x.nom, x.actif]);
  await db.exec(SQL23);   // ré-exécuter le fichier
  eq('ré-exécuter le fichier NE DOUBLE PAS les 8 types (on conflict do nothing)', (await q(`select count(*)::int n from types_service`))[0].n, 8);
  eq('… et ne touche à rien de ce qui existe déjà', (await q(`select nom, actif from types_service order by nom`)).map((x) => [x.nom, x.actif]), avant);
}

log('\n=== LECTURE : LES ACTIFS POUR TOUS, TOUT POUR L\'ADMINISTRATEUR ===');
{
  eq('un employé lit les 8 types actifs', (await sqlAs(nina, `select nom from types_service order by nom`)).map((x) => x.nom), NOMS_DEPART);
  await q(`update types_service set actif = false where nom = 'Engrais'`);
  eq('un employé ne voit PLUS un type désactivé', (await sqlAs(nina, `select nom from types_service order by nom`)).map((x) => x.nom), NOMS_DEPART.filter((n) => n !== 'Engrais'));
  eq('… mais l\'administrateur le voit toujours (pour pouvoir le réactiver)', (await sqlAs(admin, `select nom from types_service order by nom`)).map((x) => x.nom), NOMS_DEPART);
  await q(`update types_service set actif = true where nom = 'Engrais'`);
}

log('\n=== ÉCRITURE : L\'ADMINISTRATEUR SEULEMENT ===');
{
  await err('un employé ne peut pas créer un type (refusé)', () => sqlAs(nina, `insert into types_service(nom) values ('Déglaçage') returning nom`), 'row-level security');
  eq('… ni renommer', [(await sqlAs(nina, `update types_service set nom = 'x' where nom = 'Autre' returning nom`)).length, (await q(`select nom from types_service where nom = 'Autre'`)).length], [0, 1]);
  eq('… ni désactiver', [(await sqlAs(nina, `update types_service set actif = false where nom = 'Autre' returning nom`)).length, (await q(`select actif from types_service where nom = 'Autre'`))[0].actif], [0, true]);
  eq('… ni supprimer', (await sqlAs(nina, `delete from types_service where nom = 'Autre' returning nom`)).length, 0);
  eq('l\'administrateur peut créer un type', (await sqlAs(admin, `insert into types_service(nom) values ('Déglaçage') returning nom`))[0].nom, 'Déglaçage');
  eq('… renommer', (await sqlAs(admin, `update types_service set nom = 'Déglaçage express' where nom = 'Déglaçage' returning nom`))[0].nom, 'Déglaçage express');
  eq('… désactiver puis réactiver', [(await sqlAs(admin, `update types_service set actif = false where nom = 'Déglaçage express' returning actif`))[0].actif, (await sqlAs(admin, `update types_service set actif = true where nom = 'Déglaçage express' returning actif`))[0].actif], [false, true]);
  await q(`delete from types_service where nom = 'Déglaçage express'`);   // remis pour la suite des essais
}

log('\n=== UN NOM DÉJÀ UTILISÉ EST REFUSÉ (contrainte unique) ===');
{
  let refuse = false;
  try { await q(`insert into types_service(nom) values ('Autre')`); } catch (e) { refuse = /unique|duplicate/i.test(e.message); }
  vrai('deux types du même nom : la base refuse (le nom est UNIQUE)', refuse);
}

log('\n=== stops.service RESTE UN SIMPLE TEXTE (renommer un type ne touche pas les arrêts déjà créés) ===');
{
  const stopId = (await q(`select id from stops limit 1`))[0].id;
  await q(`update stops set service = 'Épandage de sel' where id = $1`, [stopId]);
  await sqlAs(admin, `update types_service set nom = 'Sel (renommé)' where nom = 'Épandage de sel'`);
  eq('l\'arrêt garde son ancien texte (« Épandage de sel »), même si le type a été renommé', (await q(`select service from stops where id = $1`, [stopId]))[0].service, 'Épandage de sel');
  await q(`update types_service set nom = 'Épandage de sel' where nom = 'Sel (renommé)'`);   // remis pour la suite
}

log('\n=== VISITEUR (non connecté) : aucun accès ===');
{
  eq('un visiteur ne peut pas lire types_service', (await q(`select has_table_privilege('anon', 'public.types_service', 'select') as r`))[0].r, false);
}

log('\n=== SQL 24 : admin_corriger_quart (corriger l\'heure d\'un quart à la main) ===');
{
  const luc = await ins('luc@t.ca', { nom: 'Luc', telephone: '8195550002' });
  const marc = await ins('marc@t.ca', { nom: 'Marc', telephone: '8195550003' });
  const insQuart = async (uid, debut, fin, over = {}) => (await q(
    `insert into quarts(utilisateur_id, debut, debut_source, fin, fin_source, fin_estimee, a_valider, raison_a_valider, note)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [uid, debut, over.debut_source ?? 'manuel', fin, fin === null ? null : (over.fin_source ?? 'delai_max'),
     over.fin_estimee ?? (fin !== null), over.a_valider ?? true, over.raison_a_valider ?? 'fin_estimee', over.note ?? null]))[0].id;
  const corriger = (uid, id, debut, fin, note) => fn(uid, `admin_corriger_quart($1::uuid,$2::timestamptz,$3::timestamptz,$4::text)`, [id, debut, fin, note]);

  const q1 = await insQuart(luc, '2026-09-20T08:00:00Z', '2026-09-20T16:00:00Z');
  const res = await corriger(admin, q1, '2026-09-20T08:30:00Z', '2026-09-20T15:30:00Z', 'corrigé par téléphone');
  eq('corrige : statut, quart_id', [res.statut, res.quart_id], ['corrige', q1]);
  const ligne1 = (await q(`select debut, fin, debut_source, fin_source, fin_estimee, a_valider, raison_a_valider, valide_par, valide_le is not null as valide, note from quarts where id = $1`, [q1]))[0];
  eq('les heures et sources sont mises à jour, fin_estimee redevient false, a_valider levé, valide_par = l\'administrateur, valide_le rempli, la note posée',
    [new Date(ligne1.debut).toISOString(), new Date(ligne1.fin).toISOString(), ligne1.debut_source, ligne1.fin_source, ligne1.fin_estimee, ligne1.a_valider, ligne1.valide_par, ligne1.valide, ligne1.note],
    [new Date('2026-09-20T08:30:00Z').toISOString(), new Date('2026-09-20T15:30:00Z').toISOString(), 'admin', 'admin', false, false, admin, true, 'corrigé par téléphone']);

  const q2 = await insQuart(luc, '2026-09-21T08:00:00Z', '2026-09-21T16:00:00Z', { note: 'note déjà là' });
  await corriger(admin, q2, '2026-09-21T08:00:00Z', '2026-09-21T16:00:00Z', 'note ajoutée');
  eq('la note s\'AJOUTE à celle déjà là (séparées par « | »), jamais remplacée', (await q(`select note from quarts where id = $1`, [q2]))[0].note, 'note déjà là | note ajoutée');

  const q3 = await insQuart(luc, '2026-09-22T08:00:00Z', '2026-09-22T16:00:00Z');
  await err('un employé ne peut pas corriger un quart (refusé)', () => corriger(luc, q3, '2026-09-22T08:00:00Z', '2026-09-22T16:00:00Z', null), 'non_autorise');

  await err('un quart introuvable est refusé', () => corriger(admin, '00000000-0000-0000-0000-000000000000', '2026-09-20T08:00:00Z', '2026-09-20T16:00:00Z', null), 'quart_introuvable');

  const q4 = await insQuart(luc, '2026-09-24T08:00:00Z', null, { fin_source: null, fin_estimee: false, raison_a_valider: 'ouvert_par_equipage' });
  await err('un quart encore OUVERT ne peut pas être corrigé (même règle que admin_valider_quart)', () => corriger(admin, q4, '2026-09-24T08:00:00Z', '2026-09-24T16:00:00Z', null), 'quart_encore_ouvert');

  const q5 = await insQuart(nina, '2026-09-20T08:00:00Z', '2026-09-20T16:00:00Z');
  await err('la fin doit être après le début (periode_invalide)', () => corriger(admin, q5, '2026-09-20T16:00:00Z', '2026-09-20T08:00:00Z', null), 'periode_invalide');

  const q6 = await insQuart(marc, '2026-09-23T08:00:00Z', '2026-09-23T12:00:00Z');
  const q7 = await insQuart(marc, '2026-09-23T14:00:00Z', '2026-09-23T18:00:00Z');
  await err('le nouvel horaire ne peut pas chevaucher un autre quart du MÊME employé (contrainte d\'exclusion, déjà en place)', () => corriger(admin, q7, '2026-09-23T10:00:00Z', '2026-09-23T18:00:00Z', null), 'exclu');

  await db.exec(SQL24);   // ré-exécuter le fichier (create or replace) : sans danger
  const res6 = await corriger(admin, q6, '2026-09-23T08:00:00Z', '2026-09-23T12:30:00Z', null);
  vrai('ré-exécuter le fichier 24 ne casse rien : la fonction répond toujours', res6.statut === 'corrige');

  eq('un visiteur ne peut pas appeler la fonction', (await q(`select has_function_privilege('anon', 'public.admin_corriger_quart(uuid, timestamptz, timestamptz, text)', 'execute') as r`))[0].r, false);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
