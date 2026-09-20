// Fichier 18 (étape 16d) — l'heure des gestes faits sans réseau : annuler_arret(p_moment) et problemes.cree_le (borné par un déclencheur).
// Banc d'essai local (base PGlite) : le vrai Supabase sera essayé à l'étape 16e (script reel-etape-16.mjs).
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
const FILES17 = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql'];
const FICHIER18 = '18-etape16d-heure-des-gestes-sans-reseau.sql';
const SQL18 = fs.readFileSync(SQL_DIR + FICHIER18, 'utf8');
const MEC = 'Déneigement mécanique';

const db = await prepare([...FILES17, FICHIER18]);
const q = async (sql, p) => (await db.query(sql, p)).rows;
async function fn(uid, call, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(`select public.${call} as r`, params)).rows[0].r; } finally { await db.query('reset role'); }
}
// Du SQL ordinaire, exécuté comme un employé connecté (les règles d'accès s'appliquent)
async function sqlAs(uid, sql, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(sql, params)).rows; } finally { await db.query('reset role'); }
}
async function err(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 80)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
let tel = 8198800000;
const emp = (nom) => ins(nom + uuid().slice(0, 4) + '@t.ca', { nom, telephone: String(++tel) });
const ms = (t) => new Date(t).getTime();

const debuter = (uid, id, route, equipe, min = 0) =>
  fn(uid, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [id, route, equipe, at(min), MEC]);
const completer = (uid, passe, stop, min) => fn(uid, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,'manuel'::text,null::float8,null::float8)`, [passe, stop, at(min)]);
const annuler = (uid, passe, stop, min) => (min === undefined
  ? fn(uid, `annuler_arret($1::uuid,$2::uuid)`, [passe, stop])                                           // appel « en ligne », comme avant
  : fn(uid, `annuler_arret($1::uuid,$2::uuid,$3::timestamptz)`, [passe, stop, at(min)]));                // appel rejoué, avec l'heure du geste
const terminer = (uid, passe, min = 0) => fn(uid, `terminer_passe($1::uuid,$2::timestamptz)`, [passe, at(min)]);
const fait = async (passe, stop) => (await q(`select count(*)::int n from passe_arrets where passe_id = $1 and stop_id = $2`, [passe, stop]))[0].n === 1;

const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
let nS = 0;
// Une passe neuve : un chauffeur, un véhicule, une route à 2 arrêts, débutée il y a `min` minutes
async function scenario(min = 90) {
  const uid = await emp('Chauffeur' + (++nS));
  const equipe = (await q(`insert into equipes(nom) values ($1) returning id`, ['V' + nS]))[0].id;
  const route = (await q(`insert into routes(nom) values ($1) returning id`, ['R16d ' + nS]))[0].id;
  const stops = [];
  for (const a of ['A', 'B']) stops.push((await q(`insert into stops(adresse, route_id, service, lat, lon) values ($1,$2,$3,46.5,-72.7) returning id`, [a + nS, route, MEC]))[0].id);
  const passe = uuid();
  await debuter(uid, passe, route, equipe, min);
  return { uid, passe, s1: stops[0], s2: stops[1], route };
}

log('=== LE FICHIER LUI-MÊME ===');
{
  // (nombres de lignes ET empreinte du contenu : un « update » qui changerait une valeur serait vu)
  const compte = async () => [(await q(`select count(*)::int n from passes`))[0].n, (await q(`select count(*)::int n from passe_arrets`))[0].n, (await q(`select count(*)::int n from problemes`))[0].n, (await q(`select count(*)::int n from utilisateurs`))[0].n,
    (await q(`select md5(coalesce(string_agg(id::text || cree_le::text || note, ',' order by id), '')) h from problemes`))[0].h,
    (await q(`select md5(coalesce(string_agg(passe_id::text || stop_id::text || complete_le::text, ',' order by passe_id, stop_id), '')) h from passe_arrets`))[0].h,
    (await q(`select md5(coalesce(string_agg(id::text || statut || debut::text, ',' order by id), '')) h from passes`))[0].h];
  const av = await compte();
  await db.exec(SQL18);
  eq('ré-exécuter le fichier : accepté, aucune donnée n\'est modifiée', await compte(), av);
  eq('une seule version de annuler_arret, avec le paramètre d\'heure', [(await q(`select count(*)::int n from pg_proc where proname = 'annuler_arret'`))[0].n, (await q(`select pg_get_function_arguments(oid) a from pg_proc where proname = 'annuler_arret'`))[0].a.includes('p_moment')], [1, true]);
  await err('un visiteur ne peut pas annuler un arrêt', () => fn(null, `annuler_arret($1::uuid,$2::uuid,null::timestamptz)`, [uuid(), uuid()], 'anon'), 'permission denied');
  eq('aucune fonction ouverte au visiteur', (await q(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')`))[0].n, 0);
  eq('le déclencheur des problèmes n\'est appelable par personne d\'autre que la base', (await q(`select has_function_privilege('authenticated', 'public._trg_problemes_borner_cree_le()', 'execute') a, has_function_privilege('anon', 'public._trg_problemes_borner_cree_le()', 'execute') b`))[0], { a: false, b: false });
  vrai('aucune clé secrète ni mot de passe', !/service_role|sb_secret|password/i.test(SQL18));
  const verif = (await q(SQL18.slice(SQL18.indexOf('select jsonb_build_object(', SQL18.lastIndexOf('-- VÉRIFICATION'))).replace(/;\s*$/, '')))[0].verification;
  eq('la requête « vérification » du bas : 1 version à 3 paramètres, visiteur refusé, employé permis, verrouillée, déclencheur présent, cree_le écrivable à l\'insertion seulement, aucune fonction ouverte au visiteur',
    [verif.annuler_arret_versions, verif.annuler_arret_parametres.includes('p_moment timestamp with time zone'), verif.annuler_arret_visiteur_peut_appeler, verif.annuler_arret_employe_peut_appeler, verif.annuler_arret_verrouillee_search_path,
      verif.declencheur_problemes_present, verif.employe_peut_ecrire_cree_le_a_linsertion, verif.employe_peut_modifier_cree_le, verif.fonctions_appelables_par_un_visiteur], [1, true, false, true, true, 1, true, false, []]);
  const sans = await prepare(FILES17.slice(0, 3));
  await err('sans les fichiers précédents : REFUSÉ, avec un message clair', () => sans.exec(SQL18), 'n\'existe pas');
}

