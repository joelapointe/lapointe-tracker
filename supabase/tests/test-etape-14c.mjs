// Fichier 15 (étape 14c) — le DERNIER TOUR TERMINÉ reste visible (décision de Joé), âge des arrêts faits, passes annulables.
// Banc d'essai local (base PGlite) : le vrai Supabase sera essayé par reel-etape-14.mjs.
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
const AVANT = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql'];
const FILES = [...AVANT, '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql'];
const SQL15 = fs.readFileSync(SQL_DIR + FILES[7], 'utf8');
const MEC = 'Déneigement mécanique', SEL = 'Épandage de sel';

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
let tel = 8198000000;
const emp = (nom) => ins(nom + uuid().slice(0, 4) + '@t.ca', { nom, telephone: String(++tel) });

const debuter = (uid, id, route, equipe, min = 0, tache = null) =>
  fn(uid, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [id, route, equipe, at(min), tache]);
const completer = (uid, passe, stop, min = 0) =>
  fn(uid, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,'manuel',46.5::float8,-72.7::float8)`, [passe, stop, at(min)]);
const annuler = (uid, passe, stop) => fn(uid, `annuler_arret($1::uuid,$2::uuid)`, [passe, stop]);
const terminer = (uid, passe, min = 0) => fn(uid, `terminer_passe($1::uuid,$2::timestamptz)`, [passe, at(min)]);
const tours = (uid) => fn(uid, `tours_en_cours()`);
const tourDe = (l, route, tache) => l.find((t) => t.route_id === route && t.tache === tache);
const tri = (a) => [...a].sort();

// ----- Personnes, véhicules, routes, arrêts -----
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const U = {}; for (const n of ['Luc', 'Marc', 'Gaby', 'Nina', 'Oscar', 'Zoe']) U[n] = await emp(n);
await q(`update utilisateurs set actif = false where id = $1`, [U.Zoe]);
const C = {}; for (const n of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) C[n] = (await q(`insert into equipes(nom) values ($1) returning id`, [n]))[0].id;
const route = async (nom) => (await q(`insert into routes(nom) values ($1) returning id`, [nom]))[0].id;
const rA = await route('T14 A (2 services)'), rB = await route('T14 B'), rC = await route('T14 C');
let n = 0;
const stop = async (r, service) => (await q(`insert into stops(adresse, route_id, service, lat, lon) values ($1,$2,$3,46.5,-72.7) returning id`, ['Adresse ' + (++n), r, service]))[0].id;
const m = []; for (let i = 0; i < 4; i++) m.push(await stop(rA, MEC));   // A : 4 arrêts de déneigement
const s = []; for (let i = 0; i < 2; i++) s.push(await stop(rA, SEL));   // A : 2 arrêts de sel
const b = []; for (let i = 0; i < 3; i++) b.push(await stop(rB, MEC));   // B : 3 arrêts
const c = []; for (let i = 0; i < 4; i++) c.push(await stop(rC, MEC));   // C : 4 arrêts

log('=== LE FICHIER LUI-MÊME ===');
{
  await err('sans le fichier 13 : REFUSÉ, avec un message clair', async () => { const d2 = await prepare(AVANT); await d2.exec(SQL15); }, 'fichier 13');
  const avant = [(await q(`select count(*)::int n from passes`))[0].n, (await q(`select count(*)::int n from passe_arrets`))[0].n, (await q(`select count(*)::int n from quarts`))[0].n];
  await db.exec(SQL15);
  eq('ré-exécuter le fichier : accepté, rien n\'est modifié', [(await q(`select count(*)::int n from passes`))[0].n, (await q(`select count(*)::int n from passe_arrets`))[0].n, (await q(`select count(*)::int n from quarts`))[0].n], avant);
  eq('une seule version de tours_en_cours', (await q(`select count(*)::int n from pg_proc where proname = 'tours_en_cours'`))[0].n, 1);
  await err('un visiteur ne peut pas lire les tours', () => fn(null, `tours_en_cours()`, [], 'anon'), 'permission denied');
  await err('un employé désactivé ne peut pas lire les tours', () => tours(U.Zoe), 'non_autorise');
  eq('aucun tour au départ', await tours(U.Luc), []);
  const sansEcriture = SQL15.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  vrai('le fichier ne fait aucune écriture (ni insert, ni update, ni delete, ni drop, ni truncate)', !/\b(insert\s+into|update\s+public|delete\s+from|drop\s|truncate)\b/i.test(sansEcriture));
  vrai('aucune clé secrète ni mot de passe', !/service_role|sb_secret|password/i.test(SQL15));
  const verif = (await q(SQL15.slice(SQL15.lastIndexOf('select jsonb_build_object(')).replace(/;\s*$/, '')))[0].verification;
  eq('la requête « vérification » du bas : 1 version, visiteur refusé, employé permis, aucune fonction ouverte au visiteur',
    [verif.tours_en_cours_versions, verif.visiteur_peut_lire_les_tours, verif.employe_peut_lire_les_tours, verif.fonctions_appelables_par_un_visiteur], [1, false, true, []]);
}

log('\n=== UNE PASSE COMPLÉTÉE À 100 % : le tour reste visible (vert) ===');
const pL = uuid();
{
  await debuter(U.Luc, pL, rA, C.C1, 60, MEC);
  await completer(U.Luc, pL, m[0], 30);
  await completer(U.Luc, pL, m[1], 20);
  let l = await tours(U.Luc), t = tourDe(l, rA, MEC);
  eq('en cours (2/4) : en_cours = vrai, aucune fin, un camion (le mien)', [t.en_cours, t.fin, t.fin_type, t.faits, t.total, t.pourcentage, t.passes.length, t.passes[0].je_suis_chauffeur], [true, null, null, 2, 4, 50, 1, true]);
  eq('… pas de « passes annulables » pour un tour en cours', t.mes_passes_annulables, []);
  await completer(U.Luc, pL, m[2], 3);
  await completer(U.Luc, pL, m[3], 0);   // 4/4 : la passe se ferme toute seule
  l = await tours(U.Luc); t = tourDe(l, rA, MEC);
  vrai('100 % : le tour est ENCORE renvoyé (il n\'a pas disparu)', !!t, JSON.stringify(l));
  eq('… en_cours = faux, fin_type « complete », une date de fin', [t.en_cours, t.fin_type, t.fin !== null, t.fin_estimee], [false, 'complete', true, false]);
  eq('… 4/4, 100 %, numéro 1, tous les arrêts faits', [t.faits, t.total, t.pourcentage, t.numero, tri(t.arrets_faits)], [4, 4, 100, 1, tri(m)]);
  eq('… plus aucun camion dessus', t.passes, []);
  eq('… MA passe complétée est offerte pour annuler un arrêt', t.mes_passes_annulables, [pL]);
  eq('un seul élément pour cette route et cette tâche', l.filter((x) => x.route_id === rA && x.tache === MEC).length, 1);

  const autre = tourDe(await tours(U.Marc), rA, MEC);
  eq('un AUTRE employé voit le même tour terminé (mêmes arrêts faits, 100 %)', [autre.en_cours, autre.faits, autre.pourcentage, tri(autre.arrets_faits)], [false, 4, 100, tri(m)]);
  eq('… mais PAS mes passes annulables (elles ne sont visibles que par leur chauffeur)', autre.mes_passes_annulables, []);
  eq('l\'administrateur voit aussi le tour terminé (sans passes annulables : ce n\'est pas lui le chauffeur)', [tourDe(await tours(admin), rA, MEC).faits, tourDe(await tours(admin), rA, MEC).mes_passes_annulables], [4, []]);

  // L'âge des arrêts, selon l'horloge du serveur
  const age = t.faits_il_y_a;
  eq('« faits_il_y_a » : un âge pour chacun des 4 arrêts', tri(Object.keys(age)), tri(m));
  vrai('… l\'arrêt fait il y a 30 min a environ 1800 secondes', age[m[0]] >= 1795 && age[m[0]] <= 1830, age[m[0]]);
  vrai('… celui d\'il y a 3 min, environ 180', age[m[2]] >= 175 && age[m[2]] <= 200, age[m[2]]);
  vrai('… le dernier, à l\'instant (moins de 10 secondes)', age[m[3]] >= 0 && age[m[3]] < 10, age[m[3]]);
  vrai('… ce sont des nombres entiers', Object.values(age).every(Number.isInteger));
  // L'âge est cohérent avec la règle des 10 minutes du serveur
  await err('un arrêt de plus de 10 minutes (âge > 600) : le serveur refuse l\'annulation', () => annuler(U.Luc, pL, m[1]), 'delai_depasse');
}

log('\n=== UN AUTRE TOUR SUR LA MÊME ROUTE (autre tâche) : les deux cohabitent ===');
{
  const pG = uuid();
  await debuter(U.Gaby, pG, rA, C.C3, 5, SEL);
  await completer(U.Gaby, pG, s[0], 0);
  const l = await tours(U.Luc);
  const mec = tourDe(l, rA, MEC), sel = tourDe(l, rA, SEL);
  eq('déneigement : toujours le tour terminé (vert)', [mec.en_cours, mec.faits, mec.pourcentage], [false, 4, 100]);
  eq('sel : un tour EN COURS (1/2), avec le camion de Gaby', [sel.en_cours, sel.faits, sel.total, sel.pourcentage, sel.passes.map((p) => p.passe_id), sel.numero], [true, 1, 2, 50, [pG], 2]);
  eq('deux éléments pour la route A', l.filter((x) => x.route_id === rA).length, 2);
  await terminer(U.Gaby, pG);
  const l2 = await tours(U.Luc);
  const sel2 = tourDe(l2, rA, SEL);
  eq('Gaby termine à 1/2 : le tour de sel reste visible, terminé, avec son arrêt fait en vert', [sel2.en_cours, sel2.faits, sel2.pourcentage, sel2.fin_type, tri(sel2.arrets_faits)], [false, 1, 50, 'manuelle', [s[0]]]);
  eq('… et cette passe terminée à la main n\'est PAS annulable (un arrêt d\'une passe arrêtée ne se rouvre pas)', sel2.mes_passes_annulables, []);
}

log('\n=== « DÉBUTER » REMET À ZÉRO : le nouveau tour remplace le tour terminé ===');
{
  const p2 = uuid();
  await debuter(U.Luc, p2, rA, C.C1, 0, MEC);
  const l = await tours(U.Luc);
  const mec = l.filter((x) => x.route_id === rA && x.tache === MEC);
  eq('un seul élément pour déneigement : le NOUVEAU tour (n° 3), en cours, 0/4', [mec.length, mec[0].en_cours, mec[0].numero, mec[0].faits, mec[0].pourcentage, mec[0].arrets_faits], [1, true, 3, 0, 0, []]);
  eq('… avec mon camion', [mec[0].passes.length, mec[0].passes[0].passe_id, mec[0].passes[0].je_suis_chauffeur], [1, p2, true]);
  eq('… le tour 1 n\'est plus renvoyé (il reste dans l\'historique de la base)', [l.some((x) => x.numero === 1), Number((await q(`select count(*) n from passes where route_id = $1 and numero = 1`, [rA]))[0].n) >= 1], [false, true]);
  eq('le tour de sel (autre tâche) n\'est pas touché', [tourDe(l, rA, SEL).en_cours, tourDe(l, rA, SEL).faits], [false, 1]);
  await terminer(U.Luc, p2);
  const apres = tourDe(await tours(U.Luc), rA, MEC);
  eq('Luc termine à 0 % : le tour terminé (0/4) remplace l\'ancien : tout est à faire', [apres.en_cours, apres.faits, apres.arrets_faits, apres.numero], [false, 0, [], 3]);
}

log('\n=== UNE PASSE TERMINÉE À LA MAIN (avant 100 %) : ses arrêts restent verts ===');
{
  const pM = uuid();
  await debuter(U.Marc, pM, rB, C.C2, 60);
  await completer(U.Marc, pM, b[0], 30);
  await completer(U.Marc, pM, b[1], 2);
  await terminer(U.Marc, pM, 1);
  const t = tourDe(await tours(U.Marc), rB, MEC);
  eq('2/3 : tour terminé, 66 %, fin « manuelle », les 2 arrêts faits', [t.en_cours, t.faits, t.total, t.pourcentage, t.fin_type, tri(t.arrets_faits)], [false, 2, 3, 66, 'manuelle', tri([b[0], b[1]])]);
  eq('… aucune passe annulable', t.mes_passes_annulables, []);
  await err('… et le serveur le confirme : annuler un arrêt d\'une passe terminée à la main est refusé', () => annuler(U.Marc, pM, b[1]), 'passe_terminee');
}

log('\n=== DEUX CAMIONS : l\'un termine à la main, l\'autre complète le tour ===');
const pN = uuid(), pO = uuid();
{
  await debuter(U.Nina, pN, rC, C.C5, 60);
  await debuter(U.Oscar, pO, rC, C.C6, 50);
  await completer(U.Nina, pN, c[0], 30);
  await completer(U.Nina, pN, c[1], 20);
  await terminer(U.Nina, pN, 15);
  let t = tourDe(await tours(U.Nina), rC, MEC);
  eq('Nina a terminé : le tour continue pour Oscar (en cours, 2/4)', [t.en_cours, t.faits, t.passes.map((p) => p.passe_id)], [true, 2, [pO]]);
  await completer(U.Oscar, pO, c[2], 3);
  await completer(U.Oscar, pO, c[3], 0);
  t = tourDe(await tours(U.Oscar), rC, MEC);
  eq('Oscar complète tout : tour terminé à 100 %, fin « complete »', [t.en_cours, t.faits, t.pourcentage, t.fin_type], [false, 4, 100, 'complete']);
  eq('Oscar peut annuler (sa passe est terminée à 100 %)', t.mes_passes_annulables, [pO]);
  eq('Nina ne le peut pas (sa passe a été terminée à la main)', tourDe(await tours(U.Nina), rC, MEC).mes_passes_annulables, []);
  await err('… le serveur confirme : Nina ne peut pas annuler par sa passe', () => annuler(U.Nina, pN, c[3]), 'passe_terminee');

  // Annuler le dernier arrêt : le tour se rouvre
  const r = await annuler(U.Oscar, pO, c[3]);
  eq('Oscar annule le dernier arrêt : annulé, passe rouverte', [r.statut, r.passe_rouverte], ['annule', true]);
  t = tourDe(await tours(U.Oscar), rC, MEC);
  eq('le tour est de nouveau EN COURS (3/4, 75 %), avec la passe d\'Oscar (et pas celle de Nina, terminée à la main)', [t.en_cours, t.faits, t.pourcentage, t.passes.map((p) => p.passe_id), t.passes[0].je_suis_chauffeur, t.fin], [true, 3, 75, [pO], true, null]);
  eq('… le tour n\'est renvoyé qu\'une fois', (await tours(U.Oscar)).filter((x) => x.route_id === rC).length, 1);
  vrai('… l\'arrêt annulé n\'est plus dans les arrêts faits ni dans les âges', !t.arrets_faits.includes(c[3]) && !(c[3] in t.faits_il_y_a), JSON.stringify(t));
}

log('\n=== LE REFUS DE ROUVRIR : un nouveau tour a déjà commencé ===');
{
  // Nouvelle passe complète sur la route B : terminer par 100 % puis débuter à nouveau, puis tenter d'annuler dans l'ancien tour
  const pB = uuid(), pB2 = uuid();
  await debuter(U.Nina, pB, rB, C.C5, 40);
  for (const x of b) await completer(U.Nina, pB, x, 0);
  let t = tourDe(await tours(U.Nina), rB, MEC);
  eq('route B complétée à 100 % par Nina', [t.en_cours, t.pourcentage, t.mes_passes_annulables], [false, 100, [pB]]);
  await debuter(U.Oscar, pB2, rB, C.C6, 0);
  t = tourDe(await tours(U.Nina), rB, MEC);
  eq('Oscar débute : le nouveau tour remplace le tour terminé (0 %)', [t.en_cours, t.pourcentage, t.numero], [true, 0, t.numero]);
  await err('Nina ne peut plus annuler dans l\'ancien tour (le serveur refuse de rouvrir)', () => annuler(U.Nina, pB, b[2]), 'impossible_de_rouvrir');
}

log('\n=== DROITS ET ANCIENS COMPORTEMENTS ===');
{
  const l = await tours(U.Luc);
  vrai('chaque élément a tous les champs attendus par l\'application', l.every((t) => ['route_id', 'tache', 'numero', 'en_cours', 'debut', 'fin', 'fin_type', 'fin_estimee', 'total', 'faits', 'pourcentage', 'arrets_faits', 'faits_il_y_a', 'passes', 'mes_passes_annulables'].every((k) => k in t)), JSON.stringify(Object.keys(l[0])));
  vrai('un tour en cours a toujours ses camions ; un tour terminé n\'en a jamais', l.every((t) => t.en_cours ? t.passes.length > 0 : t.passes.length === 0));
  vrai('« faits_il_y_a » n\'a jamais plus d\'arrêts que « arrets_faits »', l.every((t) => Object.keys(t.faits_il_y_a).length === t.arrets_faits.length));
  await err('les fonctions internes restent fermées à l\'employé', () => fn(U.Luc, `_faits_du_tour($1::uuid, 1, 'x')`, [rA]), 'permission denied');
  eq('aucune fonction ouverte au visiteur', (await q(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')`))[0].n, 0);
  eq('les anciennes fonctions de passes fonctionnent toujours (debuter_passe existe en une seule version)', (await q(`select count(*)::int n from pg_proc where proname = 'debuter_passe'`))[0].n, 1);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
