import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/ (chemin relatif : fonctionne depuis n'importe où)
import { prepare } from './prepare.mjs';
import fs from 'fs';
import { randomUUID as uuid } from 'crypto';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));

const db = await prepare(['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql']);
const r9 = await db.exec(fs.readFileSync(SQL_DIR + '04-etape9a-quarts-equipage.sql', 'utf8'));
log('Vérification renvoyée par le script 9a :\n' + JSON.stringify(r9[r9.length - 1].rows[0].verification, null, 1));

const q = async (sql, p) => (await db.query(sql, p)).rows;
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
async function fn(uid, call, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(`select public.${call} as r`, params)).rows[0].r; } finally { await db.query('reset role'); }
}
async function err(l, promiseFn, motif) {
  try { await promiseFn(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 70)}]`) : fail(l, 'autre erreur: ' + e.message); }
}
const commencer = (uid, id, min, lat = 46.55, lon = -72.75) => fn(uid, `quart_commencer($1::uuid,$2::timestamptz,$3::float8,$4::float8,null::real)`, [id, at(min), lat, lon]);
const terminer = (uid, id, min) => fn(uid, `quart_terminer($1::uuid,$2::timestamptz,46.5::float8,-72.7::float8,null::real)`, [id, at(min)]);
const ajouter = (uid, cle, passe, user, min, forcer = false) => fn(uid, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::boolean)`, [cle, passe, user, at(min), forcer]);
const retirer = (uid, cle, passe, user, min) => fn(uid, `equipage_retirer($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real)`, [cle, passe, user, at(min)]);

// ---------- Jeu de données ----------
await db.query('reset role');
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
let tel = 8195550000;
const emp = (nom) => ins(nom + '@t.ca', { nom, telephone: String(++tel) });
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const [marc, luc, eric, lea, nina, omar, paul, quinn, rita, sam, zoe] = [];
const U = {}; for (const n of ['Marc', 'Luc', 'Éric', 'Léa', 'Nina', 'Omar', 'Paul', 'Quinn', 'Rita', 'Sam', 'Zoé']) U[n] = await emp(n);
await db.query(`update utilisateurs set actif = false where id = $1`, [U['Zoé']]);
const route = (await q(`select id from routes order by nom limit 1`))[0].id;
const eqA = (await q(`insert into equipes(nom) values ('Camion 1') returning id`))[0].id;
const eqB = (await q(`insert into equipes(nom) values ('Camion 2') returning id`))[0].id;
const pA = uuid(), pB = uuid(), pC = uuid();
await db.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total) values ($1,$2,$3,$4,1,$5,10)`, [pA, route, eqA, U.Marc, at(300)]);
await db.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total) values ($1,$2,$3,$4,2,$5,10)`, [pB, route, eqB, U.Luc, at(300)]);
await db.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, fin, statut, fin_type) values ($1,$2,$3,$4,3,$5,$6,'terminee','complete')`, [pC, route, eqA, U.Paul, at(400), at(350)]);
for (const [p, u] of [[pA, U.Marc], [pB, U.Luc]]) {
  await db.query(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut) values ($1,$2,'chauffeur',$3)`, [p, u, at(300)]);
  await db.query(`insert into quarts(utilisateur_id, debut, debut_source) values ($1,$2,'manuel')`, [u, at(300)]);
}
await db.query(`insert into quarts(utilisateur_id, debut, debut_source) values ($1,$2,'manuel')`, [U['Léa'], at(200)]);   // Léa a déjà un quart ouvert
await db.query(`insert into positions(passe_id, equipe_id, chauffeur_id, lat, lon) values ($1,$2,$3,46.5,-72.7)`, [pA, eqA, U.Marc]);