log('\n=== ANNULER UN ARRÊT : SANS L\'HEURE DU GESTE, RIEN NE CHANGE (appel en ligne) ===');
{
  const s = await scenario();
  await completer(s.uid, s.passe, s.s1, 0);
  const r = await annuler(s.uid, s.passe, s.s1);
  eq('« Complété » puis « Annuler » tout de suite (2 paramètres, comme avant) : annulé', [r.statut, await fait(s.passe, s.s1)], ['annule', false]);
  const t = await scenario();
  await completer(t.uid, t.passe, t.s1, 11);
  await err('« Complété » il y a 11 minutes, « Annuler » sans heure : trop tard, comme avant', () => annuler(t.uid, t.passe, t.s1), 'delai_depasse');
  eq('… l\'arrêt reste complété', await fait(t.passe, t.s1), true);
}

log('\n=== ANNULER UN ARRÊT : LES 10 MINUTES SE COMPTENT DEPUIS L\'HEURE DU GESTE ===');
{
  const s = await scenario();
  await completer(s.uid, s.passe, s.s1, 30);
  const r = await annuler(s.uid, s.passe, s.s1, 25);
  eq('« Complété » il y a 30 min, « Annuler » FAIT il y a 25 min (5 min après) et rejoué maintenant : accepté (avant le fichier 18 : refusé « trop tard »)', [r.statut, await fait(s.passe, s.s1), r.faits], ['annule', false, 0]);
  const t = await scenario();
  await completer(t.uid, t.passe, t.s1, 30);
  await err('« Annuler » fait il y a 15 min (15 min après le « Complété ») : trop tard, même rejoué', () => annuler(t.uid, t.passe, t.s1, 15), 'delai_depasse');
  eq('… l\'arrêt reste complété', await fait(t.passe, t.s1), true);
  const u = await scenario();
  await completer(u.uid, u.passe, u.s1, 30);
  await err('« Annuler » fait il y a 19 min (11 min après le « Complété ») : trop tard', () => annuler(u.uid, u.passe, u.s1, 19), 'delai_depasse');
  eq('… à 10 min moins un peu (fait il y a 20,5 min : 9,5 min après) : accepté', (await annuler(u.uid, u.passe, u.s1, 20.5)).statut, 'annule');
}

