// Demande 5, chantier C (1ᵉʳ oct. 2026) — Fichier SQL 31 : les MODÈLES DE MESSAGES, le JOURNAL DES AVIS (la preuve en cas de bris) et les règles d'envoi (qui, quand, une seule fois par jour),
// et le lien de DÉSABONNEMENT des courriels. Banc d'essai local (base PGlite), sur le modèle de test-repertoire-inscriptions.mjs.
// Ce que ce test NE peut PAS vérifier : le vrai Supabase (le fichier y est exécuté avec l'accord de Joé, puis sa requête « verification » est relue), et l'ENVOI lui-même (le courriel par Resend,
// le texto par Twilio : fonctions serveur à part, avec leur propre test).
// SQL31_TEST (variable d'environnement) : une COPIE abîmée du fichier, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';
import crypto from 'crypto';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const SQL30 = fs.readFileSync(SQL_DIR + '30-repertoire-clients-et-inscriptions.sql', 'utf8');
const AVEC32 = process.env.AVEC_32 === '1';   // test-avis-envois-32.mjs : applique AUSSI le fichier 32 (canaux et aperçu) avant les scénarios
const SQL32 = fs.readFileSync(process.env.SQL32_TEST || (SQL_DIR + '32-avis-canaux-et-apercu.sql'), 'utf8');
const SQL31 = fs.readFileSync(process.env.SQL31_TEST || (SQL_DIR + '31-avis-aux-clients.sql'), 'utf8');

const db = await prepare(FILES);
await db.exec(`grant usage on schema public to service_role;`);
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
await db.exec(`alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);   // (comme chez Supabase : tout objet créé reçoit d'office tous les droits ; les « revoke » du fichier doivent les retirer)
await db.exec(SQL30);
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
const admin2 = await ins('inactif@t.ca', { nom: 'Ancien', role: 'admin' });
const nina = await emp('Nina');
await q(`update public.utilisateurs set actif = false where id = $1`, [admin2]);
const existe = async (nom) => (await q(`select to_regclass('public.' || $1) is not null as r`, [nom]))[0].r;
const trie = (o) => Object.fromEntries(Object.entries(o).sort());   // (jsonb range ses clés par longueur : on compare dans l'ordre alphabétique)
const n = async (sql, p) => (await q(sql, p))[0].n;
const compte = (t) => n(`select count(*)::int n from public.${t}`);

// ── Avant : rien n'existe ; on exécute le fichier ─────────────────────
log('=== AVANT LE FICHIER : RIEN N\'EXISTE ; APRÈS : LES TABLES ET LES FONCTIONS SONT LÀ ===');
const clientsAvant = JSON.stringify(await q(`select * from public.clients order by id`));
const reglesAvant = JSON.stringify(await q(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename not like 'avis_%' order by tablename, policyname`));
const defsAvant = JSON.stringify(await q(`select proname, pg_get_functiondef(oid) d from pg_proc where pronamespace = 'public'::regnamespace and proname not like '%avis%' order by proname, oid`));
let res31;
{
  eq('avant : ni les tables ni les fonctions', [await existe('avis_modeles'), await existe('avis_envois'), (await q(`select count(*)::int n from pg_proc where proname in ('avis_preparer','avis_marquer','avis_jeton','avis_desabonner_par_jeton')`))[0].n], [false, false, 0]);
  const vide = await prepare([FILES[0]]);
  await err('dans une base sans le fichier 30 : le fichier refuse de s\'exécuter (il dit pourquoi)', () => vide.exec(SQL31), 'pas été exécuté');
  res31 = await db.exec(SQL31);
  eq('après : les deux tables existent', [await existe('avis_modeles'), await existe('avis_envois')], [true, true]);
  eq('… le journal est VIDE ; QUATRE modèles (texto et courriel, « heures » et « demain »), tous en vigueur, version 1', [await compte('avis_envois'), (await q(`select canal || ':' || variante || ':' || version || ':' || en_vigueur v from public.avis_modeles order by canal, variante`)).map((x) => x.v)],
    [0, ['courriel:demain:avis-2026-10-v1:true', 'courriel:heures:avis-2026-10-v1:true', 'texto:demain:avis-2026-10-v1:true', 'texto:heures:avis-2026-10-v1:true']]);
  eq('… les clients, les règles d\'accès et les fonctions DÉJÀ là n\'ont pas changé d\'une virgule', [JSON.stringify(await q(`select * from public.clients order by id`)) === clientsAvant,
    JSON.stringify(await q(`select tablename, policyname, cmd from pg_policies where schemaname = 'public' and tablename not like 'avis_%' order by tablename, policyname`)) === reglesAvant,
    JSON.stringify(await q(`select proname, pg_get_functiondef(oid) d from pg_proc where pronamespace = 'public'::regnamespace and proname not like '%avis%' order by proname, oid`)) === defsAvant], [true, true, true]);
  await db.exec(SQL31);
  await db.exec(SQL31);
  eq('exécuté deux fois de plus : aucune erreur, rien en double (4 modèles)', await compte('avis_modeles'), 4);
  eq('la sécurité (RLS) est ACTIVE sur les deux tables ; seule la lecture par l\'administrateur existe', [(await q(`select relname from pg_class where oid in ('public.avis_modeles'::regclass, 'public.avis_envois'::regclass) and relrowsecurity order by 1`)).map((x) => x.relname),
    (await q(`select tablename || '.' || policyname || ' (' || cmd || ')' p from pg_policies where schemaname = 'public' and tablename like 'avis_%' order by 1`)).map((x) => x.p)],
    [['avis_envois', 'avis_modeles'], ['avis_envois.avis_envois_admin_lecture (SELECT)', 'avis_modeles.avis_modeles_admin_lecture (SELECT)']]);
  eq('un visiteur n\'a AUCUN droit sur les tables ; une personne connectée : la lecture seulement (jamais écrire, modifier ni effacer)', (await q(`select
    has_table_privilege('anon', 'public.avis_envois', 'select') or has_table_privilege('anon', 'public.avis_modeles', 'select') or has_table_privilege('anon', 'public.avis_envois', 'insert') a,
    has_table_privilege('authenticated', 'public.avis_envois', 'select') b, has_table_privilege('authenticated', 'public.avis_modeles', 'select') c,
    has_table_privilege('authenticated', 'public.avis_envois', 'insert') or has_table_privilege('authenticated', 'public.avis_envois', 'update') or has_table_privilege('authenticated', 'public.avis_envois', 'delete')
      or has_table_privilege('authenticated', 'public.avis_modeles', 'insert') or has_table_privilege('authenticated', 'public.avis_modeles', 'update') or has_table_privilege('authenticated', 'public.avis_modeles', 'delete') d`))[0], { a: false, b: true, c: true, d: false });
  const sig = { prep: 'public.avis_preparer(uuid, text, jsonb, timestamptz)', mar: 'public.avis_marquer(uuid, text, text, text)', jet: 'public.avis_jeton(uuid, text)', des: 'public.avis_desabonner_par_jeton(uuid, text)' };
  const priv = async (role, s) => (await q(`select has_function_privilege($1, $2, 'execute') r`, [role, s]))[0].r;
  eq('avis_preparer, avis_marquer et avis_jeton : réservées au rôle service_role (ni visiteur ni personne connectée)', [await priv('anon', sig.prep), await priv('authenticated', sig.prep), await priv('service_role', sig.prep), await priv('anon', sig.mar), await priv('authenticated', sig.mar), await priv('service_role', sig.mar), await priv('anon', sig.jet), await priv('authenticated', sig.jet), await priv('service_role', sig.jet)],
    [false, false, true, false, false, true, false, false, true]);
  eq('avis_desabonner_par_jeton : appelable par un visiteur (le lien d\'un courriel), une personne connectée et le service', [await priv('anon', sig.des), await priv('authenticated', sig.des), await priv('service_role', sig.des)], [true, true, true]);
  eq('les fonctions internes ne sont appelables ni par un visiteur ni par une personne connectée', (await q(`select has_function_privilege('anon', 'public._avis_rendre(text, text, text, text, text)', 'execute') or has_function_privilege('authenticated', 'public._avis_rendre(text, text, text, text, text)', 'execute')
    or has_function_privilege('anon', 'public._avis_texte_propre(text)', 'execute') or has_function_privilege('authenticated', 'public._avis_texte_propre(text)', 'execute')
    or has_function_privilege('authenticated', 'public._avis_envois_immuables()', 'execute') or has_function_privilege('authenticated', 'public._avis_modeles_immuables()', 'execute') r`))[0].r, false);
  eq('les fonctions qui écrivent sont « security definer » avec un chemin de recherche VIDE', (await q(`select proname, prosecdef, array_to_string(proconfig, ',') c from pg_proc where pronamespace = 'public'::regnamespace and proname in ('avis_preparer','avis_marquer','avis_jeton','avis_desabonner_par_jeton') order by proname`)).map((x) => [x.proname, x.prosecdef, x.c]),
    [['avis_desabonner_par_jeton', true, 'search_path=""'], ['avis_jeton', true, 'search_path=""'], ['avis_marquer', true, 'search_path=""'], ['avis_preparer', true, 'search_path=""']]);
  eq('la requête « verification » du bas du fichier dit la vérité', trie(res31[res31.length - 1].rows[0].verification), trie({
    tables: ['avis_envois', 'avis_modeles'], regles_actives: ['avis_envois', 'avis_modeles'], regles: ['avis_envois.avis_envois_admin_lecture (SELECT)', 'avis_modeles.avis_modeles_admin_lecture (SELECT)'],
    visiteur_peut_lire_ou_ecrire: false, connecte_peut_ecrire_le_journal: false, visiteur_peut_appeler: ['avis_desabonner_par_jeton'], envoi_reserve_au_service: true,
    modeles: ['avis-2026-10-v1:courriel:demain', 'avis-2026-10-v1:courriel:heures', 'avis-2026-10-v1:texto:demain', 'avis-2026-10-v1:texto:heures'], journal: 0 }));
}

