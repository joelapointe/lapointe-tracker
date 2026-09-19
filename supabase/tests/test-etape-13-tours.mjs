// Fichier 13 (étape 13a) — tâche d'une passe et TOUR partagé entre camions.
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
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql'];
const SQL13 = fs.readFileSync(SQL_DIR + FILES[5], 'utf8');
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
let tel = 8197000000;
const emp = (nom) => ins(nom + uuid().slice(0, 4) + '@t.ca', { nom, telephone: String(++tel) });

const debuter = (uid, id, route, equipe, membres = [], min = 0, tache = null) =>
  fn(uid, `debuter_passe($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::timestamptz,46.5::float8,-72.7::float8,null::real,$6::text)`, [id, route, equipe, JSON.stringify(membres), at(min), tache]);
const completer = (uid, passe, stop, min = 0) =>
  fn(uid, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,'manuel',46.5::float8,-72.7::float8)`, [passe, stop, at(min)]);
const annuler = (uid, passe, stop) => fn(uid, `annuler_arret($1::uuid,$2::uuid)`, [passe, stop]);
const terminer = (uid, passe, min = 0) => fn(uid, `terminer_passe($1::uuid,$2::timestamptz)`, [passe, at(min)]);
const ajouter = (uid, passe, user, min) =>
  fn(uid, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real,false)`, [uuid(), passe, user, at(min)]);
const tours = (uid) => fn(uid, `tours_en_cours()`);
const passe = async (id) => (await q(`select statut, fin_type, numero, tache, nb_arrets_total as total, nb_arrets_faits as faits, pourcentage from passes where id = $1`, [id]))[0];
const nbLignes = async (route, numero, stop) => Number((await q(`select count(*)::int n from passe_arrets pa join passes p on p.id = pa.passe_id where p.route_id = $1 and p.numero = $2 and pa.stop_id = $3`, [route, numero, stop]))[0].n);
const tri = (a) => [...a].sort();

// ----- Personnes, véhicules, routes, arrêts -----
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const U = {}; for (const n of ['Luc', 'Marc', 'Gaby', 'Eric', 'Nina', 'Oscar', 'Zoe']) U[n] = await emp(n);
await q(`update utilisateurs set actif = false where id = $1`, [U.Zoe]);
const C = {}; for (const n of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) C[n] = (await q(`insert into equipes(nom) values ($1) returning id`, [n]))[0].id;
const route = async (nom) => (await q(`insert into routes(nom) values ($1) returning id`, [nom]))[0].id;
const rA = await route('T13 A (2 services)'), rB = await route('T13 B (1 service)'), rC = await route('T13 C'), rV = await route('T13 Vide'), rE = await route('T13 E (2 services)');
let n = 0;
const stop = async (r, service) => (await q(`insert into stops(adresse, route_id, service, lat, lon) values ($1,$2,$3,46.5,-72.7) returning id`, ['Adresse ' + (++n), r, service]))[0].id;
const m = []; for (let i = 0; i < 4; i++) m.push(await stop(rA, MEC));        // 4 arrêts de déneigement mécanique sur A
const s = []; for (let i = 0; i < 2; i++) s.push(await stop(rA, SEL));         // 2 arrêts d'épandage de sel sur A
const b = []; for (let i = 0; i < 3; i++) b.push(await stop(rB, MEC));         // route B : un seul service
const c = []; for (let i = 0; i < 4; i++) c.push(await stop(rC, MEC));
for (let i = 0; i < 2; i++) await stop(rE, SEL);     // route E : 2 arrêts de sel + 1 de déneigement
await stop(rE, MEC);

