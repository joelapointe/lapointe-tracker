import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/ (chemin relatif : fonctionne depuis n'importe où)
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import fs from 'fs';

const dir = SQL_DIR;
const db = new PGlite({ extensions: { btree_gist } });
let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };

async function exec(sql) { return db.exec(sql); }
async function q(sql, params) { return (await db.query(sql, params)).rows; }
async function expectOk(l, sql, params) { try { await db.query(sql, params); pass(l); } catch (e) { fail(l, e.message); } }
async function expectFail(l, sql, params, motif) {
  try { await db.query(sql, params); fail(l, 'aurait dû être refusé'); }
  catch (e) { (!motif || e.message.includes(motif)) ? pass(l + '  [refusé: ' + e.message.split('\n')[0].slice(0, 90) + ']') : fail(l, 'refusé pour une autre raison: ' + e.message); }
}
const as = async (uid) => { await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']); };

// ---------- Simulation de Supabase + ancien schéma (d'après l'inventaire) ----------
await exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions;
create table auth.users (id uuid primary key default gen_random_uuid(), email text,
  raw_app_meta_data jsonb default '{}'::jsonb, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, extensions, public to anon, authenticated;

create table public.equipes (id uuid primary key default gen_random_uuid(), nom text not null, operateur text, couleur text default '#c8e63c', created_at timestamp default now());
create table public.zones   (id uuid primary key default gen_random_uuid(), nom text not null, equipe_id uuid references public.equipes(id), created_at timestamp default now());
create table public.routes  (id uuid primary key default gen_random_uuid(), nom text not null, couleur text default '#c8e63c', created_at timestamp default now());
create table public.stops   (id uuid primary key default gen_random_uuid(), adresse text not null, client text, service text default 'Déneigement mécanique',
  lat double precision, lon double precision, fait boolean default false, ordre integer default 0,
  equipe_id uuid references public.equipes(id), zone_id uuid references public.zones(id), created_at timestamp default now(),
  route_nom text, route_id uuid references public.routes(id), zone_points jsonb);
create table public.utilisateurs (id uuid primary key default gen_random_uuid(), nom text not null, telephone text not null unique, pin text not null,
  role text default 'employe' check (role in ('admin','employe')), created_at timestamp default now(), approuve boolean default false);
create table public.positions (id uuid primary key default gen_random_uuid(), utilisateur_id uuid references public.utilisateurs(id) on delete cascade, nom text, lat float8, lon float8, updated_at timestamp default now());
create unique index positions_user_idx on public.positions(utilisateur_id);
create table public.problemes (id uuid primary key default gen_random_uuid(), stop_id uuid references public.stops(id) on delete cascade, utilisateur_id uuid references public.utilisateurs(id), note text, lu boolean default false, created_at timestamp default now());
grant all on all tables in schema public to anon, authenticated;
insert into public.routes(nom) values ('Route Nord'), ('Route Sud');
insert into public.stops(adresse, route_id, fait) select 'Adresse ' || g, (select id from public.routes order by nom limit 1), (g % 3 = 0) from generate_series(1, 13) g;
insert into public.utilisateurs(nom, telephone, pin) values ('Test A','8195550001','1234'), ('Test B','8195550002','5678');
insert into public.positions(utilisateur_id, nom, lat, lon) select id, nom, 46.5, -72.7 from public.utilisateurs;
insert into public.problemes(stop_id, utilisateur_id, note) select (select id from public.stops limit 1), id, 'test' from public.utilisateurs;
`);
log('Base de simulation prête : ' + JSON.stringify((await q(`select (select count(*) from stops) stops, (select count(*) from routes) routes, (select count(*) from utilisateurs) users`))[0]));

// ---------- ÉTAPE 6 ----------
log('\n=== ÉTAPE 6 : exécution du fichier ===');
const r6 = await exec(fs.readFileSync(dir + '01-etape6-utilisateurs.sql', 'utf8'));
log('Vérification renvoyée : ' + JSON.stringify(r6[r6.length - 1].rows[0].verification));

// ---------- ÉTAPE 7 ----------
log('\n=== ÉTAPE 7 : exécution du fichier ===');
const r7 = await exec(fs.readFileSync(dir + '02-etape7-modele-passes-quarts.sql', 'utf8'));
log('Vérification renvoyée : ' + JSON.stringify(r7[r7.length - 1].rows[0].verification));

// ---------- TESTS ----------
log('\n=== Tests : données conservées ===');
const c = (await q(`select (select count(*) from stops)::int s, (select count(*) from routes)::int r`))[0];
c.s === 13 && c.r === 2 ? pass('13 arrêts et 2 routes conservés') : fail('arrêts/routes', JSON.stringify(c));
const t = (await q(`select data_type from information_schema.columns where table_name='stops' and column_name='created_at'`))[0].data_type;
t === 'timestamp with time zone' ? pass('dates converties en timestamptz') : fail('timestamptz', t);
const eq = (await q(`select column_name from information_schema.columns where table_name='equipes'`)).map(x => x.column_name);
!eq.includes('operateur') && eq.includes('actif') ? pass('equipes : operateur retiré, actif ajouté') : fail('equipes', eq.join());

log('\n=== Tests : création automatique des profils ===');
const ins = async (email, app, user) => db.query(`insert into auth.users(email, raw_app_meta_data, raw_user_meta_data) values ($1, $2::jsonb, $3::jsonb) returning id`, [email, JSON.stringify(app), JSON.stringify(user || {})]);
const admin = (await ins('joe@example.com', { nom: 'Joé', role: 'admin' })).rows[0].id;
pass('compte admin créé sans téléphone');
const marc = (await ins('8195551111@tel.entretienlapointe.ca', { nom: 'Marc', telephone: '8195551111' })).rows[0].id;
const luc  = (await ins('8195552222@tel.entretienlapointe.ca', { nom: 'Luc', telephone: '8195552222' }, { role: 'admin' })).rows[0].id;
const eric = (await ins('8195553333@tel.entretienlapointe.ca', { nom: 'Éric', telephone: '8195553333' })).rows[0].id;
const prof = await q(`select nom, role, actif from utilisateurs where id = $1`, [luc]);
prof[0]?.role === 'employe' ? pass('rôle « admin » glissé dans user_metadata IGNORÉ (Luc reste employé)') : fail('escalade via user_metadata', JSON.stringify(prof));
(await q(`select count(*)::int n from utilisateurs`))[0].n === 4 ? pass('4 profils créés automatiquement') : fail('nombre de profils');
await expectFail('employé sans téléphone refusé (le compte Auth n\'est pas créé)', `insert into auth.users(email, raw_app_meta_data) values ('x@y.z', '{"nom":"X"}')`, [], 'employe_a_un_telephone');
(await q(`select count(*)::int n from auth.users`))[0].n === 4 ? pass('… et aucun compte orphelin laissé dans Auth') : fail('compte orphelin');
await expectFail('téléphone mal formé refusé', `insert into auth.users(email, raw_app_meta_data) values ('x@y.z', '{"nom":"X","telephone":"123"}')`, [], 'telephone');
await expectFail('téléphone en double refusé', `insert into auth.users(email, raw_app_meta_data) values ('z@y.z', '{"nom":"Y","telephone":"8195551111"}')`, [], 'unique');
await expectFail('rôle invalide refusé', `insert into auth.users(email, raw_app_meta_data) values ('w@y.z', '{"nom":"W","telephone":"8195559999","role":"superadmin"}')`, [], 'role');

log('\n=== Tests : fonctions de rôle ===');
await as(admin); (await q(`select est_admin() a, est_actif() b`))[0].a === true ? pass('est_admin() vrai pour Joé') : fail('est_admin admin');
await as(marc);  (await q(`select est_admin() a, est_actif() b`))[0].a === false ? pass('est_admin() faux pour un employé') : fail('est_admin employé');
(await q(`select est_actif() b`))[0].b === true ? pass('est_actif() vrai pour un employé actif') : fail('est_actif');
await as(null);  (await q(`select est_admin() a, est_actif() b`))[0].a === false ? pass('sans connexion : ni admin ni actif') : fail('anonyme');
await db.query(`update utilisateurs set actif = false where id = $1`, [eric]);
await as(eric); (await q(`select est_actif() b, est_admin() a`))[0].b === false ? pass('employé désactivé : est_actif() faux') : fail('désactivé');
await db.query(`update utilisateurs set actif = true where id = $1`, [eric]); await as(null);

log('\n=== Tests : verrouillage ===');
for (const tbl of ['quarts', 'passes', 'utilisateurs', 'equipage_periodes', 'positions', 'problemes', 'reglages', 'journal_modifications']) {
  await db.query('set role anon');
  await expectFail(`anon ne peut pas lire ${tbl}`, `select * from public.${tbl}`, [], 'permission denied');
  await db.query('set role authenticated');
  await expectFail(`connecté sans règle ne peut pas lire ${tbl} (avant l'étape 8)`, `select * from public.${tbl}`, [], 'permission denied');
  await db.query('reset role');
}

log('\n=== Tests : passes ===');
const route = (await q(`select id from routes order by nom limit 1`))[0].id;
const route2 = (await q(`select id from routes order by nom desc limit 1`))[0].id;
const eqA = (await q(`insert into equipes(nom) values ('Camion 1') returning id`))[0].id;
const eqB = (await q(`insert into equipes(nom) values ('Camion 2') returning id`))[0].id;
await expectFail('deux équipes du même nom refusées', `insert into equipes(nom) values ('Camion 1')`, [], 'unique');
const mkPasse = (id, r, e, ch, n, extra = '') => db.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut ${extra ? ',' + extra.split('=')[0] : ''}) values ($1,$2,$3,$4,$5, '2026-12-01 08:00+00' ${extra ? ',' + extra.split('=')[1] : ''})`, [id, r, e, ch, n]);
const pA = '11111111-1111-1111-1111-111111111111', pB = '22222222-2222-2222-2222-222222222222';
await expectOk('passe 1 (Camion 1, chauffeur Marc)', `insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total) values ($1,$2,$3,$4,1,'2026-12-01 08:00+00',20)`, [pA, route, eqA, marc]);
await expectFail('2e passe EN COURS sur le même véhicule refusée', `insert into passes(route_id, equipe_id, chauffeur_id, numero) values ($1,$2,$3,2)`, [route, eqA, luc], 'passes_une_en_cours_par_equipe');
await expectFail('2e passe EN COURS pour le même chauffeur refusée', `insert into passes(route_id, equipe_id, chauffeur_id, numero) values ($1,$2,$3,2)`, [route, eqB, marc], 'passes_une_en_cours_par_chauffeur');
await expectFail('même numéro de passe sur la même route refusé', `insert into passes(route_id, equipe_id, chauffeur_id, numero) values ($1,$2,$3,1)`, [route, eqB, luc], 'passes_numero_unique_par_route');
await expectOk('passe 1 d\'une AUTRE route acceptée (numérotation par route)', `insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut) values ($1,$2,$3,$4,1,'2026-12-01 08:30+00')`, [pB, route2, eqB, luc]);
await expectFail('passe terminée sans date de fin refusée', `insert into passes(route_id, equipe_id, chauffeur_id, numero, statut, fin_type) values ($1,$2,$3,9,'terminee','manuelle')`, [route, eqA, eric], 'passes_fin_coherente');
await expectFail('passe terminée sans type de fin refusée', `insert into passes(route_id, equipe_id, chauffeur_id, numero, statut, fin, debut) values ($1,$2,$3,9,'terminee','2026-12-01 10:00+00','2026-12-01 08:00+00')`, [route, eqA, eric], 'passes_fin_type_requis');
await expectFail('fin avant le début refusée', `insert into passes(route_id, equipe_id, chauffeur_id, numero, statut, fin, debut, fin_type) values ($1,$2,$3,9,'terminee','2026-12-01 07:00+00','2026-12-01 08:00+00','manuelle')`, [route, eqA, eric], 'passes_fin_apres_debut');
const pct = async (tot, faits) => { await db.query(`update passes set nb_arrets_total=$1, nb_arrets_faits=$2 where id=$3`, [tot, faits, pA]); return (await q(`select pourcentage p from passes where id=$1`, [pA]))[0].p; };
const cas = [[20, 5, 25], [20, 20, 100], [0, 0, 0], [3, 1, 33], [10, 12, 100]];
for (const [tot, faits, att] of cas) { const p = await pct(tot, faits); p === att ? pass(`pourcentage ${faits}/${tot} = ${p} %`) : fail(`pourcentage ${faits}/${tot}`, `obtenu ${p}, attendu ${att}`); }
await expectOk('un arrêt complété par passe', `insert into passe_arrets(passe_id, stop_id, complete_par) values ($1,(select id from stops limit 1),$2)`, [pA, marc]);
await expectFail('même arrêt 2 fois dans la même passe refusé', `insert into passe_arrets(passe_id, stop_id, complete_par) values ($1,(select id from stops limit 1),$2)`, [pA, marc], 'un_arret_par_passe');
await expectFail('un arrêt qui a de l\'historique ne peut pas être supprimé', `delete from stops where id = (select stop_id from passe_arrets limit 1)`, [], 'foreign key');
await expectOk('une position par véhicule', `insert into positions(passe_id, equipe_id, chauffeur_id, lat, lon) values ($1,$2,$3,46.5,-72.7)`, [pA, eqA, marc]);
await expectFail('2e position pour la même passe refusée (upsert requis)', `insert into positions(passe_id, equipe_id, chauffeur_id, lat, lon) values ($1,$2,$3,46.6,-72.8)`, [pA, eqA, marc], 'positions_pkey');

log('\n=== Tests : quarts de travail ===');
const Q = (u, d, f, src = 'manuel', fsrc = null) => db.query(`insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source) values ($1,$2,$3,$4,$5)`, [u, d, f, src, f ? (fsrc || 'manuel') : null]);
await expectOk('quart terminé 06:00–12:00', ...[`insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source) values ($1,'2026-12-01 06:00+00','2026-12-01 12:00+00','manuel','manuel')`, [marc]]);
await expectOk('quart qui commence EXACTEMENT à 12:00 accepté (pas de chevauchement)', `insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source) values ($1,'2026-12-01 12:00+00','2026-12-01 14:00+00','manuel','manuel')`, [marc]);
await expectFail('quart 13:00–15:00 (chevauche) refusé', `insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source) values ($1,'2026-12-01 13:00+00','2026-12-01 15:00+00','manuel','manuel')`, [marc], 'quarts_sans_chevauchement');
await expectOk('quart OUVERT à partir de 14:00', `insert into quarts(utilisateur_id, debut, debut_source) values ($1,'2026-12-01 14:00+00','manuel')`, [marc]);
await expectFail('un 2e quart ouvert pour le même employé refusé', `insert into quarts(utilisateur_id, debut, debut_source) values ($1,'2026-12-01 16:00+00','manuel')`, [marc], 'quarts_sans_chevauchement');
await expectOk('quart d\'un AUTRE employé en même temps : accepté', `insert into quarts(utilisateur_id, debut, debut_source) values ($1,'2026-12-01 14:00+00','manuel')`, [luc]);
await expectFail('fin avant le début refusée', `insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source) values ($1,'2026-12-02 10:00+00','2026-12-02 09:00+00','manuel','manuel')`, [eric], 'quarts_fin_apres_debut');
await expectFail('fin sans source de fin refusée', `insert into quarts(utilisateur_id, debut, fin, debut_source) values ($1,'2026-12-02 08:00+00','2026-12-02 09:00+00','manuel')`, [eric], 'quarts_fin_source_requise');
await expectFail('source de début invalide refusée', `insert into quarts(utilisateur_id, debut, debut_source) values ($1,'2026-12-02 08:00+00','magie')`, [eric], 'debut_source');
await expectOk('quart ouvert par l\'équipage, à valider', `insert into quarts(utilisateur_id, debut, debut_source, a_valider, raison_a_valider) values ($1,'2026-12-01 09:00+00','equipage',true,'ouvert_par_equipage')`, [eric]);
await expectFail('quart à valider ET déjà validé : incohérent, refusé', `insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source, a_valider, valide_le) values ($1,'2026-11-30 09:00+00','2026-11-30 10:00+00','equipage','manuel',true, now())`, [eric], 'quarts_validation_coherente');
const nv = (await q(`select count(*)::int n from quarts where a_valider`))[0].n;
nv === 1 ? pass('la liste « à valider » retrouve bien 1 quart') : fail('a_valider', String(nv));

log('\n=== Tests : équipage et transferts ===');
await expectOk('Éric à bord de la passe 1 de 09:00 à 10:00', `insert into equipage_periodes(passe_id, utilisateur_id, debut, fin, ajoute_par) values ($1,$2,'2026-12-01 09:00+00','2026-12-01 10:00+00',$3)`, [pA, eric, marc]);
await expectOk('TRANSFERT : Éric rejoint la passe 2 à 10:00 pile (sans trou ni chevauchement)', `insert into equipage_periodes(passe_id, utilisateur_id, debut, ajoute_par, transfert_id) values ($1,$2,'2026-12-01 10:00+00',$3, gen_random_uuid())`, [pB, eric, luc]);
await expectFail('Éric ne peut pas être dans un 3e véhicule en même temps (ouvert)', `insert into equipage_periodes(passe_id, utilisateur_id, debut) values ($1,$2,'2026-12-01 11:00+00')`, [pA, eric], 'equipage_sans_chevauchement');
await expectFail('chevauchement de 30 min refusé', `insert into equipage_periodes(passe_id, utilisateur_id, debut, fin) values ($1,$2,'2026-12-01 09:30+00','2026-12-01 10:30+00')`, [pB, eric], 'equipage_sans_chevauchement');
await expectOk('retirer Éric de la passe 2 à 11:00', `update equipage_periodes set fin='2026-12-01 11:00+00' where passe_id=$1 and utilisateur_id=$2`, [pB, eric]);
await expectOk('un autre employé peut occuper la même passe au même moment', `insert into equipage_periodes(passe_id, utilisateur_id, debut, role) values ($1,$2,'2026-12-01 10:00+00','passager')`, [pB, marc]);
await expectOk('journal d\'équipage : un geste avec clé client', `insert into equipage_journal(cle_client, type, moment, passe_id, utilisateur_id, auteur_id) values ('aaaaaaaa-0000-0000-0000-000000000001','ajout','2026-12-01 09:00+00',$1,$2,$3)`, [pA, eric, marc]);
await expectFail('même geste renvoyé (hors réseau) : doublon refusé grâce à la clé client', `insert into equipage_journal(cle_client, type, moment, passe_id, utilisateur_id, auteur_id) values ('aaaaaaaa-0000-0000-0000-000000000001','ajout','2026-12-01 09:00+00',$1,$2,$3)`, [pA, eric, marc], 'cle_client');

log('\n=== Tests : journal automatique des corrections admin ===');
const nj = async () => (await q(`select count(*)::int n from journal_modifications`))[0].n;
await as(marc);  await db.query(`update quarts set note='vu par employé' where utilisateur_id=$1 and fin is null`, [marc]);
(await nj()) === 0 ? pass('modification par un employé : pas dans le journal admin') : fail('journal employé');
await as(null);  await db.query(`update quarts set note='tâche automatique' where utilisateur_id=$1 and fin is null`, [marc]);
(await nj()) === 0 ? pass('modification par le serveur/tâche automatique : pas dans le journal admin') : fail('journal serveur');
await as(admin); await db.query(`update quarts set debut='2026-12-01 14:15+00', note='corrigé par Joé' where utilisateur_id=$1 and fin is null`, [marc]);
const jr = await q(`select table_cible, action, avant->>'debut' av, apres->>'debut' ap, auteur_id from journal_modifications`);
jr.length === 1 && jr[0].table_cible === 'quarts' && jr[0].auteur_id === admin ? pass(`correction de Joé journalisée automatiquement (avant ${jr[0].av} → après ${jr[0].ap})`) : fail('journal admin', JSON.stringify(jr));
await db.query(`delete from equipage_periodes where passe_id=$1 and utilisateur_id=$2 and fin is null`, [pB, marc]);
const jd = await q(`select action, avant is not null a, apres is null p from journal_modifications where table_cible='equipage_periodes'`);
jd.length === 1 && jd[0].action === 'DELETE' && jd[0].a && jd[0].p ? pass('suppression par Joé journalisée (contenu conservé)') : fail('journal delete', JSON.stringify(jd));
await as(null);

log('\n=== Réglages ===');
const reg = (await q(`select jsonb_object_agg(cle, valeur) r from reglages`))[0].r;
reg.duree_max_passe_heures === 12 && reg.duree_max_quart_heures === 16 && reg.alerte_quart_termine_heures === 4 ? pass('réglages par défaut : passe 12 h, quart 16 h, alerte 4 h') : fail('réglages', JSON.stringify(reg));

log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