// ── Le fichier 32 (seulement avec AVEC_32=1) : il REMPLACE avis_preparer et ajoute avis_apercu ─────
if (AVEC32) {
  log('=== FICHIER 32 : AVANT, LA FONCTION À 4 PARAMÈTRES ; APRÈS, CELLE À 5 PARAMÈTRES ET L’APERÇU ===');
  const args = async (nom) => (await q(`select pg_get_function_identity_arguments(oid) a from pg_proc where pronamespace = 'public'::regnamespace and proname = $1 order by oid`, [nom])).map((x) => x.a);
  eq('avant : avis_preparer à 4 paramètres, pas d’aperçu ni de fonction centrale', [await args('avis_preparer'), await args('avis_apercu'), await args('_avis_decider')], [['p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamp with time zone'], [], []]);
  const sans31 = await prepare([FILES[0]]);
  await err('dans une base sans le fichier 31 : le fichier 32 refuse de s’exécuter (il dit pourquoi)', () => sans31.exec(SQL32), 'pas été exécuté');
  const stub31 = await prepare([FILES[0]]);
  await stub31.exec(`create function public.avis_preparer(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz) returns jsonb language sql as $$ select null::jsonb $$`);
  await err('avec la fonction du fichier 31 mais sans ses tables : le fichier 32 refuse aussi (« incomplet »)', () => stub31.exec(SQL32), 'incomplet');
  const res32 = await db.exec(SQL32);
  const NOUVEAUX = 'p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamp with time zone, p_canaux text[]';
  eq('après : UNE seule version de avis_preparer (à 5 paramètres), avis_apercu, et la fonction centrale', [await args('avis_preparer'), await args('avis_apercu'), await args('_avis_decider')], [[NOUVEAUX], [NOUVEAUX], [NOUVEAUX + ', p_ecrire boolean']]);
  await db.exec(SQL32);
  await db.exec(SQL32);
  eq('exécuté deux fois de plus : aucune erreur, toujours une seule version de chaque fonction', [(await args('avis_preparer')).length, (await args('avis_apercu')).length], [1, 1]);
  const sigs = { prep: 'public.avis_preparer(uuid, text, jsonb, timestamptz, text[])', ap: 'public.avis_apercu(uuid, text, jsonb, timestamptz, text[])', dec: 'public._avis_decider(uuid, text, jsonb, timestamptz, text[], boolean)' };
  const priv = async (role, s) => (await q(`select has_function_privilege($1, $2, 'execute') r`, [role, s]))[0].r;
  eq('avis_preparer, avis_apercu : réservées au rôle service_role ; la fonction centrale : ni visiteur ni personne connectée', [await priv('anon', sigs.prep), await priv('authenticated', sigs.prep), await priv('service_role', sigs.prep), await priv('anon', sigs.ap), await priv('authenticated', sigs.ap), await priv('service_role', sigs.ap), await priv('anon', sigs.dec), await priv('authenticated', sigs.dec), await priv('service_role', sigs.dec)],
    [false, false, true, false, false, true, false, false, true]);
  eq('les fonctions du fichier 32 sont « security definer » avec un chemin de recherche VIDE', (await q(`select proname, prosecdef, array_to_string(proconfig, ',') c from pg_proc where pronamespace = 'public'::regnamespace and proname in ('avis_preparer', 'avis_apercu', '_avis_decider') order by proname`)).map((x) => [x.proname, x.prosecdef, x.c]),
    [['_avis_decider', true, 'search_path=""'], ['avis_apercu', true, 'search_path=""'], ['avis_preparer', true, 'search_path=""']]);
  eq('le fichier 32 ne touche ni au journal ni aux modèles (vides, quatre)', [await compte('avis_envois'), await compte('avis_modeles')], [0, 4]);
  eq('la requête « verification » du bas du fichier 32 dit la vérité', trie(res32[res32.length - 1].rows[0].verification), trie({ preparer: [NOUVEAUX], apercu: [NOUVEAUX], reserve_au_service: true, journal: 0, modeles: 4 }));
}

// ── Les textes approuvés, mot pour mot ───────────────────────────────
const TEXTO_H = (d, s) => `Entretien Lapointe : nous passerons chez vous dans environ ${d} pour le service « ${s} ». Merci de ramasser les objets sur le terrain pour éviter les bris. Questions : textez le 819 268-8069. ARRET pour ne plus recevoir ces avis.`;
const TEXTO_D = (s) => `Entretien Lapointe : nous passerons chez vous demain pour le service « ${s} ». Merci de ramasser les objets sur le terrain pour éviter les bris. Questions : textez le 819 268-8069. ARRET pour ne plus recevoir ces avis.`;
const PIED = `Merci de ramasser d'ici là les objets qui se trouvent sur le terrain (jouets, boyaux, décorations, etc.) afin d'éviter tout bris.\n\nUne question ? Textez-nous au 819 268-8069.\n\nEntretien Lapointe · 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0 · info@entretienlapointe.ca\nVous recevez cet avis parce que vous êtes client d'Entretien Lapointe. Ne plus recevoir ces avis : [lien de désabonnement]`;
const COURRIEL_H = (dl, s, a) => `Bonjour,\n\nNous passerons chez vous d'ici environ ${dl} pour le service « ${s} » (adresse : ${a}).\n\n${PIED}`;
const COURRIEL_D = (s, a) => `Bonjour,\n\nNous passerons chez vous demain pour le service « ${s} » (adresse : ${a}).\n\n${PIED}`;
const OBJET_H = (dl) => `Entretien Lapointe : nous passons chez vous d'ici environ ${dl}`;
const OBJET_D = 'Entretien Lapointe : nous passons chez vous demain';

