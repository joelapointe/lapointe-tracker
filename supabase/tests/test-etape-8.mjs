import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));   // le dossier supabase/ (chemin relatif : fonctionne depuis n'importe où)
import { prepare } from './prepare.mjs';
import fs from 'fs';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };

// ---------- Avant l'étape 8 : la faille actuelle (pour prouver que le test la détecte) ----------
const db0 = await prepare(['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql']);
log('=== AVANT l\'étape 8 (état actuel de ta base) ===');
await db0.query('set role anon');
const avant = await db0.query('select count(*)::int n from public.stops');
avant.rows[0].n === 13 ? pass('CONFIRMÉ : avant l\'étape 8, un visiteur sans compte lit les 13 arrêts (la faille existe)') : fail('faille avant', JSON.stringify(avant.rows));
const del = await db0.query(`delete from public.routes where nom = 'zzz'`);
pass('… et peut aussi écrire/supprimer (delete accepté, 0 ligne ici car aucune route « zzz »)');
await db0.query('reset role');

// ---------- Étapes 6 + 7 + 8 ----------
const db = await prepare(['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql']);
const r8 = await db.exec(fs.readFileSync(SQL_DIR + '03-etape8-regles-acces.sql', 'utf8'));
log('\n=== Étape 8 exécutée. Vérification renvoyée : ===\n' + JSON.stringify(r8[r8.length - 1].rows[0].verification));

const q = async (sql, p) => (await db.query(sql, p)).rows;
async function as(role, uid) {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  if (role) await db.query(`set role ${role}`);
}
const denied = async (l, sql, p, motif = 'permission denied') => {
  try { await db.query(sql, p); fail(l, 'aurait dû être refusé'); }
  catch (e) { e.message.includes(motif) ? pass(l + '  [' + e.message.split('\n')[0].slice(0, 80) + ']') : fail(l, 'refusé pour une autre raison: ' + e.message); }
};
const count = async (sql, p) => (await q(`select count(*)::int n from (${sql}) t`, p))[0].n;
const zeroLigne = async (l, sql, p) => { const r = await db.query(sql, p); r.affectedRows === 0 ? pass(l + ' (0 ligne touchée)') : fail(l, `${r.affectedRows} ligne(s) modifiée(s) !`); };

// ---------- Jeu de données (créé en tant que propriétaire) ----------
await as(null);
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
const admin = await ins('joe@example.com', { nom: 'Joé', role: 'admin' });
const marc = await ins('m@t.ca', { nom: 'Marc', telephone: '8195551111' });
const luc = await ins('l@t.ca', { nom: 'Luc', telephone: '8195552222' });
const eric = await ins('e@t.ca', { nom: 'Éric', telephone: '8195553333' });
const zoe = await ins('z@t.ca', { nom: 'Zoé', telephone: '8195554444' });
await db.query(`update utilisateurs set actif = false where id = $1`, [zoe]);   // Zoé = employée désactivée
const route = (await q(`select id from routes order by nom limit 1`))[0].id;
await db.query(`insert into routes(nom, actif) values ('Route archivée', false)`);
const eqA = (await q(`insert into equipes(nom) values ('Camion 1') returning id`))[0].id;
const eqB = (await q(`insert into equipes(nom) values ('Camion 2') returning id`))[0].id;
const eqC = (await q(`insert into equipes(nom, actif) values ('Vieux camion', false) returning id`))[0].id;
await db.query(`update stops set actif = false where adresse = 'Adresse 13'`);
const [pA, pB, pC] = ['a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222', 'c3333333-3333-3333-3333-333333333333'];
await db.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, nb_arrets_total, nb_arrets_faits) values ($1,$2,$3,$4,3,'2026-12-05 08:00+00',12,6)`, [pA, route, eqA, marc]);          // en cours (Marc)
await db.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, fin, statut, fin_type) values ($1,$2,$3,$4,1,'2026-12-01 08:00+00','2026-12-01 12:00+00','terminee','complete')`, [pB, route, eqB, luc]);   // terminée (Luc)
await db.query(`insert into passes(id, route_id, equipe_id, chauffeur_id, numero, debut, fin, statut, fin_type) values ($1,$2,$3,$4,2,'2026-12-02 08:00+00','2026-12-02 12:00+00','terminee','manuelle')`, [pC, route, eqC, marc]);   // terminée (Marc)
const stop1 = (await q(`select id from stops where actif limit 1`))[0].id;
await db.query(`insert into passe_arrets(passe_id, stop_id, complete_par) values ($1,$2,$3), ($4,$2,$5)`, [pA, stop1, marc, pB, luc]);
await db.query(`insert into positions(passe_id, equipe_id, chauffeur_id, lat, lon) values ($1,$2,$3,46.5,-72.7)`, [pA, eqA, marc]);
await db.query(`insert into problemes(id, stop_id, utilisateur_id, note, lu) values
  ('00000000-0000-0000-0000-0000000000a1',$1,$2,'p1 Marc non lu',false), ('00000000-0000-0000-0000-0000000000a2',$1,$3,'p2 Luc lu',true),
  ('00000000-0000-0000-0000-0000000000a3',$1,$2,'p3 Marc lu',true),      ('00000000-0000-0000-0000-0000000000a4',$1,$3,'p4 Luc non lu',false)`, [stop1, marc, luc]);