log('\n=== UNE ANNULATION RENVOYÉE N\'ANNULE JAMAIS UN « COMPLÉTÉ » PLUS RÉCENT ===');
{
  const s = await scenario();
  await completer(s.uid, s.passe, s.s1, 60);
  eq('1re annulation (faite il y a 55 min, 5 min après le « Complété ») : annulé', (await annuler(s.uid, s.passe, s.s1, 55)).statut, 'annule');
  await completer(s.uid, s.passe, s.s1, 20);   // l'arrêt est refait, plus tard
  const r = await annuler(s.uid, s.passe, s.s1, 55);   // la MÊME annulation est renvoyée (réponse perdue)
  eq('la même annulation renvoyée : IGNORÉE (« pas complété »), le « Complété » plus récent reste', [r.statut, await fait(s.passe, s.s1)], ['pas_complete', true]);
  const t = await scenario();
  await completer(t.uid, t.passe, t.s1, 60);
  await annuler(t.uid, t.passe, t.s1, 55);
  eq('renvoyée alors que rien n\'a changé : « pas complété », sans erreur (un renvoi est inoffensif)', (await annuler(t.uid, t.passe, t.s1, 55)).statut, 'pas_complete');
  const u = await scenario();
  await completer(u.uid, u.passe, u.s1, 3);
  eq('tolérance de 2 minutes (l\'horloge d\'un autre téléphone peut avancer) : annulation faite 1 min avant le « Complété » : acceptée', (await annuler(u.uid, u.passe, u.s1, 4)).statut, 'annule');
  const v = await scenario();
  await completer(v.uid, v.passe, v.s1, 3);
  eq('… mais faite 4 min AVANT le « Complété » : ignorée', [(await annuler(v.uid, v.passe, v.s1, 7)).statut, await fait(v.passe, v.s1)], ['pas_complete', true]);
}

log('\n=== LES MÊMES RÈGLES QUE LES AUTRES GESTES : TROP ANCIEN, FUTUR ===');
{
  const s = await scenario();
  await completer(s.uid, s.passe, s.s1, 5);
  await err('une annulation datée de plus de 3 jours : refusée', () => annuler(s.uid, s.passe, s.s1, 60 * 24 * 4), 'geste_trop_ancien');
  eq('… l\'arrêt reste complété', await fait(s.passe, s.s1), true);
  eq('une heure dans le futur (téléphone mal réglé) compte comme MAINTENANT : accepté', (await annuler(s.uid, s.passe, s.s1, -24 * 60)).statut, 'annule');
}

log('\n=== LES DROITS NE CHANGENT PAS ===');
{
  const s = await scenario();
  await completer(s.uid, s.passe, s.s1, 30);
  const autre = await emp('Autre');
  await err('un autre employé ne peut pas annuler l\'arrêt de ce chauffeur', () => annuler(autre, s.passe, s.s1, 25), 'non_autorise');
  eq('l\'administrateur peut annuler même après 10 minutes', (await annuler(admin, s.passe, s.s1, 0)).statut, 'annule');
  const t = await scenario();
  await err('une passe introuvable : refusé', () => annuler(t.uid, uuid(), t.s1, 0), 'passe_introuvable');
  eq('un arrêt jamais complété : « pas complété »', (await annuler(t.uid, t.passe, t.s2, 0)).statut, 'pas_complete');
}