// =====================================================================
log('\n=== DROITS D\'EXÉCUTION ===');
await err('un visiteur ne peut appeler aucune fonction', () => fn(null, `quart_commencer($1::uuid,null,null,null,null)`, [uuid()], 'anon'), 'permission denied');
await err('un visiteur ne peut pas ajouter à un équipage', () => fn(null, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,null,null,null,null,false)`, [uuid(), pA, U['Éric']], 'anon'), 'permission denied');
await err('un employé ne peut pas appeler un outil interne (_moment_valide)', () => fn(U.Marc, `_moment_valide(now())`), 'permission denied');
await err('un employé ne peut pas appeler _fermer_passe directement', () => fn(U.Marc, `_fermer_passe($1::uuid, now(), 'manuelle')`, [pA]), 'permission denied');
await err('un employé ne peut pas appeler _equipage_ajouter directement (contournerait les droits)', () => fn(U.Marc, `_equipage_ajouter($1::uuid,$2::uuid,now(),'passager',$3::uuid,true,null,null,null)`, [pA, U['Éric'], U.Marc]), 'permission denied');
await err('un employé DÉSACTIVÉ ne peut rien faire (Zoé)', () => commencer(U['Zoé'], uuid(), 10), 'non_autorise');

// =====================================================================
log('\n=== « JE COMMENCE » / « JE TERMINE » ===');
const idN = uuid();
let r = await commencer(U.Nina, idN, 120);
eq('Nina commence son quart', r.statut, 'commence');
const qn = (await q(`select debut_source, a_valider, debut_lat, debut_lon, fin from quarts where id = $1`, [idN]))[0];
eq('… source « manuel », pas à valider, position GPS enregistrée, quart ouvert', [qn.debut_source, qn.a_valider, qn.debut_lat, qn.debut_lon, qn.fin], ['manuel', false, 46.55, -72.75, null]);
r = await commencer(U.Nina, idN, 120);
eq('renvoi du même geste (hors réseau) : aucun doublon', r.statut, 'deja_enregistre');
r = await commencer(U.Nina, uuid(), 100);
eq('« Je commence » alors qu\'il est déjà en quart', r.statut, 'deja_en_quart');
eq('… toujours un seul quart pour Nina', (await q(`select count(*)::int n from quarts where utilisateur_id = $1`, [U.Nina]))[0].n, 1);
await err('l\'id d\'un quart d\'un autre employé est refusé', () => commencer(U.Luc, idN, 90), 'non_autorise');
await err('un employé ne peut pas terminer le quart d\'un autre', () => terminer(U.Luc, idN, 60), 'quart_introuvable');
const idO = uuid();
r = await fn(U.Omar, `quart_commencer($1::uuid,$2::timestamptz,null,null,null)`, [idO, at(-60)]);   // horloge en avance d'une heure
const dOmar = new Date((await q(`select debut from quarts where id = $1`, [idO]))[0].debut).getTime();
Math.abs(dOmar - Date.now()) < 10000 ? pass('une heure dans le FUTUR (horloge du téléphone fausse) est ramenée à maintenant') : fail('heure future', String(dOmar - Date.now()));
await err('un geste vieux de 4 jours est refusé', () => commencer(U.Sam, uuid(), 4 * 24 * 60), 'geste_trop_ancien');
r = await terminer(U.Nina, idN, 60);
eq('Nina termine son quart', r.statut, 'termine');
r = await terminer(U.Nina, idN, 60);
eq('renvoi du « Je termine » : aucun doublon', r.statut, 'deja_termine');
const idOm2 = uuid(); await fn(U.Sam, `quart_commencer($1::uuid,$2::timestamptz,null,null,null)`, [idOm2, at(30)]);
await terminer(U.Sam, idOm2, 45);   // fin AVANT le début
const sq = (await q(`select extract(epoch from (fin - debut))::int s from quarts where id = $1`, [idOm2]))[0].s;
sq === 1 ? pass('fin avant le début : ramenée à début + 1 seconde (jamais de durée négative)') : fail('fin avant début', String(sq));
r = await commencer(U.Nina, uuid(), 150);
eq('nouveau quart qui chevaucherait un quart terminé : refusé proprement', r.statut, 'chevauchement');

// =====================================================================
log('\n=== ÉQUIPAGE : AJOUT ===');
const c1 = uuid();
r = await ajouter(U.Marc, c1, pA, U['Éric'], 100);
eq('Marc (chauffeur) ajoute Éric à bord', r.statut, 'ajoute');
eq('… un quart a été ouvert automatiquement pour Éric', r.quart_ouvert_automatiquement, true);
const qe = (await q(`select debut_source, a_valider, raison_a_valider, fin from quarts where utilisateur_id = $1`, [U['Éric']]))[0];
eq('… marqué « à valider », raison « ouvert par l\'équipage », quart ouvert', [qe.debut_source, qe.a_valider, qe.raison_a_valider, qe.fin], ['equipage', true, 'ouvert_par_equipage', null]);
const pe = (await q(`select role, fin, ajoute_par from equipage_periodes where passe_id = $1 and utilisateur_id = $2`, [pA, U['Éric']]))[0];
eq('… période d\'équipage ouverte, ajoutée par Marc', [pe.role, pe.fin, pe.ajoute_par], ['passager', null, U.Marc]);
const jr = (await q(`select type, moment, recu_le, auteur_id from equipage_journal where cle_client = $1`, [c1]))[0];
jr && jr.type === 'ajout' && jr.auteur_id === U.Marc ? pass('… chaque geste est écrit dans le journal (type, heure du geste, heure de réception, auteur)') : fail('journal ajout', JSON.stringify(jr));
r = await ajouter(U.Marc, c1, pA, U['Éric'], 100);
eq('même geste renvoyé (hors réseau) : même réponse, marqué « rejoué »', [r.statut, r.rejoue], ['ajoute', true]);
eq('… toujours UNE seule période et UN seul quart', [(await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and utilisateur_id=$2`, [pA, U['Éric']]))[0].n, (await q(`select count(*)::int n from quarts where utilisateur_id=$1`, [U['Éric']]))[0].n], [1, 1]);
r = await ajouter(U.Marc, uuid(), pA, U['Éric'], 90);
eq('ajouter quelqu\'un déjà à bord', r.statut, 'deja_a_bord');
r = await ajouter(U.Marc, uuid(), pA, U['Léa'], 90);
eq('Léa a DÉJÀ un quart ouvert : ajoutée sans en ouvrir un autre', [r.statut, r.quart_ouvert_automatiquement], ['ajoute', false]);
eq('… son quart n\'est pas « à valider »', (await q(`select count(*)::int n from quarts where utilisateur_id=$1 and a_valider`, [U['Léa']]))[0].n, 0);
r = await ajouter(U.Marc, uuid(), pA, U.Luc, 90);
eq('impossible d\'embarquer un chauffeur qui conduit ailleurs', [r.statut, r.raison, r.vehicule], ['refuse', 'chauffeur_ailleurs', 'Camion 2']);
await err('un passager ne peut pas gérer l\'équipage (Éric)', () => ajouter(U['Éric'], uuid(), pA, U.Paul, 5), 'non_autorise');
await err('un chauffeur d\'un AUTRE véhicule ne peut pas gérer cet équipage (Luc)', () => ajouter(U.Luc, uuid(), pA, U.Paul, 5), 'non_autorise');
await err('un employé désactivé ne peut pas être ajouté', () => ajouter(U.Marc, uuid(), pA, U['Zoé'], 5), 'utilisateur_inactif');
r = await ajouter(admin, uuid(), pA, U.Rita, 40);
eq('l\'administrateur peut ajouter à n\'importe quel équipage', r.statut, 'ajoute');