await db.query(`insert into quarts(utilisateur_id, debut, debut_source) values ($1,'2026-12-05 07:00+00','manuel'), ($2,'2026-12-05 07:30+00','manuel'), ($3,'2026-12-05 07:45+00','equipage')`, [marc, luc, eric]);
await db.query(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut) values ($1,$2,'chauffeur','2026-12-05 08:00+00'), ($1,$3,'passager','2026-12-05 08:05+00')`, [pA, marc, eric]);
await db.query(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut, fin) values ($1,$2,'chauffeur','2026-12-01 08:00+00','2026-12-01 12:00+00')`, [pB, luc]);
await db.query(`insert into equipage_journal(type, moment, passe_id, utilisateur_id) values ('ajout', now(), $1, $2)`, [pA, eric]);

// ---------- VISITEUR (clé publique, sans connexion) ----------
log('\n=== VISITEUR sans connexion (la clé publique de l\'app) ===');
await as('anon');
for (const t of ['stops', 'routes', 'equipes', 'zones', 'utilisateurs', 'passes', 'passe_arrets', 'problemes', 'positions', 'quarts', 'equipage_periodes', 'equipage_journal', 'journal_modifications', 'reglages'])
  await denied(`ne peut plus lire ${t}`, `select * from public.${t}`);
await denied('ne peut pas supprimer d\'arrêts', `delete from public.stops`);
await denied('ne peut pas se créer un problème', `insert into public.problemes(stop_id, note) values ($1,'x')`, [stop1]);
await denied('ne peut pas appeler est_admin()', `select public.est_admin()`);
await as(null);
const nbRoutes0 = await count(`select 1 from routes`);

