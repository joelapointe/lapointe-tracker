// Demande 6 de Joé (29 sept. 2026) — Fichier SQL 29 : le TEMPS PASSÉ chez chaque client (table arret_presences, fonction arret_presence) et le réglage du COMPLÉTÉ AUTOMATIQUE (presence_complete_auto_s).
// Banc d'essai local (base PGlite), sur le modèle de test-suivi-passages.mjs. Ce que ce test NE peut PAS vérifier : le vrai Supabase (le fichier y est exécuté avec l'accord de Joé, puis sa requête
// « verification » est relue) ni l'application (la détection dans la zone : test-app-presence.mjs ; le Suivi : test-app-suivi-passages.mjs).
// SQL29_TEST (variable d'environnement) : une COPIE abîmée du fichier, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
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

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const SQL29 = fs.readFileSync(process.env.SQL29_TEST || (SQL_DIR + '29-presence-et-temps-passe.sql'), 'utf8');
const GAZON = 'Coupe de gazon', SEL = 'Épandage de sel';
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

const db = await prepare(FILES);
const q = async (sql, p) => (await db.query(sql, p)).rows;
async function fn(uid, call, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(`select public.${call} as r`, params)).rows[0].r; } finally { await db.query('reset role'); }
}
async function sqlAs(uid, sql, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(sql, params)).rows; } finally { await db.query('reset role'); }
}
async function err(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { new RegExp(motif, 'i').test(e.message) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 90)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
let tel = 8195550000;
const emp = (nom) => ins(nom.toLowerCase() + '@t.ca', { nom, telephone: String(++tel) });

const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const nina = await emp('Nina'), luc = await emp('Luc'), zoe = await emp('Zoe');
await q(`update utilisateurs set actif = false where id = $1`, [zoe]);
const equipe = (await q(`insert into equipes(nom) values ('C1') returning id`))[0].id;
const route = async (nom) => (await q(`insert into routes(nom) values ($1) returning id`, [nom]))[0].id;
const rA = await route('Route A'), rB = await route('Route B');
let n = 0;
const stop = async (r, service) => (await q(`insert into stops(adresse, route_id, service, lat, lon) values ($1, $2, $3, 46.5, -72.7) returning id`, ['Adresse ' + (++n), r, service]))[0].id;
const a1 = await stop(rA, GAZON), a2 = await stop(rA, GAZON), aSel = await stop(rA, SEL), b1 = await stop(rB, GAZON);
const debuter = (uid, id, r, min = 60, tache = GAZON) => fn(uid, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [id, r, equipe, at(min), tache]);
const P1 = uuid();
await debuter(nina, P1, rA, 120);   // la passe de Nina a débuté il y a 2 heures
const presence = (uid, passe, arret, arrivee, depart = null, role = 'authenticated') =>
  fn(uid, `arret_presence($1::uuid,$2::uuid,$3::timestamptz,$4::timestamptz)`, [passe, arret, arrivee, depart], role);
const lignes = (passe, arret) => q(`select to_char(arrivee_le at time zone 'UTC', 'HH24:MI:SS') a, to_char(depart_le at time zone 'UTC', 'HH24:MI:SS') d, signale_par from arret_presences where passe_id = $1 and stop_id = $2 order by arrivee_le`, [passe, arret]);
const hms = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString().slice(11, 19);
const tableExiste = async () => (await q(`select to_regclass('public.arret_presences') is not null as r`))[0].r;
const fonctionExiste = async () => (await q(`select to_regprocedure('public.arret_presence(uuid, uuid, timestamptz, timestamptz)') is not null as r`))[0].r;
const defCompleter = async () => (await q(`select pg_get_functiondef('public.completer_arret(uuid,uuid,timestamptz,text,double precision,double precision)'::regprocedure) d`))[0].d;
const reglagesTous = () => q(`select cle, valeur::text v, description from reglages order by cle`);

log('=== AVANT LE FICHIER : RIEN N\'EXISTE ; APRÈS : LA TABLE, LA FONCTION ET LE RÉGLAGE SONT LÀ, ET RIEN D\'AUTRE NE CHANGE ===');
{
  eq('avant : pas de table arret_presences, pas de fonction arret_presence', [await tableExiste(), await fonctionExiste()], [false, false]);
  await fn(nina, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,'manuel'::text,46.5::float8,-72.7::float8)`, [P1, a2, at(100)]);   // (un « Complété » existe AVANT le fichier : il doit y être encore APRÈS)
  eq('(mise en place) un « Complété » existe déjà avant le fichier', (await q(`select count(*)::int n from passe_arrets`))[0].n, 1);
  const reglagesAvant = await reglagesTous();
  const defAvant = await defCompleter();
  const reglesReglagesAvant = (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'reglages' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd);
  const passeAvant = (await q(`select count(*)::int n from passes`))[0].n, arretsAvant = (await q(`select count(*)::int n from passe_arrets`))[0].n;
  await db.exec(SQL29);
  eq('après : la table et la fonction existent', [await tableExiste(), await fonctionExiste()], [true, true]);
  eq('… la table est VIDE', (await q(`select count(*)::int n from arret_presences`))[0].n, 0);
  eq('… ses colonnes (nom, type, vide permis)', (await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'arret_presences' order by column_name`)).map((x) => [x.column_name, x.data_type, x.is_nullable]),
    [['arrivee_le', 'timestamp with time zone', 'NO'], ['cree_le', 'timestamp with time zone', 'NO'], ['depart_le', 'timestamp with time zone', 'YES'], ['id', 'uuid', 'NO'], ['maj_le', 'timestamp with time zone', 'NO'], ['passe_id', 'uuid', 'NO'], ['signale_par', 'uuid', 'YES'], ['stop_id', 'uuid', 'NO']]);
  eq('… la sécurité de la table est ACTIVE', (await q(`select relrowsecurity from pg_class where oid = 'public.arret_presences'::regclass`))[0].relrowsecurity, true);
  eq('… UNE seule règle d\'accès : la LECTURE par l\'administrateur', (await q(`select policyname || ' (' || cmd || ')' as r from pg_policies where schemaname = 'public' and tablename = 'arret_presences'`)).map((x) => x.r), ['arret_presences_admin_lecture (SELECT)']);
  eq('… un visiteur non connecté n\'a AUCUN droit sur la table', (await q(`select has_table_privilege('anon', 'public.arret_presences', 'select') or has_table_privilege('anon', 'public.arret_presences', 'insert') or has_table_privilege('anon', 'public.arret_presences', 'update') or has_table_privilege('anon', 'public.arret_presences', 'delete') as r`))[0].r, false);
  eq('… une personne connectée peut LIRE (les règles filtrent) mais jamais écrire directement (ni ajouter, ni modifier, ni supprimer)', (await q(`select has_table_privilege('authenticated', 'public.arret_presences', 'select') as l, (has_table_privilege('authenticated', 'public.arret_presences', 'insert') or has_table_privilege('authenticated', 'public.arret_presences', 'update') or has_table_privilege('authenticated', 'public.arret_presences', 'delete')) as e`))[0], { l: true, e: false });
  eq('… la fonction : un visiteur ne peut pas l\'appeler, une personne connectée oui', (await q(`select has_function_privilege('anon', 'public.arret_presence(uuid, uuid, timestamptz, timestamptz)', 'execute') as a, has_function_privilege('authenticated', 'public.arret_presence(uuid, uuid, timestamptz, timestamptz)', 'execute') as c`))[0], { a: false, c: true });
  eq('… une seule version de la fonction', (await q(`select count(*)::int n from pg_proc where proname = 'arret_presence' and pronamespace = 'public'::regnamespace`))[0].n, 1);
  eq('… aucune clé étrangère ne supprime en cascade : supprimer une passe, un client ou une personne ne fait jamais disparaître leurs présences', (await q(`select a.attname col, c.confdeltype::text t from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.conrelid = 'public.arret_presences'::regclass and c.contype = 'f' order by a.attname`)).map((x) => x.col + ':' + x.t), ['passe_id:a', 'signale_par:a', 'stop_id:a']);
  eq('… completer_arret n\'a pas changé d\'un caractère (le complété automatique passe par lui, en mode « auto »)', (await defCompleter()) === defAvant, true);
  eq('… aucune passe ni aucun « Complété » n\'a été touché', [(await q(`select count(*)::int n from passes`))[0].n, (await q(`select count(*)::int n from passe_arrets`))[0].n], [passeAvant, arretsAvant]);
  const reglagesApres = await reglagesTous();
  eq('… les réglages d\'avant sont intacts (mêmes clés, mêmes valeurs, mêmes descriptions)', reglagesApres.filter((r) => r.cle !== 'presence_complete_auto_s'), reglagesAvant);
  eq('… UN réglage de plus : « presence_complete_auto_s » = 60 secondes, avec sa description', reglagesApres.filter((r) => r.cle === 'presence_complete_auto_s').map((r) => [r.v, /SECONDES/.test(r.description), /0 = jamais/.test(r.description)]), [['60', true, true]]);
  eq('… les règles d\'accès de « reglages » n\'ont pas changé', (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'reglages' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd), reglesReglagesAvant);
}

