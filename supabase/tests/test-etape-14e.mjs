// Fichier 16 (étape 14e) — UNE PHOTO PAR PROBLÈME : espace privé, règles d'accès, fonction probleme_attacher_photo.
// Banc d'essai local (base PGlite, avec un Storage imité) : le vrai Supabase sera essayé par reel-etape-14e.mjs.
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
  '16-etape14e-photo-probleme.sql'];
const SQL16 = fs.readFileSync(SQL_DIR + FILES[8], 'utf8');
const B = 'photos-problemes';

const db = await prepare(FILES);
const q = async (sql, p) => (await db.query(sql, p)).rows;
// Exécute du SQL « comme » quelqu'un : un employé connecté (uid), ou le visiteur (role = 'anon')
async function comme(uid, sql, params = [], role = 'authenticated') {
  await db.query('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [uid || '']);
  await db.query(`set role ${role}`);
  try { return (await db.query(sql, params)).rows; } finally { await db.query('reset role'); }
}
const fn = async (uid, call, params = [], role = 'authenticated') => (await comme(uid, `select public.${call} as r`, params, role))[0].r;
async function err(l, f, motif) {
  try { await f(); fail(l, 'aurait dû échouer'); }
  catch (e) { e.message.includes(motif) ? pass(l + `  [${e.message.split('\n')[0].slice(0, 80)}]`) : fail(l, 'autre erreur : ' + e.message); }
}
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
let tel = 8199000000;
const emp = (nom) => ins(nom + uuid().slice(0, 4) + '@t.ca', { nom, telephone: String(++tel) });

const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const luc = await emp('Luc'), marc = await emp('Marc'), zoe = await emp('Zoe');
await q(`update utilisateurs set actif = false where id = $1`, [zoe]);
const route = (await q(`insert into routes(nom) values ('T14e') returning id`))[0].id;
const stop = (await q(`insert into stops(adresse, route_id, service, lat, lon) values ('1 rue Test', $1, 'Déneigement mécanique', 46.5, -72.7) returning id`, [route]))[0].id;
const probleme = async (uid, note = 'entrée bloquée') => { const id = uuid(); await comme(uid, `insert into public.problemes(id, stop_id, note) values ($1,$2,$3)`, [id, stop, note]); return id; };
const televerser = (uid, chemin, bucket = B) => comme(uid, `insert into storage.objects(bucket_id, name) values ($1,$2)`, [bucket, chemin]);
const objets = async (uid, role = 'authenticated') => (await comme(uid, `select name from storage.objects where bucket_id = $1 order by name`, [B], role)).map((x) => x.name);
const nb = async (sql, p) => Number((await q(sql, p))[0].n);
const chemin = (uid, pid) => `${uid}/${pid}.jpg`;

log('=== LE FICHIER LUI-MÊME ===');
{
  const av = [await nb(`select count(*)::int n from problemes`), await nb(`select count(*)::int n from utilisateurs`)];
  await db.exec(SQL16);
  eq('ré-exécuter le fichier : accepté, rien n\'est modifié', [await nb(`select count(*)::int n from problemes`), await nb(`select count(*)::int n from utilisateurs`)], av);
  const b = (await q(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1`, [B]))[0];
  eq('l\'espace « photos-problemes » est PRIVÉ, 2 Mo au maximum, JPEG seulement', [b.public, Number(b.file_size_limit), b.allowed_mime_types], [false, 2097152, ['image/jpeg']]);
  eq('une seule colonne photo_chemin, nullable', (await q(`select is_nullable from information_schema.columns where table_name = 'problemes' and column_name = 'photo_chemin'`)).map((x) => x.is_nullable), ['YES']);
  eq('trois règles sur les photos (ajout, lecture, suppression), aucune de modification', (await q(`select policyname, cmd from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'photos_problemes_%' order by policyname`)).map((x) => [x.policyname, x.cmd]),
    [['photos_problemes_ajout', 'INSERT'], ['photos_problemes_lecture', 'SELECT'], ['photos_problemes_suppression', 'DELETE']]);
  eq('ré-exécuté : toujours trois règles (aucune en double)', await nb(`select count(*)::int n from pg_policies where schemaname = 'storage' and policyname like 'photos_problemes_%'`), 3);
  await err('un visiteur ne peut pas appeler la fonction', () => fn(null, `probleme_attacher_photo($1::uuid)`, [uuid()], 'anon'), 'permission denied');
  eq('aucune fonction ouverte au visiteur', await nb(`select count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and has_function_privilege('anon', oid, 'execute')`), 0);
  const sansCommentaires = SQL16.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  vrai('le fichier ne supprime rien (ni delete from, ni drop table/column/schema, ni truncate)', !/\b(delete\s+from|drop\s+(table|column|schema|function)|truncate)\b/i.test(sansCommentaires));
  vrai('aucune clé secrète ni mot de passe', !/service_role|sb_secret|password/i.test(SQL16));
  const verif = (await q(SQL16.slice(SQL16.indexOf('select jsonb_build_object(', SQL16.lastIndexOf('-- VÉRIFICATION'))).replace(/;\s*$/, '')))[0].verification;
  eq('la requête « vérification » du bas : privé, colonne, 3 règles, visiteur refusé, employé permis',
    [verif.espace_photos.prive, verif.colonne_photo_chemin, verif.regles_sur_les_photos, verif.fonction_visiteur_peut_appeler, verif.fonction_employe_peut_appeler, verif.fonctions_appelables_par_un_visiteur],
    [true, true, ['photos_problemes_ajout', 'photos_problemes_lecture', 'photos_problemes_suppression'], false, true, []]);
}
{
  const sansStorage = await prepare(FILES.slice(0, 8));
  await sansStorage.exec('drop schema storage cascade');
  await err('sans le stockage de fichiers de Supabase : REFUSÉ, avec un message clair', () => sansStorage.exec(SQL16), 'Storage');
}

log('\n=== LA COLONNE : le chemin est imposé, l\'employé ne l\'écrit pas ===');
const P1 = await probleme(luc), PM = await probleme(marc, 'chien méchant');
{
  await err('un employé ne peut pas écrire photo_chemin en signalant (pas de droit sur cette colonne)', () => comme(luc, `insert into public.problemes(id, stop_id, note, photo_chemin) values ($1,$2,'x',$3)`, [uuid(), stop, 'a/b.jpg']), 'permission denied');
  await err('… ni la modifier après coup', () => comme(luc, `update public.problemes set photo_chemin = $2 where id = $1`, [P1, chemin(luc, P1)]), 'permission denied');
  await err('un chemin qui n\'est pas « numéro-employé/numéro-problème.jpg » est refusé par la base (même pour l\'administrateur)', () => q(`update problemes set photo_chemin = 'autre/chemin.jpg' where id = $1`, [P1]), 'problemes_photo_chemin_coherent');
  await err('… même le chemin de la photo d\'un AUTRE employé', () => q(`update problemes set photo_chemin = $2 where id = $1`, [P1, chemin(marc, P1)]), 'problemes_photo_chemin_coherent');
  eq('les problèmes déjà là n\'ont pas de photo', await nb(`select count(*)::int n from problemes where photo_chemin is not null`), 0);
}

log('\n=== ENVOYER UNE PHOTO : seulement dans SON dossier, pour SON problème, au chemin exact ===');
{
  await televerser(luc, chemin(luc, P1));
  pass('Luc envoie la photo de SON problème : acceptée');
  await err('la même photo une 2e fois : refusée (pas de remplacement)', () => televerser(luc, chemin(luc, P1)), 'duplicate');
  await err('Luc envoie une photo pour le problème de MARC (dans son dossier) : refusé', () => televerser(luc, chemin(luc, PM)), 'row-level security');
  await err('Luc envoie dans le dossier de MARC : refusé', () => televerser(luc, chemin(marc, P1)), 'row-level security');
  await err('Marc envoie dans le dossier de Luc : refusé', () => televerser(marc, chemin(luc, P1)), 'row-level security');
  const P2 = await probleme(luc, 'deuxième');
  for (const [nom, c] of [['un mauvais format (.png)', `${luc}/${P2}.png`], ['un nom quelconque', `${luc}/photo.jpg`], ['sans dossier', `${P2}.jpg`], ['un sous-dossier de plus', `${luc}/x/${P2}.jpg`], ['un problème qui n\'existe pas', chemin(luc, uuid())], ['des majuscules', `${luc}/${P2.toUpperCase()}.jpg`]]) {
    await err(`${nom} : refusé`, () => televerser(luc, c), 'row-level security');
  }
  await err('un AUTRE espace de stockage : les règles des photos ne s\'y appliquent pas (refusé)', async () => { await q(`insert into storage.buckets(id, name) values ('autre', 'autre')`); await televerser(luc, chemin(luc, P2), 'autre'); }, 'row-level security');
  await err('un employé DÉSACTIVÉ ne peut rien envoyer', async () => { const pz = uuid(); await q(`insert into problemes(id, stop_id, utilisateur_id, note) values ($1,$2,$3,'z')`, [pz, stop, zoe]); await televerser(zoe, chemin(zoe, pz)); }, 'row-level security');
  await err('le visiteur : refusé (rôle anon)', () => comme(null, `insert into storage.objects(bucket_id, name) values ($1,$2)`, [B, chemin(luc, P2)], 'anon'), 'row-level security');
  eq('une seule photo est arrivée dans l\'espace privé', await nb(`select count(*)::int n from storage.objects where bucket_id = $1`, [B]), 1);
}

log('\n=== LA FONCTION : relier la photo au problème ===');
{
  eq('avant d\'être reliée, la photo est INVISIBLE pour tout le monde, même son auteur', [(await objets(luc)).length, (await objets(marc)).length, (await objets(admin)).length], [0, 0, 0]);
  let r = await fn(luc, `probleme_attacher_photo($1::uuid)`, [P1]);
  eq('Luc relie la photo à SON problème', [r.statut, r.chemin], ['attachee', chemin(luc, P1)]);
  eq('… la colonne photo_chemin est remplie', (await q(`select photo_chemin from problemes where id = $1`, [P1]))[0].photo_chemin, chemin(luc, P1));
  r = await fn(luc, `probleme_attacher_photo($1::uuid)`, [P1]);
  eq('geste renvoyé : « déjà reliée », rien n\'est refait', [r.statut, r.chemin], ['deja_attachee', chemin(luc, P1)]);
  await err('Marc ne peut pas relier une photo au problème de Luc', () => fn(marc, `probleme_attacher_photo($1::uuid)`, [P1]), 'non_autorise');
  await err('un problème qui n\'existe pas', () => fn(luc, `probleme_attacher_photo($1::uuid)`, [uuid()]), 'probleme_introuvable');
  await err('un problème à soi dont la photo n\'est PAS arrivée : refusé (jamais un lien vers rien)', () => fn(marc, `probleme_attacher_photo($1::uuid)`, [PM]), 'photo_introuvable');
  await err('un employé désactivé ne peut pas appeler la fonction', () => fn(zoe, `probleme_attacher_photo($1::uuid)`, [P1]), 'non_autorise');
  eq('aucun problème n\'a reçu de photo par erreur (un seul est relié)', await nb(`select count(*)::int n from problemes where photo_chemin is not null`), 1);
}

log('\n=== PERSONNE NE PEUT REMPLACER NI EFFACER UNE PHOTO (sauf l\'administrateur, qui peut l\'effacer) ===');
{
  const modifie = await comme(luc, `with x as (update storage.objects set name = name || 'x' where bucket_id = $1 returning 1) select count(*)::int n from x`, [B]);
  eq('Luc ne peut pas modifier sa propre photo (aucune ligne touchée)', modifie[0].n, 0);
  const efface = await comme(luc, `with x as (delete from storage.objects where bucket_id = $1 returning 1) select count(*)::int n from x`, [B]);
  eq('Luc ne peut pas effacer sa propre photo', efface[0].n, 0);
  const effaceM = await comme(marc, `with x as (delete from storage.objects where bucket_id = $1 returning 1) select count(*)::int n from x`, [B]);
  eq('Marc ne peut pas effacer la photo de Luc', effaceM[0].n, 0);
  eq('la photo est toujours là', await nb(`select count(*)::int n from storage.objects where bucket_id = $1`, [B]), 1);
}

log('\n=== QUI VOIT LA PHOTO : comme le problème auquel elle est reliée ===');
{
  eq('problème non lu : Luc (auteur), Marc (autre employé actif) et l\'administrateur la voient', [await objets(luc), await objets(marc), await objets(admin)], [[chemin(luc, P1)], [chemin(luc, P1)], [chemin(luc, P1)]]);
  eq('l\'employé désactivé ne la voit pas', await objets(zoe), []);
  eq('le VISITEUR ne la voit pas (aucun accès)', await objets(null, 'anon'), []);
  await q(`update problemes set lu = true, lu_par = $2, lu_le = now() where id = $1`, [P1, admin]);
  eq('problème marqué « lu » : sa photo disparaît pour Marc (comme le problème), pas pour son auteur ni l\'administrateur', [await objets(marc), await objets(luc), await objets(admin)], [[], [chemin(luc, P1)], [chemin(luc, P1)]]);
  eq('… la lecture d\'un problème « lu » par Marc est bien vide aussi', (await comme(marc, `select id from problemes where id = $1`, [P1])).length, 0);
}

log('\n=== L\'ADMINISTRATEUR PEUT SUPPRIMER UNE PHOTO ===');
{
  const efface = await comme(admin, `with x as (delete from storage.objects where bucket_id = $1 returning 1) select count(*)::int n from x`, [B]);
  eq('l\'administrateur supprime la photo', [efface[0].n, await nb(`select count(*)::int n from storage.objects where bucket_id = $1`, [B])], [1, 0]);
  eq('le problème, lui, est conservé (jamais effacé)', await nb(`select count(*)::int n from problemes where id = $1`, [P1]), 1);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
