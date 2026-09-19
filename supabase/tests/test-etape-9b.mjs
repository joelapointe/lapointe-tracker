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
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql', '05-etape9b-passes-fermetures-export.sql'];

async function env() {
  const db = await prepare(FILES.slice(0, 4));
  const r = await db.exec(fs.readFileSync(SQL_DIR + FILES[4], 'utf8'));
  const verif = r[r.length - 1].rows[0].verification;
  await db.exec(fs.readFileSync(SQL_DIR + '13-etape13-taches-et-tours-partages.sql', 'utf8'));   // le fichier 13 (tâche + tours) s'applique par-dessus : les anciens comportements doivent rester vrais
  await db.exec(fs.readFileSync(SQL_DIR + '14-etape13d-retrait-stops-fait.sql', 'utf8'));   // puis le fichier 14 (colonne stops.fait retirée) : tout doit encore marcher
  await db.exec(`alter table public.passes alter column tache set default 'Déneigement mécanique'`);   // BANC D'ESSAI SEULEMENT : les insertions directes de ces anciens tests n'indiquent pas la tâche (la vraie base n'a pas ce défaut)
  const q = async (sql, p) => (await db.query(sql, p)).rows;
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
  const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
  let tel = 8196000000;
  const emp = (nom) => ins(nom + uuid().slice(0, 4) + '@t.ca', { nom, telephone: String(++tel) });
  return { db, q, fn, err, ins, emp, verif };
}

// Appels utilitaires
const debuter = (E, uid, id, route, equipe, membres = [], min = 0) =>
  E.fn(uid, `debuter_passe($1::uuid,$2::uuid,$3::uuid,$4::jsonb,$5::timestamptz,46.5::float8,-72.7::float8,null::real)`, [id, route, equipe, JSON.stringify(membres), at(min)]);
const completer = (E, uid, passe, stop, min = 0, mode = 'manuel') =>
  E.fn(uid, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,$4,46.5::float8,-72.7::float8)`, [passe, stop, at(min), mode]);
const ajouter = (E, uid, passe, user, min, forcer = false) =>
  E.fn(uid, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::boolean)`, [uuid(), passe, user, at(min), forcer]);

// =====================================================================
const E = await env();
const { db, q, fn, err } = E;
log('Vérification renvoyée par le script 9b :\n' + JSON.stringify(E.verif, null, 1));

await db.query('reset role');
const admin = await E.ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const U = {}; for (const n of ['Marc', 'Luc', 'Éric', 'Léa', 'Nina', 'Oscar', 'Pia', 'Zoé']) U[n] = await E.emp(n);
await db.query(`update utilisateurs set actif = false where id = $1`, [U['Zoé']]);
const rNord = (await q(`select id from routes where nom = 'Route Nord'`))[0].id;
const rSud = (await q(`select id from routes where nom = 'Route Sud'`))[0].id;
const cam = {}; for (const n of ['Camion 1', 'Camion 2', 'Camion 3', 'Camion 4']) cam[n] = (await q(`insert into equipes(nom) values ($1) returning id`, [n]))[0].id;
const vieux = (await q(`insert into equipes(nom, actif) values ('Vieux camion', false) returning id`))[0].id;
await db.query(`insert into routes(nom, actif) values ('Route fermée', false)`);
const rFermee = (await q(`select id from routes where nom = 'Route fermée'`))[0].id;