// Les moments (le Québec est à -04:00 jusqu'au 1ᵉʳ novembre 2026, puis à -05:00)
const T = (h, m = 0, jour = '2026-10-14', z = '-04:00') => `${jour}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00${z}`;
const MIDI = T(12);
let seq = 0;
const client = async (nom, o = {}) => {
  const c = { nom, adresse: '1 rue Test', ...o };
  const cols = Object.keys(c), vals = Object.values(c);
  return (await q(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, vals))[0].id;
};
const tout = (nom, o = {}) => client(nom, { courriel: `c${++seq}@exemple.ca`, cellulaire: '819555' + String(2000 + seq), avis_courriel: true, avis_texto: true, ...o });   // un client qui reçoit TOUT
const prep = (delai, lignes, quand = MIDI, par = admin, role = 'service_role') => fn(null, 'avis_preparer($1::uuid, $2::text, $3::jsonb, $4::timestamptz)', [par, delai, JSON.stringify(lignes), quand], role);
const L = (id, service = 'Coupe de gazon', adresse = '10 rue des Pins, Louiseville') => ({ client_id: id, service, adresse });
const prep5 = (delai, lignes, quand = MIDI, par = admin, canaux = ['courriel', 'texto'], role = 'service_role') => fn(null, 'avis_preparer($1::uuid, $2::text, $3::jsonb, $4::timestamptz, $5::text[])', [par, delai, JSON.stringify(lignes), quand, canaux], role);
const ligne = (r, id, canal) => r.lignes.find((x) => x.client_id === id && x.canal === canal);
const vider = async () => { await q(`alter table public.avis_envois disable trigger avis_envois_immuables`); await q(`alter table public.avis_envois disable trigger avis_envois_pas_de_vidage`); await q(`delete from public.avis_envois`); await q(`alter table public.avis_envois enable trigger avis_envois_immuables`); await q(`alter table public.avis_envois enable trigger avis_envois_pas_de_vidage`); };

log('=== LES MODÈLES : LES TEXTES APPROUVÉS, MOT POUR MOT ===');
{
  const t = async (canal, variante) => (await q(`select objet, texte from public.avis_modeles where canal = $1 and variante = $2`, [canal, variante]))[0];
  eq('texto « heures » : exactement le texte approuvé (avec les marqueurs)', (await t('texto', 'heures')).texte, TEXTO_H('{delai}', '{service}'));
  eq('texto « demain »', (await t('texto', 'demain')).texte, TEXTO_D('{service}'));
  const ch = await t('courriel', 'heures'), cd = await t('courriel', 'demain');
  eq('courriel « heures » : l\'objet et le corps approuvés (le lien de désabonnement est le marqueur {lien})', [ch.objet, ch.texte.replace('{lien}', '[lien de désabonnement]')], [OBJET_H('{delai_long}'), COURRIEL_H('{delai_long}', '{service}', '{adresse}')]);
  eq('courriel « demain »', [cd.objet, cd.texte.replace('{lien}', '[lien de désabonnement]')], [OBJET_D, COURRIEL_D('{service}', '{adresse}')]);
  eq('aucun modèle ne parle de publicité ni de prix ; tous disent « Entretien Lapointe » et donnent le 819 268-8069', (await q(`select count(*)::int n from public.avis_modeles where texte !~* 'promo|rabais|offre|prix' and texte like '%Entretien Lapointe%' and texte like '%819 268-8069%'`))[0].n, 4);
  eq('le texto dit ARRET (exigé par les opérateurs) ; le courriel donne le lien de désabonnement et l\'adresse postale (exigés par la loi)', [(await q(`select count(*)::int n from public.avis_modeles where canal = 'texto' and texte like '%ARRET pour ne plus recevoir ces avis.'`))[0].n,
    (await q(`select count(*)::int n from public.avis_modeles where canal = 'courriel' and texte like '%{lien}%' and texte like '%331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0%'`))[0].n], [2, 2]);
  await err('un modèle ne se modifie pas (le texte)', () => q(`update public.avis_modeles set texte = 'Un autre texte assez long pour passer' where canal = 'texto' and variante = 'heures'`), 'modele_immuable');
  await err('… ni l\'objet, ni la version', () => q(`update public.avis_modeles set objet = 'Autre objet' where canal = 'courriel' and variante = 'heures'`), 'modele_immuable');
  await err('… ni ne s\'efface (même le propriétaire de la base)', () => q(`delete from public.avis_modeles`), 'modele_immuable');
  await q(`update public.avis_modeles set en_vigueur = false where canal = 'texto' and variante = 'demain'`);
  await q(`update public.avis_modeles set en_vigueur = true where canal = 'texto' and variante = 'demain'`);
  pass('… seul « en_vigueur » peut changer');
}

log('=== PRÉPARER UN AVIS : LES MESSAGES ET LE JOURNAL ===');
{
  await vider();
  const a = await tout('Famille Tremblay');
  const r = await prep('3h', [L(a)]);
  eq('un client qui reçoit tout : DEUX lignes (courriel et texto), « en attente »', [r.lignes.length, r.lignes.map((x) => x.canal + ':' + x.statut)], [2, ['courriel:en_attente', 'texto:en_attente']]);
  const c = ligne(r, a, 'courriel'), t = ligne(r, a, 'texto');
  eq('le TEXTO : le message exact avec « 3 h » et le service', t.message, TEXTO_H('3 h', 'Coupe de gazon'));
  eq('le COURRIEL : l\'objet et le corps exacts avec « 3 heures », le service et l\'adresse', [c.objet, c.message], [OBJET_H('3 heures'), COURRIEL_H('3 heures', 'Coupe de gazon', '10 rue des Pins, Louiseville')]);
  eq('… le texto n\'a pas d\'objet ; les destinataires sont le cellulaire (+1…) et le courriel de la fiche', [t.objet, t.destinataire.startsWith('+1819555'), c.destinataire.endsWith('@exemple.ca')], [null, true, true]);
  const j = await q(`select canal, statut, motif, delai, service, adresse, version_modele, envoye_par, message, objet, jour::text from public.avis_envois order by canal`);
  eq('le JOURNAL a les deux lignes, avec le message EXACT, le délai, le service, l\'adresse, la version du modèle et qui l\'a demandé', [j.length, j[0].message === c.message, j[1].message === t.message, j[0].delai, j[0].service, j[0].adresse, j[0].version_modele, j[0].envoye_par === admin, j[0].jour], [2, true, true, '3h', 'Coupe de gazon', '10 rue des Pins, Louiseville', 'avis-2026-10-v1', true, '2026-10-14']);
  eq('… le lot, le jour et l\'heure de la demande sont notés ; aucun fournisseur encore', [r.jour, typeof r.lot_id, r.heure_permise_texto, j.every((x) => x.motif === null)], ['2026-10-14', 'string', true, true]);

  eq('la ligne du journal porte l’heure de la DEMANDE (celle passée à la fonction), pas une autre', (await q(`select count(*)::int n from public.avis_envois where cree_le = $1::timestamptz`, [MIDI]))[0].n, 2);
  await vider();
  const r1 = await prep('1h', [L(a)]);
  eq('« 1h » : « 1 h » au texto et « 1 heure » (singulier) au courriel', [ligne(r1, a, 'texto').message === TEXTO_H('1 h', 'Coupe de gazon'), ligne(r1, a, 'courriel').objet], [true, OBJET_H('1 heure')]);
  await vider();
  const r72 = await prep('72h', [L(a)]);
  eq('« 72h » : accepté', [ligne(r72, a, 'texto').message === TEXTO_H('72 h', 'Coupe de gazon'), ligne(r72, a, 'courriel').objet], [true, OBJET_H('72 heures')]);
  await vider();
  const rd = await prep('demain', [L(a, 'Déneigement', '5 av. du Lac, Yamachiche')]);
  eq('« demain » : les textes « demain »', [ligne(rd, a, 'texto').message, ligne(rd, a, 'courriel').objet, ligne(rd, a, 'courriel').message], [TEXTO_D('Déneigement'), OBJET_D, COURRIEL_D('Déneigement', '5 av. du Lac, Yamachiche')]);
  eq('… et le journal garde « demain »', (await q(`select distinct delai from public.avis_envois`)).map((x) => x.delai), ['demain']);
  for (const mauvais of ['0h', '73h', '100h', '3', 'h', '3 h', '03h', 'demain ', 'Demain', '', 'abc', '-1h', '3.5h']) {
    await err(`le délai « ${mauvais} » est refusé`, () => prep(mauvais, [L(a)]), 'delai_invalide');
  }
  await err('un délai absent est refusé', () => prep(null, [L(a)]), 'delai_invalide');
  eq('un délai refusé n\'écrit RIEN au journal', await compte('avis_envois'), 2);
}