log('\n=== ON PEUT L\'EXÉCUTER PLUSIEURS FOIS : RIEN N\'EST EFFACÉ, RIEN N\'EST REMIS À ZÉRO ===');
{
  await presence(nina, P1, a1, at(50), at(40));
  await q(`update reglages set valeur = '90'::jsonb where cle = 'presence_complete_auto_s'`);
  await db.exec(SQL29);
  await db.exec(SQL29);
  eq('ré-exécuter deux fois le fichier garde la présence déjà notée', await lignes(P1, a1), [{ a: hms(50), d: hms(40), signale_par: nina }]);
  eq('… garde le réglage que Joé a changé (90 ; jamais remis à 60)', (await q(`select valeur::text v from reglages where cle = 'presence_complete_auto_s'`))[0].v, '90');
  eq('… ne double pas le réglage, la règle d\'accès, la fonction ni les règles de la table', [
    (await q(`select count(*)::int n from reglages where cle = 'presence_complete_auto_s'`))[0].n,
    (await q(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename = 'arret_presences'`))[0].n,
    (await q(`select count(*)::int n from pg_proc where proname = 'arret_presence' and pronamespace = 'public'::regnamespace`))[0].n,
    (await q(`select count(*)::int n from pg_constraint where conrelid = 'public.arret_presences'::regclass and contype in ('u', 'c')`))[0].n], [1, 1, 1, 3]);
  await q(`update reglages set valeur = '60'::jsonb where cle = 'presence_complete_auto_s'`);
  await q(`delete from arret_presences`);
}

log('\n=== NOTER UNE PRÉSENCE : L\'ARRIVÉE, PUIS LE DÉPART ===');
{
  const r1 = await presence(nina, P1, a1, at(30));
  eq('le chauffeur note l\'ARRIVÉE seule : « enregistree », une ligne, sans départ, « signale_par » = lui', [r1.statut, typeof r1.presence_id, await lignes(P1, a1)], ['enregistree', 'string', [{ a: hms(30), d: null, signale_par: nina }]]);
  eq('… « cree_le » et « maj_le » sont posés tout seuls, à l\'heure de l\'enregistrement (et pareils à la première écriture)', (await q(`select (maj_le = cree_le) as pareil, (abs(extract(epoch from (now() - cree_le))) < 120) as recent from arret_presences where passe_id = $1 and stop_id = $2`, [P1, a1]))[0], { pareil: true, recent: true });
  // (la MÊME arrivée, avec le départ : la même ligne)
  const arrivee = (await q(`select arrivee_le from arret_presences where passe_id = $1 and stop_id = $2`, [P1, a1]))[0].arrivee_le.toISOString();
  const r2 = await presence(nina, P1, a1, arrivee, at(10));
  eq('la MÊME arrivée renvoyée avec le départ : la même ligne (pas de doublon), le départ est ajouté', [r2.presence_id === r1.presence_id, await lignes(P1, a1)], [true, [{ a: hms(30), d: hms(10), signale_par: nina }]]);
  await presence(nina, P1, a1, arrivee, at(20));
  eq('un départ PLUS TÔT renvoyé plus tard (un vieux geste) ne fait pas reculer le départ', (await lignes(P1, a1))[0].d, hms(10));
  await presence(nina, P1, a1, arrivee, null);
  eq('une arrivée seule renvoyée après le départ n\'efface PAS le départ', (await lignes(P1, a1))[0].d, hms(10));
  await presence(nina, P1, a1, arrivee, at(5));
  eq('un départ PLUS TARD avance le départ (la visite s\'est prolongée)', (await lignes(P1, a1))[0].d, hms(5));
  eq('« maj_le » est mis à jour par un renvoi (plus tard que « cree_le », qui ne bouge pas)', (await q(`select maj_le > cree_le as ok from arret_presences where passe_id = $1`, [P1]))[0].ok, true);
  await presence(nina, P1, a1, at(3), at(1));
  eq('une AUTRE arrivée pour le même client dans la même passe (le camion est parti, puis revenu) : une 2ᵉ ligne', (await lignes(P1, a1)).length, 2);
  await presence(nina, P1, a2, at(100), at(90));
  eq('un autre client : sa propre ligne ; la passe a maintenant 3 présences', [(await lignes(P1, a2)).length, (await q(`select count(*)::int n from arret_presences where passe_id = $1`, [P1]))[0].n], [1, 3]);
  eq('« maj_le » et « cree_le » sont posés tout seuls, à l\'heure de l\'enregistrement, pour les 3 lignes', (await q(`select count(*)::int n from arret_presences where abs(extract(epoch from (now() - cree_le))) < 120 and abs(extract(epoch from (now() - maj_le))) < 120`))[0].n, 3);
  await q(`delete from arret_presences`);
}

log('\n=== QUI PEUT NOTER UNE PRÉSENCE : LE CHAUFFEUR DE LA PASSE (ET L\'ADMINISTRATEUR), PERSONNE D\'AUTRE ===');
{
  await err('un employé qui n\'est pas le chauffeur de cette passe est refusé', () => presence(luc, P1, a1, at(30)), 'non_autorise');
  await err('un employé désactivé est refusé', () => presence(zoe, P1, a1, at(30)), 'non_autorise');
  // (le chauffeur DÉSACTIVÉ d'une passe : il est bien le chauffeur, seule la désactivation le fait refuser)
  const yan = await emp('Yan'), P5 = uuid();
  await fn(yan, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [P5, rB, (await q(`insert into equipes(nom) values ('C5') returning id`))[0].id, at(60), GAZON]);
  eq('(mise en place) Yan, chauffeur actif de sa passe, peut noter une présence', (await presence(yan, P5, b1, at(30), at(20))).statut, 'enregistree');
  await q(`delete from arret_presences`);
  await q(`update utilisateurs set actif = false where id = $1`, [yan]);
  await err('… désactivé, le même chauffeur de la même passe est refusé', () => presence(yan, P5, b1, at(30), at(20)), 'non_autorise');
  eq('… et rien n\'est noté', (await q(`select count(*)::int n from arret_presences`))[0].n, 0);
  await err('un visiteur non connecté est refusé (« permission denied »)', () => presence(null, P1, a1, at(30), null, 'anon'), 'permission denied');
  await err('une passe qui n\'existe pas', () => presence(nina, uuid(), a1, at(30)), 'passe_introuvable');
  eq('l\'administrateur peut noter une présence (correction)', (await presence(admin, P1, a1, at(30), at(20))).statut, 'enregistree');
  eq('… « signale_par » est alors l\'administrateur', (await lignes(P1, a1))[0].signale_par, admin);
  eq('… et aucune présence n\'est restée des refus', (await q(`select count(*)::int n from arret_presences`))[0].n, 1);
  await q(`delete from arret_presences`);
  // un passager à bord (pas le chauffeur) : refusé
  eq('(mise en place) Luc monte à bord de la passe de Nina', (await fn(nina, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real,false)`, [uuid(), P1, luc, at(100)])).statut, 'ajoute');
  await err('un PASSAGER à bord de la passe n\'est pas le chauffeur : refusé (seul le chauffeur envoie, comme pour la position et les « Complété »)', () => presence(luc, P1, a1, at(30)), 'non_autorise');
  eq('… et rien n\'est noté', (await q(`select count(*)::int n from arret_presences`))[0].n, 0);
}

log('\n=== CE QUI EST REFUSÉ : L\'ARRÊT, LES HEURES ===');
{
  await err('un arrêt d\'une AUTRE route que la passe', () => presence(nina, P1, b1, at(30)), 'arret_hors_route');
  await err('un arrêt d\'une AUTRE tâche que la passe (le sel, dans une passe de gazon)', () => presence(nina, P1, aSel, at(30)), 'arret_hors_tache');
  await err('un arrêt qui n\'existe pas', () => presence(nina, P1, uuid(), at(30)), 'arret_hors_route');
  await err('sans heure d\'arrivée', () => presence(nina, P1, a1, null), 'arrivee_requise');
  await err('une arrivée d\'AVANT le début de la passe (plus de 10 minutes : la passe a débuté il y a 120 min, arrivée il y a 131 min)', () => presence(nina, P1, a1, at(131)), 'presence_avant_passe');
  eq('… 10 minutes avant le début, c\'est encore accepté (les horloges des téléphones ne sont pas exactes)', (await presence(nina, P1, a1, at(129))).statut, 'enregistree');
  await q(`delete from arret_presences`);
  await err('un départ AVANT l\'arrivée', () => presence(nina, P1, a1, at(30), at(40)), 'presence_incoherente');
  const t0 = at(15);
  eq('un départ EXACTEMENT à l\'arrivée est accepté (une visite de zéro seconde)', (await presence(nina, P1, a1, t0, t0)).statut, 'enregistree');
  await q(`delete from arret_presences`);
  // (une passe qui a débuté il y a 14 heures : c'est la seule où une arrivée de plus de 12 heures avant le départ est possible)
  const P4 = uuid();
  const nina4 = await emp('Nina4');
  await fn(nina4, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [P4, rB, (await q(`insert into equipes(nom) values ('C4') returning id`))[0].id, at(14 * 60), GAZON]);
  await err('une visite de plus de 12 heures (arrivée il y a 13 h, départ maintenant)', () => presence(nina4, P4, b1, at(13 * 60), at(0)), 'presence_trop_longue');
  await err('… 12 h 30 : refusée aussi', () => presence(nina4, P4, b1, at(12 * 60 + 30), at(0)), 'presence_trop_longue');
  const base = Date.now();
  eq('… 12 heures PILE : acceptée (la limite est « plus de 12 heures »)', (await presence(nina4, P4, b1, new Date(base - 12 * 3600000).toISOString(), new Date(base).toISOString())).statut, 'enregistree');
  await q(`delete from arret_presences`);
  eq('… 11 heures : acceptée', (await presence(nina4, P4, b1, at(11 * 60), at(0))).statut, 'enregistree');
  await q(`delete from arret_presences`);
  await err('une arrivée de plus de 3 jours (comme les autres gestes : « geste_trop_ancien »)', () => presence(nina, P1, a1, at(60 * 24 * 4)), 'geste_trop_ancien');
  const futur = new Date(Date.now() + 3600000).toISOString();
  const rf = await presence(nina, P1, a1, futur);
  const lf = (await q(`select arrivee_le from arret_presences where passe_id = $1 and stop_id = $2`, [P1, a1]))[0].arrivee_le.getTime();
  eq('une arrivée dans le FUTUR compte comme maintenant (comme les autres gestes)', [rf.statut, Math.abs(lf - Date.now()) < 60000], ['enregistree', true]);
  await q(`delete from arret_presences`);
  const rd = await presence(nina, P1, a1, at(10), new Date(Date.now() + 3600000).toISOString());
  const ld = (await q(`select depart_le, arrivee_le from arret_presences`))[0];
  eq('un départ dans le futur compte comme maintenant, et reste après l\'arrivée', [rd.statut, Math.abs(ld.depart_le.getTime() - Date.now()) < 60000, ld.depart_le >= ld.arrivee_le], ['enregistree', true, true]);
  eq('… rien d\'autre n\'est resté des refus', (await q(`select count(*)::int n from arret_presences`))[0].n, 1);
  await q(`delete from arret_presences`);
}

log('\n=== LA PASSE TERMINÉE : UNE PRÉSENCE ENVOYÉE APRÈS (SANS RÉSEAU) EST ACCEPTÉE ===');
{
  const P3 = uuid();
  const nina2 = await emp('Nina2');
  await fn(nina2, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [P3, rB, (await q(`insert into equipes(nom) values ('C2') returning id`))[0].id, at(90), GAZON]);
  await fn(nina2, `terminer_passe($1::uuid,$2::timestamptz)`, [P3, at(30)]);
  eq('(mise en place) la passe est terminée', (await q(`select statut from passes where id = $1`, [P3]))[0].statut, 'terminee');
  eq('le chauffeur note quand même la présence d\'avant la fin (les téléphones sans réseau envoient plus tard)', (await presence(nina2, P3, b1, at(60), at(50))).statut, 'enregistree');
  await q(`delete from arret_presences`);
}

log('\n=== QUI LIT LES PRÉSENCES : L\'ADMINISTRATEUR SEULEMENT ; PERSONNE N\'ÉCRIT EN DIRECT ===');
{
  await presence(nina, P1, a1, at(30), at(20));
  eq('l\'administrateur lit la présence', (await sqlAs(admin, `select count(*)::int n from arret_presences`))[0].n, 1);
  eq('le chauffeur qui l\'a notée NE la lit PAS (le chrono est chez lui, le reste est pour l\'administrateur)', (await sqlAs(nina, `select count(*)::int n from arret_presences`))[0].n, 0);
  eq('un autre employé non plus', (await sqlAs(luc, `select count(*)::int n from arret_presences`))[0].n, 0);
  await err('un visiteur ne peut pas lire (« permission denied »)', () => sqlAs(null, `select count(*) from arret_presences`, [], 'anon'), 'permission denied');
  await err('un employé ne peut pas ajouter une ligne lui-même', () => sqlAs(nina, `insert into arret_presences(passe_id, stop_id, arrivee_le) values ($1, $2, now())`, [P1, a2]), 'permission denied');
  await err('… ni la modifier', () => sqlAs(nina, `update arret_presences set depart_le = now()`), 'permission denied');
  await err('… ni la supprimer', () => sqlAs(nina, `delete from arret_presences`), 'permission denied');
  await err('l\'administrateur non plus n\'écrit pas en direct (il passe par la fonction)', () => sqlAs(admin, `insert into arret_presences(passe_id, stop_id, arrivee_le) values ($1, $2, now())`, [P1, a2]), 'permission denied');
  eq('… la présence est intacte', (await q(`select count(*)::int n from arret_presences`))[0].n, 1);
  await err('supprimer le client qui a des présences est refusé par la base (il sera archivé, comme un client qui a des passes)', () => q(`delete from stops where id = $1`, [a1]), 'foreign key');
  await err('supprimer la passe qui a des présences est refusé aussi', () => q(`delete from passes where id = $1`, [P1]), 'foreign key');
  await q(`delete from arret_presences`);
}

log('\n=== LES RÈGLES DE LA TABLE ELLE-MÊME (même pour quelqu\'un qui écrirait directement) ===');
{
  await q(`insert into arret_presences(passe_id, stop_id, arrivee_le, depart_le) values ($1, $2, '2026-06-01T10:00:00Z', '2026-06-01T10:30:00Z')`, [P1, a1]);
  await err('la même arrivée pour la même passe et le même client est refusée', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le) values ($1, $2, '2026-06-01T10:00:00Z')`, [P1, a1]), 'arret_presences_une_arrivee');
  eq('… une autre arrivée : acceptée', (await q(`insert into arret_presences(passe_id, stop_id, arrivee_le) values ($1, $2, '2026-06-01T11:00:00Z') returning id`, [P1, a1])).length, 1);
  await err('un départ avant l\'arrivée est refusé', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le, depart_le) values ($1, $2, '2026-06-02T10:00:00Z', '2026-06-02T09:59:59Z')`, [P1, a1]), 'arret_presences_depart_apres_arrivee');
  eq('… un départ EXACTEMENT à l\'arrivée est accepté (une visite de zéro seconde)', (await q(`insert into arret_presences(passe_id, stop_id, arrivee_le, depart_le) values ($1, $2, '2026-06-03T10:00:00Z', '2026-06-03T10:00:00Z') returning id`, [P1, a1])).length, 1);
  await err('une visite de 12 heures et une seconde est refusée', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le, depart_le) values ($1, $2, '2026-06-04T10:00:00Z', '2026-06-04T22:00:01Z')`, [P1, a1]), 'arret_presences_duree_plausible');
  eq('… 12 heures pile : acceptée', (await q(`insert into arret_presences(passe_id, stop_id, arrivee_le, depart_le) values ($1, $2, '2026-06-05T10:00:00Z', '2026-06-05T22:00:00Z') returning id`, [P1, a1])).length, 1);
  await err('sans passe : refusé', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le) values (null, $1, now())`, [a1]), 'null value|not-null');
  await err('sans arrêt : refusé', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le) values ($1, null, now())`, [P1]), 'null value|not-null');
  await err('sans arrivée : refusé', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le) values ($1, $2, null)`, [P1, a1]), 'null value|not-null');
  await err('une passe qui n\'existe pas : refusé', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le) values (gen_random_uuid(), $1, now())`, [a1]), 'foreign key');
  await err('un arrêt qui n\'existe pas : refusé', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le) values ($1, gen_random_uuid(), now())`, [P1]), 'foreign key');
  await err('une personne qui n\'existe pas ne peut pas être « signale_par »', () => q(`insert into arret_presences(passe_id, stop_id, arrivee_le, signale_par) values ($1, $2, now(), gen_random_uuid())`, [P1, a2]), 'foreign key');
  await q(`delete from arret_presences`);
}

