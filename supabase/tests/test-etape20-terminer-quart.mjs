// Étape 20 — admin_terminer_quart (SQL 26) : l'administrateur peut terminer À L'INSTANT le quart d'un employé encore en
// service. Retour de Joé après un essai réel (23 sept. 2026) : un employé oublié dans un véhicule (jamais coché en
// descendant) restait « en service » indéfiniment, bloquant l'export de paie — admin_corriger_quart (SQL 24) refuse exprès
// un quart encore ouvert, elle ne sert qu'à corriger un quart DÉJÀ fermé.
// Banc d'essai local (base PGlite), sur le modèle de test-etape-19b.mjs.
import { prepare } from './prepare.mjs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import fs from 'fs';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql',
  '23-etape19-types-service.sql', '24-etape19-corriger-quart.sql', '25-etape-nouvelle-saison-route.sql', '26-etape20-terminer-quart-admin.sql'];

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
const marc = await ins('marc@t.ca', { nom: 'Marc', telephone: '8195550002' });

log('=== ADMIN_TERMINER_QUART : LE CAS NORMAL ===');
let idQuart;
{
  idQuart = randomUUID();
  await fn(luc, `quart_commencer($1::uuid)`, [idQuart]);
  vrai('Luc a bien un quart ouvert (fin manquante)', (await q(`select fin from quarts where id = $1`, [idQuart]))[0].fin === null);

  await err('un employé ne peut pas terminer un quart (refusé)', () => fn(marc, `admin_terminer_quart($1::uuid)`, [idQuart]), 'non_autorise');
  vrai('… le quart de Luc n\'a pas bougé', (await q(`select fin from quarts where id = $1`, [idQuart]))[0].fin === null);

  const res = await fn(admin, `admin_terminer_quart($1::uuid)`, [idQuart]);
  eq('l\'administrateur termine le quart : statut « termine »', res.statut, 'termine');

  const apres = (await q(`select fin, fin_source, fin_estimee, a_valider, valide_par from quarts where id = $1`, [idQuart]))[0];
  vrai('le quart est maintenant fermé, à l\'instant présent (après son début)', apres.fin !== null);
  eq('fin_source = admin, fin_estimee = false, a_valider = false, validé par l\'administrateur (déjà validé, pas à revalider ensuite)',
    [apres.fin_source, apres.fin_estimee, apres.a_valider, apres.valide_par], ['admin', false, false, admin]);
}

log('\n=== UN QUART DÉJÀ FERMÉ, INTROUVABLE, OU DÉJÀ CORRIGÉ ===');
{
  await err('terminer un quart déjà fermé (celui d\'avant) est refusé', () => fn(admin, `admin_terminer_quart($1::uuid)`, [idQuart]), 'quart_deja_termine');
  await err('un quart introuvable est refusé', () => fn(admin, `admin_terminer_quart($1::uuid)`, ['00000000-0000-0000-0000-000000000000']), 'quart_introuvable');

  // Le quart terminé par l'administrateur est maintenant un quart FERMÉ comme un autre : admin_corriger_quart peut le reprendre ensuite si besoin
  const corrige = await fn(admin, `admin_corriger_quart($1::uuid,$2::timestamptz,$3::timestamptz)`,
    [idQuart, new Date(Date.now() - 3600000).toISOString(), new Date().toISOString()]);
  eq('… et reste corrigeable ensuite comme n\'importe quel quart fermé (admin_corriger_quart)', corrige.statut, 'corrige');
}

log('\n=== LA NOTE S\'AJOUTE, JAMAIS REMPLACÉE ; RÉ-EXÉCUTION DU FICHIER ===');
{
  const idQ2 = randomUUID();
  await fn(marc, `quart_commencer($1::uuid)`, [idQ2]);
  await q(`update quarts set note = 'déjà une remarque' where id = $1`, [idQ2]);
  await fn(admin, `admin_terminer_quart($1::uuid,$2::text)`, [idQ2, 'oublié dans le camion']);
  eq('la note du terminer s\'AJOUTE à celle déjà là (séparées par « | »)', (await q(`select note from quarts where id = $1`, [idQ2]))[0].note, 'déjà une remarque | oublié dans le camion');

  await db.exec(fs.readFileSync(SQL_DIR + '26-etape20-terminer-quart-admin.sql', 'utf8'));
  eq('ré-exécuter le fichier 26 ne casse rien : le quart déjà terminé reste tel quel', (await q(`select fin_source from quarts where id = $1`, [idQ2]))[0].fin_source, 'admin');
}

log('\n=== VISITEUR : AUCUN ACCÈS ===');
{
  eq('un visiteur ne peut pas appeler la fonction', (await q(`select has_function_privilege('anon', 'public.admin_terminer_quart(uuid, text)', 'execute') as r`))[0].r, false);
  eq('un employé (rôle authenticated) PEUT appeler la fonction au sens SQL (comme les autres admin_*) : c\'est « non_autorise » qui le bloque, déjà prouvé plus haut',
    (await q(`select has_function_privilege('authenticated', 'public.admin_terminer_quart(uuid, text)', 'execute') as r`))[0].r, true);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