// ---------- EMPLOYÉ ACTIF ----------
log('\n=== EMPLOYÉ actif (Éric, passager à bord de la passe de Marc) ===');
await as('authenticated', eric);
(await count(`select 1 from stops`)) === 12 ? pass('voit les 12 arrêts ACTIFS (l\'arrêt archivé est caché)') : fail('arrêts visibles', String(await count(`select 1 from stops`)));
(await count(`select 1 from routes`)) === 2 ? pass('voit les 2 routes actives (la route archivée est cachée)') : fail('routes visibles');
(await count(`select 1 from equipes`)) === 2 ? pass('voit les équipes actives (Camion 1 et 2)') : fail('équipes visibles');
const noms = await q(`select nom from utilisateurs order by nom`);
noms.length === 5 ? pass('voit les noms de tous les collègues : ' + noms.map(x => x.nom).join(', ')) : fail('noms', JSON.stringify(noms));
await denied('ne peut PAS lire les téléphones des collègues', `select telephone from utilisateurs`);
await denied('« select * » sur utilisateurs refusé (il faut nommer les colonnes)', `select * from utilisateurs`);
(await count(`select id, nom, role, actif from utilisateurs`)) === 5 ? pass('lecture par colonnes nommées : OK') : fail('lecture nommée');
const passesVues = await q(`select numero, statut from passes order by numero`);
passesVues.length === 1 && passesVues[0].statut === 'en_cours' ? pass('voit la passe EN COURS du véhicule (avec pourcentage), pas les passes terminées des autres') : fail('passes visibles', JSON.stringify(passesVues));
(await q(`select pourcentage from passes`))[0].pourcentage === 50 ? pass('le pourcentage d\'avancement est visible : 50 %') : fail('pourcentage');
(await count(`select 1 from passe_arrets`)) === 1 ? pass('voit les arrêts complétés de la passe en cours seulement') : fail('passe_arrets');
(await count(`select 1 from positions`)) === 1 ? pass('voit la position de chaque véhicule') : fail('positions');
const equip = await q(`select passe_id, role from equipage_periodes`);
equip.length === 2 ? pass('voit l\'équipage COMPLET du véhicule en cours (chauffeur + passager)') : fail('équipage visible', JSON.stringify(equip));
(await count(`select 1 from quarts`)) === 1 ? pass('voit UNIQUEMENT son propre quart (pas ceux de Marc ni Luc)') : fail('quarts visibles', String(await count(`select 1 from quarts`)));
(await count(`select 1 from equipage_journal`)) === 0 ? pass('ne voit pas le journal d\'équipage') : fail('journal visible');
(await count(`select 1 from journal_modifications`)) === 0 ? pass('ne voit pas le journal des corrections') : fail('journal_modifications visible');
(await count(`select 1 from reglages`)) === 3 ? pass('peut lire les réglages') : fail('réglages');
const pv = await q(`select note from problemes order by note`);
pv.map(x => x.note).join('|') === 'p1 Marc non lu|p4 Luc non lu' ? pass('voit les problèmes non lus (p1, p4), pas les problèmes déjà lus des autres') : fail('problèmes visibles', JSON.stringify(pv));
// écritures interdites
await zeroLigne('ne peut pas modifier une route', `update routes set nom = 'piraté'`);
await zeroLigne('ne peut pas supprimer une route', `delete from routes`);
await zeroLigne('ne peut pas modifier un arrêt', `update stops set fait = true, adresse = 'piraté'`);
await zeroLigne('ne peut pas supprimer d\'arrêts', `delete from stops`);
await denied('ne peut pas créer d\'arrêt', `insert into stops(adresse) values ('x')`, [], 'row-level security');
await denied('ne peut pas créer de route', `insert into routes(nom) values ('x')`, [], 'row-level security');
await zeroLigne('ne peut pas modifier une passe', `update passes set nb_arrets_faits = 12`);
await denied('ne peut pas créer une passe', `insert into passes(route_id, equipe_id, chauffeur_id, numero) values ($1,$2,$3,9)`, [route, eqB, eric], 'permission denied');
await denied('ne peut pas se donner un quart (écriture directe)', `insert into quarts(utilisateur_id, debut, debut_source) values ($1,'2026-12-06 08:00+00','manuel')`, [eric], 'row-level security');
await zeroLigne('ne peut pas modifier son quart', `update quarts set debut = '2026-12-05 01:00+00'`);
await zeroLigne('ne peut pas supprimer son quart', `delete from quarts`);
await denied('ne peut pas s\'ajouter à un équipage (écriture directe)', `insert into equipage_periodes(passe_id, utilisateur_id, debut) values ($1,$2,now())`, [pB, eric], 'row-level security');
await zeroLigne('ne peut pas modifier l\'équipage', `update equipage_periodes set fin = now()`);
await denied('ne peut pas écrire une position', `insert into positions(passe_id, equipe_id, chauffeur_id, lat, lon) values ($1,$2,$3,0,0)`, [pB, eqB, eric], 'permission denied');
await denied('ne peut pas modifier une position', `update positions set lat = 0, lon = 0`);
await zeroLigne('ne peut pas modifier les réglages', `update reglages set valeur = '999'`);
await denied('ne peut pas changer son propre rôle en admin', `update utilisateurs set role = 'admin' where id = $1`, [eric]);
await zeroLigne('ne peut pas se désactiver / modifier son profil (nom)', `update utilisateurs set nom = 'Chef' where id = $1`, [eric]);
// signalement de problème : permis, à son nom seulement
const ok1 = await db.query(`insert into problemes(stop_id, note) values ($1,'signalé par Éric') returning utilisateur_id`, [stop1]);
ok1.rows[0].utilisateur_id === eric ? pass('signale un problème : son identité est ajoutée automatiquement par la base') : fail('signalement', JSON.stringify(ok1.rows));
await denied('ne peut pas signaler un problème AU NOM d\'un autre', `insert into problemes(stop_id, note, utilisateur_id) values ($1,'x',$2)`, [stop1, marc], 'row-level security');
await denied('ne peut pas créer un problème déjà « lu »', `insert into problemes(stop_id, note, lu) values ($1,'x',true)`, [stop1]);
await zeroLigne('ne peut pas marquer un problème comme lu', `update problemes set lu = true`);
await as(null);