log('\n=== LA PASSE FERMÉE À 100 % SE ROUVRE, MÊME AVEC L\'HEURE DU GESTE ===');
{
  const s = await scenario();
  await completer(s.uid, s.passe, s.s1, 40);
  const fin = await completer(s.uid, s.passe, s.s2, 30);
  eq('les deux arrêts complétés : la passe est fermée à 100 %', [fin.statut, (await q(`select statut, fin_type from passes where id = $1`, [s.passe]))[0]], ['complete', { statut: 'terminee', fin_type: 'complete' }]);
  const r = await annuler(s.uid, s.passe, s.s2, 25);
  eq('« Annuler » le dernier, fait il y a 25 min (5 min après) : annulé, la passe est ROUVERTE', [r.statut, r.passe_rouverte, (await q(`select statut from passes where id = $1`, [s.passe]))[0].statut, r.faits], ['annule', true, 'en_cours', 1]);
  const t = await scenario();
  await completer(t.uid, t.passe, t.s1, 40);
  await terminer(t.uid, t.passe, 20);
  await err('une passe terminée à la main : on n\'annule plus (comme avant), même dans les 10 minutes', () => annuler(t.uid, t.passe, t.s1, 35), 'passe_terminee');
}

log('\n=== PROBLÈMES : L\'HEURE DU SIGNALEMENT, DONNÉE PAR L\'APPLICATION, BORNÉE PAR LE SERVEUR ===');
{
  const s = await scenario();
  const signaler = (uid, id, note, creeLe) => (creeLe === undefined
    ? sqlAs(uid, `insert into public.problemes(id, stop_id, note) values ($1,$2,$3) returning cree_le`, [id, s.s1, note])
    : sqlAs(uid, `insert into public.problemes(id, stop_id, note, cree_le) values ($1,$2,$3,$4) returning cree_le`, [id, s.s1, note, creeLe]));
  const r1 = await signaler(s.uid, uuid(), 'Barrière brisée', at(120));
  vrai('signalé hors réseau il y a 2 h : la base garde l\'heure du GESTE (pas celle de l\'envoi)', Math.abs(ms(r1[0].cree_le) - (Date.now() - 120 * 60000)) < 3000, String(r1[0].cree_le));
  const r2 = await signaler(s.uid, uuid(), 'Sans heure');
  vrai('sans heure (comme avant l\'étape 16) : maintenant', Math.abs(ms(r2[0].cree_le) - Date.now()) < 3000, String(r2[0].cree_le));
  const r3 = await signaler(s.uid, uuid(), 'Horloge avancée', at(-24 * 60));
  vrai('une heure dans le futur : ramenée à maintenant', Math.abs(ms(r3[0].cree_le) - Date.now()) < 3000, String(r3[0].cree_le));
  const r4 = await signaler(s.uid, uuid(), 'Presque 3 jours', at(60 * 24 * 2.9));
  vrai('il y a 2,9 jours : accepté (le serveur accepte un geste jusqu\'à 3 jours)', Math.abs(ms(r4[0].cree_le) - (Date.now() - 60 * 24 * 2.9 * 60000)) < 3000, String(r4[0].cree_le));
  await err('il y a 4 jours : refusé (« geste trop ancien »)', () => signaler(s.uid, uuid(), 'Trop vieux', at(60 * 24 * 4)), 'geste_trop_ancien');
  eq('… rien n\'est enregistré pour celui-là', (await q(`select count(*)::int n from problemes where note = 'Trop vieux'`))[0].n, 0);
  await err('un employé ne peut PAS modifier l\'heure d\'un problème après coup', () => sqlAs(s.uid, `update public.problemes set cree_le = now() where note = 'Sans heure'`), 'permission denied');
  const idAdmin = uuid();
  await signaler(s.uid, idAdmin, 'À marquer lu', at(10));
  await sqlAs(admin, `update public.problemes set lu = true, lu_par = $1, lu_le = now() where id = $2`, [admin, idAdmin]);
  const lu = (await q(`select lu, cree_le from problemes where id = $1`, [idAdmin]))[0];
  vrai('l\'administrateur marque toujours « lu » ; l\'heure du problème ne bouge pas (le déclencheur ne s\'applique qu\'à l\'insertion)', lu.lu === true && Math.abs(ms(lu.cree_le) - (Date.now() - 10 * 60000)) < 3000, JSON.stringify(lu));
  const idVieux = uuid();
  await q(`alter table public.problemes disable trigger problemes_borner_cree_le`);   // (pour PRÉPARER une donnée ancienne : le déclencheur borne toute insertion, même celle de la base)
  await q(`insert into problemes(id, stop_id, utilisateur_id, note, cree_le) values ($1,$2,$3,'Très ancien',$4)`, [idVieux, s.s1, s.uid, at(60 * 24 * 5)]);
  await q(`alter table public.problemes enable trigger problemes_borner_cree_le`);
  await sqlAs(admin, `update public.problemes set lu = true, lu_par = $1, lu_le = now() where id = $2`, [admin, idVieux]);
  const vieux = (await q(`select lu, cree_le from problemes where id = $1`, [idVieux]))[0];
  vrai('l\'administrateur peut marquer « lu » un problème vieux de 5 jours (le déclencheur ne s\'applique pas aux mises à jour)', vieux.lu === true && Math.abs(ms(vieux.cree_le) - (Date.now() - 5 * 24 * 60 * 60000)) < 3000, JSON.stringify(vieux));
  await err('signaler au nom de quelqu\'un d\'autre reste refusé (règle d\'accès inchangée)', () => sqlAs(s.uid, `insert into public.problemes(id, stop_id, note, utilisateur_id) values ($1,$2,'X',$3)`, [uuid(), s.s1, admin]), 'row-level security');
}

