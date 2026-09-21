// Fichier 20 (étape 17, morceau 2) — « Je termine » : le quart sans numéro, le quart d'un passager terminé par le chauffeur,
// « ce n'est pas exact », deux réglages. Banc d'essai local (base PGlite) : le vrai Supabase sera essayé par reel-etape-17.mjs (morceau 4).
// SQL20_TEST (variable d'environnement) : une COPIE abîmée du fichier 20, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
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
const ms = (t) => new Date(t).getTime();
const FILES19 = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const FICHIER20 = '20-etape17-fin-de-quart-equipage.sql';
const SQL20 = fs.readFileSync(process.env.SQL20_TEST || (SQL_DIR + FICHIER20), 'utf8');
const NETTOYAGE = fs.readFileSync(SQL_DIR + '10-nettoyage-comptes-zztest.sql', 'utf8');
const MEC = 'Déneigement mécanique';

const db = await prepare(FILES19);
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

// ── Les gestes, comme l'application les envoie ──
const debuter = (uid, id, route, equipe, min = 0) =>
  fn(uid, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::text)`, [id, route, equipe, at(min), MEC]);
const ajouter = (uid, cle, passe, user, min, forcer = false) =>
  fn(uid, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real,$5::boolean)`, [cle, passe, user, at(min), forcer]);
const retirer = (uid, cle, passe, user, min) =>
  fn(uid, `equipage_retirer($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,46.5::float8,-72.7::float8,null::real)`, [cle, passe, user, at(min)]);
const commencer = (uid, id, moment) => fn(uid, `quart_commencer($1::uuid,$2::timestamptz,46.5::float8,-72.7::float8,null::real)`, [id, moment]);
// « Je termine » : id = null → « mon quart ouvert » ; moment = null → maintenant
const terminerQ = (uid, id, moment) => fn(uid, `quart_terminer($1::uuid,$2::timestamptz,46.5::float8,-72.7::float8,null::real)`, [id, moment]);
const equipier = (uid, passe, user, moment) => fn(uid, `quart_terminer_equipier($1::uuid,$2::uuid,$3::timestamptz,46.5::float8,-72.7::float8,null::real)`, [passe, user, moment]);
const contester = (uid, quartId, note = null) => fn(uid, `quart_signaler_erreur($1::uuid,$2::text)`, [quartId, note]);

const quartDe = async (uid) => (await q(`select * from quarts where utilisateur_id = $1 order by debut desc limit 1`, [uid]))[0];
const periodesDe = async (uid) => q(`select * from equipage_periodes where utilisateur_id = $1 order by debut`, [uid]);
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
let nS = 0;
// Une passe en cours : un chauffeur (son quart s'ouvre avec la passe), un véhicule, des passagers ajoutés par les VRAIES fonctions
// (leur quart s'ouvre « par l'équipage », à valider). Tout est daté d'il y a `min` minutes.
async function nouvellePasse(noms, min = 240) {
  const n = ++nS;
  const chauffeur = await emp('Chauffeur' + n);
  const equipe = (await q(`insert into equipes(nom) values ($1) returning id`, ['Camion T' + n]))[0].id;
  const route = (await q(`insert into routes(nom) values ($1) returning id`, ['R17 ' + n]))[0].id;
  await q(`insert into stops(adresse, route_id, service, lat, lon) values ($1,$2,$3,46.5,-72.7)`, ['A' + n, route, MEC]);
  const passe = uuid();
  await debuter(chauffeur, passe, route, equipe, min);
  const passagers = [];
  for (const nom of noms) {
    const u = await emp(nom + n);
    const r = await ajouter(chauffeur, uuid(), passe, u, min - 1);
    if (r.statut !== 'ajoute') throw new Error('décor : ' + nom + ' pas ajouté : ' + JSON.stringify(r));
    passagers.push(u);
  }
  return { chauffeur, passe, passagers, equipe, route, nom: 'Camion T' + n };
}

