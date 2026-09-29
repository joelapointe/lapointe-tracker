// Demande 4 de Joé (29 sept. 2026) — Fichier SQL 28 : les passages notés À LA MAIN (passages_manuels) et le RYTHME de chaque service (types_service.frequence_jours).
// Banc d'essai local (base PGlite), sur le modèle de test-icones-taches.mjs. Ce que ce test NE peut PAS vérifier : le vrai Supabase (le fichier y est exécuté avec l'accord de Joé, puis sa requête
// « verification » est relue). L'écran Suivi lui-même est testé par test-app-suivi-passages.mjs.
// SQL28_TEST (variable d'environnement) : une COPIE abîmée du fichier, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
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

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const SQL23 = fs.readFileSync(SQL_DIR + '23-etape19-types-service.sql', 'utf8');
const SQL28 = fs.readFileSync(process.env.SQL28_TEST || (SQL_DIR + '28-suivi-des-passages.sql'), 'utf8');

const db = await prepare(FILES);
const q = async (sql, p) => (await db.query(sql, p)).rows;
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
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const nina = await ins('nina@t.ca', { nom: 'Nina', telephone: '8195550001' });

await db.exec(SQL23);
const stop = async (adresse) => (await q(`insert into stops(adresse, service, lat, lon) values ($1, 'Coupe de gazon', 46.5, -72.7) returning id`, [adresse]))[0].id;
const s1 = await stop('1 rue des Pins');
const s2 = await stop('2 rue des Pins');
const colonne = () => q(`select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'types_service' and column_name = 'frequence_jours'`);
const tableExiste = async () => (await q(`select to_regclass('public.passages_manuels') is not null as r`))[0].r;
const NOMS_DEPART = ['Autre', 'Coupe de gazon', 'Déneigement manuel', 'Déneigement mécanique', 'Engrais', 'Entretien paysager', 'Ramassage de feuilles', 'Épandage de sel'];

log('=== AVANT LE FICHIER : RIEN N\'EXISTE ; APRÈS : LA COLONNE ET LA TABLE SONT LÀ, VIDES, ET RIEN D\'AUTRE NE CHANGE ===');
{
  eq('avant : pas de colonne « frequence_jours » dans types_service', (await colonne()).length, 0);
  eq('avant : pas de table passages_manuels', await tableExiste(), false);
  const avant = (await q(`select nom, actif from types_service order by nom`)).map((x) => [x.nom, x.actif]);
  const reglesAvant = (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'types_service' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd);
  await db.exec(SQL28);
  eq('après : la colonne existe, un petit nombre entier, VIDE permise', (await colonne()).map((x) => [x.data_type, x.is_nullable]), [['smallint', 'YES']]);
  eq('… les 8 types de départ sont toujours là, avec le même « actif » : rien n\'a été touché', (await q(`select nom, actif from types_service order by nom`)).map((x) => [x.nom, x.actif]), avant);
  eq('… les 8 noms', (await q(`select nom from types_service order by nom`)).map((x) => x.nom).sort(), [...NOMS_DEPART].sort());
  eq('… et AUCUN rythme n\'est choisi au départ (le Suivi n\'indique alors pas « à faire »)', (await q(`select count(*)::int n from types_service where frequence_jours is not null`))[0].n, 0);
  eq('… les règles d\'accès de types_service n\'ont pas changé', (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'types_service' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd), reglesAvant);
  eq('la table passages_manuels existe, VIDE', [await tableExiste(), (await q(`select count(*)::int n from passages_manuels`))[0].n], [true, 0]);
  eq('… ses colonnes (nom, type, vide permis)', (await q(`select column_name, data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'passages_manuels' order by column_name`)).map((x) => [x.column_name, x.data_type, x.is_nullable]),
    [['ajoute_le', 'timestamp with time zone', 'NO'], ['ajoute_par', 'uuid', 'YES'], ['id', 'uuid', 'NO'], ['jour', 'date', 'NO'], ['note', 'text', 'YES'], ['stop_id', 'uuid', 'NO']]);
  eq('… la sécurité de la table est ACTIVE', (await q(`select relrowsecurity from pg_class where oid = 'public.passages_manuels'::regclass`))[0].relrowsecurity, true);
  eq('… UNE seule règle d\'accès : l\'administrateur, pour tout', (await q(`select policyname || ' (' || cmd || ')' as r from pg_policies where schemaname = 'public' and tablename = 'passages_manuels'`)).map((x) => x.r), ['passages_manuels_admin (ALL)']);
  eq('… un visiteur non connecté n\'a AUCUN droit sur la table', (await q(`select has_table_privilege('anon', 'public.passages_manuels', 'select') or has_table_privilege('anon', 'public.passages_manuels', 'insert') as r`))[0].r, false);
  eq('… une personne connectée a les droits (les règles d\'accès filtrent ensuite)', (await q(`select has_table_privilege('authenticated', 'public.passages_manuels', 'select') and has_table_privilege('authenticated', 'public.passages_manuels', 'insert') and has_table_privilege('authenticated', 'public.passages_manuels', 'update') and has_table_privilege('authenticated', 'public.passages_manuels', 'delete') as r`))[0].r, true);
}