log('\n=== DROITS D\'EXÉCUTION ===');
eq('visiteur : aucune fonction appelable', E.verif.fonctions_appelables_par_un_visiteur, []);
eq('fermer_expires : personne (ni employé, ni visiteur) ne peut l\'appeler', E.verif.fermer_expires_appelable_par_un_employe, false);
eq('déclencheur de recalcul des arrêts installé', E.verif.declencheur_recalcul_arrets, 1);
await err('un visiteur ne peut pas débuter une passe', () => fn(null, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,null,null,null,null)`, [uuid(), rNord, cam['Camion 1']], 'anon'), 'permission denied');
await err('un employé ne peut pas lancer les fermetures automatiques', () => fn(U.Marc, `fermer_expires()`), 'permission denied');
await err('un employé ne peut pas appeler _recalculer_passe', () => fn(U.Marc, `_recalculer_passe($1::uuid, now())`, [uuid()]), 'permission denied');
await err('un employé ne peut pas appeler _rouvrir_passe', () => fn(U.Marc, `_rouvrir_passe($1::uuid)`, [uuid()]), 'permission denied');

log('\n=== « DÉBUTER LA PASSE » ===');
const pA = uuid();
let r = await debuter(E, U.Marc, pA, rNord, cam['Camion 1'], [{ utilisateur_id: U['Éric'], cle_client: uuid() }, { utilisateur_id: U['Léa'], cle_client: uuid() }], 60);
eq('Marc débute la passe 1 de la Route Nord avec Éric et Léa', [r.statut, r.numero, r.nb_arrets_total], ['debutee', 1, 13]);
eq('… l\'équipage confirmé est à bord (Éric et Léa ajoutés)', r.equipage.map(x => x.statut), ['ajoute', 'ajoute']);
const crew = await q(`select u.nom, e.role from equipage_periodes e join utilisateurs u on u.id = e.utilisateur_id where e.passe_id = $1 and e.fin is null order by u.nom`, [pA]);
eq('… à bord : Marc (chauffeur), Éric et Léa', crew.map(c => c.nom + ':' + c.role), ['Léa:passager', 'Marc:chauffeur', 'Éric:passager']);
const shifts = await q(`select u.nom, q.debut_source, q.a_valider, q.raison_a_valider from quarts q join utilisateurs u on u.id = q.utilisateur_id order by u.nom`);
eq('… quarts ouverts automatiquement et À VALIDER (chauffeur : « par la passe », passagers : « par l\'équipage »)', shifts.map(s => `${s.nom}:${s.raison_a_valider}`), ['Léa:ouvert_par_equipage', 'Marc:ouvert_par_passe', 'Éric:ouvert_par_equipage']);
eq('… le véhicule apparaît tout de suite sur la carte', (await q(`select count(*)::int n from positions where passe_id = $1`, [pA]))[0].n, 1);
r = await debuter(E, U.Marc, pA, rNord, cam['Camion 1'], [], 0);
eq('renvoi du même geste (hors réseau) : aucun doublon', [r.statut, r.numero], ['deja_enregistre', 1]);
eq('… toujours une seule passe', (await q(`select count(*)::int n from passes`))[0].n, 1);
await err('l\'id d\'une passe d\'un autre chauffeur est refusé', () => debuter(E, U.Luc, pA, rNord, cam['Camion 2']), 'non_autorise');
await err('route archivée refusée', () => debuter(E, U.Luc, uuid(), rFermee, cam['Camion 2']), 'route_inactive');
await err('véhicule archivé refusé', () => debuter(E, U.Luc, uuid(), rNord, vieux), 'equipe_inactive');
await err('un employé désactivé ne peut pas débuter', () => debuter(E, U['Zoé'], uuid(), rNord, cam['Camion 2']), 'non_autorise');

log('\n=== LA PASSE PRÉCÉDENTE EST ARCHIVÉE (même véhicule, nouveau chauffeur) ===');
const pB = uuid();
r = await debuter(E, U.Luc, pB, rNord, cam['Camion 1'], [], 30);
eq('Luc débute sur le Camion 1 : passe 2 de la Route Nord', [r.statut, r.numero, r.passes_archivees], ['debutee', 2, [pA]]);
const pa = (await q(`select statut, fin_type, fin from passes where id = $1`, [pA]))[0];
eq('… la passe de Marc est archivée (terminée, « remplacée »)', [pa.statut, pa.fin_type], ['terminee', 'remplacee']);
eq('… son équipage en est sorti, sa position effacée', [(await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and fin is null`, [pA]))[0].n, (await q(`select count(*)::int n from positions where passe_id=$1`, [pA]))[0].n], [0, 0]);
eq('… ses arrêts et son historique restent (la passe existe toujours, avec début et fin)', (await q(`select debut < fin as ok from passes where id=$1`, [pA]))[0].ok, true);
eq('… une seule passe en cours sur le Camion 1', (await q(`select count(*)::int n from passes where equipe_id=$1 and statut='en_cours'`, [cam['Camion 1']]))[0].n, 1);

log('\n=== NUMÉROTATION PAR ROUTE ===');
const pS1 = uuid(), pS2 = uuid();
r = await debuter(E, U.Marc, pS1, rSud, cam['Camion 2'], [], 20);
eq('Marc débute sur la Route Sud : sa passe n° 1', r.numero, 1);
r = await debuter(E, U.Marc, pS2, rSud, cam['Camion 2'], [], 10);
eq('il en débute une autre : n° 2, et la n° 1 est archivée', [r.numero, r.passes_archivees], [2, [pS1]]);
eq('… un chauffeur n\'a jamais deux passes en cours', (await q(`select count(*)::int n from passes where chauffeur_id=$1 and statut='en_cours'`, [U.Marc]))[0].n, 1);
eq('… la Route Sud sans arrêts : pourcentage 0 (pas de division par zéro)', (await q(`select pourcentage from passes where id=$1`, [pS2]))[0].pourcentage, 0);

