// Demande 2 de Joé (29 sept. 2026) — Fichier SQL 27 : une ICÔNE par type de service (types_service.icone), choisie par l'administrateur.
// Banc d'essai local (base PGlite), sur le modèle de test-etape-19.mjs. Ce que ce test NE peut PAS vérifier : le vrai Supabase (à exécuter par Joé, comme les fichiers SQL
// précédents). La banque d'icônes elle-même et l'écran de choix sont testés par test-app-icones-taches.mjs.
// SQL27_TEST (variable d'environnement) : une COPIE abîmée du fichier, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
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
const SQL27 = fs.readFileSync(process.env.SQL27_TEST || (SQL_DIR + '27-icones-des-taches.sql'), 'utf8');

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
const colonne = () => q(`select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'types_service' and column_name = 'icone'`);
const NOMS_DEPART = ['Autre', 'Coupe de gazon', 'Déneigement manuel', 'Déneigement mécanique', 'Engrais', 'Entretien paysager', 'Ramassage de feuilles', 'Épandage de sel'];

log('=== AVANT LE FICHIER : LA COLONNE N\'EXISTE PAS ; APRÈS : ELLE EST LÀ, VIDE, ET RIEN D\'AUTRE NE CHANGE ===');
{
  eq('avant : pas de colonne « icone » dans types_service', (await colonne()).length, 0);
  const avant = (await q(`select nom, actif from types_service order by nom`)).map((x) => [x.nom, x.actif]);
  await db.exec(SQL27);
  eq('après : la colonne existe, de type texte, VIDE permise', (await colonne()).map((x) => [x.data_type, x.is_nullable]), [['text', 'YES']]);
  eq('… les 8 types de départ sont toujours là, avec le même « actif » : rien n\'a été touché', (await q(`select nom, actif from types_service order by nom`)).map((x) => [x.nom, x.actif]), avant);
  eq('… et AUCUNE icône n\'est choisie au départ (l\'application déduit l\'icône du nom)', (await q(`select count(*)::int n from types_service where icone is not null`))[0].n, 0);
}

log('\n=== ON PEUT L\'EXÉCUTER PLUSIEURS FOIS : UNE ICÔNE DÉJÀ CHOISIE N\'EST JAMAIS EFFACÉE ===');
{
  await q(`update types_service set icone = 'tracteur' where nom = 'Déneigement mécanique'`);
  await db.exec(SQL27);
  await db.exec(SQL27);
  eq('ré-exécuter deux fois le fichier garde l\'icône choisie', (await q(`select icone from types_service where nom = 'Déneigement mécanique'`))[0].icone, 'tracteur');
  eq('… ne double pas la règle de forme', (await q(`select count(*)::int n from pg_constraint where conname = 'types_service_icone_format' and conrelid = 'public.types_service'::regclass`))[0].n, 1);
  eq('… ni les colonnes', (await colonne()).length, 1);
  await q(`update types_service set icone = null where nom = 'Déneigement mécanique'`);
}

log('\n=== LA RÈGLE DE FORME : minuscules sans accent, chiffres, tirets, 1 à 30 caractères ===');
{
  for (const cle of ['tracteur', 'zero-turn', 'feuille-erable', 'pickup-lame', 'a', 'x1-y2', '0123456789012345678901234567890'.slice(0, 30)]) {
    const r = await q(`update types_service set icone = $1 where nom = 'Autre' returning icone`, [cle]);
    eq(`la clé « ${cle} » est acceptée`, r[0].icone, cle);
  }
  await q(`update types_service set icone = null where nom = 'Autre'`);
  eq('… et VIDE (aucun choix) est accepté', (await q(`update types_service set icone = null where nom = 'Autre' returning icone`))[0].icone, null);
  for (const [libelle, cle] of [['une majuscule', 'Tracteur'], ['un accent', 'zéro-turn'], ['une espace', 'zero turn'], ['un souligné', 'zero_turn'], ['un texte vide', ''],
    ['31 caractères', 'x'.repeat(31)], ['un point-virgule', 'a;b'], ['une apostrophe', 'a\'b'], ['du code HTML', '<img>'], ['des guillemets', '"a"']]) {
    await err(`${libelle} est REFUSÉ (« ${cle.length > 12 ? cle.slice(0, 12) + '…' : cle} »)`, () => q(`update types_service set icone = $1 where nom = 'Autre'`, [cle]), 'types_service_icone_format');
  }
  eq('… et rien n\'est resté d\'un essai refusé', (await q(`select icone from types_service where nom = 'Autre'`))[0].icone, null);
}