log('=== LES RÈGLES : QUI REÇOIT QUOI ===');
{
  await vider();
  const sans = await client('Sans rien activé', { courriel: 'a@exemple.ca', cellulaire: '8195559001' });
  const cSeul = await client('Courriel seulement', { courriel: 'b@exemple.ca', avis_courriel: true });
  const tSeul = await client('Texto seulement', { cellulaire: '8195559002', avis_texto: true });
  const cSansAdr = await client('Courriel coché sans courriel', { avis_courriel: true });
  const desabC = await client('Désabonné courriel', { courriel: 'd@exemple.ca', avis_courriel: true });
  const desabT = await client('Désabonné texto', { cellulaire: '8195559003', avis_texto: true });
  await q(`update public.clients set desabonne_courriel_le = now() where id = $1`, [desabC]);
  await q(`update public.clients set desabonne_texto_le = now() where id = $1`, [desabT]);
  const archive = await tout('Archivé', { actif: false });
  const r = await prep('2h', [L(sans), L(cSeul), L(tSeul), L(cSansAdr), L(desabC), L(desabT), L(archive)]);
  const m = (id, canal) => { const x = ligne(r, id, canal); return x ? x.statut + (x.motif ? ':' + x.motif : '') : 'absent'; };
  eq('rien d\'activé : les DEUX canaux refusés « pas_active »', [m(sans, 'courriel'), m(sans, 'texto')], ['refuse:pas_active', 'refuse:pas_active']);
  eq('« avertir par courriel » seulement : le courriel part, le texto est refusé', [m(cSeul, 'courriel'), m(cSeul, 'texto')], ['en_attente', 'refuse:pas_active']);
  eq('inscrit aux textos seulement : le texto part, le courriel est refusé', [m(tSeul, 'courriel'), m(tSeul, 'texto')], ['refuse:pas_active', 'en_attente']);
  eq('« avertir par courriel » coché mais AUCUN courriel : refusé « pas_de_coordonnee »', m(cSansAdr, 'courriel'), 'refuse:pas_de_coordonnee');
  eq('désabonné des courriels : refusé « desabonne » (même avec la case cochée)', m(desabC, 'courriel'), 'refuse:desabonne');
  eq('désabonné des textos : refusé « desabonne » (même inscrit)', m(desabT, 'texto'), 'refuse:desabonne');
  eq('une fiche ARCHIVÉE ne reçoit rien et n\'est pas écrite au journal', [r.lignes.filter((x) => x.client_id === archive).map((x) => x.motif), (await q(`select count(*)::int n from public.avis_envois where client_id = $1`, [archive]))[0].n], [['client_introuvable'], 0]);
  eq('les refus sont AU JOURNAL avec leur motif (ce qui n\'a PAS été envoyé se prouve aussi) ; aucun message n\'est « envoyé » sans l\'être', (await q(`select statut, motif, count(*)::int n from public.avis_envois group by statut, motif order by statut, motif`)).map((x) => `${x.statut}:${x.motif}:${x.n}`),
    ['en_attente:null:2', 'refuse:desabonne:2', 'refuse:pas_active:7', 'refuse:pas_de_coordonnee:1']);
  // un client inconnu et des lignes invalides
  await vider();
  const ok1 = await tout('Valide');
  const r2 = await prep('2h', [L(ok1), L('00000000-0000-4000-8000-000000000000'), { client_id: 'pas-un-uuid', service: 'x', adresse: 'y' }, { client_id: ok1, service: '', adresse: 'y' }, { client_id: ok1, service: 'x', adresse: '' },
    { client_id: ok1, service: 'x'.repeat(101), adresse: 'y' }, { client_id: ok1, service: 'x', adresse: 'y'.repeat(201) }, 'texte', 5, null, { service: 'x', adresse: 'y' }]);
  eq('un client inconnu et dix lignes invalides : refusées, SANS arrêter le lot ; la ligne valide part', [r2.lignes.filter((x) => x.motif === 'client_introuvable').length, r2.lignes.filter((x) => x.motif === 'ligne_invalide').length, r2.lignes.filter((x) => x.statut === 'en_attente').length], [1, 9, 2]);
  eq('… seule la ligne valide est au journal', await compte('avis_envois'), 2);
  await err('une liste vide est refusée', () => prep('2h', []), 'lignes_invalides');
  await err('… ce qui n\'est pas une liste aussi', () => prep('2h', { client_id: ok1 }), 'lignes_invalides');
  await err('… plus de 300 lignes aussi', () => prep('2h', Array.from({ length: 301 }, () => L(ok1))), 'lignes_invalides');
  eq('… 300 lignes passent (les 299 doublons sont refusés « deja_averti_aujourdhui »)', (await prep('2h', Array.from({ length: 300 }, () => L(ok1)), T(13))).lignes.filter((x) => x.motif === 'deja_averti_aujourdhui').length, 600);
}

log('=== LES HEURES : AUCUN TEXTO DE 21 H À 6 H (HEURE DU QUÉBEC) ===');
{
  const a = await tout('Client des heures');
  const essai = async (quand, titre, texto, courriel = 'en_attente') => {
    await vider();
    const r = await prep('2h', [L(a)], quand);
    eq(titre, [ligne(r, a, 'texto').statut + (ligne(r, a, 'texto').motif ? ':' + ligne(r, a, 'texto').motif : ''), ligne(r, a, 'courriel').statut, r.heure_permise_texto], [texto, courriel, texto === 'en_attente']);
  };
  await essai(T(6, 0), '6 h 00 : le texto part (limite incluse)', 'en_attente');
  await essai(T(5, 59), '5 h 59 : le texto est refusé « hors_heures » ; le COURRIEL part quand même', 'refuse:hors_heures');
  await essai(T(20, 59), '20 h 59 : le texto part', 'en_attente');
  await essai(T(21, 0), '21 h 00 : le texto est refusé (limite exclue)', 'refuse:hors_heures');
  await essai(T(23, 30), '23 h 30 : refusé', 'refuse:hors_heures');
  await essai(T(0, 5), 'minuit cinq : refusé', 'refuse:hors_heures');
  await essai('2026-10-15T01:00:00Z', '01 h 00 UTC = 21 h au Québec (l\'heure du SERVEUR n\'est pas celle du Québec) : refusé', 'refuse:hors_heures');
  await essai('2026-10-14T23:00:00Z', '23 h UTC = 19 h au Québec : le texto part', 'en_attente');
  await essai('2026-12-10T20:59:00-05:00', 'en hiver (-05:00) : 20 h 59 passe', 'en_attente');
  await essai('2026-12-11T02:00:00Z', 'en hiver : 02 h UTC = 21 h au Québec : refusé', 'refuse:hors_heures');
  await essai('2026-11-01T05:30:00-05:00', 'le jour du retour à l\'heure normale, 5 h 30 : refusé', 'refuse:hors_heures');
  await essai('2026-03-08T12:00:00-04:00', 'le jour du passage à l\'heure d\'été, midi : le texto part', 'en_attente');
  // le jour est celui du calendrier du Québec
  await vider();
  const r1 = await prep('2h', [L(a)], '2026-10-15T02:30:00Z');   // 22 h 30 le 14 au Québec
  eq('22 h 30 au Québec (02 h 30 UTC le lendemain) : le jour noté est le 14 (calendrier du Québec)', r1.jour, '2026-10-14');
  const r2 = await prep('2h', [L(a)], '2026-10-15T09:30:00Z');   // 5 h 30 le 15 au Québec
  eq('… 5 h 30 le lendemain : un NOUVEAU jour (le courriel d\'hier ne bloque pas celui d\'aujourd\'hui)', [r2.jour, ligne(r2, a, 'courriel').statut], ['2026-10-15', 'en_attente']);
  // un refus « hors heures » ne bloque pas l'essai du matin
  await vider();
  await prep('2h', [L(a)], T(22, 0));
  const r3 = await prep('2h', [L(a)], T(23, 0));
  eq('un texto REFUSÉ la nuit ne compte pas comme « envoyé » (aucune ligne « en attente » ni « envoyée »)', [(await q(`select count(*)::int n from public.avis_envois where canal = 'texto' and statut in ('en_attente','envoye')`))[0].n, ligne(r3, a, 'courriel').motif], [0, 'deja_averti_aujourdhui']);
}

