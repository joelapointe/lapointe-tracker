// Fichier 10 — nettoyage des comptes d'essai « ZZTEST » : ne doit toucher QUE ces comptes.
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
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql', '05-etape9b-passes-fermetures-export.sql',
  '06-etape10-outils-admin-employes.sql', '07-etape11-profil-sans-telephone.sql', '09-etape11-profil-employe-par-le-serveur.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql'];
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

const db = await prepare(FILES);
const NETTOYAGE = fs.readFileSync(SQL_DIR + '10-nettoyage-comptes-zztest.sql', 'utf8');
const sup = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };
const fn = async (uid, call, params = []) => {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid]);
  await db.query('set role authenticated');
  try { return (await db.query(`select public.${call} as r`, params)).rows[0].r; } finally { await db.query('reset role'); }
};
const nettoyer = async () => { const r = await db.exec(NETTOYAGE); return r[r.length - 1].rows[0].verification; };
async function echoue(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 100)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const compte = async (email, app) => (await sup('insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id', [email, JSON.stringify(app)]))[0].id;
const emp = (nom, tel) => compte(`${tel}@tel.entretienlapointe.ca`, { nom, telephone: tel });
const nb = async (table, cond = 'true') => Number((await sup(`select count(*)::int n from public.${table} where ${cond}`))[0].n);
const photo = async () => ({
  auth: await nb('utilisateurs'), quarts: await nb('quarts'), passes: await nb('passes'), passe_arrets: await nb('passe_arrets'), problemes: await nb('problemes'),
  positions: await nb('positions'), periodes: await nb('equipage_periodes'), journal: await nb('equipage_journal'), corrections: await nb('journal_modifications'),stops: await nb('stops'), routes: await nb('routes'), equipes: await nb('equipes'),
  comptes_auth: Number((await sup('select count(*)::int n from auth.users'))[0].n) });

// ----- Situation : vrais comptes + comptes d'essai mélangés dans la même base -----
const joe = await compte('joe@exemple.ca', { nom: 'Joé', role: 'admin' });
const marc = await emp('Marc', '8195550101');            // VRAI employé (numéro non fictif)
const zzAdmin = await compte('zz@exemple.ca', { nom: 'ZZTEST Admin', role: 'admin' });   // nom d'essai mais administrateur : ne doit JAMAIS être touché
const zzAdminTel = await compte('zz2@exemple.ca', { nom: 'ZZTEST Admin Deux', role: 'admin', telephone: '8195550196' });   // administrateur avec nom ET numéro d'essai : seule la condition sur le rôle le protège
const alpha = await emp('ZZTEST Alpha', '8195550191');    // sans historique
const beta = await emp('ZZTEST Beta', '8195550192');      // un quart
const gamma = await emp('ZZTEST Gamma', '8195550193');    // chauffeur, avec tout
const delta = await emp('ZZTEST Delta', '8195550194');    // passager de Gamma
const zeta = await emp('ZZTEST Zeta', '8195550197');      // 2e chauffeur d'essai : Delta est transféré chez lui, puis l'administrateur ANNULE le transfert (la ligne d'équipage est supprimée)
const fauxNom = await emp('ZZTEST Faux', '8195550777');   // nom d'essai MAIS numéro non fictif : ne doit pas être touché
const fauxTel = await emp('Vraie Personne', '8195550195'); // numéro fictif MAIS pas de nom ZZTEST : ne doit pas être touchée
const orphelin = await compte('8195550199@tel.entretienlapointe.ca', { provider: 'email' });   // reste d'un essai raté : compte de connexion sans profil