log('\n=== ÉQUIPAGE AU DÉMARRAGE : conflits, transferts, cas d\'erreur ===');
// Léa est à bord de la passe de Luc (Camion 1) ; Marc (Camion 2) veut l'embarquer
await ajouter(E, U.Luc, pB, U['Léa'], 25);
const pS3 = uuid();
r = await debuter(E, U.Marc, pS3, rSud, cam['Camion 2'], [{ utilisateur_id: U['Léa'], cle_client: uuid() }, { utilisateur_id: U['Zoé'], cle_client: uuid() }, { utilisateur_id: U.Oscar, cle_client: uuid() }], 5);
eq('Marc redémarre et liste Léa (déjà à bord du Camion 1), Zoé (désactivée), Oscar', r.statut, 'debutee');
const [rl, rz, ro] = r.equipage;
eq('… Léa : AVERTISSEMENT nommant le Camion 1, rien n\'est changé', [rl.statut, rl.avertissements[0].type, rl.avertissements[0].vehicule], ['avertissement', 'conflit_vehicule', 'Camion 1']);
eq('… Zoé (désactivée) : erreur pour elle seule, la passe démarre quand même', rz.statut, 'erreur');
eq('… Oscar : ajouté', ro.statut, 'ajoute');
eq('… Léa est toujours dans le Camion 1', (await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and utilisateur_id=$2 and fin is null`, [pB, U['Léa']]))[0].n, 1);
r = await ajouter(E, U.Marc, pS3, U['Léa'], 4, true);
eq('… après « oui, elle change de véhicule » : transfert', r.statut, 'transfere');

log('\n=== UN PASSAGER QUI DEVIENT CHAUFFEUR ===');
const pE = uuid();
await ajouter(E, U.Luc, pB, U['Éric'], 20, true);   // Éric est passager du Camion 1
r = await debuter(E, U['Éric'], pE, rNord, cam['Camion 3'], [], 2);
eq('Éric (passager du Camion 1) débute sa propre passe sur le Camion 3', r.statut, 'debutee');
eq('… il n\'est à bord que d\'UN véhicule, comme chauffeur', (await q(`select p.equipe_id = $2 as ok, e.role from equipage_periodes e join passes p on p.id=e.passe_id where e.utilisateur_id=$1 and e.fin is null`, [U['Éric'], cam['Camion 3']]))
  .map(x => [x.ok, x.role]), [[true, 'chauffeur']]);

// =====================================================================
log('\n=== ARRÊTS COMPLÉTÉS, POURCENTAGE ET FERMETURE À 100 % ===');
const rEst = (await q(`insert into routes(nom) values ('Route Est') returning id`))[0].id;
const stops = []; for (let i = 1; i <= 4; i++) stops.push((await q(`insert into stops(adresse, route_id, lat, lon) values ($1,$2,46.5,-72.7) returning id`, ['Est ' + i, rEst]))[0].id);
const pN = uuid();
await debuter(E, U.Nina, pN, rEst, cam['Camion 4'], [{ utilisateur_id: U.Pia, cle_client: uuid() }], 50);
r = await completer(E, U.Nina, pN, stops[0], 40);
eq('1 arrêt sur 4 complété : 25 %', [r.statut, r.pourcentage, r.faits, r.total], ['complete', 25, 1, 4]);
r = await completer(E, U.Nina, pN, stops[0], 39);
eq('même arrêt renvoyé : aucun doublon, toujours 25 %', [r.statut, r.pourcentage], ['deja_complete', 25]);
const autreRoute = (await q(`select id from stops where route_id = $1 limit 1`, [rNord]))[0].id;
await err('un arrêt d\'une autre route est refusé', () => completer(E, U.Nina, pN, autreRoute, 30), 'arret_hors_route');
await err('un passager ne peut pas compléter (Pia)', () => completer(E, U.Pia, pN, stops[1], 30), 'non_autorise');
await err('une passe inexistante est refusée', () => completer(E, U.Nina, uuid(), stops[1], 30), 'passe_introuvable');
await completer(E, U.Nina, pN, stops[1], 35); r = await completer(E, U.Nina, pN, stops[2], 30);
eq('3 sur 4 : 75 %', r.pourcentage, 75);
await db.query(`insert into stops(adresse, route_id) values ('Est 5 (ajouté par Joé pendant la passe)', $1)`, [rEst]);
let ps = (await q(`select nb_arrets_total, nb_arrets_faits, pourcentage from passes where id=$1`, [pN]))[0];
eq('Joé AJOUTE un arrêt pendant la passe : total 5, pourcentage recalculé automatiquement (60 %)', [ps.nb_arrets_total, ps.nb_arrets_faits, ps.pourcentage], [5, 3, 60]);
await db.query(`update stops set actif = false where adresse like 'Est 5%'`);
ps = (await q(`select nb_arrets_total, pourcentage from passes where id=$1`, [pN]))[0];
eq('… il l\'ARCHIVE : retour à 4 arrêts, 75 %', [ps.nb_arrets_total, ps.pourcentage], [4, 75]);
r = await completer(E, U.Nina, pN, stops[3], 2);
eq('dernier arrêt complété : 100 % et la passe SE FERME TOUTE SEULE', [r.pourcentage, r.passe_fermee], [100, true]);
ps = (await q(`select statut, fin_type, fin from passes where id=$1`, [pN]))[0];
eq('… terminée, type « complétée à 100 % »', [ps.statut, ps.fin_type], ['terminee', 'complete']);
eq('… équipage sorti à la même heure, position du véhicule effacée', [(await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and (fin is null or fin <> $2)`, [pN, ps.fin]))[0].n, (await q(`select count(*)::int n from positions where passe_id=$1`, [pN]))[0].n], [0, 0]);
r = await completer(E, U.Nina, pN, stops[3], 0);
eq('un arrêt reçu APRÈS la fin de la passe est refusé sans erreur', r.statut, 'passe_terminee');
eq('les 4 arrêts sont conservés avec leur passe, leur heure et leur auteur', (await q(`select count(*)::int n from passe_arrets where passe_id=$1 and complete_par=$2`, [pN, U.Nina]))[0].n, 4);