// ═════════════════════════════════════════════════════════════════════
log('=== LE FICHIER LUI-MÊME ===');
{
  const sans = await prepare(FILES19.slice(0, 3));
  await err('sans les fichiers précédents : REFUSÉ, avec un message clair', () => sans.exec(SQL20), 'n\'ont pas tous été exécutés');

  // De vraies données AVANT le fichier : « aucune donnée n'est modifiée » veut alors dire quelque chose
  const donnee = await nouvellePasse(['Nina', 'Omar']);
  await commencer(await emp('Paul'), uuid(), at(300));
  const compte = async () => [
    (await q(`select count(*)::int n from quarts`))[0].n, (await q(`select count(*)::int n from equipage_periodes`))[0].n, (await q(`select count(*)::int n from passes`))[0].n,
    (await q(`select md5(coalesce(string_agg(id::text || debut::text || coalesce(fin::text,'') || coalesce(fin_source,'') || a_valider::text || coalesce(raison_a_valider,''), ',' order by id), '')) h from quarts`))[0].h,
    (await q(`select md5(coalesce(string_agg(cle || valeur::text, ',' order by cle), '')) h from reglages`))[0].h,
    (await q(`select md5(pg_get_functiondef('public.quart_commencer(uuid, timestamptz, double precision, double precision, real)'::regprocedure)) h`))[0].h,
    (await q(`select md5(pg_get_functiondef('public.equipage_retirer(uuid, uuid, uuid, timestamptz, double precision, double precision, real)'::regprocedure)) h`))[0].h];
  const av = await compte();
  await db.exec(SQL20);
  const apres = await compte();
  eq('exécuter le fichier : les quarts, les équipages, les passes et les anciennes fonctions ne bougent pas ; SEUL le réglage s\'ajoute',
    [apres[0], apres[1], apres[2], apres[3], apres[5], apres[6]], [av[0], av[1], av[2], av[3], av[5], av[6]]);
  vrai('… et les réglages ont bien changé (deux de plus)', apres[4] !== av[4]);
  eq('les 3 anciens réglages sont intacts', (await q(`select cle, valeur from reglages where cle in ('duree_max_passe_heures','duree_max_quart_heures','alerte_quart_termine_heures') order by cle`)).map(x => [x.cle, x.valeur]),
    [['alerte_quart_termine_heures', 4], ['duree_max_passe_heures', 12], ['duree_max_quart_heures', 16]]);
  await db.exec(SQL20);
  eq('ré-exécuter le fichier une 2e fois : accepté, RIEN ne change', await compte(), apres);
  eq('une seule version de chaque fonction du quart',
    (await q(`select proname, count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname like 'quart\\_%' group by proname order by proname`)).map(x => [x.proname, x.n]),
    [['quart_commencer', 1], ['quart_signaler_erreur', 1], ['quart_terminer', 1], ['quart_terminer_equipier', 1]]);
  eq('la colonne « fin_par » existe et est VIDE pour tous les quarts existants', [(await q(`select count(*)::int n from information_schema.columns where table_schema = 'public' and table_name = 'quarts' and column_name = 'fin_par'`))[0].n,
    (await q(`select count(*)::int n from quarts where fin_par is not null`))[0].n], [1, 0]);

  await err('un visiteur ne peut pas terminer le quart d\'un passager', () => fn(null, `quart_terminer_equipier($1::uuid,$2::uuid,null,null,null,null)`, [uuid(), uuid()], 'anon'), 'permission denied');
  await err('un visiteur ne peut pas signaler une erreur', () => fn(null, `quart_signaler_erreur($1::uuid,null)`, [uuid()], 'anon'), 'permission denied');
  await err('un visiteur ne peut pas terminer un quart', () => fn(null, `quart_terminer($1::uuid,null,null,null,null)`, [uuid()], 'anon'), 'permission denied');
  eq('aucune fonction ouverte au visiteur', (await q(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')`))[0].n, 0);
  vrai('aucune clé secrète ni mot de passe', !/service_role|sb_secret|password/i.test(SQL20));
  const verif = (await q(SQL20.slice(SQL20.indexOf('select jsonb_build_object(', SQL20.lastIndexOf('-- VÉRIFICATION'))).replace(/;\s*$/, '')))[0].verification;
  eq('la requête « vérification » du bas : 1 version, sans numéro permis, les 4 fonctions du quart ouvertes aux employés seulement, colonne présente, les deux réglages',
    [verif.quart_terminer_versions, verif.quart_terminer_accepte_sans_numero, verif.fonctions_du_quart_appelables_par_un_employe, verif.fonctions_du_quart_appelables_par_un_visiteur,
      verif.fonctions_appelables_par_un_visiteur, verif.colonne_fin_par, verif.reglages.rappel_en_service_heures, verif.reglages.suggestion_pause_heures],
    [1, true, ['quart_commencer', 'quart_signaler_erreur', 'quart_terminer', 'quart_terminer_equipier'], [], [], true, 12, 4]);
  vrai('… l\'origine « equipage » et la raison « fin_contestee » sont permises', verif.origines_de_fin_permises.includes('equipage') && verif.raisons_a_valider_permises.includes('fin_contestee'), JSON.stringify([verif.origines_de_fin_permises, verif.raisons_a_valider_permises]));
  vrai('… et les anciennes valeurs le restent', ['manuel', 'fin_passe', 'delai_max', 'admin'].every(v => verif.origines_de_fin_permises.includes(v)) && ['ouvert_par_equipage', 'ouvert_par_passe', 'fin_estimee'].every(v => verif.raisons_a_valider_permises.includes(v)));
  eq('… et le nombre de quarts existants qu\'elle annonce est exact', verif.quarts_existants, (await q(`select count(*)::int n from quarts`))[0].n);

  // Les valeurs permises : une valeur bidon est TOUJOURS refusée, les anciennes et les nouvelles sont acceptées
  const u = await emp('Valeurs'); await commencer(u, uuid(), at(500));
  const bidon = async (col, val) => { try { await q(`update quarts set ${col} = $1 where utilisateur_id = $2`, [val, u]); return 'accepté'; } catch (e) { return e.message.includes('check constraint') ? 'refusé' : 'autre : ' + e.message; } };
  eq('fin_source = « bidon » : refusé', await bidon('fin_source', 'bidon'), 'refusé');
  eq('raison_a_valider = « bidon » : refusée', await bidon('raison_a_valider', 'bidon'), 'refusé');
  await q(`update quarts set fin = now(), fin_source = 'delai_max', fin_estimee = true, a_valider = true, raison_a_valider = 'fin_estimee' where utilisateur_id = $1`, [u]);
  pass('l\'ancien monde marche encore : « delai_max » et « fin_estimee » acceptés');
}

// ═════════════════════════════════════════════════════════════════════
log('\n=== « JE TERMINE » SANS NUMÉRO DE QUART ===');
{
  // (a) Le cas pour lequel c'est fait : le quart a été ouvert AUTOMATIQUEMENT par la passe (le téléphone n'en connaît pas le numéro)
  const s = await nouvellePasse(['Nina']);
  const avant = await quartDe(s.chauffeur);
  eq('le quart du chauffeur a été ouvert par la passe (à valider, sans que le téléphone en connaisse le numéro)', [avant.debut_source, avant.a_valider, avant.fin], ['passe', true, null]);
  const m = at(5);
  const r = await terminerQ(s.chauffeur, null, m);
  eq('« Je termine » SANS numéro : le quart ouvert est terminé', [r.statut, r.quart_id === avant.id, ms(r.fin) === ms(m)], ['termine', true, true]);
  const apres = await quartDe(s.chauffeur);
  eq('… à l\'heure du geste, origine « manuel » (rien de nouveau : c\'est lui-même)', [ms(apres.fin) === ms(m), apres.fin_source, apres.fin_par], [true, 'manuel', null]);
  const passe = (await q(`select statut, fin_type from passes where id = $1`, [s.passe]))[0];
  eq('… sa passe se termine avec son quart (comme avec un numéro)', [passe.statut, passe.fin_type, r.passe_fermee === s.passe], ['terminee', 'fin_quart', true]);
  eq('… et il sort du camion', (await periodesDe(s.chauffeur)).every(p => p.fin !== null), true);
  const r2 = await terminerQ(s.chauffeur, null, m);
  eq('le MÊME geste renvoyé (réponse perdue) : « déjà terminé », rien ne bouge', [r2.statut, ms(r2.fin) === ms(m), ms((await quartDe(s.chauffeur)).fin) === ms(m)], ['deja_termine', true, true]);
}
{
  // (b) Un vieux geste renvoyé APRÈS un nouveau « Je commence » ne ferme JAMAIS le nouveau quart
  const u = await emp('Renvoi');
  const id1 = uuid(), id2 = uuid();
  await commencer(u, id1, at(600));
  const m1 = at(300);
  await terminerQ(u, null, m1);
  await commencer(u, id2, at(30));   // le lendemain matin
  const r = await terminerQ(u, null, m1);   // le vieux geste est renvoyé
  eq('vieux geste renvoyé après un nouveau quart : « déjà terminé » (il vise l\'ancien quart)', r.statut, 'deja_termine');
  eq('… et le NOUVEAU quart est toujours ouvert', (await q(`select fin from quarts where id = $1`, [id2]))[0].fin, null);
}
{
  // (c) Heure du geste avant le début du quart, ou aucun quart : rien à terminer, pas une erreur
  const u = await emp('Avant'); const id = uuid();
  await commencer(u, id, at(60));
  const r = await terminerQ(u, null, at(120));
  eq('un geste daté d\'AVANT le début du quart : « pas en quart », le quart reste ouvert', [r.statut, (await q(`select fin from quarts where id = $1`, [id]))[0].fin], ['pas_en_quart', null]);
  const v = await emp('Aucun');
  eq('aucun quart du tout : « pas en quart » (pas une erreur : le geste part au retour du signal et ne doit pas rester coincé)', (await terminerQ(v, null, at(1))).statut, 'pas_en_quart');
}
{
  // (d) Sans heure (null) = maintenant ; le serveur ne ferme QUE le quart de la personne connectée
  const a = await emp('Alice'), b = await emp('Bruno');
  await commencer(a, uuid(), at(120)); await commencer(b, uuid(), at(120));
  const r = await terminerQ(a, null, null);
  eq('sans heure : terminé maintenant', [r.statut, Math.abs(ms(r.fin) - Date.now()) < 60000], ['termine', true]);
  eq('… le quart de l\'AUTRE personne n\'a pas bougé', (await quartDe(b)).fin, null);
}
{
  // (e) Avec un numéro : exactement comme avant
  const u = await emp('Numero'); const id = uuid();
  await commencer(u, id, at(90));
  const w = await emp('Autre');
  await err('avec le numéro d\'un quart qui n\'est pas à moi : refusé, comme avant', () => terminerQ(w, id, at(1)), 'quart_introuvable');
  await err('avec un numéro qui n\'existe pas : refusé, comme avant', () => terminerQ(u, uuid(), at(1)), 'quart_introuvable');
  const r = await terminerQ(u, id, at(1));
  eq('avec le bon numéro : terminé, comme avant', [r.statut, r.quart_id === id], ['termine', true]);
  eq('… renvoyé : « déjà terminé »', (await terminerQ(u, id, at(1))).statut, 'deja_termine');
  const x = await emp('Meme'); const idx = uuid(); const mm = at(50);
  await commencer(x, idx, mm);
  await terminerQ(x, idx, mm);
  eq('un quart terminé à la seconde même de son début : la fin est reculée d\'une seconde après le début', ms((await q(`select fin from quarts where id = $1`, [idx]))[0].fin) - ms(mm), 1000);
  await err('une heure de plus de 3 jours : refusée (sans numéro comme avec)', () => terminerQ(u, null, at(60 * 24 * 4)), 'geste_trop_ancien');
  const y = await emp('Desactive'); await commencer(y, uuid(), at(30));
  await q(`update utilisateurs set actif = false where id = $1`, [y]);
  await err('un employé DÉSACTIVÉ ne peut pas terminer un quart', () => terminerQ(y, null, at(1)), 'non_autorise');
}

// ═════════════════════════════════════════════════════════════════════
log('\n=== LE CHAUFFEUR TERMINE LE QUART D\'UN PASSAGER ===');
{
  const s = await nouvellePasse(['Nina', 'Omar']);
  const [nina, omar] = s.passagers;
  const avant = await quartDe(nina);
  eq('le quart de Nina a été ouvert par l\'équipage (à valider)', [avant.debut_source, avant.a_valider, avant.raison_a_valider, avant.fin], ['equipage', true, 'ouvert_par_equipage', null]);
  const m = at(5);
  const r = await equipier(s.chauffeur, s.passe, nina, m);
  eq('le chauffeur termine le quart de Nina', [r.statut, r.quart_id === avant.id, r.utilisateur_id === nina, ms(r.fin) === ms(m)], ['termine', true, true, true]);
  const q1 = await quartDe(nina);
  eq('… l\'heure, l\'origine « equipage », QUI l\'a fait, et la position du chauffeur sont gardées', [ms(q1.fin) === ms(m), q1.fin_source, q1.fin_par === s.chauffeur, q1.fin_lat, q1.fin_lon], [true, 'equipage', true, 46.5, -72.7]);
  eq('… le quart reste « à valider » (il l\'était déjà : ouvert par l\'équipage)', [q1.a_valider, q1.raison_a_valider], [true, 'ouvert_par_equipage']);
  const pn = (await periodesDe(nina))[0];
  eq('… Nina sort du camion à la même heure, retirée par le chauffeur', [ms(pn.fin) === ms(m), pn.retire_par === s.chauffeur], [true, true]);
  eq('… Omar n\'a pas bougé (son quart et sa place à bord)', [(await quartDe(omar)).fin, (await periodesDe(omar))[0].fin], [null, null]);
  eq('… la passe du chauffeur continue, son quart aussi', [(await q(`select statut from passes where id = $1`, [s.passe]))[0].statut, (await quartDe(s.chauffeur)).fin], ['en_cours', null]);

  const r2 = await equipier(s.chauffeur, s.passe, nina, m);
  eq('le MÊME geste renvoyé : « déjà terminé », rien ne bouge', [r2.statut, ms(r2.fin) === ms(m), (await quartDe(nina)).fin_par === s.chauffeur], ['deja_termine', true, true]);
  eq('… une 3e fois aussi', (await equipier(s.chauffeur, s.passe, nina, m)).statut, 'deja_termine');

  // Ce que Nina voit : SON quart, avec qui l'a terminé ; jamais celui d'un collègue ; elle ne peut rien écrire
  const vu = await sqlAs(nina, `select fin_source, fin_par from quarts where id = $1`, [avant.id]);
  eq('Nina lit son quart : terminé par le chauffeur, origine « equipage »', [vu.length, vu[0].fin_source, vu[0].fin_par === s.chauffeur], [1, 'equipage', true]);
  eq('Omar ne lit PAS le quart de Nina (jamais le quart d\'un collègue)', (await sqlAs(omar, `select id from quarts where id = $1`, [avant.id])).length, 0);
  eq('un employé ne peut pas écrire « fin_par » lui-même (0 ligne modifiée)', [(await sqlAs(omar, `update quarts set fin_par = $1 where id = $2 returning id`, [omar, (await quartDe(omar)).id])).length, (await quartDe(omar)).fin_par], [0, null]);
}
{
  // L'ordre de « JE TERMINE » : le chauffeur d'abord (sa passe se ferme, l'équipage sort), PUIS les passagers, à la même heure
  const s = await nouvellePasse(['Nina', 'Omar']);
  const [nina, omar] = s.passagers;
  const m = at(3);
  await terminerQ(s.chauffeur, null, m);
  eq('après « Je termine » du chauffeur : la passe est terminée et l\'équipage est sorti', [(await q(`select statut from passes where id = $1`, [s.passe]))[0].statut, (await periodesDe(nina))[0].fin !== null], ['terminee', true]);
  const a = await equipier(s.chauffeur, s.passe, nina, m), b = await equipier(s.chauffeur, s.passe, omar, m);
  eq('… PUIS le quart de chaque passager : terminé à la même heure', [a.statut, b.statut, ms(a.fin) === ms(m), ms(b.fin) === ms(m)], ['termine', 'termine', true, true]);
  eq('… toute l\'équipe a fini à la même seconde', new Set([(await quartDe(s.chauffeur)).fin, (await quartDe(nina)).fin, (await quartDe(omar)).fin].map(ms)).size, 1);
}
{
  // L'autre ordre (les passagers d'abord, le chauffeur ensuite) : même résultat
  const s = await nouvellePasse(['Nina']);
  const m = at(3);
  eq('les passagers d\'abord', (await equipier(s.chauffeur, s.passe, s.passagers[0], m)).statut, 'termine');
  const r = await terminerQ(s.chauffeur, null, m);
  eq('… puis le chauffeur : sa passe se ferme', [r.statut, r.passe_fermee === s.passe], ['termine', true]);
}
{
  // « Retirer » PUIS « il a terminé sa journée » : la question est posée quelques instants après la descente
  const s = await nouvellePasse(['Nina', 'Omar', 'Paul']);
  const [nina, omar, paul] = s.passagers;
  const mr = at(10);
  const rr = await retirer(s.chauffeur, uuid(), s.passe, nina, 10);
  eq('Nina descend du camion (plus de 2 minutes après son entrée : un vrai retrait, pas une annulation)', rr.statut, 'retire');
  const r = await equipier(s.chauffeur, s.passe, nina, at(9.5));   // 30 secondes plus tard
  eq('30 secondes après : son quart se termine à l\'heure où elle est DESCENDUE (pas à l\'heure de la réponse)', [r.statut, ms(r.fin) === ms(mr)], ['termine', true]);
  await retirer(s.chauffeur, uuid(), s.passe, omar, 30);
  eq('descendu il y a 30 min, question à 21 min (9 min après) : encore accepté (limite 10 minutes)', (await equipier(s.chauffeur, s.passe, omar, at(21))).statut, 'termine');
  await retirer(s.chauffeur, uuid(), s.passe, paul, 30);
  const p = await equipier(s.chauffeur, s.passe, paul, at(15));   // 15 minutes après la descente
  eq('descendu il y a 30 min, question à 15 min (15 min après) : REFUSÉ, il n\'est plus à bord depuis trop longtemps', [p.statut, p.raison], ['refuse', 'pas_a_bord']);
  eq('… et son quart reste ouvert', (await quartDe(paul)).fin, null);
}
{
  // Les refus
  const s = await nouvellePasse(['Nina', 'Omar']), t = await nouvellePasse(['Paul']);
  const [nina, omar] = s.passagers, [paul] = t.passagers;
  await err('un simple passager ne peut PAS terminer le quart d\'un collègue', () => equipier(omar, s.passe, nina, at(2)), 'non_autorise');
  await err('l\'administrateur non plus, avec cette fonction (il corrigera à l\'étape 19)', () => equipier(admin, s.passe, nina, at(2)), 'non_autorise');
  await err('le chauffeur d\'un AUTRE camion non plus', () => equipier(t.chauffeur, s.passe, nina, at(2)), 'non_autorise');
  await err('le chauffeur ne l\'utilise pas pour lui-même (« Je termine » existe)', () => equipier(s.chauffeur, s.passe, s.chauffeur, at(2)), 'non_autorise');
  await err('une passe qui n\'existe pas', () => equipier(s.chauffeur, uuid(), nina, at(2)), 'passe_introuvable');
  const x = await equipier(s.chauffeur, s.passe, paul, at(2));
  eq('quelqu\'un qui n\'a jamais été à bord de MA passe (Paul, à bord de l\'autre camion) : refusé', [x.statut, x.raison], ['refuse', 'pas_a_bord']);
  eq('… son quart n\'a pas bougé', [(await quartDe(paul)).fin, (await quartDe(paul)).fin_par], [null, null]);
  const tot = await equipier(s.chauffeur, s.passe, nina, at(300));   // avant même le début de la passe : elle n'était pas encore à bord
  eq('une heure AVANT son arrivée à bord (elle n\'était pas encore là) : refusé', [tot.statut, tot.raison], ['refuse', 'pas_a_bord']);
  eq('aucun quart des passagers n\'a été touché par tous ces refus', [(await quartDe(nina)).fin, (await quartDe(omar)).fin], [null, null]);
  await q(`update utilisateurs set actif = false where id = $1`, [s.chauffeur]);
  await err('un chauffeur DÉSACTIVÉ ne peut plus rien terminer', () => equipier(s.chauffeur, s.passe, nina, at(2)), 'non_autorise');
}
{
  // Un passager passé dans un autre camion travaille encore : ce n'est pas au premier chauffeur de terminer son quart
  const s = await nouvellePasse(['Nina']), t = await nouvellePasse([]);
  const nina = s.passagers[0];
  const tr = await ajouter(t.chauffeur, uuid(), t.passe, nina, 30, true);
  eq('(décor) Nina est transférée dans l\'autre camion il y a 30 minutes', tr.statut, 'transfere');
  const r = await equipier(s.chauffeur, s.passe, nina, at(35));
  eq('le premier chauffeur veut terminer son quart : REFUSÉ, elle est maintenant à bord de l\'autre camion (nommé)', [r.statut, r.raison, r.vehicule], ['refuse', 'a_bord_ailleurs', t.nom]);
  eq('… son quart est toujours ouvert', (await quartDe(nina)).fin, null);
}
{
  // Un quart déjà terminé par la personne elle-même n'est jamais modifié
  const s = await nouvellePasse(['Omar']);
  const omar = s.passagers[0];
  const mo = at(20);
  await terminerQ(omar, null, mo);
  const r = await equipier(s.chauffeur, s.passe, omar, at(19));
  eq('Omar a terminé son quart LUI-MÊME : « déjà terminé », son heure et son origine ne changent pas', [r.statut, ms((await quartDe(omar)).fin) === ms(mo), (await quartDe(omar)).fin_source, (await quartDe(omar)).fin_par], ['deja_termine', true, 'manuel', null]);
}
{
  // Quelqu'un sans quart ; une fin qui tombe à la seconde du début ; les heures impossibles
  const s = await nouvellePasse(['Nina', 'Omar', 'Paul'], 60);
  const [nina, omar, paul] = s.passagers;
  await q(`delete from quarts where utilisateur_id = $1`, [nina]);
  eq('une personne à bord SANS aucun quart : « pas en quart » (rien à terminer)', (await equipier(s.chauffeur, s.passe, nina, at(2))).statut, 'pas_en_quart');
  const d = new Date((await quartDe(omar)).debut).toISOString();
  const r = await equipier(s.chauffeur, s.passe, omar, d);
  eq('fin demandée à la seconde même du DÉBUT du quart : reculée d\'une seconde après le début (jamais avant)', ms(r.fin) - ms(d), 1000);
  await err('une heure de plus de 3 jours : refusée', () => equipier(s.chauffeur, s.passe, paul, at(60 * 24 * 4)), 'geste_trop_ancien');
  const f = await equipier(s.chauffeur, s.passe, paul, at(-24 * 60));
  eq('une heure dans le futur (téléphone mal réglé) compte comme MAINTENANT', [f.statut, Math.abs(ms(f.fin) - Date.now()) < 60000], ['termine', true]);
}
{
  // Un passager qui avait déjà « puncher » lui-même avant de monter : son quart (pas ouvert par l'équipage) est terminé aussi
  const n = ++nS;
  const chauffeur = await emp('ChauffeurP' + n), paul = await emp('PaulP' + n);
  const equipe = (await q(`insert into equipes(nom) values ($1) returning id`, ['Camion P' + n]))[0].id;
  const route = (await q(`insert into routes(nom) values ($1) returning id`, ['RP ' + n]))[0].id;
  await q(`insert into stops(adresse, route_id, service, lat, lon) values ($1,$2,$3,46.5,-72.7)`, ['P' + n, route, MEC]);
  const idp = uuid();
  await commencer(paul, idp, at(300));
  const passe = uuid();
  await debuter(chauffeur, passe, route, equipe, 240);
  await ajouter(chauffeur, uuid(), passe, paul, 239);
  eq('(décor) le quart de Paul est le sien (manuel), pas à valider', [(await quartDe(paul)).debut_source, (await quartDe(paul)).a_valider], ['manuel', false]);
  const r = await equipier(chauffeur, passe, paul, at(4));
  const qp = await quartDe(paul);
  eq('le chauffeur termine le quart que Paul avait commencé lui-même (depuis 5 h)', [r.statut, r.quart_id === idp, qp.fin_source, qp.fin_par === chauffeur], ['termine', true, 'equipage', true]);
}

// ═════════════════════════════════════════════════════════════════════
log('\n=== « CE N\'EST PAS EXACT » ===');
{
  const s = await nouvellePasse(['Nina', 'Omar', 'Paul']);
  const [nina, omar, paul] = s.passagers;
  const m = at(4);
  await equipier(s.chauffeur, s.passe, nina, m);
  const qid = (await quartDe(nina)).id;
  const r = await contester(nina, qid);
  eq('Nina signale que la fin de son quart n\'est pas exacte', r.statut, 'signale');
  const c = await quartDe(nina);
  eq('… son quart est « à valider », raison « fin_contestee » ; l\'heure de fin n\'a PAS changé', [c.a_valider, c.raison_a_valider, ms(c.fin) === ms(m), c.fin_source], [true, 'fin_contestee', true, 'equipage']);
  vrai('… une note dit « contestée par l\'employé »', /contestée par l'employé/.test(c.note || ''), c.note);
  const r2 = await contester(nina, qid);
  eq('renvoyé (réponse perdue) : « déjà signalé », la note n\'est pas répétée', [r2.statut, (await quartDe(nina)).note], ['deja_signale', c.note]);

  // Un quart que la personne avait lancé elle-même (jamais « à valider ») : il le devient
  await equipier(s.chauffeur, s.passe, paul, m);
  await q(`update quarts set a_valider = false, raison_a_valider = null where utilisateur_id = $1`, [paul]);   // (décor : validé sans note)
  const rp = await contester(paul, (await quartDe(paul)).id, 'Je suis resté jusqu\'à 17 h 30');
  const cp = await quartDe(paul);
  eq('un quart pas encore « à valider » le devient, avec le message de la personne', [rp.statut, cp.a_valider, cp.raison_a_valider, (cp.note || '').includes('Je suis resté jusqu\'à 17 h 30')], ['signale', true, 'fin_contestee', true]);

  await err('un collègue ne peut PAS contester à la place de Nina', () => contester(omar, qid), 'quart_introuvable');
  await err('un quart qui n\'existe pas', () => contester(nina, uuid()), 'quart_introuvable');
  const ch = await contester(s.chauffeur, (await quartDe(s.chauffeur)).id);
  eq('un quart encore OUVERT ne se conteste pas', [ch.statut, ch.raison], ['refuse', 'pas_termine_par_un_autre']);

  // Le quart qu'on a terminé soi-même ne se « conteste » pas : c'est son propre geste
  await terminerQ(omar, null, at(2));
  const ro = await contester(omar, (await quartDe(omar)).id);
  eq('un quart terminé par la personne ELLE-MÊME ne se conteste pas', [ro.statut, ro.raison], ['refuse', 'pas_termine_par_un_autre']);
  eq('… et il n\'a pas été changé', [(await quartDe(omar)).a_valider, (await quartDe(omar)).raison_a_valider], [true, 'ouvert_par_equipage']);

  // L'export de paie le refuse tant que l'administrateur ne l'a pas réglé
  const ex = await fn(admin, `admin_export_paie($1::timestamptz,$2::timestamptz)`, [at(60 * 24), at(-60)]);
  eq('l\'export de paie REFUSE tant que le quart contesté n\'est pas réglé (et nomme la raison)', [ex.statut, ex.raison, ex.quarts.some(x => x.quart_id === qid && x.raison === 'fin_contestee')], ['refuse', 'quarts_a_valider', true]);

  // L'administrateur l'a examiné : la personne ne peut plus le rouvrir d'un toucher
  await fn(admin, `admin_valider_quart($1::uuid, null)`, [qid]);
  const cv = await quartDe(nina);
  eq('l\'administrateur valide le quart de Nina', [cv.a_valider, cv.valide_le !== null], [false, true]);
  const rv = await contester(nina, qid);
  eq('… Nina ne peut plus le contester d\'un toucher : « déjà validé » (lui parler directement)', [rv.statut, rv.raison, (await quartDe(nina)).a_valider], ['refuse', 'deja_valide', false]);
}

// ═════════════════════════════════════════════════════════════════════
log('\n=== LES DEUX RÉGLAGES ===');
{
  const nina = await emp('ReglNina');
  const lus = await sqlAs(nina, `select cle, valeur from reglages where cle in ('rappel_en_service_heures','suggestion_pause_heures') order by cle`);
  eq('un employé lit les deux réglages : rappel à 12 h, pause suggérée à 4 h', lus.map(x => [x.cle, x.valeur]), [['rappel_en_service_heures', 12], ['suggestion_pause_heures', 4]]);
  eq('… chacun a une description', (await q(`select count(*)::int n from reglages where cle in ('rappel_en_service_heures','suggestion_pause_heures') and length(description) > 20`))[0].n, 2);
  eq('un employé ne peut PAS les changer (0 ligne modifiée)', [(await sqlAs(nina, `update reglages set valeur = '99' where cle = 'suggestion_pause_heures' returning cle`)).length,
    (await q(`select valeur from reglages where cle = 'suggestion_pause_heures'`))[0].valeur], [0, 4]);
  eq('l\'administrateur peut changer la pause suggérée (à 5 h)', (await sqlAs(admin, `update reglages set valeur = '5'::jsonb where cle = 'suggestion_pause_heures' returning valeur`))[0].valeur, 5);
  await db.exec(SQL20);
  eq('ré-exécuter le fichier NE REMET PAS à 4 h une valeur que l\'administrateur a changée', (await q(`select valeur from reglages where cle = 'suggestion_pause_heures'`))[0].valeur, 5);
  eq('… ni ne double le réglage', (await q(`select count(*)::int n from reglages where cle in ('rappel_en_service_heures','suggestion_pause_heures')`))[0].n, 2);
}

// ═════════════════════════════════════════════════════════════════════
log('\n=== LES FERMETURES AUTOMATIQUES ET LE NETTOYAGE FONCTIONNENT TOUJOURS ===');
{
  // La règle « valeurs permises » a été remplacée : la fermeture automatique (pg_cron) doit encore marcher
  const u = await emp('Oublie');
  await q(`insert into quarts(utilisateur_id, debut, debut_source) values ($1, now() - interval '20 hours', 'manuel')`, [u]);
  await q(`select public.fermer_expires()`);
  const f = await quartDe(u);
  eq('un quart oublié depuis 20 h est fermé automatiquement : fin ESTIMÉE, origine « delai_max », à valider', [f.fin !== null, f.fin_source, f.fin_estimee, f.a_valider, f.raison_a_valider], [true, 'delai_max', true, true, 'fin_estimee']);
}
{
  // Des comptes d'essai « ZZTEST » dont le quart a été terminé par le chauffeur : le nettoyage doit tout enlever, sans erreur
  const compteAvant = (await q(`select count(*)::int n from utilisateurs where nom not like 'ZZTEST%'`))[0].n;
  const chauff = await ins('zz-a@t.ca', { nom: 'ZZTEST Eq A', telephone: '8195550191' });
  const pass1 = await ins('zz-b@t.ca', { nom: 'ZZTEST Eq B', telephone: '8195550192' });
  const equipe = (await q(`insert into equipes(nom) values ('ZZTEST Camion 1') returning id`))[0].id;
  const route = (await q(`insert into routes(nom) values ('R17 ZZ') returning id`))[0].id;
  await q(`insert into stops(adresse, route_id, service, lat, lon) values ('ZZ 1',$1,$2,46.5,-72.7)`, [route, MEC]);
  const passe = uuid();
  await debuter(chauff, passe, route, equipe, 120);
  await ajouter(chauff, uuid(), passe, pass1, 119);
  await equipier(chauff, passe, pass1, at(5));
  eq('(décor) le quart du compte d\'essai B a été terminé par le chauffeur d\'essai A', (await quartDe(pass1)).fin_par === chauff, true);
  await db.exec(NETTOYAGE);
  eq('le nettoyage des comptes d\'essai passe SANS erreur : plus aucun compte, quart ni passe d\'essai',
    [(await q(`select count(*)::int n from utilisateurs where nom like 'ZZTEST%'`))[0].n, (await q(`select count(*)::int n from quarts where utilisateur_id in ($1,$2)`, [chauff, pass1]))[0].n,
      (await q(`select count(*)::int n from passes where id = $1`, [passe]))[0].n], [0, 0, 0]);
  eq('… les vrais employés n\'ont pas bougé', (await q(`select count(*)::int n from utilisateurs where nom not like 'ZZTEST%'`))[0].n, compteAvant);
}

log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