const nord = (await sup(`select id from routes where nom = 'Route Nord'`))[0].id;
const sud = (await sup(`select id from routes where nom = 'Route Sud'`))[0].id;
const veh = async (nom) => (await sup(`insert into equipes(nom) values ($1) returning id`, [nom]))[0].id;
const camA = await veh('ZZTEST Camion A');        // véhicule d'essai utilisé par la passe d'essai de Gamma : doit disparaître
const camB = await veh('Camion B');               // VRAI véhicule utilisé par Marc : jamais touché
const camLibre = await veh('ZZTEST Camion Libre'); // véhicule d'essai que personne n'utilise : doit disparaître
const camPiege = await veh('ZZTEST Camion Piège'); // véhicule d'essai utilisé par une VRAIE passe (Marc) : doit être CONSERVÉ
const stops = (await sup(`select id from stops where route_id = $1 order by id limit 4`, [nord])).map((x) => x.id);

// Historique d'un VRAI employé (Marc) : quart + passe complète sur l'autre route/camion
await fn(marc, `quart_commencer($1::uuid, $2::timestamptz, null, null, null)`, [uuid(), at(300)]);
await sup(`insert into stops(adresse, route_id) values ('Adresse Sud 1', $1)`, [sud]);   // la route Sud n'a aucun arrêt de test : on en ajoute un pour que Marc ait un arrêt complété
const passeMarc = uuid();
await fn(marc, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real)`, [passeMarc, sud, camB, at(200)]);
await commeCompleter();
async function commeCompleter() {
  const stopSud = (await sup(`select id from stops where route_id = $1 limit 1`, [sud]))[0]?.id;
  if (stopSud) await fn(marc, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,'manuel',46.5::float8,-72.7::float8)`, [passeMarc, stopSud, at(190)]);
}
await fn(marc, `terminer_passe($1::uuid, $2::timestamptz)`, [passeMarc, at(100)]);
const passeMarc2 = uuid();   // une vraie passe de Marc sur le véhicule « ZZTEST Camion Piège »
await fn(marc, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real)`, [passeMarc2, sud, camPiege, at(90)]);
await fn(marc, `terminer_passe($1::uuid, $2::timestamptz)`, [passeMarc2, at(80)]);

// Historique des comptes d'essai
const quartBeta = uuid();
await fn(beta, `quart_commencer($1::uuid, $2::timestamptz, null, null, null)`, [quartBeta, at(120)]);
await fn(beta, `quart_terminer($1::uuid, $2::timestamptz, null, null, null)`, [quartBeta, at(100)]);
// Corrections faites par l'ADMINISTRATEUR pendant les essais : journalisées automatiquement (sur des lignes d'essai ET sur une ligne d'un vrai employé)
const quartMarc = (await sup(`select id from quarts where utilisateur_id = $1`, [marc]))[0].id;
await fn(marc, `quart_terminer($1::uuid, $2::timestamptz, null, null, null)`, [quartMarc, at(70)]);
await fn(joe, `admin_valider_quart($1::uuid, 'ok')`, [quartBeta]);   // ligne d'essai
await fn(joe, `admin_valider_quart($1::uuid, 'ok')`, [quartMarc]);   // ligne d'un VRAI employé : sa trace doit rester
const passeG = uuid();
await fn(gamma, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.5::float8,-72.7::float8,null::real)`, [passeG, nord, camA, at(60)]);
await fn(gamma, `completer_arret($1::uuid,$2::uuid,$3::timestamptz,'manuel',46.5::float8,-72.7::float8)`, [passeG, stops[0], at(50)]);
await fn(gamma, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,null,null,false)`, [uuid(), passeG, delta, at(40)]);
const passeZ = uuid();
await fn(zeta, `debuter_passe($1::uuid,$2::uuid,$3::uuid,'[]'::jsonb,$4::timestamptz,46.6::float8,-72.8::float8,null::real)`, [passeZ, nord, camLibre, at(35)]);
await fn(zeta, `equipage_ajouter($1::uuid,$2::uuid,$3::uuid,$4::timestamptz,null,null,null,true)`, [uuid(), passeZ, delta, at(30)]);   // transfert de la passe de Gamma vers celle de Zeta
const transfert = (await sup(`select transfert_id from equipage_periodes where utilisateur_id = $1 and transfert_id is not null limit 1`, [delta]))[0].transfert_id;
await fn(joe, `admin_annuler_transfert($1::uuid)`, [transfert]);   // SUPPRIME la période d'entrée chez Zeta : journalisé, et la ligne n'existera plus au moment du nettoyage
// Une trace du journal qui concerne un VRAI employé (Marc) : doit rester
await sup(`insert into journal_modifications(auteur_id, table_cible, ligne_id, action, avant) values ($1, 'equipage_periodes', $2, 'DELETE', $3::jsonb)`,
  [joe, uuid(), JSON.stringify({ utilisateur_id: marc, passe_id: passeMarc })]);
await fn(gamma, `envoyer_position($1::uuid, 46.51::float8, -72.71::float8, 5::real, $2::timestamptz)`, [passeG, at(1)]);
await sup(`insert into problemes(stop_id, passe_id, utilisateur_id, note) values ($1, $2, $3, 'chien')`, [stops[1], passeG, delta]);
await sup(`insert into problemes(stop_id, utilisateur_id, note) values ($1, $2, 'barrière')`, [stops[2], gamma]);   // problème sans passe

const avant = await photo();
log('=== AVANT LE NETTOYAGE ===');
eq('les comptes d\'essai ont bien de l\'historique (quarts, passes, arrêts, équipage, problèmes, positions)',
  [avant.quarts >= 4, avant.passes, avant.passe_arrets >= 1, avant.periodes >= 2, avant.problemes, avant.positions >= 1], [true, 4, true, true, 2, true]);
eq('les corrections de l\'administrateur ont été journalisées automatiquement (une sur un quart d\'essai, une sur le quart d\'un vrai employé)',
  [await nb('journal_modifications', `ligne_id = '${quartBeta}'`) >= 1, await nb('journal_modifications', `ligne_id = '${quartMarc}'`) >= 1], [true, true]);
eq('une correction de l\'administrateur a SUPPRIMÉ une ligne d\'équipage d\'essai (Delta) : sa trace existe, mais la ligne, elle, n\'existe plus',
  [await nb('journal_modifications', `action = 'DELETE' and avant ->> 'utilisateur_id' = '${delta}'`) >= 1, await nb('equipage_periodes', `utilisateur_id = '${delta}' and passe_id = '${passeZ}'`)], [true, 0]);
eq('… et un compte de connexion orphelin existe', (await sup('select count(*)::int n from auth.users where id = $1', [orphelin]))[0].n, 1);

// ----- Le garde-fou : données mélangées -----
log('\n=== GARDE-FOU : données de vrais comptes mêlées aux comptes d\'essai ===');
{
  await sup(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut, fin) values ($1, $2, 'passager', $3, $4)`, [passeG, marc, at(45), at(44)]);
  await echoue('un VRAI employé (Marc) dans la passe d\'un compte d\'essai : REFUSÉ', () => db.exec(NETTOYAGE), 'refuse');
  eq('… rien n\'a été supprimé (état identique)', await photo(), { ...avant, periodes: avant.periodes + 1 });
  await sup(`delete from equipage_periodes where utilisateur_id = $1 and passe_id = $2`, [marc, passeG]);
  await sup(`insert into equipage_periodes(passe_id, utilisateur_id, role, debut, fin) values ($1, $2, 'passager', $3, $4)`, [passeMarc, alpha, at(150), at(149)]);
  await echoue('un compte d\'essai dans la passe d\'un VRAI chauffeur : REFUSÉ', () => db.exec(NETTOYAGE), 'refuse');
  await sup(`delete from equipage_periodes where utilisateur_id = $1 and passe_id = $2`, [alpha, passeMarc]);
  eq('… après avoir retiré ces lignes mêlées, la photo est revenue à l\'état de départ', await photo(), avant);
}