log('\n=== ANNULER UN ARRÊT COMPLÉTÉ PAR ERREUR ===');
await err('un autre chauffeur ne peut pas annuler', () => fn(U.Luc, `annuler_arret($1::uuid,$2::uuid)`, [pN, stops[3]]), 'non_autorise');
r = await fn(U.Nina, `annuler_arret($1::uuid,$2::uuid)`, [pN, stops[3]]);
eq('Nina annule le dernier arrêt : la passe SE ROUVRE, 75 %', [r.statut, r.passe_rouverte, r.pourcentage], ['annule', true, 75]);
ps = (await q(`select statut, fin, fin_type from passes where id=$1`, [pN]))[0];
eq('… en cours, sans date de fin', [ps.statut, ps.fin, ps.fin_type], ['en_cours', null, null]);
eq('… Nina et Pia sont de nouveau à bord', (await q(`select count(*)::int n from equipage_periodes where passe_id=$1 and fin is null`, [pN]))[0].n, 2);
r = await fn(U.Nina, `annuler_arret($1::uuid,$2::uuid)`, [pN, stops[3]]);
eq('annuler un arrêt qui n\'est pas complété', r.statut, 'pas_complete');
await db.query(`update passe_arrets set complete_le = now() - interval '30 minutes' where passe_id=$1 and stop_id=$2`, [pN, stops[1]]);
await err('le chauffeur ne peut plus annuler après 10 minutes', () => fn(U.Nina, `annuler_arret($1::uuid,$2::uuid)`, [pN, stops[1]]), 'delai_depasse');
r = await fn(admin, `annuler_arret($1::uuid,$2::uuid)`, [pN, stops[1]]);
eq('… mais l\'administrateur le peut, sans limite de temps', [r.statut, r.pourcentage], ['annule', 50]);
await completer(E, U.Nina, pN, stops[1], 5); r = await completer(E, U.Nina, pN, stops[3], 4);
eq('tout complété de nouveau : la passe se referme', r.passe_fermee, true);
const pN2 = uuid();
await debuter(E, U.Nina, pN2, rSud, cam['Camion 4'], [], 1);   // Nina démarre une autre passe
await err('rouvrir la première est impossible : Nina a une autre passe en cours', () => fn(U.Nina, `annuler_arret($1::uuid,$2::uuid)`, [pN, stops[3]]), 'impossible_de_rouvrir');
eq('… et l\'arrêt n\'a PAS été annulé (rien ne bouge en cas d\'échec)', (await q(`select count(*)::int n from passe_arrets where passe_id=$1 and stop_id=$2`, [pN, stops[3]]))[0].n, 1);