log('\n=== ACCÈS : L\'ADMINISTRATEUR CHOISIT ; TOUT EMPLOYÉ ACTIF LIT ; LES TYPES DÉSACTIVÉS RESTENT CACHÉS ===');
{
  eq('l\'administrateur peut choisir l\'icône d\'un type', (await sqlAs(admin, `update types_service set icone = 'zero-turn' where nom = 'Coupe de gazon' returning icone`))[0].icone, 'zero-turn');
  eq('… la changer', (await sqlAs(admin, `update types_service set icone = 'tondeuse' where nom = 'Coupe de gazon' returning icone`))[0].icone, 'tondeuse');
  eq('… et revenir à « par défaut » (vide)', (await sqlAs(admin, `update types_service set icone = null where nom = 'Coupe de gazon' returning icone`))[0].icone, null);
  await sqlAs(admin, `update types_service set icone = 'camion-benne' where nom = 'Épandage de sel'`);
  eq('un employé ne peut PAS choisir une icône (aucune ligne modifiée)', [(await sqlAs(nina, `update types_service set icone = 'pelle' where nom = 'Épandage de sel' returning icone`)).length, (await q(`select icone from types_service where nom = 'Épandage de sel'`))[0].icone], [0, 'camion-benne']);
  eq('… ni l\'effacer', [(await sqlAs(nina, `update types_service set icone = null where nom = 'Épandage de sel' returning icone`)).length, (await q(`select icone from types_service where nom = 'Épandage de sel'`))[0].icone], [0, 'camion-benne']);
  eq('un employé LIT les icônes des types actifs (la carte les lui montre aussi)', (await sqlAs(nina, `select nom, icone from types_service where icone is not null order by nom`)).map((x) => [x.nom, x.icone]), [['Épandage de sel', 'camion-benne']]);
  await sqlAs(admin, `update types_service set actif = false where nom = 'Épandage de sel'`);
  eq('un type DÉSACTIVÉ (avec son icône) reste caché à l\'employé : la carte déduira alors l\'icône du nom', (await sqlAs(nina, `select nom from types_service where icone is not null`)).length, 0);
  eq('… mais l\'administrateur le voit, avec son icône', (await sqlAs(admin, `select icone from types_service where nom = 'Épandage de sel'`))[0].icone, 'camion-benne');
  await sqlAs(admin, `update types_service set actif = true where nom = 'Épandage de sel'`);
  eq('un visiteur (non connecté) ne peut toujours rien lire', (await q(`select has_table_privilege('anon', 'public.types_service', 'select') as r`))[0].r, false);
}

log('\n=== RENOMMER OU DÉSACTIVER UN TYPE GARDE SON ICÔNE ; stops.service RESTE UN SIMPLE TEXTE ===');
{
  await sqlAs(admin, `update types_service set nom = 'Sel (renommé)' where nom = 'Épandage de sel'`);
  eq('renommer un type garde l\'icône choisie', (await q(`select icone from types_service where nom = 'Sel (renommé)'`))[0].icone, 'camion-benne');
  await sqlAs(admin, `update types_service set nom = 'Épandage de sel' where nom = 'Sel (renommé)'`);
  await sqlAs(admin, `update types_service set actif = false where nom = 'Épandage de sel'`);
  await sqlAs(admin, `update types_service set actif = true where nom = 'Épandage de sel'`);
  eq('désactiver puis réactiver la garde aussi', (await q(`select icone from types_service where nom = 'Épandage de sel'`))[0].icone, 'camion-benne');
  const stopId = (await q(`select id from stops limit 1`))[0].id;
  await q(`update stops set service = 'Épandage de sel' where id = $1`, [stopId]);
  await sqlAs(admin, `update types_service set icone = 'pickup-lame' where nom = 'Épandage de sel'`);
  eq('choisir une icône ne touche pas les arrêts déjà créés (stops.service reste un texte)', (await q(`select service from stops where id = $1`, [stopId]))[0].service, 'Épandage de sel');
  eq('… ni la liste des types', (await q(`select nom from types_service order by nom`)).map((x) => x.nom), NOMS_DEPART);
}

log('\n=== SANS LE FICHIER 23 (la table types_service) : REFUSÉ, RIEN N\'EST MODIFIÉ ===');
{
  const vierge = await prepare(FILES);
  let refuse = false, message = '';
  try { await vierge.exec(SQL27); } catch (e) { refuse = /types_service n'existe pas/.test(e.message); message = e.message; }
  vrai('le fichier refuse de s\'exécuter et dit qu\'il manque le fichier 23', refuse, message);
  eq('… et n\'a créé aucune table types_service', (await vierge.query(`select to_regclass('public.types_service') is not null as r`)).rows[0].r, false);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