// ----- Le nettoyage -----
log('\n=== NETTOYAGE ===');
const verif = await nettoyer();
const apres = await photo();
eq('vérification : restent seulement les 4 cas voulus (2 administrateurs « ZZTEST », « ZZTEST Faux » au numéro non fictif, « Vraie Personne » au numéro fictif)', verif.comptes_zztest_restants, 4);
eq('les comptes d\'essai reconnus sont supprimés (Alpha, Beta, Gamma, Delta)', (await sup(`select count(*)::int n from auth.users where id = any($1::uuid[])`, [[alpha, beta, gamma, delta]]))[0].n, 0);
eq('… leurs profils aussi', await nb('utilisateurs', `id in ('${alpha}','${beta}','${gamma}','${delta}')`), 0);
eq('le compte de connexion ORPHELIN (numéro fictif, sans profil) est supprimé', (await sup('select count(*)::int n from auth.users where id = $1', [orphelin]))[0].n, 0);
eq('tout ce que les comptes d\'essai avaient produit a disparu : passe de Gamma, arrêts, problèmes, positions, équipage, journal', [
  await nb('passes', `id = '${passeG}'`), await nb('passe_arrets', `passe_id = '${passeG}'`), await nb('problemes'), await nb('positions'), await nb('equipage_periodes', `passe_id = '${passeG}'`), await nb('equipage_journal')], [0, 0, 0, 0, 0, 0]);