log('\n=== ON PEUT L\'EXÉCUTER PLUSIEURS FOIS : RIEN N\'EST EFFACÉ NI DOUBLÉ ===');
{
  await q(`update types_service set frequence_jours = 7 where nom = 'Coupe de gazon'`);
  await q(`insert into passages_manuels(stop_id, jour, note) values ($1, '2026-05-12', 'noté à la main')`, [s1]);
  await db.exec(SQL28);
  await db.exec(SQL28);
  eq('ré-exécuter deux fois le fichier garde le rythme choisi', (await q(`select frequence_jours from types_service where nom = 'Coupe de gazon'`))[0].frequence_jours, 7);
  eq('… garde la date notée à la main', (await q(`select to_char(jour, 'YYYY-MM-DD') j, note from passages_manuels`)).map((x) => [x.j, x.note]), [['2026-05-12', 'noté à la main']]);
  eq('… ne double pas la règle du rythme', (await q(`select count(*)::int n from pg_constraint where conname = 'types_service_frequence_plage' and conrelid = 'public.types_service'::regclass`))[0].n, 1);
  eq('… ne double pas la règle « un par jour »', (await q(`select count(*)::int n from pg_constraint where conname = 'passages_manuels_un_par_jour' and conrelid = 'public.passages_manuels'::regclass`))[0].n, 1);
  eq('… ne double pas la règle d\'accès', (await q(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename = 'passages_manuels'`))[0].n, 1);
  eq('… ni la colonne', (await colonne()).length, 1);
  await q(`update types_service set frequence_jours = null where nom = 'Coupe de gazon'`);
  await q(`delete from passages_manuels`);
}

log('\n=== LE RYTHME : DE 1 À 365 JOURS, OU VIDE ===');
{
  for (const n of [1, 7, 10, 14, 365]) eq(`${n} jour(s) est accepté`, (await q(`update types_service set frequence_jours = $1 where nom = 'Engrais' returning frequence_jours`, [n]))[0].frequence_jours, n);
  eq('… et VIDE (aucun rythme) est accepté', (await q(`update types_service set frequence_jours = null where nom = 'Engrais' returning frequence_jours`))[0].frequence_jours, null);
  for (const n of [0, -1, -30, 366, 1000]) await err(`${n} est REFUSÉ`, () => q(`update types_service set frequence_jours = $1 where nom = 'Engrais'`, [n]), 'types_service_frequence_plage');
  await err('un nombre trop grand pour la colonne est refusé aussi (40 000)', () => q(`update types_service set frequence_jours = 40000 where nom = 'Engrais'`), 'out of range|smallint');
  await err('un texte est refusé', () => q(`update types_service set frequence_jours = 'sept' where nom = 'Engrais'`), 'invalid input|smallint');
  eq('… et rien n\'est resté d\'un essai refusé', (await q(`select frequence_jours from types_service where nom = 'Engrais'`))[0].frequence_jours, null);
}

log('\n=== UN PASSAGE NOTÉ À LA MAIN : UN CLIENT, UN JOUR, UNE NOTE COURTE ===');
{
  const r = await q(`insert into passages_manuels(stop_id, jour) values ($1, '2026-06-01') returning id, note, ajoute_par, ajoute_le`, [s1]);
  eq('l\'ajout marche ; la note est vide par défaut', [r.length, r[0].note], [1, null]);
  vrai('… l\'heure de l\'ajout est posée toute seule', Math.abs(new Date(r[0].ajoute_le).getTime() - Date.now()) < 60_000);
  await err('un 2ᵉ passage le MÊME jour pour le MÊME client est refusé', () => q(`insert into passages_manuels(stop_id, jour) values ($1, '2026-06-01')`, [s1]), 'passages_manuels_un_par_jour');
  eq('… un autre jour pour le même client : accepté', (await q(`insert into passages_manuels(stop_id, jour) values ($1, '2026-06-08') returning id`, [s1])).length, 1);
  eq('… le même jour pour un AUTRE client : accepté', (await q(`insert into passages_manuels(stop_id, jour) values ($1, '2026-06-01') returning id`, [s2])).length, 1);
  await err('sans client : refusé', () => q(`insert into passages_manuels(stop_id, jour) values (null, '2026-06-01')`), 'null value|not-null');
  await err('sans jour : refusé', () => q(`insert into passages_manuels(stop_id, jour) values ($1, null)`, [s1]), 'null value|not-null');
  await err('un client qui n\'existe pas : refusé', () => q(`insert into passages_manuels(stop_id, jour) values (gen_random_uuid(), '2026-06-01')`), 'foreign key');
  await err('une personne qui n\'existe pas ne peut pas être « ajoutée par » : refusé', () => q(`insert into passages_manuels(stop_id, jour, ajoute_par) values ($1, '2026-07-01', gen_random_uuid())`, [s1]), 'foreign key');
  for (const j of ['2000-01-01', '2026-12-31', '2100-12-31']) eq(`le jour ${j} est accepté`, (await q(`insert into passages_manuels(stop_id, jour) values ($1, $2) returning id`, [s2, j])).length, 1);
  for (const j of ['1999-12-31', '2101-01-01', '0001-01-01']) await err(`le jour ${j} est REFUSÉ (hors 2000-2100)`, () => q(`insert into passages_manuels(stop_id, jour) values ($1, $2)`, [s2, j]), 'passages_manuels_jour_plausible');
  await err('un jour qui n\'existe pas (30 février) est refusé', () => q(`insert into passages_manuels(stop_id, jour) values ($1, '2026-02-30')`, [s2]), 'date/time field value out of range|invalid input');
  eq('une note de 200 caractères est acceptée', (await q(`insert into passages_manuels(stop_id, jour, note) values ($1, '2026-08-01', $2) returning length(note) n`, [s2, 'x'.repeat(200)]))[0].n, 200);
  await err('une note de 201 caractères est REFUSÉE', () => q(`insert into passages_manuels(stop_id, jour, note) values ($1, '2026-08-02', $2)`, [s2, 'x'.repeat(201)]), 'passages_manuels_note_courte');
  eq('une note vide (texte) est acceptée', (await q(`insert into passages_manuels(stop_id, jour, note) values ($1, '2026-08-03', '') returning note`, [s2]))[0].note, '');
  eq('une note avec des accents, une apostrophe et un guillemet est acceptée telle quelle', (await q(`insert into passages_manuels(stop_id, jour, note) values ($1, '2026-08-04', $2) returning note`, [s2, 'Coupé à l\'arrière « en vitesse »']))[0].note, 'Coupé à l\'arrière « en vitesse »');
  await err('changer le jour d\'un passage vers un jour déjà noté est refusé aussi', () => q(`update passages_manuels set jour = '2026-06-08' where stop_id = $1 and jour = '2026-06-01'`, [s1]), 'passages_manuels_un_par_jour');
}

log('\n=== UN CLIENT QUI A DES DATES NOTÉES À LA MAIN N\'EST PAS SUPPRIMÉ (il est archivé, comme un client qui a des passes) ===');
{
  await err('supprimer le client s1 (2 dates notées) est refusé par la base', () => q(`delete from stops where id = $1`, [s1]), 'foreign key');
  eq('… ses dates sont intactes', (await q(`select count(*)::int n from passages_manuels where stop_id = $1`, [s1]))[0].n, 2);
  const s3 = await stop('3 rue des Pins');
  eq('un client SANS date à la main se supprime toujours', (await q(`delete from stops where id = $1 returning id`, [s3])).length, 1);
  eq('… et l\'archivage (actif = faux) d\'un client qui a des dates marche', (await q(`update stops set actif = false where id = $1 returning actif`, [s1]))[0].actif, false);
  await q(`update stops set actif = true where id = $1`, [s1]);
}

log('\n=== ACCÈS : L\'ADMINISTRATEUR ÉCRIT ET LIT ; UN EMPLOYÉ N\'A AUCUN ACCÈS ; UN VISITEUR NON PLUS ===');
{
  await q(`delete from passages_manuels`);
  const a = await sqlAs(admin, `insert into passages_manuels(stop_id, jour, note) values ($1, '2026-09-01', 'Joé') returning id, ajoute_par`, [s1]);
  eq('l\'administrateur ajoute un passage ; « ajouté par » est SA personne, posée toute seule', [a.length, a[0].ajoute_par], [1, admin]);
  eq('… le lit', (await sqlAs(admin, `select count(*)::int n from passages_manuels`))[0].n, 1);
  eq('… le modifie (la note)', (await sqlAs(admin, `update passages_manuels set note = 'corrigé' where id = $1 returning note`, [a[0].id]))[0].note, 'corrigé');
  eq('… le modifie (le jour)', (await sqlAs(admin, `update passages_manuels set jour = '2026-09-02' where id = $1 returning to_char(jour, 'YYYY-MM-DD') j`, [a[0].id]))[0].j, '2026-09-02');
  eq('… ajoute plusieurs passages d\'un coup (un outil « plusieurs clients, une date »)', (await sqlAs(admin, `insert into passages_manuels(stop_id, jour) values ($1, '2026-09-10'), ($2, '2026-09-10') returning id`, [s1, s2])).length, 2);
  eq('… et une reprise avec des doublons (« ignorer ce qui existe déjà ») ne plante pas', (await sqlAs(admin, `insert into passages_manuels(stop_id, jour) values ($1, '2026-09-10'), ($2, '2026-09-11') on conflict (stop_id, jour) do nothing returning stop_id`, [s1, s2])).length, 1);
  eq('… le supprime', (await sqlAs(admin, `delete from passages_manuels where id = $1 returning id`, [a[0].id])).length, 1);

  eq('(mise en place) il reste des dates', (await q(`select count(*)::int n from passages_manuels`))[0].n > 0, true);
  const avant = (await q(`select count(*)::int n from passages_manuels`))[0].n;
  eq('un EMPLOYÉ ne voit AUCUNE date notée à la main (même si elles existent)', (await sqlAs(nina, `select count(*)::int n from passages_manuels`))[0].n, 0);
  await err('… ne peut pas en ajouter', () => sqlAs(nina, `insert into passages_manuels(stop_id, jour) values ($1, '2026-09-20')`, [s1]), 'row-level security');
  eq('… ne peut pas en modifier (aucune ligne touchée)', (await sqlAs(nina, `update passages_manuels set note = 'piraté' returning id`)).length, 0);
  eq('… ne peut pas en supprimer (aucune ligne touchée)', (await sqlAs(nina, `delete from passages_manuels returning id`)).length, 0);
  eq('… rien n\'a changé pour l\'administrateur', [(await q(`select count(*)::int n from passages_manuels`))[0].n, (await q(`select count(*)::int n from passages_manuels where note = 'piraté'`))[0].n], [avant, 0]);
  await err('un visiteur non connecté ne peut rien lire : « permission denied »', () => sqlAs('', `select count(*) from passages_manuels`, [], 'anon'), 'permission denied');
  await err('… ni écrire', () => sqlAs('', `insert into passages_manuels(stop_id, jour) values ($1, '2026-09-21')`, [s1], 'anon'), 'permission denied');
  await err('… et sans identité (ni employé ni administrateur) même connecté, rien n\'entre', () => sqlAs('', `insert into passages_manuels(stop_id, jour) values ($1, '2026-09-22')`, [s1]), 'row-level security');
}

log('\n=== LE RYTHME : L\'ADMINISTRATEUR LE CHOISIT ; L\'EMPLOYÉ LIT CELUI DES TYPES ACTIFS SEULEMENT ===');
{
  eq('l\'administrateur choisit le rythme du gazon (7 jours)', (await sqlAs(admin, `update types_service set frequence_jours = 7 where nom = 'Coupe de gazon' returning frequence_jours`))[0].frequence_jours, 7);
  eq('… le change', (await sqlAs(admin, `update types_service set frequence_jours = 10 where nom = 'Coupe de gazon' returning frequence_jours`))[0].frequence_jours, 10);
  eq('… l\'efface', (await sqlAs(admin, `update types_service set frequence_jours = null where nom = 'Coupe de gazon' returning frequence_jours`))[0].frequence_jours, null);
  await sqlAs(admin, `update types_service set frequence_jours = 14 where nom = 'Engrais'`);
  eq('un employé ne peut PAS changer le rythme (aucune ligne modifiée, le rythme est intact)', [(await sqlAs(nina, `update types_service set frequence_jours = 1 where nom = 'Engrais' returning frequence_jours`)).length, (await q(`select frequence_jours from types_service where nom = 'Engrais'`))[0].frequence_jours], [0, 14]);
  eq('un employé LIT le rythme d\'un type actif', (await sqlAs(nina, `select frequence_jours from types_service where nom = 'Engrais'`))[0].frequence_jours, 14);
  await sqlAs(admin, `update types_service set actif = false where nom = 'Engrais'`);
  eq('un type DÉSACTIVÉ (et son rythme) reste caché à l\'employé', (await sqlAs(nina, `select count(*)::int n from types_service where nom = 'Engrais'`))[0].n, 0);
  eq('… mais l\'administrateur le voit, avec son rythme', (await sqlAs(admin, `select frequence_jours from types_service where nom = 'Engrais'`))[0].frequence_jours, 14);
}

log('\n=== SANS LE FICHIER 23 (la table types_service) : REFUSÉ, RIEN N\'EST MODIFIÉ ===');
{
  const vierge = await prepare(FILES);
  let refuse = false, message = '';
  try { await vierge.exec(SQL28); } catch (e) { refuse = /types_service n'existe pas/.test(e.message); message = e.message; }
  vrai('le fichier refuse de s\'exécuter et dit qu\'il manque le fichier 23', refuse, message);
  eq('… et n\'a créé aucune table passages_manuels', (await vierge.query(`select to_regclass('public.passages_manuels') is not null as r`)).rows[0].r, false);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