log('\n=== LE RÉGLAGE : LES EMPLOYÉS LE LISENT, L\'ADMINISTRATEUR LE CHANGE (0 = JAMAIS) ===');
{
  eq('un employé lit le réglage (60)', (await sqlAs(luc, `select valeur::text v from reglages where cle = 'presence_complete_auto_s'`))[0].v, '60');
  eq('… il ne peut PAS le changer (aucune ligne modifiée)', [(await sqlAs(luc, `update reglages set valeur = '5'::jsonb where cle = 'presence_complete_auto_s' returning cle`)).length, (await q(`select valeur::text v from reglages where cle = 'presence_complete_auto_s'`))[0].v], [0, '60']);
  eq('l\'administrateur le change (0 = jamais)', (await sqlAs(admin, `update reglages set valeur = '0'::jsonb where cle = 'presence_complete_auto_s' returning valeur::text v`))[0].v, '0');
  eq('… et 90', (await sqlAs(admin, `update reglages set valeur = '90'::jsonb where cle = 'presence_complete_auto_s' returning valeur::text v`))[0].v, '90');
  await q(`update reglages set valeur = '60'::jsonb where cle = 'presence_complete_auto_s'`);
  eq('un visiteur ne lit rien (« permission denied »)', await (async () => { try { await sqlAs(null, `select * from reglages`, [], 'anon'); return 'lu'; } catch (e) { return /permission denied/.test(e.message) ? 'refusé' : e.message; } })(), 'refusé');
}