eq('le quart de Beta est supprimé (il ne reste que celui de Marc)', await nb('quarts'), 1);
eq('la trace des corrections de l\'administrateur sur le quart de Beta est supprimée avec lui, mais celle du quart de Marc (vrai employé) reste',
  [await nb('journal_modifications', `ligne_id = '${quartBeta}'`), await nb('journal_modifications', `ligne_id = '${quartMarc}'`) >= 1], [0, true]);
eq('la trace de la ligne d\'équipage SUPPRIMÉE (qui n\'existait plus au moment du nettoyage) est supprimée aussi ; la trace concernant un vrai employé reste',
  [await nb('journal_modifications', `avant ->> 'utilisateur_id' = '${delta}'`), await nb('journal_modifications', `avant ->> 'utilisateur_id' = '${marc}'`)], [0, 2]);   // Marc : la trace de la validation de son quart + celle ajoutée à la main
eq('… la vérification annonce les corrections restantes', verif.corrections_journalisees, apres.corrections);

log('\n=== CE QUI NE DOIT PAS ÊTRE TOUCHÉ ===');
eq('Joé (administrateur) : intact', (await sup('select role, actif from public.utilisateurs where id = $1', [joe]))[0], { role: 'admin', actif: true });
eq('« ZZTEST Admin » : compte administrateur, jamais touché même avec un nom d\'essai', await nb('utilisateurs', `id = '${zzAdmin}'`), 1);
eq('un administrateur avec nom ET numéro d\'essai : jamais touché (le rôle protège)', await nb('utilisateurs', `id = '${zzAdminTel}' and role = 'admin'`), 1);
eq('Marc (vrai employé) : profil, quart, passe et arrêt complétés intacts', [await nb('utilisateurs', `id = '${marc}'`), await nb('quarts', `utilisateur_id = '${marc}'`), await nb('passes', `id = '${passeMarc}'`), await nb('passe_arrets', `passe_id = '${passeMarc}'`)], [1, 1, 1, 1]);
eq('nom « ZZTEST » mais numéro non fictif : pas touché', await nb('utilisateurs', `id = '${fauxNom}'`), 1);
eq('numéro fictif mais nom normal : pas touchée', await nb('utilisateurs', `id = '${fauxTel}'`), 1);
eq('arrêts et routes de test : intacts', [apres.stops, apres.routes], [avant.stops, avant.routes]);
eq('véhicules : « ZZTEST Camion A » (passe d\'essai) et « ZZTEST Camion Libre » (inutilisé) supprimés ; le VRAI « Camion B » et « ZZTEST Camion Piège » (utilisé par une vraie passe de Marc) conservés',
  (await sup('select nom from public.equipes order by nom')).map((e) => e.nom), ['Camion B', 'ZZTEST Camion Piège']);
eq('… la vérification annonce 1 véhicule d\'essai restant (le piège) sur 2 véhicules', [verif.vehicules_zztest_restants, verif.vehicules], [1, 2]);
eq('profils supprimés : 5 (Alpha, Beta, Gamma, Delta, Zeta) ; comptes de connexion supprimés : 6 (ces 5 + l\'orphelin)', [avant.auth - apres.auth, avant.comptes_auth - apres.comptes_auth], [5, 6]);