// ---------- EMPLOYÉ DÉSACTIVÉ ----------
log('\n=== EMPLOYÉ DÉSACTIVÉ (Zoé) : son ancien accès ne doit plus rien donner ===');
await as('authenticated', zoe);
for (const t of ['stops', 'routes', 'equipes', 'utilisateurs', 'passes', 'positions', 'problemes', 'reglages', 'quarts'])
  (await count(`select 1 from ${t === 'utilisateurs' ? 'utilisateurs' : t}`)) === 0 ? pass(`ne voit rien dans ${t}`) : fail(`${t} visible pour un désactivé`);
await denied('ne peut pas signaler de problème', `insert into problemes(stop_id, note) values ($1,'x')`, [stop1], 'row-level security');
await as(null);

// ---------- AUTRE EMPLOYÉ : historique ----------
log('\n=== EMPLOYÉ chauffeur (Marc) : voit ses propres passes terminées ===');
await as('authenticated', marc);
const pm = await q(`select numero, statut from passes order by numero`);
pm.map(x => x.numero + ':' + x.statut).join(',') === '2:terminee,3:en_cours' ? pass('voit sa passe en cours + sa passe terminée, pas celle de Luc') : fail('passes de Marc', JSON.stringify(pm));
(await count(`select 1 from quarts`)) === 1 ? pass('voit son seul quart') : fail('quarts Marc');
await as(null);

// ---------- ADMINISTRATEUR ----------
log('\n=== ADMINISTRATEUR (Joé) ===');
await as('authenticated', admin);
(await count(`select 1 from stops`)) === 13 ? pass('voit tous les arrêts, même archivés') : fail('admin stops');
(await count(`select 1 from routes`)) === 3 ? pass('voit toutes les routes, même archivées') : fail('admin routes');
(await count(`select 1 from passes`)) === 3 ? pass('voit toutes les passes') : fail('admin passes');
(await count(`select 1 from quarts`)) === 3 ? pass('voit les quarts de tous') : fail('admin quarts');
(await count(`select 1 from equipage_periodes`)) === 3 ? pass('voit tout l\'équipage, passé et présent') : fail('admin équipage');
(await count(`select 1 from equipage_journal`)) === 1 ? pass('voit le journal d\'équipage') : fail('admin journal');
(await count(`select 1 from problemes`)) === 5 ? pass('voit tous les problèmes') : fail('admin problèmes', String(await count(`select 1 from problemes`)));
await db.query(`insert into routes(nom) values ('Route Est')`); pass('crée une route');
await db.query(`insert into stops(adresse, route_id) values ('1 rue Neuve', $1)`, [route]); pass('crée un arrêt');
await db.query(`update stops set actif = false where adresse = '1 rue Neuve'`); pass('archive un arrêt');
await db.query(`insert into equipes(nom) values ('Camion 3')`); pass('crée un véhicule (équipe)');
await db.query(`update problemes set lu = true, lu_par = $1, lu_le = now() where note = 'p4 Luc non lu'`, [admin]); pass('marque un problème comme lu');
await db.query(`update reglages set valeur = '10' where cle = 'duree_max_passe_heures'`); pass('modifie un réglage (passe max 10 h)');
await db.query(`update utilisateurs set actif = false where id = $1`, [eric]); pass('désactive un employé');
await db.query(`update utilisateurs set actif = true where id = $1`, [eric]); pass('le réactive');
await denied('ne peut pas se désactiver LUI-MÊME', `update utilisateurs set actif = false where id = $1`, [admin], 'row-level security');
await denied('ne peut pas changer un rôle depuis l\'app', `update utilisateurs set role = 'admin' where id = $1`, [marc]);
await denied('ne peut pas modifier un téléphone depuis l\'app', `update utilisateurs set telephone = '8190000000' where id = $1`, [marc]);
await denied('ne peut pas lire les téléphones directement (fonction dédiée à l\'étape 9)', `select telephone from utilisateurs`);
await db.query(`update quarts set note = 'validé par Joé', a_valider = false, valide_par = $1, valide_le = now() where utilisateur_id = $2`, [admin, eric]); pass('valide un quart « ouvert par l\'équipage »');
await db.query(`insert into quarts(utilisateur_id, debut, fin, debut_source, fin_source) values ($1,'2026-12-04 07:00+00','2026-12-04 15:00+00','admin','admin')`, [luc]); pass('ajoute un quart oublié');
await db.query(`update equipage_periodes set fin = '2026-12-05 09:00+00' where utilisateur_id = $1 and fin is null`, [eric]); pass('corrige une période d\'équipage');
await db.query(`update passes set nb_arrets_total = 14 where id = $1`, [pA]); pass('corrige une passe');
const jm = await q(`select table_cible, count(*)::int n from journal_modifications group by table_cible order by table_cible`);
JSON.stringify(jm.map(x => x.table_cible + ':' + x.n)) === JSON.stringify(['equipage_periodes:1', 'passes:1', 'quarts:1']) ? pass('les 3 corrections sont dans le journal, alors que les changements normaux (arrêts, routes…) n\'y sont pas') : fail('journal', JSON.stringify(jm));
await denied('ne peut pas effacer le journal', `delete from journal_modifications`);
await denied('ne peut pas modifier le journal d\'équipage', `update equipage_journal set type = 'retrait'`);
await denied('ne peut pas insérer directement dans le journal', `insert into equipage_journal(type, moment) values ('ajout', now())`);
await as(null);