log('\n=== ÉQUIPAGE : AVERTISSEMENTS (quart récemment terminé) ===');
r = await ajouter(U.Marc, uuid(), pA, U.Nina, 30);
eq('Nina a terminé son quart il y a 1 h : AVERTISSEMENT, rien n\'est ajouté', r.statut, 'avertissement');
eq('… l\'avertissement dit « quart_termine »', r.avertissements.map(a => a.type), ['quart_termine']);
eq('… et aucune période créée pour Nina', (await q(`select count(*)::int n from equipage_periodes where utilisateur_id=$1`, [U.Nina]))[0].n, 0);
r = await ajouter(U.Marc, uuid(), pA, U.Nina, 30, true);
eq('après confirmation volontaire (forcer) : ajoutée, nouveau quart à valider', [r.statut, r.quart_ouvert_automatiquement], ['ajoute', true]);

log('\n=== ÉQUIPAGE : CONFLIT ET TRANSFERT ===');
const cInit = (await q(`select debut from equipage_periodes where passe_id=$1 and utilisateur_id=$2`, [pA, U['Éric']]))[0].debut;
r = await ajouter(U.Luc, uuid(), pB, U['Éric'], 50);
eq('Luc veut ajouter Éric (déjà dans le Camion 1) : AVERTISSEMENT nommant le véhicule', [r.statut, r.avertissements[0].type, r.avertissements[0].vehicule], ['avertissement', 'conflit_vehicule', 'Camion 1']);
eq('… réponse « non » : RIEN ne change (Éric reste dans le Camion 1, période ouverte)', (await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and utilisateur_id=$2 and fin is null`, [pA, U['Éric']]))[0].n, 1);
eq('… et aucune période créée dans le Camion 2', (await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and utilisateur_id=$2`, [pB, U['Éric']]))[0].n, 0);
const cT = uuid();
r = await ajouter(U.Luc, cT, pB, U['Éric'], 50, true);
eq('réponse « oui » : TRANSFERT', r.statut, 'transfere');
const sortie = (await q(`select fin, transfert_id from equipage_periodes where passe_id=$1 and utilisateur_id=$2`, [pA, U['Éric']]))[0];
const entree = (await q(`select debut, fin, transfert_id from equipage_periodes where passe_id=$1 and utilisateur_id=$2`, [pB, U['Éric']]))[0];
new Date(sortie.fin).getTime() === new Date(entree.debut).getTime() ? pass('sortie du Camion 1 et entrée dans le Camion 2 à la MÊME heure exacte (aucun trou, aucun chevauchement)') : fail('heure du transfert', `${sortie.fin} / ${entree.debut}`);
sortie.transfert_id && sortie.transfert_id === entree.transfert_id ? pass('… les deux moitiés sont liées par le même identifiant de transfert') : fail('lien transfert');
eq('… Éric n\'est à bord que d\'UN véhicule à la fois', (await q(`select count(*)::int n from equipage_periodes where utilisateur_id=$1 and fin is null`, [U['Éric']]))[0].n, 1);
eq('… son quart n\'a pas été touché (toujours un seul, toujours ouvert)', (await q(`select count(*)::int n from quarts where utilisateur_id=$1 and fin is null`, [U['Éric']]))[0].n, 1);
const jt = (await q(`select type, de_passe_id, vers_passe_id, auteur_id from equipage_journal where cle_client=$1`, [cT]))[0];
jt && jt.type === 'transfert' && jt.de_passe_id === pA && jt.vers_passe_id === pB && jt.auteur_id === U.Luc ? pass('… journal : transfert, véhicule quitté (Camion 1), véhicule rejoint (Camion 2), auteur Luc') : fail('journal transfert', JSON.stringify(jt));
r = await ajouter(U.Luc, cT, pB, U['Éric'], 50, true);
eq('renvoi du transfert (hors réseau) : aucun doublon', [r.statut, r.rejoue], ['transfere', true]);