log('\n=== RÉ-EXÉCUTION ===');
const v2 = await nettoyer();
eq('exécuter le nettoyage une deuxième fois : ne change plus rien', await photo(), apres);
eq('… et la vérification est identique', v2, verif);

// Base sans aucun compte d'essai
const db2 = await prepare(FILES);
await db2.query(`insert into auth.users(email, raw_app_meta_data) values ('joe@exemple.ca', '{"nom":"Joé","role":"admin"}'::jsonb)`);
const r2 = await db2.exec(NETTOYAGE);
eq('sur une base sans aucun compte d\'essai : aucun effet, aucune erreur', [r2[r2.length - 1].rows[0].verification.comptes_zztest_restants, r2[r2.length - 1].rows[0].verification.administrateurs], [0, 1]);

// ----- Fichier 11 : suppression ciblée d'UNE trace du journal -----
log('\n=== FICHIER 11 : une trace précise du journal ===');
{
  const SQL11 = fs.readFileSync(SQL_DIR + '11-nettoyage-une-trace-de-journal.sql', 'utf8');
  const ID_REEL = '7cea81e6-8098-459c-af41-b5bfcc3e9290';
  const cible = uuid(), autre = uuid();
  const pour = (id) => SQL11.replaceAll(ID_REEL, id);
  const q2 = async (sql, p) => (await db2.query(sql, p)).rows;
  const joe2 = (await q2(`select id from public.utilisateurs limit 1`))[0].id;
  const trace = (id, table, action, avant) => q2(`insert into public.journal_modifications(id, table_cible, ligne_id, action, avant) values ($1, $2, gen_random_uuid(), $3, $4::jsonb)`, [id, table, action, JSON.stringify(avant)]);
  const compte11 = async () => Number((await q2(`select count(*)::int n from public.journal_modifications`))[0].n);
  vrai11('le fichier 11 vise exactement l\'identifiant de la trace restante (2 occurrences : suppression et vérification)', SQL11.split(ID_REEL).length === 3);
  await trace(autre, 'quarts', 'UPDATE', { utilisateur_id: joe2 });          // une autre trace, sans rapport : ne doit JAMAIS bouger

  await trace(cible, 'equipage_periodes', 'DELETE', { utilisateur_id: joe2, passe_id: uuid() });   // décrit un employé qui EXISTE encore
  await echoue('trace qui décrit un employé existant : REFUSÉ', () => db2.exec(pour(cible)), 'refuse');
  eq('… rien n\'a été supprimé', await compte11(), 2);
  await q2(`delete from public.journal_modifications where id = $1`, [cible]);

  await trace(cible, 'quarts', 'DELETE', { utilisateur_id: uuid(), passe_id: uuid() });           // mauvaise table
  await echoue('trace d\'une autre table que l\'équipage : REFUSÉ', () => db2.exec(pour(cible)), 'refuse');
  await q2(`delete from public.journal_modifications where id = $1`, [cible]);

  await trace(cible, 'equipage_periodes', 'DELETE', { utilisateur_id: uuid(), passe_id: uuid() });   // la situation réelle : tout ce qu'elle décrit a disparu
  const r11 = await db2.exec(pour(cible));
  const v11 = r11[r11.length - 1].rows[0].verification;
  eq('trace orpheline (employé, passe et ligne disparus) : supprimée', [await compte11(), v11.trace_encore_presente], [1, false]);
  eq('… l\'autre trace, sans rapport, est intacte', Number((await q2(`select count(*)::int n from public.journal_modifications where id = $1`, [autre]))[0].n), 1);
  await db2.exec(pour(cible));
  eq('ré-exécuter quand la trace n\'existe plus : aucun effet, aucune erreur', await compte11(), 1);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
function vrai11(l, c, d) { c ? pass(l) : fail(l, d); }