log('=== UN SEUL AVIS PAR CLIENT, PAR CANAL ET PAR JOUR ===');
{
  await vider();
  const a = await tout('Client unique'), b = await tout('Autre client');
  const r1 = await prep('2h', [L(a), L(b)], T(9));
  const r2 = await prep('4h', [L(a)], T(15));
  eq('un 2ᵉ avis le même jour : refusé « deja_averti_aujourdhui » pour les DEUX canaux ; l\'autre client n\'est pas touché', [r2.lignes.map((x) => x.canal + ':' + x.statut + ':' + x.motif), r1.lignes.filter((x) => x.statut === 'en_attente').length], [['courriel:refuse:deja_averti_aujourdhui', 'texto:refuse:deja_averti_aujourdhui'], 4]);
  eq('… le journal garde le refus (avec son motif) ET le premier avis', (await q(`select statut, motif from public.avis_envois where client_id = $1 order by cree_le, canal, statut`, [a])).map((x) => x.statut + ':' + x.motif).sort(), ['en_attente:null', 'en_attente:null', 'refuse:deja_averti_aujourdhui', 'refuse:deja_averti_aujourdhui'].map((x) => x.replace('null', '')).map((x) => (x.startsWith('en_attente') ? 'en_attente:null' : x)));
  const r3 = await prep('2h', [L(a)], T(9, 0, '2026-10-15'));
  eq('le lendemain : permis', r3.lignes.map((x) => x.statut), ['en_attente', 'en_attente']);
  // « envoyé » bloque aussi
  await vider();
  const c = (await prep('2h', [L(a)], T(9))).lignes.find((x) => x.canal === 'courriel');
  await fn(null, 'avis_marquer($1::uuid, $2::text, $3::text, $4::text)', [c.id, 'envoye', 're_abc123', null], 'service_role');
  eq('un courriel DÉJÀ ENVOYÉ aujourd\'hui bloque un autre courriel aujourd\'hui', (await prep('2h', [L(a)], T(16))).lignes.find((x) => x.canal === 'courriel').motif, 'deja_averti_aujourdhui');
  // un ÉCHEC permet de réessayer le même jour
  await vider();
  const e = (await prep('2h', [L(a)], T(9))).lignes.find((x) => x.canal === 'courriel');
  await fn(null, 'avis_marquer($1::uuid, $2::text, $3::text, $4::text)', [e.id, 'echec', null, 'boîte pleine'], 'service_role');
  eq('un envoi en ÉCHEC n\'empêche pas de réessayer le même jour (le texto, lui, reste « en attente » donc bloqué)', (await prep('2h', [L(a)], T(10))).lignes.map((x) => x.canal + ':' + x.statut), ['courriel:en_attente', 'texto:refuse']);
  // deux demandes en même temps : la seconde est refusée, jamais un 2ᵉ avis (on imite la course avec un déclencheur d'essai qui écrit l'autre avis juste avant)
  await vider();
  await q(`create function public._essai_course() returns trigger language plpgsql as $$ begin if pg_trigger_depth() = 1 and new.statut = 'en_attente' and new.canal = 'courriel' then insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, message, statut, fournisseur_id, envoye_le) values (gen_random_uuid(), new.jour, new.envoye_par, new.client_id, new.canal, new.destinataire, new.delai, 'autre', 'autre', new.version_modele, 'autre', 'envoye', 'r1', now()); end if; return new; end $$`);
  await q(`create trigger essai_course before insert on public.avis_envois for each row execute function public._essai_course()`);
  const course = await prep('2h', [L(a)], T(9));
  await q(`drop trigger essai_course on public.avis_envois`);
  await q(`drop function public._essai_course()`);
  eq('une autre demande écrit le même avis PENDANT la nôtre : la nôtre est refusée « deja_averti_aujourdhui » (jamais d’erreur, jamais deux avis) ; le texto, lui, part', [ligne(course, a, 'courriel').statut + ':' + ligne(course, a, 'courriel').motif, ligne(course, a, 'texto').statut,
    (await q(`select count(*)::int n from public.avis_envois where canal = 'courriel' and statut = 'en_attente'`))[0].n], ['refuse:deja_averti_aujourdhui', 'en_attente', 0]);
  // l'index lui-même
  await vider();
  await prep('2h', [L(a)], T(9));
  await err('l\'index du journal refuse DIRECTEMENT un 2ᵉ avis « en attente » le même jour, même écrit à la main', () => q(`insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, message, statut)
    select gen_random_uuid(), jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, message, 'en_attente' from public.avis_envois where canal = 'texto' limit 1`), 'duplicate key|unique');
}

log('=== CE QUE LE SERVICE REÇOIT : RIEN DE DANGEREUX DANS LES MESSAGES ===');
{
  await vider();
  const a = await tout('Client piégé');
  const r = await prep('2h', [L(a, 'Gazon {adresse} {lien} {delai}', '  12   rue\tDu  Lac\n{service}, Ville ')]);
  const t = ligne(r, a, 'texto').message;
  eq('des accolades dans le service sont remplacées (aucun marqueur ne peut être glissé dans un message)', t, TEXTO_H('2 h', 'Gazon (adresse) (lien) (delai)'));
  eq('… les espaces et les tabulations sont nettoyés ; les accolades de l\'adresse aussi', ligne(r, a, 'courriel').message.includes('(adresse : 12 rue Du Lac (service), Ville)'), true);
  eq('… et RIEN ne reste de « {…} » dans aucun message du lot', r.lignes.every((x) => !/[{}]/.test(x.message) && !/[{}]/.test(x.objet || '')), true);
  await vider();
  const r2 = await prep('2h', [L(a, 'Épandage de sel', 'Rue Éloïse « Test », Trois-Rivières')]);
  eq('les accents et les guillemets passent tels quels', ligne(r2, a, 'courriel').message.includes('(adresse : Rue Éloïse « Test », Trois-Rivières)') && ligne(r2, a, 'texto').message.includes('« Épandage de sel »'), true);
}