// ---------- Défense en profondeur ----------
log('\n=== Défense en profondeur ===');
await db.query(`create table public.future_table (id int)`);
const pa = (await q(`select has_table_privilege('anon','public.future_table','select') a, has_table_privilege('authenticated','public.future_table','select') b`))[0];
!pa.a && !pa.b ? pass('une future table ne donnera AUCUN droit par défaut (ni anon, ni connecté)') : fail('privilèges par défaut', JSON.stringify(pa));
const fa = await q(`select proname from pg_proc where pronamespace='public'::regnamespace and has_function_privilege('anon', oid, 'execute')`);
fa.length === 0 ? pass('AUCUNE fonction du projet n\'est appelable par un visiteur') : fail('fonctions appelables par anon', JSON.stringify(fa));
const fb = await q(`select proname from pg_proc where pronamespace='public'::regnamespace and has_function_privilege('authenticated', oid, 'execute') order by proname`);
JSON.stringify(fb.map(x => x.proname)) === JSON.stringify(['est_actif', 'est_admin']) ? pass('un employé connecté ne peut appeler QUE est_admin() et est_actif() (les fonctions de déclencheur sont verrouillées)') : fail('fonctions appelables par un connecté', JSON.stringify(fb));
// les déclencheurs fonctionnent toujours après le verrouillage de leurs fonctions
await db.query(`create role gotrue_sim nologin`);
await db.query(`grant usage on schema auth to gotrue_sim`);
await db.query(`grant select, insert on auth.users to gotrue_sim`);
await db.query(`set role gotrue_sim`);   // comme Supabase Auth : un rôle qui n'est PAS propriétaire des fonctions
await db.query(`insert into auth.users(email, raw_app_meta_data) values ('apres@t.ca','{"nom":"Après","telephone":"8195559990"}')`);
await db.query(`reset role`);
(await q(`select count(*)::int n from utilisateurs where nom='Après'`))[0].n === 1 ? pass('la création automatique du profil fonctionne toujours après le verrouillage') : fail('déclencheur profil cassé');
const pub = (await q(`select coalesce(jsonb_agg(tablename order by tablename),'[]'::jsonb) t from pg_publication_tables where pubname='supabase_realtime'`))[0].t;
JSON.stringify(pub) === JSON.stringify(['equipage_periodes', 'passe_arrets', 'passes', 'positions', 'problemes', 'stops']) ? pass('temps réel activé pour : ' + pub.join(', ')) : fail('temps réel', JSON.stringify(pub));
const anc = (await q(`select count(*)::int n from pg_policies where 'public'::name = any(roles)`))[0].n;
anc === 0 ? pass('plus aucune règle « Accès public »') : fail('anciennes règles', String(anc));
const sansRls = (await q(`select count(*)::int n from pg_class where relnamespace='public'::regnamespace and relkind='r' and not relrowsecurity and relname <> 'future_table'`))[0].n;
sansRls === 0 ? pass('toutes les tables ont les règles d\'accès actives') : fail('tables sans RLS', String(sansRls));
const nbRoutesFin = await count(`select 1 from routes`);
log(`(routes avant/après tests d'attaque : ${nbRoutes0} → ${nbRoutesFin}, +1 créée par l'admin)`);
nbRoutesFin === nbRoutes0 + 1 ? pass('aucune route supprimée ni modifiée par les attaques') : fail('routes altérées');

log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