log('\n=== ÉQUIPAGE : RETRAIT ET ANNULATION ===');
r = await retirer(U.Marc, uuid(), pA, U['Éric'], 10);
eq('retirer quelqu\'un qui n\'est plus à bord de CETTE passe', r.statut, 'pas_a_bord');
r = await retirer(U.Luc, uuid(), pB, U['Éric'], 10);
eq('Luc retire Éric du Camion 2 (il y était depuis 40 min)', r.statut, 'retire');
eq('… la période est fermée, son quart continue (il n\'a pas fait « Je termine »)', [(await q(`select count(*)::int n from equipage_periodes where utilisateur_id=$1 and fin is null`, [U['Éric']]))[0].n, (await q(`select count(*)::int n from quarts where utilisateur_id=$1 and fin is null`, [U['Éric']]))[0].n], [0, 1]);
await err('on ne peut pas retirer le chauffeur', () => retirer(U.Luc, uuid(), pB, U.Luc, 5), 'chauffeur_ne_peut_etre_retire');
await err('un autre chauffeur ne peut pas retirer', () => retirer(U.Marc, uuid(), pB, U['Éric'], 5), 'non_autorise');

// Annulation d'un ajout par erreur (moins de 2 minutes)
r = await fn(U.Marc, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,null,null,false)`, [uuid(), pA, U.Paul, at(1)]);
eq('Marc ajoute Paul par erreur', r.statut, 'ajoute');
r = await fn(U.Marc, `equipage_retirer($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,null,null)`, [uuid(), pA, U.Paul, at(0)]);
eq('… puis « Annuler » : la trace disparaît', [r.statut, r.quart_supprime], ['annule', true]);
eq('… ni période, ni quart automatique pour Paul', [(await q(`select count(*)::int n from equipage_periodes where utilisateur_id=$1`, [U.Paul]))[0].n, (await q(`select count(*)::int n from quarts where utilisateur_id=$1`, [U.Paul]))[0].n], [0, 0]);
eq('… mais l\'annulation est écrite dans le journal', (await q(`select count(*)::int n from equipage_journal where type='annulation' and utilisateur_id=$1`, [U.Paul]))[0].n, 1);

// Annulation d'un TRANSFERT par erreur : l'employé retourne dans son véhicule
const leaA = (await q(`select id from equipage_periodes where passe_id=$1 and utilisateur_id=$2 and fin is null`, [pA, U['Léa']]))[0]?.id;
r = await fn(U.Luc, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,null,null,true)`, [uuid(), pB, U['Léa'], at(1)]);
eq('Luc transfère Léa par erreur (Camion 1 → Camion 2)', r.statut, 'transfere');
r = await fn(U.Luc, `equipage_retirer($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,null,null)`, [uuid(), pB, U['Léa'], at(0)]);
eq('… « Annuler » aussitôt', [r.statut, r.retour_vehicule_precedent], ['annule', true]);
const lea2 = (await q(`select fin, transfert_id, retire_par from equipage_periodes where id=$1`, [leaA]))[0];
eq('… Léa est de retour dans le Camion 1, période ROUVERTE, sans trace de transfert', [lea2.fin, lea2.transfert_id, lea2.retire_par], [null, null, null]);
eq('… et rien dans le Camion 2', (await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and utilisateur_id=$2`, [pB, U['Léa']]))[0].n, 0);

log('\n=== ADMIN : CORRIGER UN TRANSFERT APRÈS COUP ===');
await ajouter(U.Luc, uuid(), pB, U.Quinn, 80);
r = await ajouter(U.Marc, uuid(), pA, U.Quinn, 30, true);
eq('Marc transfère Quinn du Camion 2 au Camion 1 (se trompe de nom)', r.statut, 'transfere');
const tid = r.transfert_id;
await err('un chauffeur ne peut pas annuler un transfert', () => fn(U.Marc, `admin_annuler_transfert($1::uuid)`, [tid]), 'non_autorise');
r = await fn(admin, `admin_annuler_transfert($1::uuid)`, [tid]);
eq('Joé annule le transfert', [r.statut, r.reste_dans_passe_id], ['transfert_annule', pB]);
const qq = await q(`select passe_id, fin from equipage_periodes where utilisateur_id=$1`, [U.Quinn]);
eq('… Quinn est de retour dans le Camion 2 (période ouverte), plus rien dans le Camion 1', qq.map(x => [x.passe_id === pB, x.fin]), [[true, null]]);
eq('… le journal garde la correction de l\'administrateur', (await q(`select count(*)::int n from equipage_journal where type='correction_admin' and utilisateur_id=$1`, [U.Quinn]))[0].n, 1);
r = await ajouter(admin, uuid(), pA, U.Sam, 25, true);
eq('… et Joé peut ensuite ajouter la BONNE personne', r.statut, 'ajoute');

log('\n=== HORS RÉSEAU : GESTES REÇUS EN RETARD ===');
r = await ajouter(U.Marc, uuid(), pA, U.Omar, 150);
eq('geste vieux de 2 h 30 accepté avec SON heure (pas celle de la réception)', r.statut, 'ajoute');
const om = (await q(`select debut from equipage_periodes where utilisateur_id=$1 and passe_id=$2`, [U.Omar, pA]))[0].debut;
Math.abs(new Date(om).getTime() - (Date.now() - 150 * 60000)) < 5000 ? pass('… la période commence bien à l\'heure du geste (il y a 2 h 30)') : fail('heure du geste', String(om));
const jo = (await q(`select moment, recu_le from equipage_journal where utilisateur_id=$1 and passe_id=$2`, [U.Omar, pA]))[0];
(new Date(jo.recu_le) - new Date(jo.moment)) > 140 * 60000 ? pass('… le journal garde l\'heure du geste ET l\'heure de réception (détecte une horloge fausse)') : fail('recu_le');
// Chevauchement : Rita a été ajoutée à A à -40 (par l'admin). Un geste hors réseau plus ancien (-60) arrive dans B.
r = await ajouter(U.Luc, uuid(), pB, U.Rita, 70);
eq('un geste plus ANCIEN arrive après un plus récent : accepté et marqué « à vérifier »', [r.statut, r.a_verifier], ['ajoute', true]);
const rp = await q(`select passe_id, debut, fin, a_verifier from equipage_periodes where utilisateur_id=$1 order by debut`, [U.Rita]);
eq('… la période ancienne s\'arrête exactement où commence la récente', new Date(rp[0].fin).getTime() === new Date(rp[1].debut).getTime(), true);
eq('… les deux périodes sont marquées « à vérifier »', rp.map(x => x.a_verifier), [true, true]);
eq('… Rita n\'a pas de quart en double (chevauchement évité)', (await q(`select count(*)::int n from quarts where utilisateur_id=$1`, [U.Rita]))[0].n, 1);
r = await ajouter(U.Paul, uuid(), pC, U.Sam, 5).catch(e => ({ statut: 'erreur:' + e.message }));   // Paul n'est plus chauffeur d'une passe en cours, mais c'est le chauffeur de pC (terminée)
eq('ajouter à une passe TERMINÉE (geste postérieur à sa fin) : refusé sans erreur', r.statut, 'passe_terminee');

log('\n=== ADMIN : VALIDER UN QUART ===');
const idEric = (await q(`select id from quarts where utilisateur_id=$1`, [U['Éric']]))[0].id;
await err('valider un quart encore OUVERT est refusé', () => fn(admin, `admin_valider_quart($1::uuid,null)`, [idEric]), 'quart_encore_ouvert');
await terminer(U['Éric'], idEric, 5);
await err('un employé ne peut pas valider (même son propre quart)', () => fn(U['Éric'], `admin_valider_quart($1::uuid,null)`, [idEric]), 'non_autorise');
r = await fn(admin, `admin_valider_quart($1::uuid,$2)`, [idEric, 'vérifié avec Marc']);
eq('Joé valide le quart d\'Éric', r.statut, 'valide');
const vq = (await q(`select a_valider, valide_par, valide_le is not null v, note from quarts where id=$1`, [idEric]))[0];
eq('… plus « à valider », validé par Joé, avec sa note', [vq.a_valider, vq.valide_par, vq.v, vq.note], [false, admin, true, 'vérifié avec Marc']);
eq('… la validation est dans le journal des corrections', (await q(`select count(*)::int n from journal_modifications where table_cible='quarts' and ligne_id=$1`, [idEric]))[0].n >= 1, true);

log('\n=== « JE TERMINE » DU CHAUFFEUR : ferme sa passe et son équipage ===');
const idMarc = (await q(`select id from quarts where utilisateur_id=$1`, [U.Marc]))[0].id;
const ouvertsIds = (await q(`select id from equipage_periodes where passe_id=$1 and fin is null`, [pA])).map(x => x.id);
const ouvertsAvant = ouvertsIds.length;
r = await terminer(U.Marc, idMarc, 0);
eq('Marc fait « Je termine » alors qu\'il conduit la passe du Camion 1', [r.statut, r.passe_fermee], ['termine', pA]);
const pa = (await q(`select statut, fin_type, fin from passes where id=$1`, [pA]))[0];
eq('… la passe est terminée, type « fin du quart »', [pa.statut, pa.fin_type], ['terminee', 'fin_quart']);
eq(`… les ${ouvertsAvant} personnes qui étaient à bord en sortent TOUTES à la même heure que la fin de la passe`, (await q(`select count(*)::int n from equipage_periodes where id = any($1::uuid[]) and (fin is null or fin <> $2)`, [ouvertsIds, pa.fin]))[0].n, 0);
eq('… plus personne n\'est à bord (aucune période ouverte) dans la passe terminée', (await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and fin is null`, [pA]))[0].n, 0);
const autres = await q(`select u.nom, e.fin = $2 as meme_heure, e.transfert_id is not null as transfert from equipage_periodes e join utilisateurs u on u.id = e.utilisateur_id where e.passe_id=$1 and not (e.id = any($3::uuid[])) and e.fin <> $2`, [pA, pa.fin, ouvertsIds]);
log('  (info : périodes déjà fermées AVANT la fin de la passe, donc normalement plus anciennes : ' + JSON.stringify(autres.map(a => a.nom + (a.transfert ? ' [sortie de transfert]' : ''))) + ')');
eq('… la position du véhicule est effacée de la carte', (await q(`select count(*)::int n from positions where passe_id=$1`, [pA]))[0].n, 0);
eq('… la passe du Camion 2 (Luc) n\'est pas touchée', (await q(`select statut from passes where id=$1`, [pB]))[0].statut, 'en_cours');
const orph = (await q(`select count(*)::int n from equipage_periodes p where p.fin is not null and p.fin < p.debut`))[0].n;
orph === 0 ? pass('aucune période avec une fin avant son début, dans toute la base') : fail('périodes incohérentes', String(orph));

log('\n=== COHÉRENCE GLOBALE ===');
const chev = (await q(`select count(*)::int n from equipage_periodes a join equipage_periodes b on a.utilisateur_id = b.utilisateur_id and a.id < b.id
   and tstzrange(a.debut, coalesce(a.fin,'infinity'),'[)') && tstzrange(b.debut, coalesce(b.fin,'infinity'),'[)')`))[0].n;
chev === 0 ? pass('AUCUN employé n\'a deux périodes d\'équipage qui se chevauchent') : fail('chevauchements équipage', String(chev));
const chevq = (await q(`select count(*)::int n from quarts a join quarts b on a.utilisateur_id = b.utilisateur_id and a.id < b.id
   and tstzrange(a.debut, coalesce(a.fin,'infinity'),'[)') && tstzrange(b.debut, coalesce(b.fin,'infinity'),'[)')`))[0].n;
chevq === 0 ? pass('AUCUN employé n\'a deux quarts qui se chevauchent') : fail('chevauchements quarts', String(chevq));
const nav = (await q(`select count(*)::int n from quarts where a_valider`))[0].n;
log(`  (info : ${nav} quart(s) « à valider » dans la liste de l'administrateur à la fin des tests)`);

log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
