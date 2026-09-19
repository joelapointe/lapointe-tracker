// Fichier 14 (étape 13d) — retrait de la colonne stops.fait : ce qu'il fait, ce qu'il refuse, et ce qu'il ne touche jamais.
import { fileURLToPath } from 'url';
import { prepare } from './prepare.mjs';
import fs from 'fs';

const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
async function echoue(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 100)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
// Toutes les étapes qui créent des fonctions, des déclencheurs et des règles : le contrôle « fonction qui utilise encore fait » ne doit trouver AUCUN faux positif
const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql', '05-etape9b-passes-fermetures-export.sql',
  '06-etape10-outils-admin-employes.sql', '07-etape11-profil-sans-telephone.sql', '09-etape11-profil-employe-par-le-serveur.sql', '13-etape13-taches-et-tours-partages.sql'];
const SQL14 = fs.readFileSync(SQL_DIR + '14-etape13d-retrait-stops-fait.sql', 'utf8');
const colonnes = async (db) => (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'stops' order by ordinal_position`)).rows.map((r) => r.column_name);
const lancer = async (db) => { const r = await db.exec(SQL14); return r[r.length - 1].rows[0].verification; };
async function tenter(db) { try { await db.exec(SQL14); return null; } catch (e) { await db.exec('rollback').catch(() => {}); return e; } }

log('=== CAS NORMAL : la colonne disparaît, tout le reste est intact ===');
{
  const db = await prepare(FILES);
  await db.query(`update stops set client = 'Client ' || ordre, service = 'Épandage de sel' where ordre % 2 = 0`);
  const avant = (await db.query(`select id, adresse, client, service, lat, lon, ordre, route_id, zone_points, actif, created_at from stops order by id`)).rows;
  const colsAvant = await colonnes(db);
  const nFait = (await db.query(`select count(*)::int n from stops where fait`)).rows[0].n;
  vrai('départ : la colonne fait existe, et certains arrêts sont « faits » (anciennes valeurs)', colsAvant.includes('fait') && nFait > 0, `fait=${colsAvant.includes('fait')} nFait=${nFait}`);
  const v = await lancer(db);
  eq('résultat : colonne supprimée', v.colonne_fait_supprimee, true);
  eq('les autres colonnes sont exactement les mêmes', v.colonnes_de_stops, colsAvant.filter((c) => c !== 'fait'));
  const apres = (await db.query(`select id, adresse, client, service, lat, lon, ordre, route_id, zone_points, actif, created_at from stops order by id`)).rows;
  eq('aucun arrêt perdu ni modifié (adresse, client, service, coordonnées, route, zone, ordre, actif)', JSON.stringify(apres), JSON.stringify(avant));
  eq('le compte d\'arrêts est le même (13 avant, 13 après)', [avant.length, v.arrets, v.arrets_actifs], [13, 13, 13]);
  eq('le déclencheur de recalcul des passes est toujours là', v.declencheur_recalcul_arrets, 1);
  eq('aucune fonction ouverte à un visiteur', v.fonctions_appelables_par_un_visiteur, []);
  await echoue('ré-exécuter : REFUSÉ (déjà exécuté)', () => db.exec(SQL14), 'déjà été exécuté');
  eq('… et rien n\'a changé', (await colonnes(db)).length, colsAvant.length - 1);

  // L'application et les fonctions du serveur continuent de marcher sans la colonne
  const r = (await db.query(`insert into stops(adresse, route_id, service, lat, lon, ordre) values ('Nouvel arrêt', (select id from routes limit 1), 'Épandage de sel', 46.5, -72.7, 99) returning id`)).rows;
  eq('ajouter un arrêt SANS « fait » (comme le fait l\'application) : accepté', r.length, 1);
  await echoue('ajouter un arrêt AVEC « fait » : refusé (la colonne n\'existe plus)', () => db.query(`insert into stops(adresse, fait) values ('x', true)`), 'fait');
  await echoue('l\'ancien nettoyage « update stops set fait » est refusé aussi', () => db.query(`update stops set fait = false`), 'fait');
  const t = (await db.query(`select public._recalculer_passe(gen_random_uuid(), now()) as r`)).rows[0].r;
  eq('les fonctions internes du serveur tournent (recalcul d\'une passe inconnue : rien)', t, null);
}

log('\n=== PROTECTIONS : il refuse, et ne change RIEN, si quelque chose s\'en sert encore ===');
{
  let db = await prepare(FILES);
  await db.exec(`create function public.vieux_calcul() returns integer language sql as $$ select count(*)::int from public.stops s where s.fait $$;`);
  await echoue('une fonction qui lit encore « s.fait » : REFUSÉ, elle est nommée', () => db.exec(SQL14), 'vieux_calcul');
  eq('… la colonne est toujours là', (await colonnes(db)).includes('fait'), true);

  db = await prepare(FILES);
  await db.exec(`create function public.vieux_marquage() returns void language plpgsql as $$ begin update public.stops set fait = false; end $$;`);
  await echoue('une fonction qui écrit encore « set fait » : REFUSÉ', () => db.exec(SQL14), 'vieux_marquage');

  db = await prepare(FILES);
  await db.exec(`create function public.trg_vide() returns trigger language plpgsql as $$ begin return new; end $$; create trigger vieux_declencheur before update of fait on public.stops for each row execute function public.trg_vide();`);
  await echoue('un déclencheur « update of fait » : REFUSÉ, il est nommé', () => db.exec(SQL14), 'vieux_declencheur');
  eq('… la colonne est toujours là', (await colonnes(db)).includes('fait'), true);

  db = await prepare(FILES);
  await db.exec(`create view public.arrets_faits as select id, fait from public.stops;`);
  let e = await tenter(db);
  vrai('une vue qui en dépend : la base REFUSE (pas de « cascade »)', e && /depend|dépend/i.test(e.message), e?.message);
  eq('… la colonne ET la vue sont toujours là', [(await colonnes(db)).includes('fait'), (await db.query(`select count(*)::int n from public.arrets_faits`)).rows[0].n], [true, 13]);

  db = await prepare(FILES);
  await db.exec(`create policy vieille_regle on public.stops for select to authenticated using (fait or true);`);
  e = await tenter(db);
  vrai('une règle d\'accès qui en dépend : la base REFUSE', e && /depend|dépend/i.test(e.message), e?.message);
  eq('… la colonne est toujours là', (await colonnes(db)).includes('fait'), true);

  db = await prepare(FILES);
  await db.exec(`create index vieux_index on public.stops (fait);`);
  await db.exec(SQL14);
  eq('un simple index sur la colonne tombe avec elle (aucun risque) : la colonne est supprimée', (await colonnes(db)).includes('fait'), false);
}

log('\n=== LE FICHIER LUI-MÊME ===');
{
  vrai('aucune « cascade » (ce serait supprimer autre chose sans le dire)', !/cascade/i.test(SQL14.replace(/--.*$/gm, '')));
  vrai('une seule suppression : stops.fait', (SQL14.match(/drop\s+/gi) || []).length === 1 && /alter table public\.stops drop column fait;/.test(SQL14));
  vrai('aucune clé secrète ni mot de passe', !/service_role|password|eyJ[A-Za-z0-9_-]{20,}/i.test(SQL14));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