log('=== LE FICHIER LUI-MÊME ===');
{
  const col = (await q(`select is_nullable from information_schema.columns where table_name = 'passes' and column_name = 'tache'`))[0];
  eq('passes.tache existe et est obligatoire', col?.is_nullable, 'NO');
  await err('ré-exécuter le fichier : REFUSÉ (déjà exécuté)', () => db.exec(SQL13), 'déjà été exécuté');
  eq('l\'ancien numéro unique par route a disparu', (await q(`select count(*)::int n from pg_constraint where conname = 'passes_numero_unique_par_route'`))[0].n, 0);
  eq('une seule version de debuter_passe (l\'ancienne est supprimée)', (await q(`select count(*)::int n from pg_proc where proname = 'debuter_passe'`))[0].n, 1);
  await err('un visiteur ne peut pas lire les tours', () => fn(null, `tours_en_cours()`, [], 'anon'), 'permission denied');
  await err('un visiteur ne peut pas débuter une passe', () => fn(null, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,null,null,null,null,null)`, [uuid(), rA, C.C1], 'anon'), 'permission denied');
  await err('un employé désactivé ne peut pas lire les tours', () => tours(U.Zoe), 'non_autorise');
  await err('un employé ne peut pas appeler l\'outil interne _faits_du_tour', () => fn(U.Luc, `_faits_du_tour($1::uuid, 1, 'x')`, [rA]), 'permission denied');
  eq('aucun tour en cours au départ', await tours(U.Luc), []);
}

log('\n=== LA TÂCHE : celle qu\'on choisit, ou la seule possible ===');
{
  await err('route à 2 services, sans tâche : REFUSÉ', () => debuter(U.Luc, uuid(), rA, C.C1), 'tache_requise');
  await err('tâche qui n\'existe pas sur la route : REFUSÉ', () => debuter(U.Luc, uuid(), rA, C.C1, [], 0, 'Entretien paysager'), 'tache_sans_arret');
  await err('route vide + tâche demandée : REFUSÉ', () => debuter(U.Luc, uuid(), rV, C.C1, [], 0, MEC), 'tache_sans_arret');
  eq('… rien n\'a été créé par ces refus', (await q(`select count(*)::int n from passes`))[0].n, 0);
  const p1 = uuid(); let r = await debuter(U.Oscar, p1, rV, C.C6);
  eq('route SANS arrêt et sans tâche : accepté (comportement d\'avant), tâche par défaut', [r.statut, r.tache, r.nb_arrets_total], ['debutee', MEC, 0]);
  await terminer(U.Oscar, p1);
  const pS = uuid(); r = await debuter(U.Oscar, pS, rB, C.C6);
  eq('route à UN seul service, sans tâche : la tâche est déduite', [r.statut, r.tache, r.numero, r.nb_arrets_total], ['debutee', MEC, 1, 3]);
  await terminer(U.Oscar, pS);
  const pT = uuid(); r = await debuter(U.Oscar, pT, rE, C.C6, [], 0, '  ' + SEL + '  ');
  eq('la tâche est nettoyée (espaces) et comptée : 2 arrêts de sel', [r.tache, r.nb_arrets_total], [SEL, 2]);
  await terminer(U.Oscar, pT);
}

log('\n=== PASSE TERMINÉE : les gestes en retard (hors réseau) comptent jusqu\'à sa fin ===');
let rB1;
{
  const pN = uuid(); await debuter(U.Nina, pN, rB, C.C5, [], 90);
  await completer(U.Nina, pN, b[0], 80);
  await terminer(U.Nina, pN, 60);
  eq('passe terminée à 60 min : 1 arrêt fait', (await passe(pN)).faits, 1);
  const r = await completer(U.Nina, pN, b[1], 70);            // geste noté à 70 min, reçu après la fin (60 min)
  eq('geste hors réseau daté d\'AVANT la fin : accepté', r.statut, 'complete');
  eq('… la passe terminée compte maintenant 2 arrêts', (await passe(pN)).faits, 2);
  eq('geste daté d\'APRÈS la fin : refusé (passe_terminee)', (await completer(U.Nina, pN, b[2], 50)).statut, 'passe_terminee');
  eq('… toujours 2', (await passe(pN)).faits, 2);
  rB1 = pN;
}

log('\n=== TOUR PARTAGÉ : deux camions, même route, même tâche ===');
const pL = uuid(), pM = uuid(), pG = uuid();
{
  let r = await debuter(U.Luc, pL, rA, C.C1, [], 60, MEC);
  eq('Luc démarre : tour n° 1, nouveau tour', [r.numero, r.tour_rejoint, r.nb_arrets_total, r.tache], [1, false, 4, MEC]);
  r = await debuter(U.Marc, pM, rA, C.C2, [], 50, MEC);
  eq('Marc démarre, même route et même tâche : il REJOINT le tour n° 1', [r.numero, r.tour_rejoint, r.nb_arrets_total], [1, true, 4]);
  r = await debuter(U.Gaby, pG, rA, C.C3, [], 40, SEL);
  eq('Gaby démarre une AUTRE tâche (sel) : son propre tour n° 2', [r.numero, r.tour_rejoint, r.nb_arrets_total, r.tache], [2, false, 2, SEL]);
  eq('les trois passes existent, chacune avec son camion', (await q(`select count(distinct equipe_id)::int n from passes where id = any($1::uuid[])`, [[pL, pM, pG]]))[0].n, 3);

  r = await completer(U.Luc, pL, m[0], 45);
  eq('Luc complète le 1er arrêt : 1/4 = 25 %', [r.statut, r.faits, r.total, r.pourcentage], ['complete', 1, 4, 25]);
  r = await completer(U.Marc, pM, m[0], 30);
  eq('Marc complète le MÊME arrêt : « déjà complété » (partagé), rien n\'est ajouté', [r.statut, r.faits], ['deja_complete', 1]);
  eq('… une seule ligne pour cet arrêt dans le tour', await nbLignes(rA, 1, m[0]), 1);
  r = await completer(U.Marc, pM, m[1], 25);
  eq('Marc complète le 2e : 2/4 = 50 %', [r.statut, r.faits, r.pourcentage], ['complete', 2, 50]);
  eq('les DEUX camions du tour affichent 2 arrêts faits', [(await passe(pL)).faits, (await passe(pM)).faits], [2, 2]);
  eq('le camion de sel n\'est pas touché (0 fait, 2 au total)', [(await passe(pG)).faits, (await passe(pG)).total], [0, 2]);

  await err('le camion de sel ne peut pas compléter un arrêt de déneigement', () => completer(U.Gaby, pG, m[2], 20), 'arret_hors_tache');
  await err('le camion de déneigement ne peut pas compléter un arrêt de sel', () => completer(U.Luc, pL, s[0], 20), 'arret_hors_tache');
  await err('un arrêt d\'une autre route est refusé', () => completer(U.Luc, pL, b[2], 20), 'arret_hors_route');
  await ajouter(U.Luc, pL, U.Eric, 30);
  await err('un passager ne peut pas compléter (seul le chauffeur)', () => completer(U.Eric, pL, m[2], 20), 'non_autorise');
  const rr = await completer(admin, pL, m[2], 10);
  eq('l\'administrateur peut compléter : 3/4 = 75 %', [rr.statut, rr.faits, rr.pourcentage], ['complete', 3, 75]);
}

log('\n=== LECTURE POUR L\'APPLICATION : tours_en_cours() ===');
{
  const vuGaby = await tours(U.Gaby);
  eq('deux tours en cours sur la route A (déneigement et sel)', vuGaby.map((t) => [t.numero, t.tache]).sort(), [[1, MEC], [2, SEL]]);
  const t1 = vuGaby.find((t) => t.numero === 1);
  eq('tour 1 : 3/4, 75 %', [t1.faits, t1.total, t1.pourcentage], [3, 4, 75]);
  eq('… les arrêts faits sont ceux des DEUX camions et de l\'administrateur, vus de Gaby (autre tâche)', tri(t1.arrets_faits), tri([m[0], m[1], m[2]]));
  eq('… deux camions dans le tour', t1.passes.length, 2);
  vrai('… Gaby n\'y est ni chauffeur ni à bord', t1.passes.every((p) => !p.je_suis_chauffeur && !p.je_suis_a_bord));
  eq('tour 2 (sel) : 0/2', (({ faits, total }) => [faits, total])(vuGaby.find((t) => t.numero === 2)), [0, 2]);
  const vuLuc = (await tours(U.Luc)).find((t) => t.numero === 1).passes;
  eq('vu de Luc : chauffeur de SA passe seulement', vuLuc.map((p) => [p.passe_id === pL, p.je_suis_chauffeur]).sort(), [[false, false], [true, true]]);
  const vuEric = (await tours(U.Eric)).find((t) => t.numero === 1).passes.find((p) => p.passe_id === pL);
  eq('vu d\'Éric (passager de Luc) : à bord, pas chauffeur', [vuEric.je_suis_a_bord, vuEric.je_suis_chauffeur], [true, false]);
  vrai('aucune donnée personnelle : que des identifiants (pas de nom ni de téléphone)', !JSON.stringify(vuGaby).match(/telephone|nom"/));
  eq('aucun tour terminé n\'apparaît (la route B a une passe terminée seulement)', vuGaby.filter((t) => t.route_id === rB).length, 0);
}

log('\n=== « TERMINER » : ne ferme que son camion, le tour continue ===');
const pL2 = uuid();
{
  const r = await terminer(U.Luc, pL, 5);
  eq('Luc termine sa passe', [r.statut, r.faits], ['terminee', 3]);
  eq('… la passe de Marc continue', (await passe(pM)).statut, 'en_cours');
  const t = (await tours(U.Marc)).find((x) => x.numero === 1);
  eq('… le tour n° 1 n\'a plus qu\'un camion et garde ses 3 arrêts faits', [t.passes.length, t.faits], [1, 3]);
  const rr = await debuter(U.Luc, pL2, rA, C.C1, [], 3, MEC);
  eq('Luc redémarre pendant que Marc est en cours : il REJOINT le tour n° 1 avec ses 3 arrêts déjà faits', [rr.numero, rr.tour_rejoint, rr.nb_arrets_faits], [1, true, '3']);
  eq('… sa nouvelle passe affiche 3/4', [(await passe(pL2)).faits, (await passe(pL2)).total], [3, 4]);
}

log('\n=== 100 % : tous les camions du tour se terminent ensemble ===');
{
  const r = await completer(U.Luc, pL2, m[3], 2);
  eq('le dernier arrêt est complété : 100 %, passe fermée', [r.statut, r.pourcentage, r.passe_fermee], ['complete', 100, true]);
  const a = await passe(pL2), bb = await passe(pM);
  eq('les DEUX camions sont terminés « complete »', [a.statut, a.fin_type, bb.statut, bb.fin_type], ['terminee', 'complete', 'terminee', 'complete']);
  eq('… à la même heure', (await q(`select count(distinct fin)::int n from passes where id = any($1::uuid[])`, [[pL2, pM]]))[0].n, 1);
  eq('… leurs positions sont effacées', (await q(`select count(*)::int n from positions where passe_id = any($1::uuid[])`, [[pL2, pM]]))[0].n, 0);
  eq('… leur équipage est sorti', (await q(`select count(*)::int n from equipage_periodes where passe_id = any($1::uuid[]) and fin is null`, [[pL2, pM]]))[0].n, 0);
  eq('le camion de sel (autre tour) continue', (await passe(pG)).statut, 'en_cours');
  eq('le tour de déneigement n\'apparaît plus dans la lecture', (await tours(U.Luc)).map((t) => t.numero), [2]);
}

log('\n=== NOUVEAU TOUR, ET ANNULATION QUI ROUVRE LE TOUR ===');
const pL3 = uuid(), pLB = uuid();
{
  let r = await debuter(U.Luc, pL3, rA, C.C1, [], 1, MEC);
  eq('après la fermeture, un camion qui démarre ouvre un NOUVEAU tour (n° 3, 0 fait)', [r.numero, r.tour_rejoint, r.nb_arrets_faits], [3, false, '0']);

  await err('annuler le dernier arrêt de l\'ancien tour alors qu\'un nouveau est ouvert : REFUSÉ', () => annuler(U.Marc, pM, m[3]), 'impossible_de_rouvrir');
  eq('… rien n\'a changé (arrêt toujours fait, passe toujours terminée)', [await nbLignes(rA, 1, m[3]), (await passe(pM)).statut], [1, 'terminee']);

  await terminer(U.Luc, pL3);
  r = await debuter(U.Luc, pLB, rB, C.C1, [], 1);          // Luc est maintenant occupé sur la route B (nouveau tour : celui de Nina est terminé)
  eq('Luc démarre sur la route B : nouveau tour n° 3 (les tours n° 1 et n° 2 de la route B sont terminés)', [r.numero, r.tour_rejoint], [3, false]);

  r = await annuler(U.Marc, pM, m[3]);                      // Marc (dernier arrêt, fait il y a 2 min, dans les 10 min permises)
  eq('Marc annule le dernier arrêt : la passe de Marc se rouvre', [r.statut, r.passe_rouverte], ['annule', true]);
  eq('… l\'arrêt n\'est plus fait (3/4)', [await nbLignes(rA, 1, m[3]), (await passe(pM)).faits, (await passe(pM)).statut], [0, 3, 'en_cours']);
  eq('… la passe de Luc reste fermée (il travaille déjà ailleurs)', (await passe(pL2)).statut, 'terminee');
  eq('… le tour n° 1 est de nouveau en cours, avec un seul camion', (await tours(U.Marc)).find((t) => t.numero === 1)?.passes.length, 1);

  r = await annuler(U.Marc, pM, m[0]).catch((e) => ({ erreur: e.message }));
  vrai('un arrêt fait il y a plus de 10 min ne s\'annule pas par le chauffeur (délai)', String(r.erreur || '').includes('delai_depasse'), JSON.stringify(r));
  r = await annuler(admin, pM, m[0]);
  eq('… mais l\'administrateur peut, sans limite', [r.statut, r.faits], ['annule', 2]);
  r = await annuler(U.Marc, pM, m[3]);
  eq('annuler un arrêt qui n\'est pas fait : « pas_complete »', r.statut, 'pas_complete');
}

log('\n=== L\'AUTRE CAMION PEUT ANNULER L\'ARRÊT DE SON COLLÈGUE (même tour, dans les 10 minutes) ===');
{
  const pP = uuid(), pQ = uuid();
  await debuter(U.Oscar, pP, rC, C.C4, [], 20);
  await debuter(U.Nina, pQ, rC, C.C5, [], 15);
  await completer(U.Oscar, pP, c[0], 3);
  eq('Oscar complète un arrêt : Nina voit 1/4 aussi', (await passe(pQ)).faits, 1);
  const r = await annuler(U.Nina, pQ, c[0]);
  eq('Nina (l\'autre camion) l\'annule : accepté', [r.statut, r.faits], ['annule', 0]);
  eq('… plus aucune ligne pour cet arrêt', await nbLignes(rC, 1, c[0]), 0);

  log('\n=== CHANGER LE TYPE DE SERVICE D\'UN ARRÊT RECALCULE LE TOUR (déclencheur) ===');
  await completer(U.Oscar, pP, c[0], 3); await completer(U.Nina, pQ, c[1], 3); await completer(U.Oscar, pP, c[2], 2);
  eq('3 arrêts faits sur 4', [(await passe(pP)).faits, (await passe(pQ)).total], [3, 4]);
  await q(`update stops set service = $2 where id = $1`, [c[3], SEL]);      // le dernier arrêt devient un arrêt de sel : il sort de ce tour
  const a = await passe(pP), bb = await passe(pQ);
  eq('le tour passe à 3/3 et SE FERME (les deux camions)', [a.total, a.faits, a.statut, a.fin_type, bb.statut, bb.fin_type], [3, 3, 'terminee', 'complete', 'terminee', 'complete']);
}

log('\n=== COHÉRENCE : un tour n\'a jamais deux tâches ===');
{
  await err('changer la tâche d\'une passe pour qu\'elle contredise son tour : REFUSÉ', () => q(`update passes set tache = $2 where id = $1`, [pM, SEL]), 'tour_incoherent');
  await err('insérer à la main une passe du même tour avec une autre tâche : REFUSÉ',
    () => q(`insert into passes(route_id, equipe_id, chauffeur_id, numero, tache, debut) values ($1,$2,$3,1,$4,now())`, [rA, C.C4, U.Nina, SEL]), 'tour_incoherent');
  eq('numéros de la route A : tour 1 (déneigement, 2 passes de Luc/Marc), tour 2 (sel), tour 3 (déneigement)',
    (await q(`select numero, tache, count(*)::int n from passes where route_id = $1 group by numero, tache order by numero`, [rA])).map((x) => [x.numero, x.tache, x.n]),
    [[1, MEC, 3], [2, SEL, 1], [3, MEC, 1]]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