log('\n=== SANS LES FICHIERS PRÉCÉDENTS : REFUSÉ, RIEN N\'EST MODIFIÉ ===');
{
  const essaiSans = async (nb) => {
    const nu = await prepare(FILES.slice(0, nb));
    let msg = null;
    try { await nu.exec(SQL29); } catch (e) { msg = e.message; }
    const reglageCree = (await nu.query(`select to_regclass('public.reglages') is not null as r`)).rows[0].r
      ? (await nu.query(`select count(*)::int n from reglages where cle = 'presence_complete_auto_s'`)).rows[0].n > 0 : false;   // (sans la table des réglages, rien n'a pu y être ajouté)
    const rien = [(await nu.query(`select to_regclass('public.arret_presences') is not null as r`)).rows[0].r, (await nu.query(`select count(*)::int n from pg_proc where proname = 'arret_presence'`)).rows[0].n, !reglageCree];
    return { msg: msg || '', rien };
  };
  const s1 = await essaiSans(1);
  eq('sans le fichier 02 (pas de passes ni de réglages) : le fichier refuse de s\'exécuter et le dit clairement', /les tables passes, stops, utilisateurs et reglages n'existent pas/.test(s1.msg), true);
  eq('… et n\'a créé ni la table, ni la fonction, ni le réglage', s1.rien, [false, 0, true]);
  const s2 = await essaiSans(2);
  eq('sans les fichiers 03 et 04 (pas de est_admin, _exiger_actif, _moment_valide) : refusé, et le dit clairement', /les fonctions de base/.test(s2.msg), true);
  eq('… et n\'a rien créé non plus', s2.rien, [false, 0, true]);
  const s4 = await essaiSans(4);
  eq('sans le fichier 05 (completer_arret n\'existe pas encore) : refusé aussi, avec son nom', /la fonction completer_arret/.test(s4.msg), true);
  eq('… et n\'a rien créé non plus', s4.rien, [false, 0, true]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