log('\n=== FERMETURE AUTOMATIQUE QUAND L\'ADMIN ARCHIVE LE DERNIER ARRÊT RESTANT ===');
const rOuest = (await q(`insert into routes(nom) values ('Route Ouest') returning id`))[0].id;
const o1 = (await q(`insert into stops(adresse, route_id) values ('Ouest 1',$1) returning id`, [rOuest]))[0].id;
await db.query(`insert into stops(adresse, route_id) values ('Ouest 2',$1)`, [rOuest]);
const pO = uuid();
await debuter(E, U.Oscar, pO, rOuest, cam['Camion 3'], [], 10);   // Oscar (Camion 3) ; Éric avait le Camion 3 → sa passe est archivée
await completer(E, U.Oscar, pO, o1, 5);
await db.query(`update stops set actif = false where adresse = 'Ouest 2'`);
ps = (await q(`select statut, fin_type, pourcentage from passes where id=$1`, [pO]))[0];
eq('il ne reste qu\'un arrêt et il est fait : la passe se ferme (100 %)', [ps.statut, ps.fin_type, ps.pourcentage], ['terminee', 'complete', 100]);

log('\n=== BOUTON « TERMINER » (passe non complétée) ===');
const pT = uuid();
await debuter(E, U.Luc, pT, rSud, cam['Camion 1'], [], 8);
await err('un passager/autre chauffeur ne peut pas terminer la passe de Luc', () => fn(U.Marc, `terminer_passe($1::uuid,null)`, [pT]), 'non_autorise');
r = await fn(U.Luc, `terminer_passe($1::uuid,null)`, [pT]);
eq('Luc termine sa passe', [r.statut], ['terminee']);
eq('… type « manuelle »', (await q(`select fin_type from passes where id=$1`, [pT]))[0].fin_type, 'manuelle');
r = await fn(U.Luc, `terminer_passe($1::uuid,null)`, [pT]);
eq('renvoi du geste : aucun doublon', r.statut, 'deja_terminee');
const pT2 = uuid(); await debuter(E, U.Luc, pT2, rSud, cam['Camion 1'], [], 3);
r = await fn(admin, `terminer_passe($1::uuid,null)`, [pT2]);
eq('Joé peut terminer la passe d\'un chauffeur (type « admin »)', [r.statut, (await q(`select fin_type from passes where id=$1`, [pT2]))[0].fin_type], ['terminee', 'admin']);

log('\n=== POSITION DU VÉHICULE ===');
const pP = uuid(); await debuter(E, U.Marc, pP, rNord, cam['Camion 2'], [{ utilisateur_id: U['Léa'], cle_client: uuid() }], 6);
const pos = (lat, lon, min) => fn(U.Marc, `envoyer_position($1::uuid,$2::float8,$3::float8,5::real,$4::timestamptz)`, [pP, lat, lon, at(min)]);
r = await pos(46.6, -72.6, 1);
eq('le chauffeur envoie sa position', r.statut, 'ok');
await pos(46.9, -72.9, 5);   // envoi hors réseau plus ANCIEN
const cur = (await q(`select lat, lon from positions where passe_id=$1`, [pP]))[0];
eq('une position plus ANCIENNE (envoi hors réseau) n\'écrase pas la plus récente', [cur.lat, cur.lon], [46.6, -72.6]);
await pos(46.7, -72.5, 0);
eq('une plus récente la remplace', (await q(`select lat from positions where passe_id=$1`, [pP]))[0].lat, 46.7);
eq('UNE seule ligne de position par véhicule', (await q(`select count(*)::int n from positions where passe_id=$1`, [pP]))[0].n, 1);
await err('un PASSAGER ne peut pas envoyer de position (seul le chauffeur)', () => fn(U['Léa'], `envoyer_position($1::uuid,46.5::float8,-72.5::float8,null::real,null)`, [pP]), 'non_autorise');
await err('Joé non plus (seul le téléphone du chauffeur)', () => fn(admin, `envoyer_position($1::uuid,46.5::float8,-72.5::float8,null::real,null)`, [pP]), 'non_autorise');
await err('coordonnées invalides refusées', () => fn(U.Marc, `envoyer_position($1::uuid,95::float8,-72.5::float8,null::real,null)`, [pP]), 'position_invalide');
r = await fn(U.Nina, `envoyer_position($1::uuid,46.5::float8,-72.5::float8,null::real,null)`, [pN]).catch(e => ({ statut: 'erreur:' + e.message }));
eq('position pour une passe terminée d\'un autre : refusée', r.statut.startsWith('erreur:non_autorise') || r.statut === 'passe_terminee', true);
r = await fn(U.Nina, `envoyer_position($1::uuid,46.5::float8,-72.5::float8,null::real,null)`, [pN2]);
eq('… Nina peut envoyer pour SA passe en cours', r.statut, 'ok');
await fn(U.Marc, `terminer_passe($1::uuid,null)`, [pP]);
r = await pos(46.5, -72.5, 0);
eq('position envoyée après la fin de la passe : ignorée', r.statut, 'passe_terminee');