// ═════════════════════════════════════════════════════════════════
// FICHIER 32 : LES CANAUX DEMANDÉS ET L'APERÇU (exécuté seulement avec AVEC_32=1 : test-avis-envois-32.mjs)
// ═════════════════════════════════════════════════════════════════
if (AVEC32) {
  log('=== LES CANAUX DEMANDÉS : LES AUTRES N’ÉCRIVENT RIEN AU JOURNAL ===');
  {
    await vider();
    const a = await tout('Client des canaux');
    const rc = await prep5('2h', [L(a)], MIDI, admin, ['courriel']);
    eq('« courriel » seulement : UNE ligne (le courriel) ; rien pour le texto', [rc.lignes.map((x) => x.canal + ':' + x.statut), (await q(`select canal from public.avis_envois order by canal`)).map((x) => x.canal)], [['courriel:en_attente'], ['courriel']]);
    await vider();
    const rt = await prep5('2h', [L(a)], MIDI, admin, ['texto']);
    eq('« texto » seulement : UNE ligne (le texto) ; rien pour le courriel', [rt.lignes.map((x) => x.canal + ':' + x.statut), (await q(`select canal from public.avis_envois order by canal`)).map((x) => x.canal)], [['texto:en_attente'], ['texto']]);
    await vider();
    const r2 = await prep5('2h', [L(a)], MIDI, admin, ['texto', 'courriel']);
    eq('les deux (dans n’importe quel ordre) : deux lignes, toujours courriel puis texto', r2.lignes.map((x) => x.canal), ['courriel', 'texto']);
    await vider();
    eq('sans préciser les canaux (appel à 4 paramètres) : les deux, comme avant', (await prep('2h', [L(a)])).lignes.map((x) => x.canal), ['courriel', 'texto']);
    await vider();
    await prep5('2h', [L(a)], MIDI, admin, ['courriel']);
    const suite = await prep5('3h', [L(a)], MIDI, admin, ['courriel', 'texto']);
    eq('un courriel déjà envoyé aujourd’hui n’empêche pas le TEXTO de partir plus tard ; le courriel, lui, est refusé', suite.lignes.map((x) => x.canal + ':' + x.statut + ':' + x.motif), ['courriel:refuse:deja_averti_aujourdhui', 'texto:en_attente:null']);
    await vider();
    for (const [titre, c] of [['une liste vide', []], ['aucune liste', null], ['un canal inconnu', ['sms']], ['un canal vide', ['courriel', null]], ['un canal inconnu parmi de bons', ['courriel', 'sms']], ['du texte au lieu d’une liste', 'courriel']]) {
      await err(`${titre} : « canaux_invalides »`, () => fn(null, 'avis_preparer($1::uuid, $2::text, $3::jsonb, $4::timestamptz, $5::text[])', [admin, '2h', JSON.stringify([L(a)]), MIDI, c], 'service_role'), 'canaux_invalides|malformed array|invalid input');
    }
    eq('… rien n’a été écrit', await compte('avis_envois'), 0);
  }

  log('=== L’APERÇU : LES MÊMES DÉCISIONS ET LES MÊMES MESSAGES, SANS RIEN ÉCRIRE ===');
  {
    await vider();
    const a = await tout('Client de l’aperçu');
    const b = await client('Client sans avis', { courriel: 'x@exemple.ca' });
    const ap = (delai, lignes, quand = MIDI, canaux = ['courriel', 'texto'], par = admin, role = 'service_role') => fn(null, 'avis_apercu($1::uuid, $2::text, $3::jsonb, $4::timestamptz, $5::text[])', [par, delai, JSON.stringify(lignes), quand, canaux], role);
    const r = await ap('3h', [L(a), L(b)]);
    eq('un aperçu : « a_envoyer » ou « refuse » (avec le motif), jamais « en_attente » ; aucun numéro de ligne ni de lot', [r.lignes.map((x) => x.statut + (x.motif ? ':' + x.motif : '')), r.lignes.every((x) => x.id === null), r.lot_id, r.apercu], [['a_envoyer', 'a_envoyer', 'refuse:pas_active', 'refuse:pas_active'], true, null, true]);
    eq('… RIEN n’a été écrit au journal', await compte('avis_envois'), 0);
    const aperçuTexte = r.lignes.filter((x) => x.client_id === a);
    const vrai1 = await prep('3h', [L(a), L(b)]);
    eq('l’aperçu donne EXACTEMENT les messages (et objets, destinataires) qui partent ensuite', [aperçuTexte.map((x) => [x.canal, x.message, x.objet, x.destinataire]), ], [vrai1.lignes.filter((x) => x.client_id === a).map((x) => [x.canal, x.message, x.objet, x.destinataire])]);
    eq('… et les mêmes refus', r.lignes.filter((x) => x.client_id === b).map((x) => x.motif), vrai1.lignes.filter((x) => x.client_id === b).map((x) => x.motif));
    eq('après l’envoi, l’aperçu montre « déjà averti aujourd’hui »', (await ap('3h', [L(a)])).lignes.map((x) => x.statut + ':' + x.motif), ['refuse:deja_averti_aujourdhui', 'refuse:deja_averti_aujourdhui']);
    eq('… l’aperçu ne réserve RIEN : après plusieurs aperçus, le journal est resté tel quel', await compte('avis_envois'), 4);
    await vider();
    await ap('3h', [L(a)]); await ap('3h', [L(a)]);
    eq('deux aperçus de suite puis un vrai envoi : l’envoi part (l’aperçu n’a rien bloqué)', (await prep('3h', [L(a)])).lignes.map((x) => x.statut), ['en_attente', 'en_attente']);
    await vider();
    eq('l’aperçu de la nuit : le texto est refusé « hors_heures », le courriel est « a_envoyer »', (await ap('3h', [L(a)], T(22))).lignes.map((x) => x.canal + ':' + x.statut + (x.motif ? ':' + x.motif : '')), ['courriel:a_envoyer', 'texto:refuse:hors_heures']);
    eq('sans préciser les canaux (appel à 4 paramètres), l’aperçu montre les DEUX canaux, comme l’envoi', (await fn(null, 'avis_apercu($1::uuid, $2::text, $3::jsonb, $4::timestamptz)', [admin, '2h', JSON.stringify([L(a)]), MIDI], 'service_role')).lignes.map((x) => x.canal), ['courriel', 'texto']);
    eq('l’aperçu respecte les canaux demandés', (await ap('3h', [L(a)], MIDI, ['courriel'])).lignes.map((x) => x.canal), ['courriel']);
    eq('… « demain » aussi', (await ap('demain', [L(a, 'Déneigement', '5 av. du Lac')])).lignes.map((x) => x.message.includes('demain')), [true, true]);
    for (const [titre, f, motif] of [
      ['un délai invalide', () => ap('0h', [L(a)]), 'delai_invalide'], ['une liste vide', () => ap('2h', []), 'lignes_invalides'], ['des canaux invalides', () => ap('2h', [L(a)], MIDI, ['sms']), 'canaux_invalides'],
      ['un employé', () => ap('2h', [L(a)], MIDI, ['courriel'], nina), 'non_autorise'], ['un administrateur désactivé', () => ap('2h', [L(a)], MIDI, ['courriel'], admin2), 'non_autorise'],
      ['un visiteur', () => ap('2h', [L(a)], MIDI, ['courriel'], admin, 'anon'), 'permission denied|droit|privilege'], ['une personne connectée (même l’administrateur)', () => ap('2h', [L(a)], MIDI, ['courriel'], admin, 'authenticated'), 'permission denied|droit|privilege'],
    ]) await err(`l’aperçu refuse ${titre}`, f, motif);
    eq('… et aucun refus n’a écrit quoi que ce soit', await compte('avis_envois'), 0);
    eq('un client inconnu ou archivé : refusé dans l’aperçu aussi', (await ap('2h', [L('00000000-0000-4000-8000-000000000000')])).lignes.map((x) => x.motif), ['client_introuvable']);
  }
}


log('=== QUI PEUT PRÉPARER UN AVIS ===');
{
  const a = await tout('Client des droits');
  await err('un employé (même dans la liste) : refusé', () => prep('2h', [L(a)], MIDI, nina), 'non_autorise');
  await err('un administrateur DÉSACTIVÉ : refusé', () => prep('2h', [L(a)], MIDI, admin2), 'non_autorise');
  await err('un identifiant inconnu : refusé', () => prep('2h', [L(a)], MIDI, '00000000-0000-4000-8000-000000000000'), 'non_autorise');
  await err('aucun identifiant : refusé', () => prep('2h', [L(a)], MIDI, null), 'non_autorise');
  await err('un visiteur ne peut pas appeler avis_preparer', () => prep('2h', [L(a)], MIDI, admin, 'anon'), 'permission denied|droit|privilege');
  await err('… ni une personne connectée (même l\'administrateur)', () => prep('2h', [L(a)], MIDI, admin, 'authenticated'), 'permission denied|droit|privilege');
  await err('… ni avis_marquer', () => fn(admin, 'avis_marquer($1::uuid, $2::text, $3::text, $4::text)', ['00000000-0000-4000-8000-000000000000', 'echec', null, 'x'], 'authenticated'), 'permission denied|droit|privilege');
  await err('… ni avis_jeton', () => fn(admin, 'avis_jeton($1::uuid, $2::text)', [a, 'courriel'], 'authenticated'), 'permission denied|droit|privilege');
}