log('\n=== AVANT ET APRÈS LE FICHIER 18 : CE QUI CHANGE, ET RIEN D\'AUTRE ===');
{
  const avant = await prepare(FILES17);
  eq('avant : l\'employé ne peut pas écrire cree_le (l\'application, mise à jour trop tôt, serait refusée : d\'où l\'ordre « SQL d\'abord »)', (await avant.query(`select has_column_privilege('authenticated', 'public.problemes', 'cree_le', 'insert') a`)).rows[0].a, false);
  eq('avant : annuler_arret n\'accepte pas d\'heure', (await avant.query(`select pg_get_function_arguments(oid) a from pg_proc where proname = 'annuler_arret'`)).rows[0].a.includes('p_moment'), false);
  // Un problème déjà signalé garde son heure
  const uid = (await avant.query(`insert into auth.users(email, raw_app_meta_data) values ('vieux@t.ca', $1::jsonb) returning id`, [JSON.stringify({ nom: 'Vieux', telephone: '8190000001' })])).rows[0].id;
  const stop = (await avant.query(`insert into stops(adresse, service, lat, lon) values ('Vieille adresse', $1, 46.5, -72.7) returning id`, [MEC])).rows[0].id;
  const vieux = uuid();
  await avant.query(`insert into problemes(id, stop_id, utilisateur_id, note, cree_le) values ($1,$2,$3,'Ancien',$4)`, [vieux, stop, uid, at(60 * 24 * 40)]);
  await avant.exec(SQL18);
  const apres = (await avant.query(`select cree_le from problemes where id = $1`, [vieux])).rows[0];
  vrai('un problème signalé il y a 40 jours (avant le fichier) garde son heure après le fichier', Math.abs(ms(apres.cree_le) - (Date.now() - 40 * 24 * 60 * 60000)) < 3000, String(apres.cree_le));
  eq('après : l\'employé peut écrire cree_le à l\'insertion, et l\'ancienne version d\'annuler_arret a disparu (une seule version, avec l\'heure)', [(await avant.query(`select has_column_privilege('authenticated', 'public.problemes', 'cree_le', 'insert') a`)).rows[0].a, (await avant.query(`select count(*)::int n from pg_proc where proname = 'annuler_arret'`)).rows[0].n], [true, 1]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