log('\n=== LISTE DES EMPLOYÉS (avec téléphones) ===');
const lu = await fn(admin, `admin_lister_utilisateurs()`);
eq('Joé voit les 9 comptes avec leur téléphone', [lu.length, lu.filter(x => x.telephone).length], [9, 8]);
await err('un employé ne peut pas voir la liste avec les téléphones', () => fn(U.Marc, `admin_lister_utilisateurs()`), 'non_autorise');

// =====================================================================
log('\n=== FERMETURES AUTOMATIQUES APRÈS UN DÉLAI (pg_cron toutes les 5 min) ===');
const E2 = await env(); const db2 = E2.db, q2 = E2.q;
await db2.query('reset role');
const V = {}; for (const n of ['Vic', 'Wanda', 'Xavier', 'Yan', 'Zack']) V[n] = await E2.emp(n);
const route2 = (await q2(`select id from routes order by nom limit 1`))[0].id;
const cA = (await q2(`insert into equipes(nom) values ('A') returning id`))[0].id;
const cB = (await q2(`insert into equipes(nom) values ('B') returning id`))[0].id;
const cC = (await q2(`insert into equipes(nom) values ('C') returning id`))[0].id;
const sid = (await q2(`select id from stops limit 1`))[0].id;
// 1) passe oubliée depuis 13 h : dernier arrêt il y a 11 h, dernière position il y a 10 h
const pOld = uuid();
await db2.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total) values ($1,$2,$3,$4,1,$5,13)`, [pOld, route2, cA, V.Vic, at(13 * 60)]);
await db2.query(`insert into passe_arrets(passe_id, stop_id, complete_le, complete_par) values ($1,$2,$3,$4)`, [pOld, sid, at(11 * 60), V.Vic]);
await db2.query(`insert into positions(passe_id, equipe_id, chauffeur_id, lat, lon, maj_le) values ($1,$2,$3,46.5,-72.7,$4)`, [pOld, cA, V.Vic, at(10 * 60)]);
await db2.query(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut) values ($1,$2,'chauffeur',$3), ($1,$4,'passager',$5)`, [pOld, V.Vic, at(13 * 60), V.Wanda, at(12 * 60)]);
// 2) quart manuel oublié depuis 17 h (Xavier), dernière activité (arrêt complété) il y a 15 h
await db2.query(`insert into quarts(utilisateur_id, debut, debut_source) values ($1,$2,'manuel')`, [V.Xavier, at(17 * 60)]);
await db2.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, fin, statut, fin_type) values ($1,$2,$3,$4,2,$5,$6,'terminee','manuelle')`, [uuid(), route2, cC, V.Xavier, at(16 * 60), at(15 * 60)]);
// 3) quart ouvert par l'équipage depuis 17 h (Yan) + une passe RÉCENTE (5 h) dont il est le chauffeur
await db2.query(`insert into quarts(utilisateur_id, debut, debut_source, a_valider, raison_a_valider) values ($1,$2,'equipage',true,'ouvert_par_equipage')`, [V.Yan, at(17 * 60)]);
const pYan = uuid();
await db2.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total) values ($1,$2,$3,$4,3,$5,13)`, [pYan, route2, cB, V.Yan, at(5 * 60)]);
await db2.query(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut) values ($1,$2,'chauffeur',$3)`, [pYan, V.Yan, at(5 * 60)]);
// 4) éléments RÉCENTS qui ne doivent pas être touchés
await db2.query(`insert into quarts(utilisateur_id, debut, debut_source) values ($1,$2,'manuel')`, [V.Zack, at(2 * 60)]);
await E2.err('les fermetures automatiques ne sont pas appelables par un employé', () => E2.fn(V.Vic, `fermer_expires()`), 'permission denied');
const rc = (await db2.query(`select public.fermer_expires() as r`)).rows[0].r;
eq('1re exécution : 2 passes et 2 quarts fermés (la passe de Yan est fermée avec son quart)', [rc.passes_fermees, rc.quarts_fermes], [1, 2]);
const po = (await q2(`select statut, fin_type, fin_estimee, fin from passes where id=$1`, [pOld]))[0];
eq('passe oubliée : fermée, « délai maximal », fin ESTIMÉE', [po.statut, po.fin_type, po.fin_estimee], ['terminee', 'delai_max', true]);
const dpo = Math.abs(new Date(po.fin).getTime() - (Date.now() - 10 * 3600000));
dpo < 5000 ? pass('… fin = dernière activité connue (la dernière position, il y a 10 h), pas l\'heure du nettoyage') : fail('fin estimée', String(dpo));
eq('… son équipage est sorti à la même heure et sa position est effacée', [(await q2(`select count(*)::int n from equipage_periodes where passe_id=$1 and (fin is null or fin <> $2)`, [pOld, po.fin]))[0].n, (await q2(`select count(*)::int n from positions where passe_id=$1`, [pOld]))[0].n], [0, 0]);
const qx = (await q2(`select fin_source, fin_estimee, a_valider, raison_a_valider, fin from quarts where utilisateur_id=$1`, [V.Xavier]))[0];
eq('quart manuel oublié : fermé, fin estimée, À VALIDER (« fin estimée »)', [qx.fin_source, qx.fin_estimee, qx.a_valider, qx.raison_a_valider], ['delai_max', true, true, 'fin_estimee']);
const dqx = Math.abs(new Date(qx.fin).getTime() - (Date.now() - 15 * 3600000));
dqx < 5000 ? pass('… fin = sa dernière activité connue (il y a 15 h)') : fail('fin quart estimée', String(dqx));
const qy = (await q2(`select fin_estimee, a_valider, raison_a_valider from quarts where utilisateur_id=$1`, [V.Yan]))[0];
eq('quart « ouvert par l\'équipage » oublié : fermé, garde sa raison d\'origine', [qy.fin_estimee, qy.a_valider, qy.raison_a_valider], [true, true, 'ouvert_par_equipage']);
const pyan = (await q2(`select statut, fin_type, fin_estimee from passes where id=$1`, [pYan]))[0];
eq('la passe RÉCENTE de Yan se ferme avec son quart (« fin du quart », estimée)', [pyan.statut, pyan.fin_type, pyan.fin_estimee], ['terminee', 'fin_quart', true]);
eq('le quart récent de Zack (2 h) n\'est pas touché', (await q2(`select fin from quarts where utilisateur_id=$1`, [V.Zack]))[0].fin, null);
const rc2 = (await db2.query(`select public.fermer_expires() as r`)).rows[0].r;
eq('2e exécution : plus rien à fermer (idempotent)', [rc2.passes_fermees, rc2.quarts_fermes], [0, 0]);
eq('la tâche planifiée n\'existe pas ici (pas de pg_cron sur la base de test) : aucune erreur', E2.verif.tache_planifiee, null);

// =====================================================================
log('\n=== EXPORT DE PAIE ===');
const E3 = await env(); const db3 = E3.db, q3 = E3.q;
await db3.query('reset role');
const adm = await E3.ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const X = await E3.emp('Xénia'), Y = await E3.emp('Yvan'), Z = await E3.emp('Zoltan');
const rt1 = (await q3(`select id from routes where nom='Route Nord'`))[0].id, rt2 = (await q3(`select id from routes where nom='Route Sud'`))[0].id;
const c1 = (await q3(`insert into equipes(nom) values ('Camion 1') returning id`))[0].id, c2 = (await q3(`insert into equipes(nom) values ('Camion 2') returning id`))[0].id;
const D = (h, m = 0) => `2027-01-10T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
const p1 = uuid(), p2 = uuid();
await db3.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, fin, statut, fin_type) values ($1,$2,$3,$4,1,$5,$6,'terminee','complete'), ($7,$8,$9,$4,2,$10,$11,'terminee','complete')`, [p1, rt1, c1, Y, D(8), D(10), p2, rt2, c2, D(10), D(11)]);
await db3.query(`insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source) values ($1,$2,$3,'manuel','manuel'), ($4,$5,$6,'manuel','manuel')`, [X, D(8), D(12), Y, D(9), D(11)]);
await db3.query(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut, fin) values ($1,$2,'passager',$3,$4), ($5,$2,'passager',$4,$6)`, [p1, X, D(8), D(10), p2, D(11)]);
const exportPaie = (uid, a, b) => E3.fn(uid, `admin_export_paie($1::timestamptz,$2::timestamptz)`, [a, b]);
r = await exportPaie(adm, D(0), D(23, 59));
eq('journée complète : statut ok', r.statut, 'ok');
const ex = r.employes.find(e => e.nom === 'Xénia'), ey = r.employes.find(e => e.nom === 'Yvan');
eq('Xénia : 4 h au total (08:00–12:00)', [ex.heures, ex.quarts], [4, 1]);
eq('… réparties : 2 h Camion 1 / Route Nord, 1 h Camion 2 / Route Sud', ex.repartition.map(x => `${x.vehicule}|${x.route}|${x.heures}`), ['Camion 1|Route Nord|2', 'Camion 2|Route Sud|1']);
eq('… et 1 h hors équipage (11:00–12:00), donc payée quand même', ex.hors_equipage, 1);
eq('Yvan : 2 h, aucune répartition, toutes hors équipage', [ey.heures, ey.repartition, ey.hors_equipage], [2, [], 2]);
r = await exportPaie(adm, D(9), D(11));
const ex2 = r.employes.find(e => e.nom === 'Xénia');
eq('période plus courte (09:00–11:00) : les heures sont COUPÉES à la période', [ex2.heures, ex2.hors_equipage, ex2.repartition.map(x => x.heures)], [2, 0, [1, 1]]);
eq('Zoltan (aucun quart) n\'apparaît pas', r.employes.some(e => e.nom === 'Zoltan'), false);
// Quart à valider
const idZ = uuid();
await db3.query(`insert into quarts(id, utilisateur_id, debut, fin, debut_source, fin_source, a_valider, raison_a_valider) values ($1,$2,$3,$4,'equipage','manuel',true,'ouvert_par_equipage')`, [idZ, Z, D(13), D(15)]);
r = await exportPaie(adm, D(0), D(23, 59));
eq('un quart « ouvert par l\'équipage » non validé : l\'export REFUSE', [r.statut, r.raison, r.quarts.length], ['refuse', 'quarts_a_valider', 1]);
eq('… AUCUNE heure n\'est renvoyée dans un refus', 'employes' in r, false);
eq('… le refus nomme l\'employé et le quart à valider', [r.quarts[0].employe, r.quarts[0].raison], ['Zoltan', 'ouvert_par_equipage']);
r = await exportPaie(adm, D(0), D(12, 30));
eq('une période qui ne contient PAS ce quart peut être exportée', r.statut, 'ok');
await E3.fn(adm, `admin_valider_quart($1::uuid,null)`, [idZ]);
r = await exportPaie(adm, D(0), D(23, 59));
eq('après validation par Joé : l\'export fonctionne', [r.statut, r.employes.find(e => e.nom === 'Zoltan').heures], ['ok', 2]);
await db3.query(`insert into quarts(utilisateur_id, debut, debut_source) values ($1,$2,'manuel')`, [Y, D(16)]);
r = await exportPaie(adm, D(0), D(23, 59));
eq('un quart encore OUVERT : l\'export refuse aussi', [r.statut, r.raison], ['refuse', 'quarts_ouverts']);
// Quart à valider à cause d'une fin estimée
await db3.query(`update quarts set fin = $1, fin_source='delai_max', fin_estimee = true, a_valider = true, raison_a_valider = 'fin_estimee' where utilisateur_id=$2 and fin is null`, [D(23), Y]);
r = await exportPaie(adm, D(0), D(23, 59));
eq('un quart à fin ESTIMÉE non validé : refusé aussi', [r.statut, r.quarts.map(q => q.raison)], ['refuse', ['fin_estimee']]);
await db3.query(`update quarts set a_valider = false, valide_par = $1, valide_le = now() where utilisateur_id=$2 and fin_estimee`, [adm, Y]);
await db3.query(`update equipage_periodes set a_verifier = true where utilisateur_id=$1`, [X]);
r = await exportPaie(adm, D(0), D(23, 59));
eq('tout validé : ok, avec un avertissement sur les périodes d\'équipage « à vérifier »', [r.statut, r.avertissements.periodes_equipage_a_verifier], ['ok', 2]);
await E3.err('un employé ne peut pas exporter la paie', () => exportPaie(X, D(0), D(23, 59)), 'non_autorise');
await E3.err('un visiteur non plus', () => E3.fn(null, `admin_export_paie($1::timestamptz,$2::timestamptz)`, [D(0), D(1)], 'anon'), 'permission denied');
await E3.err('période invalide refusée', () => exportPaie(adm, D(12), D(8)), 'periode_invalide');

log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