log('=== NOTER LE RÉSULTAT D\'UN ENVOI ===');
{
  await vider();
  const a = await tout('Client du résultat');
  const r = await prep('2h', [L(a)]);
  const c = ligne(r, a, 'courriel'), t = ligne(r, a, 'texto');
  const mar = (id, st, f = null, e = null) => fn(null, 'avis_marquer($1::uuid, $2::text, $3::text, $4::text)', [id, st, f, e], 'service_role');
  await err('« envoyé » sans identifiant du fournisseur : refusé (aucune preuve)', () => mar(c.id, 'envoye'), 'fournisseur_requis');
  await err('… avec un identifiant vide : refusé aussi', () => mar(c.id, 'envoye', '   '), 'fournisseur_requis');
  await err('un statut inconnu : refusé', () => mar(c.id, 'livre', 'x'), 'statut_invalide');
  await err('une ligne inconnue : refusé', () => mar('00000000-0000-4000-8000-000000000000', 'envoye', 'x'), 'avis_introuvable');
  eq('« envoyé » : noté avec l\'identifiant du fournisseur et l\'heure', (await mar(c.id, 'envoye', 're_abc123')), { statut: 'envoye' });
  const ligneC = (await q(`select statut, fournisseur_id, envoye_le is not null ok, erreur, motif from public.avis_envois where id = $1`, [c.id]))[0];
  eq('… la ligne du journal', ligneC, { statut: 'envoye', fournisseur_id: 're_abc123', ok: true, erreur: null, motif: null });
  await err('une ligne déjà marquée ne se marque plus (le journal ne se réécrit pas)', () => mar(c.id, 'echec', null, 'x'), 'avis_deja_marque');
  eq('« échec » : noté avec la raison (tronquée à 500 caractères) et le motif « echec_fournisseur »', [(await mar(t.id, 'echec', null, 'x'.repeat(600))).statut, (await q(`select statut, motif, char_length(erreur)::int n from public.avis_envois where id = $1`, [t.id]))[0]], ['echec', { statut: 'echec', motif: 'echec_fournisseur', n: 500 }]);
  await vider();
  const r2 = await prep('2h', [L(a)]);
  await mar(ligne(r2, a, 'texto').id, 'echec', null, '   ');
  eq('… une raison vide devient « erreur inconnue »', (await q(`select erreur from public.avis_envois where canal = 'texto'`))[0].erreur, 'erreur inconnue');
  await vider();
  const r3 = await prep('2h', [L(a)], T(23));
  const refus = ligne(r3, a, 'texto');
  await err('une ligne REFUSÉE ne se marque pas « envoyée » (jamais de faux envoi)', () => mar(refus.id, 'envoye', 'x'), 'avis_deja_marque');
}

log('=== LE JOURNAL EST À L\'ÉPREUVE DES MODIFICATIONS ===');
{
  await vider();
  const a = await tout('Client du journal');
  const r = await prep('2h', [L(a)]);
  const c = ligne(r, a, 'courriel');
  await err('le message ne se modifie pas (même le propriétaire de la base)', () => q(`update public.avis_envois set message = 'autre' where id = $1`, [c.id]), 'journal_immuable');
  for (const col of ['destinataire', 'service', 'adresse', 'delai', 'version_modele', 'objet']) {
    await err(`… ${col}`, () => q(`update public.avis_envois set ${col} = 'autre' where id = $1`, [c.id]), 'journal_immuable|check|violates');
  }
  await err('… ni la date', () => q(`update public.avis_envois set cree_le = now() - interval '1 day' where id = $1`, [c.id]), 'journal_immuable');
  const unAutre = await tout('Un autre');
  await err('… ni le client', () => q(`update public.avis_envois set client_id = $2 where id = $1`, [c.id, unAutre]), 'journal_immuable');
  await err('une ligne ne s\'efface pas', () => q(`delete from public.avis_envois where id = $1`, [c.id]), 'journal_immuable');
  await err('… ni le journal entier (truncate)', () => q(`truncate public.avis_envois`), 'journal_immuable');
  await fn(null, 'avis_marquer($1::uuid, $2::text, $3::text, $4::text)', [c.id, 'envoye', 're_1', null], 'service_role');
  await err('une ligne « envoyée » ne change plus (même le propriétaire)', () => q(`update public.avis_envois set statut = 'echec', motif = 'x' where id = $1`, [c.id]), 'journal_immuable');
  await err('l\'administrateur connecté ne peut ni modifier, ni effacer, ni écrire au journal', () => sqlAs(admin, `delete from public.avis_envois`), 'permission denied|droit|privilege');
  await err('… modifier', () => sqlAs(admin, `update public.avis_envois set message = 'x'`), 'permission denied|droit|privilege');
  await err('… écrire', () => sqlAs(admin, `insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, delai, service, adresse, version_modele, message, statut) values (gen_random_uuid(), current_date, '${admin}', '${a}', 'texto', '2h', 'x', 'y', 'v', 'm', 'en_attente')`), 'permission denied|droit|privilege');
  eq('l\'administrateur LIT le journal et les modèles', [(await sqlAs(admin, `select count(*)::int n from public.avis_envois`))[0].n, (await sqlAs(admin, `select count(*)::int n from public.avis_modeles`))[0].n], [2, 4]);
  eq('un employé ne voit AUCUNE ligne du journal ni des modèles', [(await sqlAs(nina, `select count(*)::int n from public.avis_envois`))[0].n, (await sqlAs(nina, `select count(*)::int n from public.avis_modeles`))[0].n], [0, 0]);
  await err('un visiteur ne peut pas lire le journal', () => sqlAs(null, `select * from public.avis_envois`, [], 'anon'), 'permission denied|droit|privilege');
}

log('=== LES RÈGLES DE LA TABLE : CE QUE LA BASE REFUSE D’ELLE-MÊME ===');
{
  await vider();
  const a = await tout('Client des règles');
  const brut = (o = {}) => {
    const r = { lot_id: '00000000-0000-4000-8000-0000000000aa', jour: '2026-10-14', envoye_par: admin, client_id: a, canal: 'courriel', delai: '2h', service: 'S', adresse: 'A', version_modele: 'v', message: 'm', statut: 'en_attente', ...o };
    const cols = Object.keys(r);
    return q(`insert into public.avis_envois (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')})`, Object.values(r));
  };
  const jour = (n) => ({ jour: '2026-11-' + String(n).padStart(2, '0') });
  await err('un canal « sms » : refusé', () => brut({ canal: 'sms' }), 'avis_envois_canal_liste');
  await err('un statut inconnu : refusé', () => brut({ statut: 'livre' }), 'avis_envois_statut_liste');
  for (const d of ['abc', '0h', '100h', '3', 'h']) await err(`un délai « ${d} » : refusé`, () => brut({ delai: d }), 'avis_envois_delai_format');
  await brut({ delai: 'demain', ...jour(1) });
  await brut({ delai: '72h', canal: 'texto', ...jour(2) });
  pass('« demain » et « 72h » : acceptés');
  await err('un refus SANS motif : refusé', () => brut({ statut: 'refuse' }), 'avis_envois_refus_motif');
  await err('un motif sur une ligne qui n’est pas un refus : refusé', () => brut({ statut: 'en_attente', motif: 'desabonne' }), 'avis_envois_refus_motif');
  await brut({ statut: 'refuse', motif: 'desabonne', ...jour(3) });
  pass('un refus AVEC motif : accepté');
  await err('« envoyé » sans identifiant du fournisseur ni heure : refusé', () => brut({ statut: 'envoye' }), 'avis_envois_envoye_coherent');
  await err('… avec l’identifiant mais sans l’heure : refusé', () => brut({ statut: 'envoye', fournisseur_id: 'r1' }), 'avis_envois_envoye_coherent');
  await brut({ statut: 'envoye', fournisseur_id: 'r1', envoye_le: new Date().toISOString(), ...jour(4) });
  pass('… avec les deux : accepté');
  await err('un client qui n’existe pas : refusé (clé étrangère)', () => brut({ client_id: '00000000-0000-4000-8000-000000000000' }), 'foreign key|violates');
  await err('une personne qui n’existe pas comme auteur de la demande : refusé', () => brut({ envoye_par: '00000000-0000-4000-8000-000000000000' }), 'foreign key|violates');
  await err('un service vide : refusé', () => brut({ service: '' }), 'avis_envois_service_plage');
  await err('… de 101 caractères : refusé', () => brut({ service: 'x'.repeat(101) }), 'avis_envois_service_plage');
  await err('une adresse vide : refusée', () => brut({ adresse: '' }), 'avis_envois_adresse_plage');
  await err('… de 201 caractères : refusée', () => brut({ adresse: 'x'.repeat(201) }), 'avis_envois_adresse_plage');
  await err('un message absent : refusé', () => brut({ message: null }), 'null value|not-null|violates');
  await vider();
  // les modèles
  const mod = (o) => {
    const r = { version: 'essai', canal: 'texto', variante: 'heures', objet: null, texte: 'Un texte assez long pour passer', ...o };
    return q('insert into public.avis_modeles (version, canal, variante, objet, texte) values ($1, $2, $3, $4, $5)', [r.version, r.canal, r.variante, r.objet, r.texte]);
  };
  await err('un modèle de texto AVEC un objet : refusé', () => mod({ objet: 'Un objet' }), 'avis_modeles_objet_coherent');
  await err('un modèle de courriel SANS objet : refusé', () => mod({ canal: 'courriel' }), 'avis_modeles_objet_coherent');
  await err('… avec un objet trop court : refusé', () => mod({ canal: 'courriel', objet: 'Hé' }), 'avis_modeles_objet_coherent');
  await err('un canal « sms » : refusé', () => mod({ canal: 'sms' }), 'avis_modeles_canal_liste');
  await err('une variante inconnue : refusée', () => mod({ variante: 'bientot' }), 'avis_modeles_variante_liste');
  await err('un texte trop court : refusé', () => mod({ texte: 'Court' }), 'avis_modeles_texte_present');
  eq('rien de tout cela n’a laissé de trace', [await compte('avis_envois'), await compte('avis_modeles')], [0, 4]);
}

log('=== UN NOUVEAU MODÈLE : UNE NOUVELLE VERSION ===');
{
  await vider();
  const a = await tout('Client des versions');
  const v2 = (variante, canal, objet, texte) => q(`insert into public.avis_modeles (version, canal, variante, objet, texte) values ('avis-2026-11-v2', $1, $2, $3, $4)`, [canal, variante, objet, texte]);
  await v2('heures', 'texto', null, 'Version 2 : passage dans {delai} pour « {service} » ; ARRET pour ne plus recevoir.');
  await v2('demain', 'texto', null, 'Version 2 : passage demain pour « {service} » ; ARRET pour ne plus recevoir.');
  await v2('heures', 'courriel', 'V2 objet {delai_long}', 'Version 2 : passage dans {delai_long} à {adresse} pour « {service} ». {lien}');
  await v2('demain', 'courriel', 'V2 objet demain', 'Version 2 : passage demain à {adresse} pour « {service} ». {lien}');
  const r = await prep('2h', [L(a)]);
  eq('la version la plus récente en vigueur est utilisée (et notée au journal)', [ligne(r, a, 'texto').message, ligne(r, a, 'courriel').objet, (await q(`select distinct version_modele from public.avis_envois`)).map((x) => x.version_modele)], ['Version 2 : passage dans 2 h pour « Coupe de gazon » ; ARRET pour ne plus recevoir.', 'V2 objet 2 heures', ['avis-2026-11-v2']]);
  await q(`update public.avis_modeles set en_vigueur = false where version = 'avis-2026-11-v2'`);
  await vider();
  eq('retirer la version 2 : la version 1 reprend', ligne(await prep('2h', [L(a)]), a, 'texto').message, TEXTO_H('2 h', 'Coupe de gazon'));
  await q(`update public.avis_modeles set en_vigueur = false`);
  await vider();
  await err('aucun modèle en vigueur : refusé, et RIEN n\'est écrit au journal', () => prep('2h', [L(a)]), 'modele_introuvable');
  eq('… journal vide', await compte('avis_envois'), 0);
  await q(`update public.avis_modeles set en_vigueur = true where version = 'avis-2026-10-v1'`);
  await q(`update public.avis_modeles set en_vigueur = true where version = 'avis-2026-11-v2' and false`);
}

log('=== LE LIEN DE DÉSABONNEMENT DES COURRIELS ===');
{
  await vider();
  const a = await tout('Client du lien', { courriel: 'lien@exemple.ca' });
  const b = await tout('Autre client du lien', { courriel: 'autre@exemple.ca' });
  const jeton = (id, canal = 'courriel') => fn(null, 'avis_jeton($1::uuid, $2::text)', [id, canal], 'service_role');
  const ja = await jeton(a), jb = await jeton(b);
  eq('le jeton : 32 caractères hexadécimaux, le même à chaque fois, différent d\'un client à l\'autre et d\'un canal à l\'autre', [/^[0-9a-f]{32}$/.test(ja), ja === await jeton(a), ja !== jb, ja !== await jeton(a, 'texto')], [true, true, true, true]);
  const nonSale = crypto.createHash('sha256').update(`${a}|courriel|`).digest('hex').slice(0, 32);
  eq('le jeton dépend d’un SECRET de la base (il n’est pas le simple hachage de l’identifiant : personne ne peut le fabriquer)', ja !== nonSale, true);
  const des = (id, j, role = 'anon') => fn(null, 'avis_desabonner_par_jeton($1::uuid, $2::text)', [id, j], role);
  for (const [titre, id, j] of [['un faux jeton', a, 'x'.repeat(32)], ['le jeton d\'un AUTRE client', a, jb], ['un jeton vide', a, ''], ['un jeton tronqué', a, ja.slice(0, 31)], ['un client inconnu', '00000000-0000-4000-8000-000000000000', ja], ['aucun client', null, ja], ['aucun jeton', a, null]]) {
    await err(`${titre} : « lien_invalide » (toujours la même réponse : rien ne se découvre)`, () => des(id, j), 'lien_invalide');
  }
  eq('aucun lien invalide n’a désabonné personne', (await q(`select count(*)::int n from public.clients where desabonne_courriel_le is not null and id in ($1, $2)`, [a, b]))[0].n, 0);
  eq('le bon jeton, par un VISITEUR : désabonné', await des(a, ja), { statut: 'desabonne' });
  eq('… la fiche est marquée ; le registre note le retrait (courriel d\'avis, source « lien_desabonnement »)', [(await q(`select desabonne_courriel_le is not null d from public.clients where id = $1`, [a]))[0].d,
    (await q(`select canal, action, source, contact from public.consentements where client_id = $1 and action = 'retrait'`, [a]))[0]], [true, { canal: 'courriel_avis', action: 'retrait', source: 'lien_desabonnement', contact: 'lien@exemple.ca' }]);
  eq('… l\'autre client n\'est pas touché', (await q(`select desabonne_courriel_le is null d from public.clients where id = $1`, [b]))[0].d, true);
  eq('… cliquer deux fois ne casse rien', await des(a, ja), { statut: 'desabonne' });
  const r = await prep('2h', [L(a)]);
  eq('après le désabonnement : le courriel est refusé « desabonne », le texto part toujours (autre canal)', [ligne(r, a, 'courriel').motif, ligne(r, a, 'texto').statut], ['desabonne', 'en_attente']);
  // un client sans courriel
  const sansC = await client('Sans courriel');
  const jSans = await jeton(sansC);
  await err('un client sans courriel : « lien_invalide »', () => des(sansC, jSans), 'lien_invalide');
  // courriel partagé : les deux fiches sont désabonnées (même boîte)
  const p1 = await client('Syndic un', { courriel: 'partage@exemple.ca', avis_courriel: true }), p2 = await client('Syndic deux', { courriel: 'partage@exemple.ca', avis_courriel: true });
  await des(p1, await jeton(p1));
  eq('un courriel partagé par deux fiches : le lien désabonne la BOÎTE (les deux fiches)', (await q(`select count(*)::int n from public.clients where lower(courriel) = 'partage@exemple.ca' and desabonne_courriel_le is not null`))[0].n, 2);
  eq('le service et une personne connectée peuvent aussi l\'appeler', [(await des(b, jb, 'service_role')).statut, (await des(b, jb, 'authenticated')).statut], ['desabonne', 'desabonne']);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
