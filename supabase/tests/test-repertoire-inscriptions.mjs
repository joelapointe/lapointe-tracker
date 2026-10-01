// Demande 5 de Joé (30 sept. 2026) — Fichier SQL 30 : le RÉPERTOIRE CLIENTS, les INSCRIPTIONS aux avis par texto (page publique) et le REGISTRE DES CONSENTEMENTS.
// Banc d'essai local (base PGlite), sur le modèle de test-presence-temps.mjs. Ce que ce test NE peut PAS vérifier : le vrai Supabase (le fichier y est exécuté avec l'accord de Joé, puis sa
// requête « verification » est relue ; les en-têtes réels envoyés par PostgREST : ici on les imite avec set_config('request.headers', …)), ni la page web (test-site-avis.mjs), ni l'envoi
// des courriels et des textos (chantier C).
// SQL30_TEST (variable d'environnement) : une COPIE abîmée du fichier, pour les « erreurs volontaires » ; le vrai fichier n'est jamais touché.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';
import { PGlite } from '@electric-sql/pglite';

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const SQL30 = fs.readFileSync(process.env.SQL30_TEST || (SQL_DIR + '30-repertoire-clients-et-inscriptions.sql'), 'utf8');
const V1 = 'texto-2026-10-v1';
// Le texte de consentement approuvé (version 1), MOT POUR MOT. La page entretienlapointe.ca/avis (site-consentement/avis.html) doit afficher exactement le même (test-page-avis.mjs) :
// on ne le change que volontairement, avec une NOUVELLE version, jamais en modifiant celle-ci.
const TEXTE_V1 = 'J\'accepte de recevoir des textos d\'Entretien Lapointe au numéro ci-dessus, pour les avis liés à mes services : jour ou heure de passage, début des travaux, changement d\'horaire. Aucune publicité. La fréquence varie selon les travaux (jusqu\'à quelques textos par semaine en saison). Des frais de messagerie et de données peuvent s\'appliquer selon mon forfait. Je peux me désabonner en tout temps en répondant ARRET (ou STOP), ou obtenir de l\'aide en répondant AIDE (ou HELP) ou en appelant le 819 268-8069. Mon numéro n\'est ni vendu ni partagé avec des tiers, sauf le fournisseur qui envoie les textos pour Entretien Lapointe. Cette inscription est facultative : je reçois mes services même si je ne m\'inscris pas.';
const V1P = 'promo-2026-10-v1';   // le texte de la 2ᵉ case (offres par courriel), SÉPARÉ de celui des textos
const TEXTE_PROMO_V1 = 'J\'accepte aussi de recevoir par courriel, de temps en temps, les offres et les nouvelles d\'Entretien Lapointe (par exemple, un rappel avant la saison des feuilles). Je peux me désabonner en tout temps avec le lien au bas de chaque courriel ou en écrivant à info@entretienlapointe.ca. Cette case est facultative : elle n\'a aucun effet sur mes services ni sur mes avis de passage. Entretien Lapointe, 331, Le Petit Bellechasse N, Charette (Québec), 819 268-8069.';
const TABLES = ['clients', 'textes_consentement', 'avis_sel', 'inscriptions_avis', 'consentements'];

const db = await prepare(FILES);
await db.exec(`grant usage on schema public to service_role;`);   // (comme chez Supabase : service_role peut utiliser le schéma public)
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);   // (comme chez Supabase : tout objet créé reçoit d'office tous les droits ; les « revoke » du fichier doivent les retirer)
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
const nina = await emp('Nina'), luc = await emp('Luc');
const existe = async (nom) => (await q(`select to_regclass('public.' || $1) is not null as r`, [nom]))[0].r;
const fonctionExiste = async (sig) => (await q(`select to_regprocedure($1) is not null as r`, [sig]))[0].r;
const SIG_INSCRIRE = 'public.inscrire_avis(text, text, text, text, boolean, text, text, text, boolean, text)';
const SIG_PROMO = 'public.promo_courriel_permis(text, date, timestamptz, timestamptz, timestamptz, boolean)';
const SIG_DESAB = 'public.desabonner_contact(text, text, text)';
const SIG_RELIER = 'public.admin_relier_inscription(uuid, uuid)';
const SIG_IGNORER = 'public.admin_ignorer_inscription(uuid)';
const SIG_ENREG = 'public.admin_enregistrer_consentement(uuid, text, text, text, text)';
const headers = (h) => db.query(`select set_config('request.headers', $1, false)`, [h == null ? '' : (typeof h === 'string' ? h : JSON.stringify(h))]);
const n = async (sql, p) => (await q(sql, p))[0].n;
const compte = (t) => n(`select count(*)::int n from public.${t}`);

// Une inscription par la page publique (visiteur non connecté)
const inscrire = (nom, adresse, cel, cour, accepte = true, version = V1, piege = null, agent = null, promo = false, versionPromo = null) =>
  fn(null, `inscrire_avis($1::text,$2::text,$3::text,$4::text,$5::boolean,$6::text,$7::text,$8::text,$9::boolean,$10::text)`, [nom, adresse, cel, cour, accepte, version, piege, agent, promo, versionPromo], 'anon');
let cel = 0;
const celNeuf = () => '819555' + String(1000 + (++cel)).padStart(4, '0');   // 8195551001, 8195551002…
const client = async (nom, extra = {}) => {
  const c = { nom, ...extra };
  const cols = Object.keys(c), vals = Object.values(c);
  return (await sqlAs(admin, `insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, vals))[0].id;
};
const ligneClient = async (id) => (await q(`select * from public.clients where id = $1`, [id]))[0];
const vider = async () => {   // vider le registre (le propriétaire de la base seulement : on désactive un instant le déclencheur) PUIS les inscriptions
  await q(`alter table public.consentements disable trigger consentements_immuables`);
  await q(`delete from public.consentements`);
  await q(`alter table public.consentements enable trigger consentements_immuables`);
  await q(`delete from public.inscriptions_avis`);
};
const consents = (filtre = 'true', p = []) => q(`select canal, action, source, contact, version_texte, client_id, inscription_id, fait_par from public.consentements where ${filtre} order by fait_le, id`, p);

log('=== AVANT LE FICHIER : RIEN N\'EXISTE ; APRÈS : LES TABLES, LES FONCTIONS ET LA VUE SONT LÀ, ET RIEN D\'AUTRE NE CHANGE ===');
const stopsAvant = await q(`select id, adresse, route_id, service from public.stops order by id`);
const reglesStopsAvant = (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'stops' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd);
const reglesUtilAvant = (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'utilisateurs' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd);
const defAdmin = (await q(`select pg_get_functiondef('public.est_admin()'::regprocedure) d`))[0].d;
const defExiger = (await q(`select pg_get_functiondef('public._exiger_actif()'::regprocedure) d`))[0].d;
const colonnesStopsAvant = (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'stops' order by column_name`)).map((x) => x.column_name);
{
  eq('avant : aucune des 5 tables n\'existe', await Promise.all(TABLES.map(existe)), [false, false, false, false, false]);
  eq('… ni la vue clients_avant, ni les fonctions', [await existe('clients_avis'), await fonctionExiste(SIG_INSCRIRE), await fonctionExiste(SIG_PROMO), await fonctionExiste(SIG_DESAB)], [false, false, false, false]);
  eq('… et stops n\'a pas de colonne client_id', colonnesStopsAvant.includes('client_id'), false);
  const res30 = await db.exec(SQL30);
  eq('après : les 5 tables existent', await Promise.all(TABLES.map(existe)), [true, true, true, true, true]);
  eq('… la vue et toutes les fonctions existent', [await existe('clients_avis'), await fonctionExiste(SIG_INSCRIRE), await fonctionExiste(SIG_PROMO), await fonctionExiste(SIG_DESAB), await fonctionExiste(SIG_RELIER), await fonctionExiste(SIG_IGNORER), await fonctionExiste(SIG_ENREG), await fonctionExiste('public._cellulaire_normalise(text)')], [true, true, true, true, true, true, true, true]);
  eq('… clients, inscriptions et registre sont VIDES ; DEUX versions du texte (textos et offres par courriel) ; UN sel', [await compte('clients'), await compte('inscriptions_avis'), await compte('consentements'), await compte('textes_consentement'), await compte('avis_sel')], [0, 0, 0, 2, 1]);
  eq('… la version 1 du texte : canal texto, en vigueur, avec tous les éléments exigés par les opérateurs', (await q(`select version, canal, en_vigueur, texte like '%Entretien Lapointe%' a, texte like '%Aucune publicité%' b, texte like '%frais de messagerie et de données%' c, texte like '%ARRET%' d, texte like '%AIDE%' e, texte like '%819 268-8069%' f, texte like '%ni vendu ni partagé%' g, texte like '%facultative%' h, texte like '%fréquence varie%' i from public.textes_consentement`))[0],
    { version: V1, canal: 'texto', en_vigueur: true, a: true, b: true, c: true, d: true, e: true, f: true, g: true, h: true, i: true });
  eq('… et son texte est EXACTEMENT celui approuvé (la page du site doit afficher le même, mot pour mot)', (await q(`select texte from public.textes_consentement where version = $1`, [V1]))[0].texte, TEXTE_V1);
  eq('… la version 1 du texte des OFFRES PAR COURRIEL : canal courriel_promo, en vigueur, EXACTEMENT le texte approuvé', (await q(`select canal, en_vigueur, texte from public.textes_consentement where version = $1`, [V1P]))[0], { canal: 'courriel_promo', en_vigueur: true, texte: TEXTE_PROMO_V1 });
  vrai('… ce texte nomme l\'entreprise, dit « par courriel », la façon de se désabonner, que la case est facultative, et donne l\'adresse, le téléphone et le courriel (exigés par la loi dans une demande de consentement)', [/Entretien Lapointe/, /par courriel/, /me désabonner en tout temps avec le lien au bas de chaque courriel/, /info@entretienlapointe\.ca/, /facultative/, /sur mes services ni sur mes avis de passage/, /331, Le Petit Bellechasse N, Charette \(Québec\)/, /819 268-8069/].every((r) => r.test(TEXTE_PROMO_V1)));
  eq('… la sécurité (RLS) est ACTIVE sur les 5 tables', (await q(`select relname from pg_class where oid in ('public.clients'::regclass, 'public.textes_consentement'::regclass, 'public.avis_sel'::regclass, 'public.inscriptions_avis'::regclass, 'public.consentements'::regclass) and relrowsecurity order by relname`)).map((x) => x.relname), ['avis_sel', 'clients', 'consentements', 'inscriptions_avis', 'textes_consentement']);
  eq('… les règles d\'accès : tout est réservé à l\'administrateur (et « avis_sel » n\'en a AUCUNE : personne n\'y a accès)', (await q(`select tablename || '.' || policyname || ' (' || cmd || ')' r from pg_policies where schemaname = 'public' and tablename in ('clients','textes_consentement','avis_sel','inscriptions_avis','consentements') order by tablename, policyname`)).map((x) => x.r),
    ['clients.clients_admin (ALL)', 'consentements.consentements_admin_lecture (SELECT)', 'inscriptions_avis.inscriptions_avis_admin_lecture (SELECT)', 'textes_consentement.textes_consentement_admin_lecture (SELECT)']);
  eq('… un visiteur non connecté n\'a AUCUN droit sur les tables ni sur la vue', (await q(`select ${TABLES.concat(['clients_avis']).map((t) => `has_table_privilege('anon', 'public.${t}', 'select') or has_table_privilege('anon', 'public.${t}', 'insert') or has_table_privilege('anon', 'public.${t}', 'update') or has_table_privilege('anon', 'public.${t}', 'delete')`).join(' or ')} as r`))[0].r, false);
  eq('… une personne connectée ne peut JAMAIS supprimer (ni clients, ni inscriptions, ni registre, ni textes)', (await q(`select ${TABLES.concat(['clients_avis']).map((t) => `has_table_privilege('authenticated', 'public.${t}', 'delete')`).join(' or ')} as r`))[0].r, false);
  eq('… connecté : lecture seule sur les textes, les inscriptions et le registre ; aucun droit sur « avis_sel »', (await q(`select ${['textes_consentement', 'inscriptions_avis', 'consentements'].map((t) => `has_table_privilege('authenticated', 'public.${t}', 'select') and not (has_table_privilege('authenticated', 'public.${t}', 'insert') or has_table_privilege('authenticated', 'public.${t}', 'update'))`).join(' and ')} as lect, (has_table_privilege('authenticated', 'public.avis_sel', 'select') or has_table_privilege('authenticated', 'public.avis_sel', 'insert') or has_table_privilege('authenticated', 'public.avis_sel', 'update')) as sel`))[0], { lect: true, sel: false });
  const colsEcrivables = ['nom', 'nom_entreprise', 'type_client', 'adresse', 'ville', 'code_postal', 'courriel', 'telephone', 'cellulaire', 'avis_courriel', 'dernier_contrat_le', 'quickbooks_nom', 'notes', 'actif'];
  const colsProtegees = ['id', 'avis_texto', 'promo_consentement_expres_le', 'desabonne_courriel_le', 'desabonne_texto_le', 'desabonne_promo_le', 'cree_le', 'maj_le'];
  eq('… clients : l\'administrateur peut écrire les 14 colonnes des coordonnées (insert et update)', (await q(`select ${colsEcrivables.map((c) => `has_column_privilege('authenticated', 'public.clients', '${c}', 'insert') and has_column_privilege('authenticated', 'public.clients', '${c}', 'update')`).join(' and ')} as r`))[0].r, true);
  eq('… clients : les 8 colonnes du CONSENTEMENT et du système ne s\'écrivent PAS directement (ni insert ni update)', (await q(`select ${colsProtegees.map((c) => `has_column_privilege('authenticated', 'public.clients', '${c}', 'insert') or has_column_privilege('authenticated', 'public.clients', '${c}', 'update')`).join(' or ')} as r`))[0].r, false);
  eq('… inscrire_avis : un visiteur ET une personne connectée peuvent l\'appeler', (await q(`select has_function_privilege('anon', '${SIG_INSCRIRE}', 'execute') a, has_function_privilege('authenticated', '${SIG_INSCRIRE}', 'execute') c`))[0], { a: true, c: true });
  eq('… les 3 fonctions de l\'administrateur : pas de visiteur, une personne connectée oui (elles vérifient elles-mêmes qu\'elle est administratrice)', (await q(`select ${[SIG_RELIER, SIG_IGNORER, SIG_ENREG].map((s) => `has_function_privilege('anon', '${s}', 'execute')`).join(' or ')} a, ${[SIG_RELIER, SIG_IGNORER, SIG_ENREG].map((s) => `has_function_privilege('authenticated', '${s}', 'execute')`).join(' and ')} c`))[0], { a: false, c: true });
  eq('… desabonner_contact : réservée au rôle service_role (ni visiteur, ni personne connectée)', (await q(`select has_function_privilege('anon', '${SIG_DESAB}', 'execute') a, has_function_privilege('authenticated', '${SIG_DESAB}', 'execute') c, has_function_privilege('service_role', '${SIG_DESAB}', 'execute') s`))[0], { a: false, c: false, s: true });
  eq('… les fonctions internes (normalisation du cellulaire, déclencheurs) ne sont appelables ni par un visiteur ni par une personne connectée', (await q(`select ${['public._cellulaire_normalise(text)', 'public._consentements_immuables()', 'public._textes_consentement_immuables()', 'public._clients_avant_ecriture()'].map((s) => `has_function_privilege('anon', '${s}', 'execute') or has_function_privilege('authenticated', '${s}', 'execute')`).join(' or ')} as r`))[0].r, false);
  eq('… promo_courriel_permis : pas de visiteur, une personne connectée oui', (await q(`select has_function_privilege('anon', '${SIG_PROMO}', 'execute') a, has_function_privilege('authenticated', '${SIG_PROMO}', 'execute') c`))[0], { a: false, c: true });
  eq('… une seule version de chaque fonction', (await q(`select proname, count(*)::int n from pg_proc where pronamespace = 'public'::regnamespace and proname in ('inscrire_avis','admin_relier_inscription','admin_ignorer_inscription','admin_enregistrer_consentement','desabonner_contact','promo_courriel_permis','_cellulaire_normalise') group by proname order by proname`)).map((x) => x.proname + ':' + x.n),
    ['_cellulaire_normalise:1', 'admin_enregistrer_consentement:1', 'admin_ignorer_inscription:1', 'admin_relier_inscription:1', 'desabonner_contact:1', 'inscrire_avis:1', 'promo_courriel_permis:1']);
  eq('… les fonctions qui écrivent sont « security definer » et n\'ont PAS de chemin de recherche ouvert (search_path vide)', (await q(`select proname, prosecdef, array_to_string(proconfig, ',') cfg from pg_proc where pronamespace = 'public'::regnamespace and proname in ('inscrire_avis','admin_relier_inscription','admin_ignorer_inscription','admin_enregistrer_consentement','desabonner_contact','_clients_avant_ecriture') order by proname`)).map((x) => [x.proname, x.prosecdef, x.cfg]),
    [['_clients_avant_ecriture', true, 'search_path=""'], ['admin_enregistrer_consentement', true, 'search_path=""'], ['admin_ignorer_inscription', true, 'search_path=""'], ['admin_relier_inscription', true, 'search_path=""'], ['desabonner_contact', true, 'search_path=""'], ['inscrire_avis', true, 'search_path=""']]);
  eq('… la vue clients_avis respecte les droits de celui qui la lit (security_invoker)', (await q(`select reloptions::text o from pg_class where oid = 'public.clients_avis'::regclass`))[0].o, '{security_invoker=true}');
  eq('… stops a maintenant client_id (uuid, vide permis) et RIEN d\'autre de plus', [(await q(`select data_type, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'stops' and column_name = 'client_id'`))[0], (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'stops' order by column_name`)).map((x) => x.column_name).filter((c) => !colonnesStopsAvant.includes(c))],
    [{ data_type: 'uuid', is_nullable: 'YES' }, ['client_id']]);
  eq('… les arrêts existants sont intacts (mêmes lignes) et aucun n\'a de client', [JSON.stringify(await q(`select id, adresse, route_id, service from public.stops order by id`)) === JSON.stringify(stopsAvant), await n(`select count(*)::int n from public.stops where client_id is not null`)], [true, 0]);
  eq('… les règles d\'accès de stops et d\'utilisateurs n\'ont pas changé ; est_admin et _exiger_actif non plus', [
    (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'stops' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd).join('|') === reglesStopsAvant.join('|'),
    (await q(`select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'utilisateurs' order by policyname`)).map((x) => x.policyname + ' ' + x.cmd).join('|') === reglesUtilAvant.join('|'),
    (await q(`select pg_get_functiondef('public.est_admin()'::regprocedure) d`))[0].d === defAdmin,
    (await q(`select pg_get_functiondef('public._exiger_actif()'::regprocedure) d`))[0].d === defExiger], [true, true, true, true]);
  eq('… la requête « verification » du bas du fichier dit la vérité (celle que Joé et Claude lisent après l\x27exécution)', Object.fromEntries(Object.entries(res30[res30.length - 1].rows[0].verification).sort()), Object.fromEntries(Object.entries({ tables: ['avis_sel', 'clients', 'consentements', 'inscriptions_avis', 'textes_consentement'], regles_actives: ['avis_sel', 'clients', 'consentements', 'inscriptions_avis', 'textes_consentement'], regles: ['clients.clients_admin (ALL)', 'consentements.consentements_admin_lecture (SELECT)', 'inscriptions_avis.inscriptions_avis_admin_lecture (SELECT)', 'textes_consentement.textes_consentement_admin_lecture (SELECT)'], visiteur_peut_lire_les_tables: false, connecte_peut_ecrire_le_consentement: false, visiteur_peut_appeler: ['inscrire_avis'], desabonner_reserve_au_service: true, colonne_stops_client_id: 'uuid', texte_en_vigueur: V1, texte_promo_en_vigueur: V1P, clients: 0, inscriptions: 0, consentements: 0 }).sort()));
  eq('… les 7 index existent', (await q(`select indexname from pg_indexes where schemaname = 'public' and indexname in ('clients_courriel_idx','clients_cellulaire_idx','stops_client_id_idx','inscriptions_avis_ip_idx','inscriptions_avis_cellulaire_idx','consentements_client_idx','consentements_contact_idx') order by indexname`)).map((x) => x.indexname), ['clients_cellulaire_idx', 'clients_courriel_idx', 'consentements_client_idx', 'consentements_contact_idx', 'inscriptions_avis_cellulaire_idx', 'inscriptions_avis_ip_idx', 'stops_client_id_idx']);
  eq('… les clés étrangères : stops.client_id met à VIDE si la fiche disparaît ; les autres ne supprimentt JAMAIS en cascade (registre et inscriptions restent)', (await q(`select c.conrelid::regclass::text || '.' || a.attname col, c.confdeltype::text t from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey) where c.contype = 'f' and c.conrelid in ('public.stops'::regclass, 'public.inscriptions_avis'::regclass, 'public.consentements'::regclass) and a.attname in ('client_id','inscription_id','version_texte','version_promo','traitee_par','fait_par') order by 1`)).map((x) => x.col + ':' + x.t),
    ['consentements.client_id:a', 'consentements.fait_par:a', 'consentements.inscription_id:a', 'consentements.version_texte:a', 'inscriptions_avis.client_id:a', 'inscriptions_avis.traitee_par:a', 'inscriptions_avis.version_promo:a', 'inscriptions_avis.version_texte:a', 'stops.client_id:n']);
}

log('\n=== SANS LES FICHIERS PRÉCÉDENTS, LE FICHIER REFUSE DE S\'EXÉCUTER ET NE CRÉE RIEN ===');
{
  const base = `create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;`;
  const vide = new PGlite();
  await vide.exec(base);
  await err('dans une base sans les tables stops et utilisateurs : le fichier refuse de s\'exécuter (il dit pourquoi : ce sont les TABLES qui manquent)', () => vide.exec(SQL30), 'les tables stops et utilisateurs n\'existent pas');
  eq('… et il n\'a rien créé (aucune table)', (await vide.query(`select count(*)::int n from pg_tables where schemaname = 'public'`)).rows[0].n, 0);
  const sans = new PGlite();
  await sans.exec(base + ` create table public.stops (id uuid primary key); create table public.utilisateurs (id uuid primary key);`);
  await err('avec les tables mais sans est_admin ni _exiger_actif (fichiers 01 et 04) : refusé aussi', () => sans.exec(SQL30), 'fonctions de base');
  eq('… et rien n\'a été créé (ni table clients, ni colonne client_id dans stops)', [(await sans.query(`select to_regclass('public.clients') is not null r`)).rows[0].r, (await sans.query(`select count(*)::int n from information_schema.columns where table_name = 'stops' and column_name = 'client_id'`)).rows[0].n], [false, 0]);
}

log('\n=== ON PEUT L\'EXÉCUTER PLUSIEURS FOIS : RIEN N\'EST EFFACÉ, LE SEL ET LE TEXTE NE CHANGENT JAMAIS ===');
{
  const sel = (await q(`select sel from public.avis_sel`))[0].sel;
  const c1 = await client('Client de départ', { courriel: 'A@B.ca' });
  await db.exec(SQL30);
  await db.exec(SQL30);
  eq('ré-exécuter deux fois le fichier garde le client déjà créé', await n(`select count(*)::int n from public.clients where id = $1`, [c1]), 1);
  eq('… garde le MÊME sel (les empreintes d\'adresses IP déjà gardées restent comparables)', (await q(`select sel, count(*) over ()::int n from public.avis_sel`))[0], { sel, n: 1 });
  eq('… ne double ni la version du texte, ni les règles d\'accès, ni les déclencheurs, ni les règles CHECK', [
    await compte('textes_consentement'),
    await n(`select count(*)::int n from pg_policies where schemaname = 'public' and tablename in ('clients','textes_consentement','avis_sel','inscriptions_avis','consentements')`),
    await n(`select count(*)::int n from pg_trigger where not tgisinternal and tgrelid in ('public.clients'::regclass, 'public.consentements'::regclass, 'public.textes_consentement'::regclass)`),
    await n(`select count(*)::int n from pg_constraint where contype = 'c' and conrelid in ('public.clients'::regclass, 'public.inscriptions_avis'::regclass, 'public.consentements'::regclass, 'public.textes_consentement'::regclass)`)], [2, 4, 4, 26]);
  await q(`update public.clients set nom = 'Modifié' where id = $1`, [c1]);
  await db.exec(SQL30);
  eq('… ne remet pas à zéro ce que Joé a changé dans une fiche', (await ligneClient(c1)).nom, 'Modifié');
  await q(`delete from public.clients where id = $1`, [c1]);
}

log('\n=== LE CELLULAIRE : TOUTES LES FORMES D\'ÉCRITURE DONNENT LE MÊME NUMÉRO, LES MAUVAIS SONT REFUSÉS ===');
{
  const norm = async (s) => (await q(`select public._cellulaire_normalise($1) r`, [s]))[0].r;
  for (const [entree, attendu] of [['819 555-1234', '+18195551234'], ['(819) 555-1234', '+18195551234'], ['819-555-1234', '+18195551234'], ['8195551234', '+18195551234'], ['1 819 555 1234', '+18195551234'], ['+1 (819) 555-1234', '+18195551234'], ['18195551234', '+18195551234'], ['819.555.1234', '+18195551234'], ['  819 555 1234  ', '+18195551234'], ['819 555-1234 poste 5', null], ['219 555 1234', '+12195551234'], ['999 999 9999', '+19999999999']]) {
    eq(`« ${entree} » → ${attendu}`, await norm(entree), attendu);
  }
  for (const mauvais of ['', '   ', '123', '1234567890', '0195551234', '819 155 1234', '819 055 1234', '819555123', '819555123456', 'abc', '+44 20 7946 0958', '1 1 819 555 1234', '28195551234']) {
    eq(`refusé (aucun numéro) : « ${mauvais} »`, await norm(mauvais), null);
  }
  eq('refusé : vide (NULL)', await norm(null), null);
}

log('\n=== LA PAGE PUBLIQUE : S\'INSCRIRE AUX AVIS PAR TEXTO (visiteur non connecté) ===');
await headers({ 'x-forwarded-for': '203.0.113.10' });
{
  const c1 = celNeuf();
  const r = await inscrire('  Marie Tremblay  ', ' 12 rue des Érables, Charette ', '(819) ' + c1.slice(3, 6) + '-' + c1.slice(6), '  Marie.T@Exemple.CA ', true, V1, null, 'Mozilla/5.0 (Android)');
  eq('une inscription valide : « enregistree »', r, { statut: 'enregistree' });
  const i = (await q(`select * from public.inscriptions_avis`))[0];
  eq('… UNE ligne : nom et adresse sans les espaces autour, numéro au format +1…, courriel en minuscules, version, statut « nouvelle », pas encore de client', [i.nom, i.adresse, i.cellulaire, i.courriel, i.version_texte, i.statut, i.client_id, i.traitee_le, i.traitee_par, i.agent], ['Marie Tremblay', '12 rue des Érables, Charette', '+1' + c1, 'marie.t@exemple.ca', V1, 'nouvelle', null, null, null, 'Mozilla/5.0 (Android)']);
  vrai('… l\'heure d\'inscription est posée toute seule (maintenant)', Math.abs(Date.now() - new Date(i.cree_le).getTime()) < 120000);
  vrai('… l\'adresse IP n\'est PAS gardée : seulement une EMPREINTE de 64 caractères qui ne contient pas l\'adresse', /^[0-9a-f]{64}$/.test(i.ip_hash) && !i.ip_hash.includes('203'), i.ip_hash);
  eq('… le registre a reçu l\'ACCORD au même moment (canal texto, source « page_avis », le numéro, la version lue, la même empreinte, pas encore de client)', (await q(`select canal, action, source, contact, version_texte, client_id, inscription_id = $1 as lie, ip_hash = $2 as meme_hash, fait_par from public.consentements`, [i.id, i.ip_hash]))[0],
    { canal: 'texto', action: 'accord', source: 'page_avis', contact: '+1' + c1, version_texte: V1, client_id: null, lie: true, meme_hash: true, fait_par: null });
  const r2 = await inscrire('Paul Gagnon', '5 chemin du Lac', '819 555 ' + String(2000 + cel), null);
  eq('sans courriel : accepté, courriel vide', [r2.statut, (await q(`select courriel from public.inscriptions_avis where nom = 'Paul Gagnon'`))[0].courriel], ['enregistree', null]);
  eq('un courriel de seulement des espaces compte comme « pas de courriel »', (await inscrire('Paul G2', '5 chemin du Lac', '819 555 ' + String(3000 + cel), '   ')).statut, 'enregistree');
  eq('… et aucune donnée n\'est lisible par un visiteur (permission refusée)', await (async () => { try { await sqlAs(null, `select count(*) from public.inscriptions_avis`, [], 'anon'); return 'lu'; } catch (e) { return /permission denied/i.test(e.message) ? 'refuse' : e.message; } })(), 'refuse');
  await vider();
}

log('\n=== CHAQUE CHAMP EST VÉRIFIÉ : UN MAUVAIS CHAMP EST REFUSÉ ET RIEN N\'EST GARDÉ ===');
{
  const bon = () => ['Marie Tremblay', '12 rue des Érables', '819 555 4321', 'marie@exemple.ca', true, V1];
  const essai = (modif) => { const a = bon(); Object.entries(modif).forEach(([k, v]) => { a[k] = v; }); return () => inscrire(...a); };
  await err('nom d\'un seul caractère refusé', essai({ 0: 'M' }), 'nom_invalide');
  await err('nom de 101 caractères refusé', essai({ 0: 'M'.repeat(101) }), 'nom_invalide');
  await err('nom fait d\'espaces refusé', essai({ 0: '     ' }), 'nom_invalide');
  await err('nom absent (NULL) refusé', essai({ 0: null }), 'nom_invalide');
  eq('… un nom de 2 caractères et un nom de 100 caractères sont acceptés', [(await inscrire('Li', 'Adresse 12345', '819 555 6001', null)).statut, (await inscrire('M'.repeat(100), 'Adresse 12345', '819 555 6002', null)).statut], ['enregistree', 'enregistree']);
  await err('adresse de 4 caractères refusée', essai({ 1: '12 r' }), 'adresse_invalide');
  await err('adresse de 201 caractères refusée', essai({ 1: 'a'.repeat(201) }), 'adresse_invalide');
  await err('adresse absente (NULL) refusée', essai({ 1: null }), 'adresse_invalide');
  eq('… une adresse de 5 caractères et une de 200 sont acceptées', [(await inscrire('Li Wu', '12 rue', '819 555 6003', null)).statut, (await inscrire('Li Wu', 'a'.repeat(200), '819 555 6004', null)).statut], ['enregistree', 'enregistree']);
  await err('cellulaire invalide refusé', essai({ 2: '123' }), 'cellulaire_invalide');
  await err('cellulaire absent (NULL) refusé', essai({ 2: null }), 'cellulaire_invalide');
  await err('cellulaire étranger refusé', essai({ 2: '+44 20 7946 0958' }), 'cellulaire_invalide');
  await err('courriel sans arobase refusé', essai({ 3: 'marie.exemple.ca' }), 'courriel_invalide');
  await err('courriel sans point refusé', essai({ 3: 'marie@exemple' }), 'courriel_invalide');
  await err('courriel avec espace refusé', essai({ 3: 'ma rie@exemple.ca' }), 'courriel_invalide');
  await err('courriel de plus de 150 caractères refusé', essai({ 3: 'a'.repeat(140) + '@exemple.ca' }), 'courriel_invalide');
  await err('case NON cochée (false) : refusé', essai({ 4: false }), 'consentement_requis');
  await err('case absente (NULL) : refusé', essai({ 4: null }), 'consentement_requis');
  await err('version du texte inconnue refusée', essai({ 5: 'texto-inconnu' }), 'version_inconnue');
  await err('version du texte absente refusée', essai({ 5: null }), 'version_inconnue');
  await q(`update public.textes_consentement set en_vigueur = false where version = $1`, [V1]);
  await err('une version qui n\'est plus « en vigueur » est refusée (la page doit afficher le texte courant)', essai({}), 'version_inconnue');
  await q(`update public.textes_consentement set en_vigueur = true where version = $1`, [V1]);
  eq('… après tous ces refus : seulement les 4 inscriptions valides des essais de limites, et 4 lignes au registre', [await compte('inscriptions_avis'), await compte('consentements')], [4, 4]);
  await vider();
}

log('\n=== LE PIÈGE ANTI-ROBOT ET LE DOUBLE TOUCHER ===');
{
  const c = celNeuf();
  eq('un champ caché rempli (un robot) : on répond « enregistree » mais RIEN n\'est gardé', [(await inscrire('Robot Bob', '1 rue du Robot', c, 'r@r.ca', true, V1, 'http://spam.example')).statut, await compte('inscriptions_avis'), await compte('consentements')], ['enregistree', 0, 0]);
  eq('… même un champ caché presque vide (un seul caractère) est un robot', [(await inscrire('Robot Bob', '1 rue du Robot', c, 'r@r.ca', true, V1, 'x')).statut, await compte('inscriptions_avis')], ['enregistree', 0]);
  eq('… un champ caché fait seulement d\'espaces ou vide n\'en est PAS un', [(await inscrire('Vrai Vrai', '1 rue du Vrai', c, null, true, V1, '   ')).statut, await compte('inscriptions_avis')], ['enregistree', 1]);
  const avant = await compte('inscriptions_avis');
  eq('un double toucher (le même numéro, écrit autrement) : « enregistree », mais UNE seule inscription et un seul accord', [(await inscrire('Vrai Vrai', '1 rue du Vrai', '(' + c.slice(0, 3) + ') ' + c.slice(3, 6) + '-' + c.slice(6), null)).statut, (await compte('inscriptions_avis')) - avant, await compte('consentements')], ['enregistree', 0, 1]);
  await q(`update public.inscriptions_avis set cree_le = now() - interval '25 hours'`);
  eq('… 25 heures plus tard, le même numéro peut s\'inscrire de nouveau (nouvelle ligne)', [(await inscrire('Vrai Vrai', '1 rue du Vrai', c, null)).statut, await compte('inscriptions_avis')], ['enregistree', 2]);
  await q(`update public.inscriptions_avis set cree_le = now() - interval '23 hours 50 minutes'`);
  eq('… mais pas 23 h 50 après', [(await inscrire('Vrai Vrai', '1 rue du Vrai', c, null)).statut, await compte('inscriptions_avis')], ['enregistree', 2]);
  await vider();
}

log('\n=== LES LIMITES PAR ADRESSE IP (l\'adresse est lue dans les en-têtes de la requête) ===');
{
  const hashDe = async (nom) => (await q(`select ip_hash from public.inscriptions_avis where nom = $1`, [nom]))[0].ip_hash;
  await headers({ 'x-forwarded-for': '198.51.100.7' });
  for (let k = 1; k <= 5; k++) await inscrire('Ip A ' + k, 'Adresse ' + k + ' rue', celNeuf(), null);
  eq('5 inscriptions dans l\'heure depuis la même adresse : acceptées', await compte('inscriptions_avis'), 5);
  await err('… la 6ᵉ est refusée (trop de demandes)', () => inscrire('Ip A 6', 'Adresse 6 rue', celNeuf(), null), 'trop_de_demandes');
  await headers({ 'x-forwarded-for': '198.51.100.8' });
  eq('… une AUTRE adresse n\'est pas touchée', (await inscrire('Ip B 1', 'Adresse 1 rue', celNeuf(), null)).statut, 'enregistree');
  await headers({ 'x-forwarded-for': '198.51.100.7' });
  await q(`update public.inscriptions_avis set cree_le = now() - interval '61 minutes' where nom like 'Ip A %'`);
  eq('… 61 minutes plus tard la première adresse peut de nouveau s\'inscrire (limite d\'une heure)', (await inscrire('Ip A 7', 'Adresse 7 rue', celNeuf(), null)).statut, 'enregistree');
  for (let k = 8; k <= 11; k++) await inscrire('Ip A ' + k, 'Adresse ' + k + ' rue', celNeuf(), null);
  eq('… (elle fait 5 de plus dans l\'heure, donc 10 en tout ce jour-là)', await n(`select count(*)::int n from public.inscriptions_avis where nom like 'Ip A %'`), 10);
  await q(`update public.inscriptions_avis set cree_le = now() - interval '120 minutes' where nom like 'Ip A %'`);
  for (let k = 12; k <= 15; k++) await inscrire('Ip A ' + k, 'Adresse ' + k + ' rue', celNeuf(), null);
  eq('… et 15 dans la journée (la 15ᵉ passe)', await n(`select count(*)::int n from public.inscriptions_avis where nom like 'Ip A %'`), 14);
  await inscrire('Ip A 16', 'Adresse 16 rue', celNeuf(), null);
  await err('… la 16ᵉ de la journée est refusée même si l\'heure est calme (limite d\'une journée)', () => inscrire('Ip A 17', 'Adresse 17 rue', celNeuf(), null), 'trop_de_demandes');
  await q(`update public.inscriptions_avis set cree_le = now() - interval '25 hours' where nom like 'Ip A %'`);
  eq('… le lendemain elle peut de nouveau', (await inscrire('Ip A 18', 'Adresse 18 rue', celNeuf(), null)).statut, 'enregistree');

  // les en-têtes
  await vider();
  await headers({ 'x-forwarded-for': '198.51.100.20, 10.0.0.1, 10.0.0.2' });
  await inscrire('Xff 1', 'Adresse xff rue', celNeuf(), null);
  await headers({ 'x-forwarded-for': '198.51.100.20' });
  await inscrire('Xff 2', 'Adresse xff rue', celNeuf(), null);
  eq('« x-forwarded-for » avec plusieurs adresses : seule la PREMIÈRE compte (la même empreinte que l\'adresse seule)', (await hashDe('Xff 1')) === (await hashDe('Xff 2')), true);
  await headers({ 'x-forwarded-for': '198.51.100.21' });
  await inscrire('Xff 3', 'Adresse xff rue', celNeuf(), null);
  eq('… une autre adresse : une autre empreinte', (await hashDe('Xff 3')) !== (await hashDe('Xff 1')), true);
  await headers({ 'cf-connecting-ip': '198.51.100.20', 'x-forwarded-for': '203.0.113.99' });
  await inscrire('Cf 1', 'Adresse cf rue', celNeuf(), null);
  eq('« cf-connecting-ip » (l\'adresse vue par Cloudflare) passe AVANT « x-forwarded-for »', (await hashDe('Cf 1')) === (await hashDe('Xff 1')), true);
  await headers(null);
  await inscrire('Sans 1', 'Adresse sans rue', celNeuf(), null);
  await headers('ceci n\'est pas du JSON');
  await inscrire('Sans 2', 'Adresse sans rue', celNeuf(), null);
  await headers({});
  await inscrire('Sans 3', 'Adresse sans rue', celNeuf(), null);
  eq('sans en-têtes, avec des en-têtes illisibles ou vides : l\'inscription marche, avec une empreinte commune « inconnue »', [(await hashDe('Sans 1')) === (await hashDe('Sans 2')), (await hashDe('Sans 2')) === (await hashDe('Sans 3')), /^[0-9a-f]{64}$/.test(await hashDe('Sans 1'))], [true, true, true]);
  const hashAvant = await hashDe('Xff 1');
  await q(`update public.avis_sel set sel = 'un-autre-sel'`);
  await headers({ 'x-forwarded-for': '198.51.100.20' });
  await inscrire('Xff 4', 'Adresse xff rue', celNeuf(), null);
  eq('l\'empreinte dépend du SEL secret de la base (un autre sel : une autre empreinte pour la même adresse)', (await hashDe('Xff 4')) !== hashAvant, true);
  await q(`delete from public.avis_sel`);
  await db.exec(SQL30);
  eq('… et si le sel avait disparu, le fichier en remet un nouveau (jamais deux)', await compte('avis_sel'), 1);

  // la limite de toute la base
  await vider();
  await q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, version_texte, ip_hash) select 'Masse ' || g, 'Adresse ' || g || ' rue', '+1819556' || lpad(g::text, 4, '0'), '${V1}', 'h' || g from generate_series(1, 199) g`);
  await headers({ 'x-forwarded-for': '192.0.2.1' });
  eq('199 inscriptions dans la journée (toutes adresses) : la 200ᵉ passe', (await inscrire('Masse 200', 'Adresse 200 rue', celNeuf(), null)).statut, 'enregistree');
  await headers({ 'x-forwarded-for': '192.0.2.2' });
  await err('… la 201ᵉ est refusée (limite de la base : 200 par jour)', () => inscrire('Masse 201', 'Adresse 201 rue', celNeuf(), null), 'trop_de_demandes');
  await q(`update public.inscriptions_avis set cree_le = now() - interval '25 hours'`);
  eq('… le lendemain, elle passe', (await inscrire('Masse 202', 'Adresse 202 rue', celNeuf(), null)).statut, 'enregistree');
  await vider();
  await headers({ 'x-forwarded-for': '203.0.113.10' });
}

log('\n=== DES CHAÎNES PIÈGES SONT GARDÉES COMME DU SIMPLE TEXTE ===');
{
  const piege = `Robert'); drop table public.clients;--`;
  eq('une apostrophe et du SQL dans le nom : gardés tels quels, rien d\'exécuté', [(await inscrire(piege, '1 rue Piège, Charette', celNeuf(), null)).statut, (await q(`select nom from public.inscriptions_avis where nom = $1`, [piege])).length, await existe('clients')], ['enregistree', 1, true]);
  eq('… et l\'agent (le navigateur) trop long est COUPÉ à 300 caractères', (await (async () => { await inscrire('Agent Long', '1 rue Agent', celNeuf(), null, true, V1, null, 'x'.repeat(500)); return (await q(`select char_length(agent) n from public.inscriptions_avis where nom = 'Agent Long'`))[0].n; })()), 300);
  await vider();
}

log('\n=== LES RÈGLES DES TABLES TIENNENT MÊME POUR LE PROPRIÉTAIRE DE LA BASE (qui n\'est pas arrêté par la fonction de la page) ===');
{
  const insI = (nom, adresse, cel, cour, colExtra = null, valExtra = null) =>
    q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, courriel, version_texte${colExtra ? ', ' + colExtra : ''}) values ($1, $2, $3, $4, '${V1}'${colExtra ? ', $5' : ''})`, colExtra ? [nom, adresse, cel, cour, valExtra] : [nom, adresse, cel, cour]);
  const bonne = ['Ok Ok', '1 rue Ok, Charette', '+18195559000', 'ok@exemple.ca'];
  await err('inscription : nom d\'un caractère refusé', () => insI('x', bonne[1], bonne[2], bonne[3]), 'inscriptions_avis_nom_plage');
  await err('inscription : nom de 101 caractères refusé', () => insI('x'.repeat(101), bonne[1], bonne[2], bonne[3]), 'inscriptions_avis_nom_plage');
  await err('inscription : adresse de 4 caractères refusée', () => insI(bonne[0], '1 ru', bonne[2], bonne[3]), 'inscriptions_avis_adresse_plage');
  await err('inscription : adresse de 201 caractères refusée', () => insI(bonne[0], 'a'.repeat(201), bonne[2], bonne[3]), 'inscriptions_avis_adresse_plage');
  await err('inscription : cellulaire qui n\'est pas au format +1… refusé', () => insI(bonne[0], bonne[1], '8195559000', bonne[3]), 'inscriptions_avis_cellulaire_format');
  await err('inscription : cellulaire avec un indicatif invalide (1xx) refusé', () => insI(bonne[0], bonne[1], '+11955590000', bonne[3]), 'inscriptions_avis_cellulaire_format');
  await err('inscription : courriel invalide refusé', () => insI(bonne[0], bonne[1], bonne[2], 'pas-un-courriel'), 'inscriptions_avis_courriel_format');
  await err('inscription : courriel de 151 caractères refusé', () => insI(bonne[0], bonne[1], bonne[2], 'a'.repeat(140) + '@exemple.ca'), 'inscriptions_avis_courriel_format');
  await err('inscription : agent de 301 caractères refusé', () => insI(bonne[0], bonne[1], bonne[2], bonne[3], 'agent', 'x'.repeat(301)), 'inscriptions_avis_agent_court');
  await err('inscription : statut inconnu refusé', () => insI(bonne[0], bonne[1], bonne[2], bonne[3], 'statut', 'en_attente'), 'inscriptions_avis_statut_liste');
  await err('inscription : version du texte inconnue refusée (clé étrangère)', () => q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, version_texte) values ('Ok Ok', '1 rue Ok', '+18195559000', 'texto-fantome')`), 'foreign key');
  await insI('xx', 'x'.repeat(5), bonne[2], null);
  await insI('x'.repeat(100), 'x'.repeat(200), '+18195559001', 'a'.repeat(139) + '@exemple.ca', 'agent', 'x'.repeat(300));
  eq('… les limites exactes sont acceptées (nom 2 et 100, adresse 5 et 200, agent 300, courriel 150)', await compte('inscriptions_avis'), 2);
  await q(`delete from public.inscriptions_avis`);
  await err('fiche : nom d\'entreprise de 151 caractères refusé', () => client('Ent X', { nom_entreprise: 'e'.repeat(151) }), 'clients_entreprise_courte');
  await err('fiche : ville de 101 caractères refusée', () => client('Ville X', { ville: 'v'.repeat(101) }), 'clients_ville_courte');
  await err('fiche : nom QuickBooks de 151 caractères refusé', () => client('QB X', { quickbooks_nom: 'q'.repeat(151) }), 'clients_quickbooks_court');
  await err('fiche : courriel de 151 caractères refusé', () => client('Mail long', { courriel: 'a'.repeat(140) + '@exemple.ca' }), 'clients_courriel_format');
  eq('… les limites exactes d\'une fiche sont acceptées (entreprise 150, ville 100, code postal 10, adresse 200, téléphone 30, notes 2000, QuickBooks 150, courriel 150)', !!(await client('Limites', { nom_entreprise: 'e'.repeat(150), ville: 'v'.repeat(100), code_postal: 'A'.repeat(10), adresse: 'a'.repeat(200), telephone: '1'.repeat(30), notes: 'n'.repeat(2000), quickbooks_nom: 'q'.repeat(150), courriel: 'a'.repeat(139) + '@exemple.ca' })), true);
  await q(`delete from public.clients`);
}

log('\n=== LES COLONNES OBLIGATOIRES ET LES LIMITES EXACTES ===');
{
  const nonNul = (l, sql, p) => err(l, () => q(sql, p), 'null value');
  eq('le « sel » secret a la forme attendue (32 caractères hexadécimaux au hasard)', /^[0-9a-f]{32}$/.test((await q(`select sel from public.avis_sel`))[0].sel), true);
  await err('une fiche sans nom est refusée (colonne obligatoire)', () => sqlAs(admin, `insert into public.clients (courriel) values ('sans.nom@exemple.ca')`), 'null value');
  const c1 = await client('A');
  eq('un nom d\'un seul caractère est accepté pour une fiche', (await ligneClient(c1)).nom, 'A');
  await err('le type d\'une fiche ne peut pas être vidé (colonne obligatoire)', () => sqlAs(admin, `update public.clients set type_client = null where id = $1`, [c1]), 'null value');
  await err('l\'état « actif » d\'une fiche ne peut pas être vidé', () => sqlAs(admin, `update public.clients set actif = null where id = $1`, [c1]), 'null value');
  await err('le choix « avertir par courriel » ne peut pas être vidé', () => sqlAs(admin, `update public.clients set avis_courriel = null where id = $1`, [c1]), 'null value');
  const c2 = await client('Courriel vide', { courriel: '' });
  const c3 = await client('Courriel espaces', { courriel: '   ' });
  eq('un courriel VIDE ou fait d\'espaces devient « pas de courriel » (NULL), il n\'est pas refusé', [(await ligneClient(c2)).courriel, (await ligneClient(c3)).courriel], [null, null]);
  await q(`delete from public.clients`);

  await nonNul('inscription : le nom est obligatoire', `insert into public.inscriptions_avis (adresse, cellulaire, version_texte) values ('1 rue Ok', '+18195559000', '${V1}')`);
  await nonNul('inscription : l\'adresse est obligatoire', `insert into public.inscriptions_avis (nom, cellulaire, version_texte) values ('Ok Ok', '+18195559000', '${V1}')`);
  await nonNul('inscription : le cellulaire est obligatoire', `insert into public.inscriptions_avis (nom, adresse, version_texte) values ('Ok Ok', '1 rue Ok', '${V1}')`);
  await nonNul('inscription : la version du texte lu est obligatoire', `insert into public.inscriptions_avis (nom, adresse, cellulaire) values ('Ok Ok', '1 rue Ok', '+18195559000')`);
  await q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, version_texte) values ('Ok Ok', '1 rue Ok', '+18195559000', '${V1}')`);
  const it = (await q(`select statut, cree_le from public.inscriptions_avis`))[0];
  eq('une inscription ajoutée sans statut est « nouvelle », datée de maintenant', [it.statut, Math.abs(Date.now() - new Date(it.cree_le).getTime()) < 120000], ['nouvelle', true]);
  await q(`delete from public.inscriptions_avis`);

  await nonNul('registre : le canal est obligatoire', `insert into public.consentements (action, source, contact) values ('accord', 'admin', '+18195550001')`);
  await nonNul('registre : l\'action est obligatoire', `insert into public.consentements (canal, source, contact) values ('texto', 'admin', '+18195550001')`);
  await nonNul('registre : la source est obligatoire', `insert into public.consentements (canal, action, contact) values ('texto', 'accord', '+18195550001')`);
  await nonNul('registre : le contact est obligatoire', `insert into public.consentements (canal, action, source) values ('texto', 'accord', 'admin')`);
  await err('registre : un contact de 2 caractères est refusé', () => q(`insert into public.consentements (canal, action, source, contact) values ('texto', 'accord', 'admin', 'xy')`), 'consentements_contact_present');
  await err('registre : un contact de 151 caractères est refusé', () => q(`insert into public.consentements (canal, action, source, contact) values ('texto', 'accord', 'admin', '${'x'.repeat(151)}')`), 'consentements_contact_present');
  await q(`insert into public.consentements (canal, action, source, contact) values ('texto', 'accord', 'admin', 'xyz'), ('texto', 'accord', 'admin', '${'x'.repeat(150)}')`);
  eq('… les limites exactes (3 et 150 caractères) sont acceptées, l\'heure du geste est posée toute seule', [await compte('consentements'), (await q(`select count(*)::int n from public.consentements where abs(extract(epoch from (now() - fait_le))) < 120`))[0].n], [2, 2]);
  await vider();

  await nonNul('texte de consentement : le canal est obligatoire', `insert into public.textes_consentement (version, texte) values ('v-sans-canal', 'Un texte de consentement assez long pour la règle')`);
  await err('texte de consentement : 19 caractères refusés', () => q(`insert into public.textes_consentement (version, canal, texte) values ('v19', 'texto', '${'x'.repeat(19)}')`), 'textes_consentement_texte_present');
  await err('texte de consentement : 25 espaces (aucun vrai caractère) refusés', () => q(`insert into public.textes_consentement (version, canal, texte) values ('v-blanc', 'texto', '${' '.repeat(25)}')`), 'textes_consentement_texte_present');
  await q(`insert into public.textes_consentement (version, canal, texte) values ('v20', 'texto', '${'x'.repeat(20)}')`);
  eq('… 20 caractères sont acceptés, en vigueur par défaut, datés de maintenant', (await q(`select en_vigueur, abs(extract(epoch from (now() - cree_le))) < 120 recent from public.textes_consentement where version = 'v20'`))[0], { en_vigueur: true, recent: true });
  await q(`alter table public.textes_consentement disable trigger textes_consentement_immuables`);
  await q(`delete from public.textes_consentement where version = 'v20'`);
  await q(`alter table public.textes_consentement enable trigger textes_consentement_immuables`);
}

log('\n=== QUI VOIT QUOI : L\'ADMINISTRATEUR SEULEMENT ===');
{
  const c1 = await client('Client Visible');
  await inscrire('Insc Visible', '1 rue Visible', celNeuf(), null);
  for (const t of ['clients', 'inscriptions_avis', 'consentements', 'textes_consentement']) {
    eq(`${t} : l'administrateur voit les lignes, l'employé n'en voit AUCUNE`, [(await sqlAs(admin, `select count(*)::int n from public.${t}`))[0].n > 0, (await sqlAs(nina, `select count(*)::int n from public.${t}`))[0].n], [true, 0]);
  }
  await err('« avis_sel » : même l\'administrateur n\'y a pas accès (permission refusée)', () => sqlAs(admin, `select * from public.avis_sel`), 'permission denied');
  eq('la vue clients_avis : l\'administrateur voit le client, l\'employé rien', [(await sqlAs(admin, `select count(*)::int n from public.clients_avis`))[0].n, (await sqlAs(nina, `select count(*)::int n from public.clients_avis`))[0].n], [1, 0]);
  await err('un employé ne peut pas ajouter un client (la règle d\'accès le refuse)', () => sqlAs(nina, `insert into public.clients (nom) values ('Pirate')`), 'row-level security');
  eq('… ni modifier ni « supprimer » une fiche : 0 ligne touchée', [(await sqlAs(nina, `update public.clients set nom = 'Pirate' where id = $1 returning id`, [c1])).length, (await ligneClient(c1)).nom], [0, 'Client Visible']);
  await err('un visiteur ne peut pas lire les clients', () => sqlAs(null, `select * from public.clients`, [], 'anon'), 'permission denied');
  await err('ni la vue', () => sqlAs(null, `select * from public.clients_avis`, [], 'anon'), 'permission denied');
  await vider();
  await q(`delete from public.clients`);
}

log('\n=== LA FICHE D\'UN CLIENT : LES RÈGLES DE CHAQUE CHAMP ===');
{
  const c1 = await client('Marc Lavoie', { courriel: '  Marc.L@Exemple.CA ', cellulaire: '(819) 555-1111' });
  const l = await ligneClient(c1);
  eq('une fiche minimale : valeurs de départ (particulier, pas d\'avis, actif, aucune date de consentement)', [(await ligneClient(await client('Minimale'))).type_client, l.avis_courriel, l.avis_texto, l.actif, l.dernier_contrat_le, l.promo_consentement_expres_le, l.desabonne_courriel_le, l.desabonne_texto_le, l.desabonne_promo_le], ['particulier', false, false, true, null, null, null, null, null]);
  eq('… le courriel est remis en minuscules sans espaces, le cellulaire au format +1…', [l.courriel, l.cellulaire], ['marc.l@exemple.ca', '+18195551111']);
  vrai('… « cree_le » et « maj_le » sont posés tout seuls', Math.abs(Date.now() - new Date(l.cree_le).getTime()) < 120000 && Math.abs(Date.now() - new Date(l.maj_le).getTime()) < 120000);
  await err('un nom vide est refusé', () => client('   '), 'clients_nom_plage');
  await err('un nom de 151 caractères est refusé', () => client('x'.repeat(151)), 'clients_nom_plage');
  eq('… un nom de 150 caractères est accepté', !!(await client('y'.repeat(150))), true);
  await err('un type inconnu est refusé', () => client('Type X', { type_client: 'extraterrestre' }), 'clients_type_liste');
  for (const t of ['particulier', 'investisseur', 'municipalite', 'commerce', 'syndicat', 'autre']) eq(`… le type « ${t} » est accepté`, !!(await client('T ' + t, { type_client: t })), true);
  await err('un courriel invalide est refusé', () => client('Mail X', { courriel: 'pas-un-courriel' }), 'clients_courriel_format');
  await err('un cellulaire invalide est refusé (message clair)', () => client('Cel X', { cellulaire: '123' }), 'cellulaire_invalide');
  await err('une adresse de 201 caractères est refusée', () => client('Adr X', { adresse: 'a'.repeat(201) }), 'clients_adresse_courte');
  await err('un téléphone de 31 caractères est refusé', () => client('Tel X', { telephone: '1'.repeat(31) }), 'clients_telephone_court');
  await err('un code postal de 11 caractères est refusé', () => client('CP X', { code_postal: 'A'.repeat(11) }), 'clients_code_postal_court');
  await err('des notes de 2001 caractères sont refusées', () => client('Notes X', { notes: 'n'.repeat(2001) }), 'clients_notes_courtes');
  await err('une date de contrat en 1999 est refusée', () => client('Date X', { dernier_contrat_le: '1999-12-31' }), 'clients_dernier_contrat_plausible');
  eq('… une date de contrat de 2026 est acceptée', !!(await client('Date Y', { dernier_contrat_le: '2026-05-01' })), true);
  await err('l\'administrateur ne peut PAS écrire « avis_texto » directement (à l\'ajout)', () => sqlAs(admin, `insert into public.clients (nom, avis_texto) values ('Fraude', true)`), 'permission denied');
  await err('… ni à la modification', () => sqlAs(admin, `update public.clients set avis_texto = true where id = $1`, [c1]), 'permission denied');
  for (const col of ['desabonne_texto_le', 'desabonne_courriel_le', 'desabonne_promo_le', 'promo_consentement_expres_le']) {
    await err(`… ni « ${col} »`, () => sqlAs(admin, `update public.clients set ${col} = now() where id = $1`, [c1]), 'permission denied');
  }
  await err('… ni « cree_le » ni « maj_le » ni « id »', () => sqlAs(admin, `update public.clients set maj_le = '2000-01-01' where id = $1`, [c1]), 'permission denied');
  await err('l\'administrateur ne peut PAS supprimer une fiche (elle est archivée : actif = faux)', () => sqlAs(admin, `delete from public.clients where id = $1`, [c1]), 'permission denied');
  await q(`update public.clients set maj_le = '2001-01-01' where id = $1`, [c1]);
  await sqlAs(admin, `update public.clients set notes = 'une note', type_client = 'commerce', avis_courriel = true where id = $1`, [c1]);
  const l2 = await ligneClient(c1);
  eq('modifier les coordonnées : les valeurs changent, « maj_le » avance toute seule, « cree_le » ne bouge pas', [l2.notes, l2.type_client, l2.avis_courriel, new Date(l2.maj_le).getFullYear() >= 2026, new Date(l2.cree_le).getTime() === new Date(l.cree_le).getTime()], ['une note', 'commerce', true, true, true]);
  await err('une fiche ne peut pas être « inscrite aux textos » sans numéro (règle de la table, même pour le propriétaire de la base)', async () => { const id = await client('Sans numéro'); await q(`update public.clients set avis_texto = true where id = $1`, [id]); }, 'clients_texto_sans_numero');
  await q(`delete from public.clients`);
}

log('\n=== LE LIEN ENTRE UN ARRÊT ET SA FICHE CLIENT (stops.client_id) ===');
{
  const c1 = await client('Client Lié');
  const s1 = (await q(`select id from public.stops order by id limit 1`))[0].id;
  await sqlAs(admin, `update public.stops set client_id = $1 where id = $2`, [c1, s1]);
  eq('l\'administrateur relie un arrêt à une fiche', (await q(`select client_id from public.stops where id = $1`, [s1]))[0].client_id, c1);
  eq('… un employé ne change pas les arrêts (règles existantes) : 0 ligne touchée', (await sqlAs(nina, `update public.stops set client_id = null where id = $1 returning id`, [s1])).length, 0);
  eq('… mais il lit toujours les arrêts (règle existante) sans rien voir des coordonnées du client (elles sont dans clients, inaccessible)', [(await sqlAs(nina, `select count(*)::int n from public.stops`))[0].n > 0, (await sqlAs(nina, `select count(*)::int n from public.clients`))[0].n], [true, 0]);
  await err('un lien vers une fiche qui n\'existe pas est refusé (clé étrangère)', () => q(`update public.stops set client_id = gen_random_uuid() where id = $1`, [s1]), 'foreign key');
  await q(`delete from public.clients where id = $1`, [c1]);
  eq('si une fiche disparaissait (par le propriétaire de la base), l\'arrêt reste et son lien est VIDÉ', (await q(`select count(*)::int n, count(client_id)::int avec from public.stops where id = $1`, [s1]))[0], { n: 1, avec: 0 });
}

log('\n=== RELIER UNE INSCRIPTION À UN CLIENT : LE CLIENT EST ALORS INSCRIT AUX TEXTOS ===');
{
  await headers({ 'x-forwarded-for': '203.0.113.50' });
  const cMarc = await client('Marc Client');
  const cPaul = await client('Paul Client', { courriel: 'paul@ancien.ca', cellulaire: '819 555 0101', avis_courriel: true });
  const cVieux = await client('Vieux Client', { actif: false });
  const num = celNeuf();
  await inscrire('Marc T.', '1 rue Marc', num, 'Marc@Nouveau.ca');
  const ins1 = (await q(`select id from public.inscriptions_avis where nom = 'Marc T.'`))[0].id;
  await err('un employé ne peut pas relier', () => fn(nina, `admin_relier_inscription($1::uuid,$2::uuid)`, [ins1, cMarc]), 'non_autorise');
  await err('un visiteur ne peut pas appeler la fonction (droit refusé)', () => fn(null, `admin_relier_inscription($1::uuid,$2::uuid)`, [ins1, cMarc], 'anon'), 'permission denied');
  await err('une inscription inconnue est refusée', () => fn(admin, `admin_relier_inscription(gen_random_uuid(),$1::uuid)`, [cMarc]), 'inscription_introuvable');
  await err('un client inconnu est refusé', () => fn(admin, `admin_relier_inscription($1::uuid,gen_random_uuid())`, [ins1]), 'client_introuvable');
  await err('un client ARCHIVÉ est refusé', () => fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [ins1, cVieux]), 'client_introuvable');
  eq('… (rien n\'a bougé après ces refus : l\'inscription est encore « nouvelle » et le client sans numéro)', [(await q(`select statut from public.inscriptions_avis where id = $1`, [ins1]))[0].statut, (await ligneClient(cMarc)).cellulaire, (await ligneClient(cMarc)).avis_texto], ['nouvelle', null, false]);
  const r = await fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [ins1, cMarc]);
  eq('l\'administrateur relie : « reliee » avec l\'identifiant du client (et « promo » : la case des offres n\'était pas cochée)', r, { promo: 'non_demandee', statut: 'reliee', client_id: cMarc });
  const m = await ligneClient(cMarc);
  eq('… le client reçoit le numéro de l\'inscription, le courriel (il n\'en avait pas), et il est INSCRIT aux textos', [m.cellulaire, m.courriel, m.avis_texto, m.desabonne_texto_le], ['+1' + num, 'marc@nouveau.ca', true, null]);
  const i1 = (await q(`select statut, client_id, traitee_par, traitee_le is not null t from public.inscriptions_avis where id = $1`, [ins1]))[0];
  eq('… l\'inscription est « reliee », avec le client, qui l\'a traitée et quand', i1, { statut: 'reliee', client_id: cMarc, traitee_par: admin, t: true });
  eq('… la ligne du registre (la preuve faite par la page) est maintenant reliée au client', (await consents(`inscription_id = $1`, [ins1])).map((x) => [x.canal, x.action, x.source, x.client_id]), [['texto', 'accord', 'page_avis', cMarc]]);
  await err('relier une 2ᵉ fois la même inscription est refusé', () => fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [ins1, cMarc]), 'inscription_deja_traitee');

  // un client qui a déjà un numéro et un courriel : le numéro est remplacé, le courriel gardé
  const num2 = celNeuf();
  await inscrire('Paul T.', '2 rue Paul', num2, 'paul@nouveau.ca');
  const ins2 = (await q(`select id from public.inscriptions_avis where nom = 'Paul T.'`))[0].id;
  await q(`update public.clients set avis_texto = true where id = $1`, [cPaul]);
  await fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [ins2, cPaul]);
  const p = await ligneClient(cPaul);
  eq('un client qui avait un autre numéro : le NOUVEAU numéro remplace l\'ancien, son courriel est gardé, il est inscrit, son choix d\'avis par courriel est gardé', [p.cellulaire, p.courriel, p.avis_texto, p.avis_courriel], ['+1' + num2, 'paul@ancien.ca', true, true]);

  // se réinscrire après un ARRET
  await fn(null, `desabonner_contact($1::text,$2::text,$3::text)`, ['texto', num, 'texto_arret'], 'service_role');
  eq('après ARRET : le client n\'est plus inscrit et la date du désabonnement est notée', [(await ligneClient(cMarc)).avis_texto, (await ligneClient(cMarc)).desabonne_texto_le !== null], [false, true]);
  await q(`update public.inscriptions_avis set cree_le = now() - interval '2 days'`);
  await inscrire('Marc T. encore', '1 rue Marc', num, null);
  const ins3 = (await q(`select id from public.inscriptions_avis where nom = 'Marc T. encore'`))[0].id;
  await fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [ins3, cMarc]);
  eq('se réinscrire plus tard (nouvelle inscription reliée) : le client est de nouveau inscrit et le désabonnement est levé', [(await ligneClient(cMarc)).avis_texto, (await ligneClient(cMarc)).desabonne_texto_le], [true, null]);
  eq('… le registre raconte toute l\'histoire dans l\'ordre : accord (page), retrait (ARRET), accord (page)', (await consents(`client_id = $1`, [cMarc])).map((x) => x.action + ':' + x.source), ['accord:page_avis', 'retrait:texto_arret', 'accord:page_avis']);
  await vider();
  await vider(); await q(`delete from public.clients`);
}

log('\n=== ÉCARTER UNE INSCRIPTION ===');
{
  await inscrire('Inconnue X', '9 rue Inconnue', celNeuf(), null);
  const i = (await q(`select id from public.inscriptions_avis where nom = 'Inconnue X'`))[0].id;
  await err('un employé ne peut pas écarter', () => fn(nina, `admin_ignorer_inscription($1::uuid)`, [i]), 'non_autorise');
  await err('une inscription inconnue est refusée', () => fn(admin, `admin_ignorer_inscription(gen_random_uuid())`, []), 'inscription_introuvable');
  eq('l\'administrateur écarte : « ignoree », qui et quand', [await fn(admin, `admin_ignorer_inscription($1::uuid)`, [i]), (await q(`select statut, traitee_par, traitee_le is not null t, client_id from public.inscriptions_avis where id = $1`, [i]))[0]], [{ statut: 'ignoree' }, { statut: 'ignoree', traitee_par: admin, t: true, client_id: null }]);
  eq('… la preuve du consentement reste au registre, sans client', (await consents(`inscription_id = $1`, [i])).map((x) => [x.action, x.client_id]), [['accord', null]]);
  await err('écarter deux fois est refusé', () => fn(admin, `admin_ignorer_inscription($1::uuid)`, [i]), 'inscription_deja_traitee');
  await err('relier une inscription déjà écartée est refusé', async () => fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [i, await client('Client Ignoré')]), 'inscription_deja_traitee');
  await vider();
  await vider(); await q(`delete from public.clients`);
}

log('\n=== NOTER UN CONSENTEMENT OU UN RETRAIT OBTENU DE VIVE VOIX, SUR PAPIER OU DÉCIDÉ PAR L\'ADMINISTRATEUR ===');
{
  const cTel = await client('Avec Cellulaire', { cellulaire: '819 555 7001', courriel: 'tel@exemple.ca' });
  const cSans = await client('Sans Rien');
  const cVieux = await client('Archivé', { cellulaire: '819 555 7002', courriel: 'v@exemple.ca', actif: false });
  const enreg = (uid, id, canal, action, source, version = V1, role = 'authenticated') => fn(uid, `admin_enregistrer_consentement($1::uuid,$2::text,$3::text,$4::text,$5::text)`, [id, canal, action, source, version], role);
  await err('un employé ne peut pas', () => enreg(nina, cTel, 'texto', 'accord', 'verbal'), 'non_autorise');
  await err('un visiteur ne peut pas (droit refusé)', () => enreg(null, cTel, 'texto', 'accord', 'verbal', V1, 'anon'), 'permission denied');
  await err('un canal inconnu est refusé', () => enreg(admin, cTel, 'pigeon', 'accord', 'verbal'), 'canal_invalide');
  await err('le canal « courriel_avis » n\'a pas de consentement à noter (refusé)', () => enreg(admin, cTel, 'courriel_avis', 'accord', 'verbal'), 'canal_invalide');
  await err('une action inconnue est refusée', () => enreg(admin, cTel, 'texto', 'peut-etre', 'verbal'), 'action_invalide');
  await err('une source inconnue est refusée', () => enreg(admin, cTel, 'texto', 'accord', 'page_avis'), 'source_invalide');
  await err('une source absente est refusée', () => enreg(admin, cTel, 'texto', 'accord', null), 'source_invalide');
  await err('un client inconnu est refusé', () => enreg(admin, '00000000-0000-0000-0000-000000000000', 'texto', 'accord', 'verbal'), 'client_introuvable');
  await err('un client archivé est refusé', () => enreg(admin, cVieux, 'texto', 'accord', 'verbal'), 'client_introuvable');
  await err('texto : un client SANS cellulaire est refusé', () => enreg(admin, cSans, 'texto', 'accord', 'verbal'), 'cellulaire_requis');
  await err('texto : un retrait pour un client sans cellulaire est refusé aussi', () => enreg(admin, cSans, 'texto', 'retrait', 'verbal'), 'cellulaire_requis');
  await err('texto : un accord sans la version du texte lu est refusé', () => enreg(admin, cTel, 'texto', 'accord', 'verbal', null), 'version_inconnue');
  await err('texto : une version inconnue est refusée', () => enreg(admin, cTel, 'texto', 'accord', 'verbal', 'texto-xx'), 'version_inconnue');
  await err('promo : un client sans courriel est refusé', () => enreg(admin, cSans, 'courriel_promo', 'accord', 'verbal', null), 'courriel_requis');
  eq('… rien n\'a été noté après tous ces refus', [await compte('consentements'), (await ligneClient(cTel)).avis_texto], [0, false]);
  eq('texto, accord verbal : « enregistre », le client est inscrit', [await enreg(admin, cTel, 'texto', 'accord', 'verbal'), (await ligneClient(cTel)).avis_texto], [{ statut: 'enregistre' }, true]);
  eq('… le registre garde : canal, accord, verbal, le numéro du client, la version lue, le client, qui l\'a noté', (await consents(`client_id = $1`, [cTel])).map((x) => [x.canal, x.action, x.source, x.contact, x.version_texte, x.fait_par]), [['texto', 'accord', 'verbal', '+18195557001', V1, admin]]);
  await enreg(admin, cTel, 'texto', 'retrait', 'admin', null);
  const t = await ligneClient(cTel);
  eq('texto, retrait décidé par l\'administrateur : plus inscrit, désabonnement daté (sans exiger de version)', [t.avis_texto, t.desabonne_texto_le !== null], [false, true]);
  await enreg(admin, cTel, 'texto', 'accord', 'papier');
  eq('… un nouvel accord (papier) : inscrit de nouveau, désabonnement levé', [(await ligneClient(cTel)).avis_texto, (await ligneClient(cTel)).desabonne_texto_le], [true, null]);
  eq('… le registre a 3 lignes dans l\'ordre (accord verbal, retrait admin, accord papier)', (await consents(`client_id = $1`, [cTel])).map((x) => x.action + ':' + x.source), ['accord:verbal', 'retrait:admin', 'accord:papier']);
  await enreg(admin, cTel, 'courriel_promo', 'accord', 'verbal', null);
  const pr = await ligneClient(cTel);
  eq('promotions par courriel, accord : la date du consentement exprès est posée, pas de désabonnement', [pr.promo_consentement_expres_le !== null, pr.desabonne_promo_le], [true, null]);
  eq('… le registre garde le courriel du client', (await consents(`canal = 'courriel_promo'`)).map((x) => [x.action, x.source, x.contact, x.version_texte]), [['accord', 'verbal', 'tel@exemple.ca', null]]);
  await enreg(admin, cTel, 'courriel_promo', 'retrait', 'admin', null);
  const pr2 = await ligneClient(cTel);
  eq('promotions, retrait : le consentement exprès est EFFACÉ et le désabonnement daté', [pr2.promo_consentement_expres_le, pr2.desabonne_promo_le !== null], [null, true]);
  await enreg(admin, cTel, 'courriel_promo', 'accord', 'papier', null);
  eq('… un nouvel accord lève le désabonnement aux promotions', [(await ligneClient(cTel)).promo_consentement_expres_le !== null, (await ligneClient(cTel)).desabonne_promo_le], [true, null]);
  await vider();
  await q(`delete from public.clients`);
}

log('\n=== ARRET REÇU PAR TEXTO, LIEN DE DÉSABONNEMENT D\'UN COURRIEL (par la fonction d\'envoi : service_role) ===');
{
  const desab = (canal, contact, source, uid = null, role = 'service_role') => fn(uid, `desabonner_contact($1::text,$2::text,$3::text)`, [canal, contact, source], role);
  const cA = await client('Client A', { cellulaire: '819 555 8001', courriel: 'a@exemple.ca', avis_courriel: true });
  const cB = await client('Client B (même numéro)', { cellulaire: '819 555 8001' });
  const cC = await client('Client C', { cellulaire: '819 555 8002', courriel: 'C@Exemple.ca' });
  for (const id of [cA, cB, cC]) await q(`update public.clients set avis_texto = true where id = $1`, [id]);
  await err('l\'administrateur (connecté) ne peut PAS appeler cette fonction (droit refusé)', () => desab('texto', '819 555 8001', 'texto_arret', admin, 'authenticated'), 'permission denied');
  await err('un visiteur non plus', () => desab('texto', '819 555 8001', 'texto_arret', null, 'anon'), 'permission denied');
  await err('un canal inconnu est refusé', () => desab('pigeon', '819 555 8001', 'texto_arret'), 'canal_invalide');
  await err('une source inconnue est refusée', () => desab('texto', '819 555 8001', 'verbal'), 'source_invalide');
  await err('un numéro invalide est refusé', () => desab('texto', '123', 'texto_arret'), 'contact_invalide');
  await err('un courriel invalide est refusé', () => desab('courriel', 'pas-un-courriel', 'lien_desabonnement'), 'contact_invalide');
  eq('… rien n\'a bougé après ces refus', [await compte('consentements'), (await ligneClient(cA)).avis_texto], [0, true]);
  eq('ARRET : tous les clients qui ont CE numéro sont désinscrits (2 fiches), quelle que soit l\'écriture du numéro', [await desab('texto', '(819) 555-8001', 'texto_arret'), (await ligneClient(cA)).avis_texto, (await ligneClient(cB)).avis_texto, (await ligneClient(cC)).avis_texto], [{ statut: 'desabonne', clients: 2 }, false, false, true]);
  eq('… les deux désabonnements sont datés, et le registre a deux lignes « retrait » par ARRET', [(await ligneClient(cA)).desabonne_texto_le !== null, (await ligneClient(cB)).desabonne_texto_le !== null, (await ligneClient(cC)).desabonne_texto_le, (await consents(`action = 'retrait'`)).map((x) => [x.canal, x.source, x.contact, x.client_id !== null])], [true, true, null, [['texto', 'texto_arret', '+18195558001', true], ['texto', 'texto_arret', '+18195558001', true]]]);
  eq('… un numéro que nous ne connaissons pas : le retrait est quand même GARDÉ (sans client)', [await desab('texto', '819 555 9999', 'texto_arret'), (await consents(`contact = '+18195559999'`)).map((x) => [x.action, x.client_id])], [{ statut: 'desabonne', clients: 0 }, [['retrait', null]]]);
  // des inscriptions en attente avec ce numéro
  await headers({ 'x-forwarded-for': '203.0.113.60' });
  await inscrire('Attente', '1 rue Attente', '819 555 8003', null);
  await inscrire('Autre', '2 rue Autre', '819 555 8004', null);
  await desab('texto', '819 555 8003', 'texto_arret');
  eq('une inscription EN ATTENTE avec ce numéro est écartée ; celle d\'un autre numéro ne l\'est pas', (await q(`select nom, statut from public.inscriptions_avis order by nom`)).map((x) => x.nom + ':' + x.statut), ['Attente:ignoree', 'Autre:nouvelle']);
  const iLiee = (await q(`select id from public.inscriptions_avis where nom = 'Autre'`))[0].id;
  await fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [iLiee, cC]);
  await desab('texto', '819 555 8004', 'texto_arret');
  eq('… une inscription déjà reliée reste « reliee » (l\'historique ne change pas)', (await q(`select statut from public.inscriptions_avis where id = $1`, [iLiee]))[0].statut, 'reliee');
  // courriel
  eq('lien « plus d\'avis par courriel » (sans égard à la casse) : la date est posée sur la fiche, le registre garde « courriel_avis »', [await desab('courriel', '  A@EXEMPLE.ca ', 'lien_desabonnement'), (await ligneClient(cA)).desabonne_courriel_le !== null, (await consents(`canal = 'courriel_avis'`)).map((x) => [x.action, x.source, x.contact, x.client_id === cA])], [{ statut: 'desabonne', clients: 1 }, true, [['retrait', 'lien_desabonnement', 'a@exemple.ca', true]]]);
  const d1 = (await ligneClient(cA)).desabonne_courriel_le;
  await desab('courriel', 'a@exemple.ca', 'lien_desabonnement');
  eq('… un 2ᵉ clic ne change PAS la date du désabonnement (la première est gardée)', new Date((await ligneClient(cA)).desabonne_courriel_le).getTime(), new Date(d1).getTime());
  await q(`update public.clients set promo_consentement_expres_le = now() where id = $1`, [cC]);
  eq('lien « plus d\'offres » : le désabonnement aux promotions est posé ET le consentement exprès est effacé ; les avis par courriel continuent', [await desab('courriel_promo', 'c@exemple.ca', 'lien_desabonnement'), (await ligneClient(cC)).desabonne_promo_le !== null, (await ligneClient(cC)).promo_consentement_expres_le, (await ligneClient(cC)).desabonne_courriel_le], [{ statut: 'desabonne', clients: 1 }, true, null, null]);
  eq('un courriel inconnu : le retrait est quand même GARDÉ (sans client)', [await desab('courriel', 'inconnu@exemple.ca', 'lien_desabonnement'), (await consents(`contact = 'inconnu@exemple.ca'`)).map((x) => [x.canal, x.action, x.client_id])], [{ statut: 'desabonne', clients: 0 }, [['courriel_avis', 'retrait', null]]]);
  await vider();
  await vider(); await q(`delete from public.clients`);
}

log('\n=== LA CELLULAIRE CHANGE : L\'INSCRIPTION AUX TEXTOS EST ANNULÉE (elle valait pour l\'ancien numéro) ===');
{
  const c1 = await client('Change de numéro', { cellulaire: '819 555 8101', courriel: 'cn@exemple.ca' });
  await fn(admin, `admin_enregistrer_consentement($1::uuid,'texto','accord','verbal',$2::text)`, [c1, V1]);
  eq('au départ le client est inscrit', (await ligneClient(c1)).avis_texto, true);
  await sqlAs(admin, `update public.clients set notes = 'une autre note', courriel = 'autre@exemple.ca' where id = $1`, [c1]);
  eq('changer une AUTRE information (note, courriel) ne touche pas l\'inscription', (await ligneClient(c1)).avis_texto, true);
  await sqlAs(admin, `update public.clients set cellulaire = '(819) 555-8101' where id = $1`, [c1]);
  eq('ré-écrire le MÊME numéro autrement ne touche pas l\'inscription', (await ligneClient(c1)).avis_texto, true);
  await sqlAs(admin, `update public.clients set cellulaire = '819 555 8102' where id = $1`, [c1]);
  eq('un NOUVEAU numéro annule l\'inscription (le client doit s\'inscrire de nouveau avec le nouveau)', [(await ligneClient(c1)).avis_texto, (await ligneClient(c1)).cellulaire], [false, '+18195558102']);
  await sqlAs(admin, `update public.clients set cellulaire = null where id = $1`, [c1]);
  eq('effacer le numéro laisse l\'inscription annulée (et la règle « pas de texto sans numéro » tient)', [(await ligneClient(c1)).avis_texto, (await ligneClient(c1)).cellulaire], [false, null]);
  await sqlAs(admin, `update public.clients set cellulaire = '819 555 8103' where id = $1`, [c1]);
  await fn(admin, `admin_enregistrer_consentement($1::uuid,'texto','accord','verbal',$2::text)`, [c1, V1]);
  eq('client INSCRIT avec un nouveau numéro…', [(await ligneClient(c1)).avis_texto, (await ligneClient(c1)).cellulaire], [true, '+18195558103']);
  await sqlAs(admin, `update public.clients set cellulaire = null where id = $1`, [c1]);
  eq('… on efface son numéro PENDANT qu\'il est inscrit : ça marche (pas d\'erreur) et l\'inscription tombe en même temps', [(await ligneClient(c1)).avis_texto, (await ligneClient(c1)).cellulaire], [false, null]);
  await vider();
  await q(`delete from public.clients`);
}

log('\n=== LE REGISTRE ET LES TEXTES NE SE MODIFIENT NI NE S\'EFFACENT (même par le propriétaire de la base) ===');
{
  await headers({ 'x-forwarded-for': '203.0.113.70' });
  const cX = await client('Registre X', { cellulaire: '819 555 8201' });
  const cY = await client('Registre Y');
  await inscrire('Insc Reg', '1 rue Reg', celNeuf(), null);
  const id = (await q(`select id from public.consentements limit 1`))[0].id;
  await err('modifier une ligne du registre (le numéro) est refusé', () => q(`update public.consentements set contact = '+18195559999' where id = $1`, [id]), 'registre_immuable');
  await err('modifier l\'action (accord → retrait) est refusé', () => q(`update public.consentements set action = 'retrait' where id = $1`, [id]), 'registre_immuable');
  await err('modifier la date est refusé', () => q(`update public.consentements set fait_le = now() - interval '5 years' where id = $1`, [id]), 'registre_immuable');
  await err('modifier la version du texte lu est refusé', () => q(`update public.consentements set version_texte = null where id = $1`, [id]), 'registre_immuable');
  await err('supprimer une ligne est refusé', () => q(`delete from public.consentements where id = $1`, [id]), 'registre_immuable');
  await err('vider le registre (truncate) est refusé', () => q(`truncate public.consentements`), 'registre_immuable');
  await err('relier une ligne à un client ET changer autre chose en même temps est refusé', () => q(`update public.consentements set client_id = $1, contact = '+18195550000' where id = $2`, [cX, id]), 'registre_immuable');
  for (const [col, expr] of [['id', 'gen_random_uuid()'], ['inscription_id', 'null'], ['canal', "'courriel_promo'"], ['action', "'retrait'"], ['source', "'admin'"], ['contact', "'+18195550000'"], ['version_texte', 'null'], ['ip_hash', "'autre'"], ['fait_le', "now() - interval '1 day'"], ['fait_par', "'" + admin + "'::uuid"]]) {
    await err(`relier une ligne à un client ET changer « ${col} » en même temps est refusé`, () => q(`update public.consentements set client_id = $1, ${col} = ${expr} where id = $2`, [cX, id]), 'registre_immuable');
  }
  eq('… rien n\'a bougé après ces refus (la ligne n\'est toujours reliée à personne)', (await q(`select client_id from public.consentements where id = $1`, [id]))[0].client_id, null);
  await q(`update public.consentements set client_id = $1 where id = $2`, [cX, id]);
  eq('relier une ligne à un client (seulement ça) est permis, une fois', (await q(`select client_id from public.consentements where id = $1`, [id]))[0].client_id, cX);
  await err('… le changer ensuite vers un autre client est refusé', () => q(`update public.consentements set client_id = $1 where id = $2`, [cY, id]), 'registre_immuable');
  await err('… le remettre à vide est refusé', () => q(`update public.consentements set client_id = null where id = $1`, [id]), 'registre_immuable');
  eq('le registre est intact (une ligne, reliée à son client)', (await consents()).map((x) => [x.action, x.client_id]), [['accord', cX]]);
  await err('un texte de consentement : modifier le texte est refusé', () => q(`update public.textes_consentement set texte = 'un autre texte de plus de vingt caractères' where version = $1`, [V1]), 'texte_immuable');
  await err('… renommer la version est refusé', () => q(`update public.textes_consentement set version = 'autre' where version = $1`, [V1]), 'texte_immuable');
  await err('… changer la date de création est refusé', () => q(`update public.textes_consentement set cree_le = now() - interval '1 year' where version = $1`, [V1]), 'texte_immuable');
  await err('… supprimer une version est refusé', () => q(`delete from public.textes_consentement where version = $1`, [V1]), 'texte_immuable');
  await q(`update public.textes_consentement set en_vigueur = false where version = $1`, [V1]);
  eq('… seul « en_vigueur » peut changer (on retire une version du service sans l\'effacer)', (await q(`select en_vigueur from public.textes_consentement where version = $1`, [V1]))[0].en_vigueur, false);
  await q(`update public.textes_consentement set en_vigueur = true where version = $1`, [V1]);
  await q(`insert into public.textes_consentement (version, canal, texte) values ('texto-2027-v2', 'texto', 'Un nouveau texte de consentement, version deux.')`);
  eq('une NOUVELLE version s\'ajoute (les trois existent)', await compte('textes_consentement'), 3);
  await err('un texte trop court (moins de 20 caractères) est refusé', () => q(`insert into public.textes_consentement (version, canal, texte) values ('v3', 'texto', 'court')`), 'textes_consentement_texte_present');
  await err('un autre canal que « texto » est refusé', () => q(`insert into public.textes_consentement (version, canal, texte) values ('v4', 'pigeon', 'Un texte assez long pour passer la règle')`), 'textes_consentement_canal_liste');
  await q(`alter table public.textes_consentement disable trigger textes_consentement_immuables`); await q(`delete from public.textes_consentement where version = 'texto-2027-v2'`); await q(`alter table public.textes_consentement enable trigger textes_consentement_immuables`);
  await err('une ligne du registre ne peut pas viser un client qui n\'existe pas (clé étrangère)', () => q(`insert into public.consentements (client_id, canal, action, source, contact) values (gen_random_uuid(), 'texto', 'accord', 'admin', '+18195550001')`), 'foreign key');
  await err('ni une version du texte qui n\'existe pas', () => q(`insert into public.consentements (canal, action, source, contact, version_texte) values ('texto', 'accord', 'admin', '+18195550001', 'texto-fantome')`), 'foreign key');
  await err('une action inconnue est refusée', () => q(`insert into public.consentements (canal, action, source, contact) values ('texto', 'peut-etre', 'admin', '+18195550001')`), 'consentements_action_liste');
  await err('un canal inconnu est refusé', () => q(`insert into public.consentements (canal, action, source, contact) values ('pigeon', 'accord', 'admin', '+18195550001')`), 'consentements_canal_liste');
  await err('une source inconnue est refusée', () => q(`insert into public.consentements (canal, action, source, contact) values ('texto', 'accord', 'rumeur', '+18195550001')`), 'consentements_source_liste');
  await err('un contact trop court est refusé', () => q(`insert into public.consentements (canal, action, source, contact) values ('texto', 'accord', 'admin', 'x')`), 'consentements_contact_present');
  await err('une fiche client qui a des lignes au registre ne peut pas être supprimée (le registre la retient)', () => q(`delete from public.clients where id = $1`, [cX]), 'foreign key');
  await err('une inscription qui a une ligne au registre ne peut pas être supprimée non plus', () => q(`delete from public.inscriptions_avis`), 'foreign key');
  await vider();
  await vider(); await q(`delete from public.clients`);
}

log('\n=== QUI PEUT RECEVOIR QUOI : LES AVIS PAR COURRIEL, PAR TEXTO ET LES COURRIELS PROMOTIONNELS ===');
{
  const jours = (j) => new Date(Date.now() - j * 86400000).toISOString().slice(0, 10);
  const ctr = await client('Contrat récent', { courriel: 'r@exemple.ca', dernier_contrat_le: jours(400) });
  const ctrLimite = await client('Contrat à 2 ans pile', { courriel: 'l@exemple.ca' });
  await q(`update public.clients set dernier_contrat_le = (current_date - interval '2 years')::date where id = $1`, [ctrLimite]);
  const ctrExpire = await client('Contrat expiré', { courriel: 'e@exemple.ca' });
  await q(`update public.clients set dernier_contrat_le = (current_date - interval '2 years' - interval '1 day')::date where id = $1`, [ctrExpire]);
  const sansContrat = await client('Sans contrat', { courriel: 's@exemple.ca' });
  const expresVieux = await client('Exprès et expiré', { courriel: 'x@exemple.ca', dernier_contrat_le: jours(1500) });
  await fn(admin, `admin_enregistrer_consentement($1::uuid,'courriel_promo','accord','papier',null)`, [expresVieux]);
  const sansCourriel = await client('Sans courriel', { dernier_contrat_le: jours(10) });
  const desabPromo = await client('Désabonné promo', { courriel: 'd@exemple.ca', dernier_contrat_le: jours(10) });
  await fn(null, `desabonner_contact($1::text,$2::text,$3::text)`, ['courriel_promo', 'd@exemple.ca', 'lien_desabonnement'], 'service_role');
  const desabTout = await client('Désabonné de tout', { courriel: 't@exemple.ca', dernier_contrat_le: jours(10), avis_courriel: true });
  await fn(null, `desabonner_contact($1::text,$2::text,$3::text)`, ['courriel', 't@exemple.ca', 'lien_desabonnement'], 'service_role');
  const archive = await client('Archivé', { courriel: 'a@exemple.ca', dernier_contrat_le: jours(10), actif: false, avis_courriel: true });
  const vue = async (id) => (await sqlAs(admin, `select courriel_avis_ok, texto_avis_ok, promo_courriel_ok, promo_implicite_expire_le::text exp from public.clients_avis where id = $1`, [id]))[0];
  eq('contrat il y a 400 jours : promotions permises (consentement implicite), expire dans ~1 an', [(await vue(ctr)).promo_courriel_ok, (await vue(ctr)).exp], [true, new Date(new Date(jours(400)).setFullYear(new Date(jours(400)).getFullYear() + 2)).toISOString().slice(0, 10)]);
  eq('contrat terminé il y a EXACTEMENT 2 ans : encore permis (limite incluse)', (await vue(ctrLimite)).promo_courriel_ok, true);
  eq('contrat terminé il y a 2 ans et 1 jour : plus permis', (await vue(ctrExpire)).promo_courriel_ok, false);
  eq('… la date d\'expiration du consentement implicite est celle du contrat + 2 ans', (await vue(ctrExpire)).exp, (await q(`select ((current_date - interval '2 years' - interval '1 day') + interval '2 years')::date::text d`))[0].d);
  eq('aucune date de contrat, aucun consentement exprès : pas de promotions, pas de date d\'expiration', [(await vue(sansContrat)).promo_courriel_ok, (await vue(sansContrat)).exp], [false, null]);
  eq('un consentement EXPRÈS permet les promotions même si le contrat est vieux (et il n\'y a plus de date d\'expiration)', [(await vue(expresVieux)).promo_courriel_ok, (await vue(expresVieux)).exp], [true, null]);
  eq('sans courriel : aucun courriel possible', [(await vue(sansCourriel)).promo_courriel_ok, (await vue(sansCourriel)).courriel_avis_ok], [false, false]);
  eq('désabonné des offres : plus de promotions', (await vue(desabPromo)).promo_courriel_ok, false);
  eq('désabonné de tous les courriels : ni promotions ni avis', [(await vue(desabTout)).promo_courriel_ok, (await vue(desabTout)).courriel_avis_ok], [false, false]);
  eq('un client ARCHIVÉ ne reçoit rien (ni avis, ni promotions)', [(await vue(archive)).courriel_avis_ok, (await vue(archive)).promo_courriel_ok, (await vue(archive)).texto_avis_ok], [false, false, false]);
  // avis par courriel : il faut avis_courriel ET un courriel
  const av1 = await client('Avis courriel', { courriel: 'av@exemple.ca', avis_courriel: true });
  const av2 = await client('Avis courriel décoché', { courriel: 'av2@exemple.ca' });
  const av3 = await client('Avis courriel sans adresse', { avis_courriel: true });
  eq('avis par courriel : oui seulement si Joé a choisi d\'avertir ET que le client a un courriel', [(await vue(av1)).courriel_avis_ok, (await vue(av2)).courriel_avis_ok, (await vue(av3)).courriel_avis_ok], [true, false, false]);
  // avis par texto : inscription active
  const tx1 = await client('Texto inscrit', { cellulaire: '819 555 8301' });
  const tx2 = await client('Texto non inscrit', { cellulaire: '819 555 8302' });
  await fn(admin, `admin_enregistrer_consentement($1::uuid,'texto','accord','verbal',$2::text)`, [tx1, V1]);
  eq('avis par texto : oui seulement pour un client INSCRIT (un numéro seul ne suffit pas)', [(await vue(tx1)).texto_avis_ok, (await vue(tx2)).texto_avis_ok], [true, false]);
  await fn(null, `desabonner_contact($1::text,$2::text,$3::text)`, ['texto', '819 555 8301', 'texto_arret'], 'service_role');
  eq('… et plus du tout après ARRET', (await vue(tx1)).texto_avis_ok, false);
  await sqlAs(admin, `update public.clients set actif = false where id = $1`, [tx2]);
  await fn(admin, `admin_enregistrer_consentement($1::uuid,'texto','accord','verbal',$2::text)`, [tx1, V1]);
  await sqlAs(admin, `update public.clients set actif = false where id = $1`, [tx1]);
  eq('… ni pour un client archivé', (await vue(tx1)).texto_avis_ok, false);
  // la fonction seule
  const pp = async (...a) => (await sqlAs(admin, `select public.promo_courriel_permis($1::text, $2::date, $3::timestamptz, $4::timestamptz, $5::timestamptz, $6::boolean) r`, a))[0].r;
  eq('promo_courriel_permis : le cas permis de référence', await pp('a@b.ca', jours(5), null, null, null, true), true);
  eq('… courriel vide : non', await pp(null, jours(5), null, null, null, true), false);
  eq('… désabonné des offres : non', await pp('a@b.ca', jours(5), null, '2026-01-01', null, true), false);
  eq('… désabonné des courriels : non', await pp('a@b.ca', jours(5), null, null, '2026-01-01', true), false);
  eq('… client inactif : non ; « actif » absent (NULL) : non ; « actif » omis : oui (valeur par défaut)', [await pp('a@b.ca', jours(5), null, null, null, false), await pp('a@b.ca', jours(5), null, null, null, null), (await sqlAs(admin, `select public.promo_courriel_permis('a@b.ca', current_date, null, null, null) r`))[0].r], [false, false, true]);
  eq('… ni contrat ni consentement : non ; contrat vieux de 3 ans : non ; consentement exprès seul : oui', [await pp('a@b.ca', null, null, null, null, true), await pp('a@b.ca', jours(1100), null, null, null, true), await pp('a@b.ca', null, '2026-01-01', null, null, true)], [false, false, true]);
  await vider();
  await q(`delete from public.clients`);
}

log('\n=== LA 2ᵉ CASE DE LA PAGE : LES OFFRES PAR COURRIEL (facultative, séparée de celle des textos) ===');
{
  const desab = (canal, contact, source) => fn(null, `desabonner_contact($1::text,$2::text,$3::text)`, [canal, contact, source], 'service_role');
  const effacerTexte = async (version) => { await q(`alter table public.textes_consentement disable trigger textes_consentement_immuables`); await q(`delete from public.textes_consentement where version = $1`, [version]); await q(`alter table public.textes_consentement enable trigger textes_consentement_immuables`); };
  let ipTour = 0;   // chaque inscription vient d'une adresse IP différente (sinon la limite de 5 par heure et par adresse arrête le test)
  const promoUn = async (nom, cour, o = {}) => { await headers({ 'x-forwarded-for': '203.0.113.' + (100 + (++ipTour % 150)) }); return inscrire(nom, '1 rue Promo', o.cel || celNeuf(), cour, o.accepte === undefined ? true : o.accepte, o.version || V1, null, null, o.promo === undefined ? true : o.promo, o.versionPromo === undefined ? V1P : o.versionPromo); };
  const insc = async (nom) => (await q(`select nom, courriel, promo_accepte, version_promo, statut from public.inscriptions_avis where nom = $1`, [nom]))[0];
  await vider();
  await q(`delete from public.clients`);
  await headers({ 'x-forwarded-for': '203.0.113.80' });

  log('  -- s\'inscrire AVEC la 2ᵉ case cochée');
  eq('inscription avec les offres : réponse « enregistree »', await promoUn('Promo Un', 'Promo.Un@Exemple.CA'), { statut: 'enregistree' });
  eq('… l\'inscription garde l\'accord aux offres, la version lue et le courriel (en minuscules)', await insc('Promo Un'), { nom: 'Promo Un', courriel: 'promo.un@exemple.ca', promo_accepte: true, version_promo: V1P, statut: 'nouvelle' });
  const reg = await q(`select canal, action, source, contact, version_texte, ip_hash is not null h, client_id is null libre, inscription_id is not null i from public.consentements order by canal`);
  eq('… le registre garde DEUX accords distincts : les textos (le numéro, la version des textos) et les offres (le courriel, la version des offres)', reg.map((x) => [x.canal, x.action, x.source, x.version_texte, x.h, x.libre, x.i]), [['courriel_promo', 'accord', 'page_avis', V1P, true, true, true], ['texto', 'accord', 'page_avis', V1, true, true, true]]);
  eq('… avec le bon contact dans chaque ligne (courriel pour les offres, numéro pour les textos)', reg.map((x) => x.contact.startsWith('+1') ? 'numéro' : x.contact), ['promo.un@exemple.ca', 'numéro']);
  eq('… et la MÊME empreinte d\'adresse IP dans les deux lignes et dans l\'inscription', (await q(`select count(distinct h)::int n from (select ip_hash h from public.consentements union all select ip_hash from public.inscriptions_avis) x`))[0].n, 1);

  log('  -- s\'inscrire SANS la 2ᵉ case');
  await promoUn('Sans Promo', 'sans.promo@exemple.ca', { promo: false, versionPromo: null });
  eq('case non cochée : « promo_accepte » est faux, aucune version, même si un courriel est donné', await insc('Sans Promo'), { nom: 'Sans Promo', courriel: 'sans.promo@exemple.ca', promo_accepte: false, version_promo: null, statut: 'nouvelle' });
  eq('… et aucune ligne « courriel_promo » n\'est écrite au registre pour elle', await n(`select count(*)::int n from public.consentements c join public.inscriptions_avis i on i.id = c.inscription_id where i.nom = 'Sans Promo' and c.canal = 'courriel_promo'`), 0);
  await promoUn('Promo Absent', 'absent@exemple.ca', { promo: null, versionPromo: V1P });
  eq('« promo » absent (NULL) compte comme « non » : rien n\'est noté pour les offres (même si une version est envoyée)', [await insc('Promo Absent'), await n(`select count(*)::int n from public.consentements c join public.inscriptions_avis i on i.id = c.inscription_id where i.nom = 'Promo Absent' and c.canal = 'courriel_promo'`)], [{ nom: 'Promo Absent', courriel: 'absent@exemple.ca', promo_accepte: false, version_promo: null, statut: 'nouvelle' }, 0]);
  await promoUn('Version Ignoree', null, { promo: false, versionPromo: 'texto-fantome' });
  eq('case non cochée avec une version quelconque : la version est ignorée (aucune erreur, rien de gardé)', (await insc('Version Ignoree')).version_promo, null);
  await promoUn('Sans Courriel', null, { promo: false, versionPromo: null });
  eq('sans la 2ᵉ case, le courriel reste facultatif (aucun courriel)', (await insc('Sans Courriel')).courriel, null);

  await headers({ 'x-forwarded-for': '203.0.113.99' });
  const ancienne = await fn(null, `inscrire_avis($1::text,$2::text,$3::text,$4::text,$5::boolean,$6::text,$7::text,$8::text)`, ['Ancienne Page', '1 rue Ancienne', celNeuf(), 'ancienne@exemple.ca', true, V1, null, null], 'anon');
  eq('une page qui ne connaît pas encore la 2ᵉ case (8 paramètres seulement) marche toujours : « enregistree », sans offres', [ancienne, (await insc('Ancienne Page')).promo_accepte, (await insc('Ancienne Page')).version_promo], [{ statut: 'enregistree' }, false, null]);
  eq('… et le registre n\'a que l\'accord aux textos pour elle', (await q(`select c.canal from public.consentements c join public.inscriptions_avis i on i.id = c.inscription_id where i.nom = 'Ancienne Page'`)).map((x) => x.canal), ['texto']);

  log('  -- les refus');
  const avant = [await compte('inscriptions_avis'), await compte('consentements')];
  await err('case des offres cochée SANS courriel : refusée', () => promoUn('Refus Un', null), 'courriel_requis_offres');
  await err('… un courriel fait d\'espaces compte comme « aucun »', () => promoUn('Refus Deux', '   '), 'courriel_requis_offres');
  await err('case des offres cochée avec un courriel invalide : c\'est le courriel qui est refusé', () => promoUn('Refus Trois', 'pasuncourriel'), 'courriel_invalide');
  await err('case des offres cochée sans version du texte lu : refusée', () => promoUn('Refus Quatre', 'q4@exemple.ca', { versionPromo: null }), 'version_promo_inconnue');
  await err('… avec une version qui n\'existe pas : refusée', () => promoUn('Refus Cinq', 'q5@exemple.ca', { versionPromo: 'promo-fantome' }), 'version_promo_inconnue');
  await err('… avec la version du texte des TEXTOS (mauvais canal) : refusée', () => promoUn('Refus Six', 'q6@exemple.ca', { versionPromo: V1 }), 'version_promo_inconnue');
  await q(`update public.textes_consentement set en_vigueur = false where version = $1`, [V1P]);
  await err('… avec la bonne version mais retirée du service (plus « en vigueur ») : refusée', () => promoUn('Refus Sept', 'q7@exemple.ca'), 'version_promo_inconnue');
  await q(`update public.textes_consentement set en_vigueur = true where version = $1`, [V1P]);
  await err('les offres ne suffisent pas : la case des TEXTOS reste obligatoire', () => promoUn('Refus Huit', 'q8@exemple.ca', { accepte: false }), 'consentement_requis');
  await err('la version des offres NE PEUT PAS servir de version du texte des textos (mauvais canal)', () => promoUn('Refus Neuf', 'q9@exemple.ca', { version: V1P }), 'version_inconnue');
  eq('… rien n\'a été gardé par tous ces refus', [await compte('inscriptions_avis'), await compte('consentements')], avant);

  log('  -- le « double toucher » : un NOUVEL accord aux offres est noté, un doublon non');
  await vider();
  const numero = celNeuf();
  await promoUn('Double A', 'double.a@exemple.ca', { cel: numero, promo: false, versionPromo: null });
  await promoUn('Double B', 'double.b@exemple.ca', { cel: numero, promo: false, versionPromo: null });
  eq('même numéro, sans offres les deux fois : le 2ᵉ est un doublon (une seule inscription)', await compte('inscriptions_avis'), 1);
  const second = await promoUn('Double C', 'double.c@exemple.ca', { cel: numero });
  eq('même numéro, mais la personne ajoute maintenant son accord aux offres : c\'est un NOUVEL accord, il est noté (une 2ᵉ inscription)', [second, await compte('inscriptions_avis'), (await insc('Double C')).promo_accepte], [{ statut: 'enregistree' }, 2, true]);
  await promoUn('Double D', 'double.d@exemple.ca', { cel: numero });
  eq('… un 3ᵉ envoi identique (avec offres) est un doublon', await compte('inscriptions_avis'), 2);
  await promoUn('Double E', 'double.e@exemple.ca', { cel: numero, promo: false, versionPromo: null });
  eq('… et un envoi SANS offres après un envoi AVEC offres est aussi un doublon', await compte('inscriptions_avis'), 2);
  eq('… le registre garde un seul accord aux offres (celui de « Double C »)', (await q(`select contact from public.consentements where canal = 'courriel_promo'`)).map((x) => x.contact), ['double.c@exemple.ca']);

  log('  -- les règles de la table (même pour le propriétaire de la base)');
  await vider();
  const ligneBase = (promo, version, cour) => q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, courriel, version_texte, promo_accepte, version_promo) values ('Table Promo', '1 rue Ok', '+18195559950', $1, '${V1}', $2, $3)`, [cour, promo, version]);
  await err('promo cochée sans version lue : refusé par la table', () => ligneBase(true, null, 'ok@exemple.ca'), 'inscriptions_avis_promo_coherente');
  await err('promo cochée sans courriel : refusé par la table', () => ligneBase(true, V1P, null), 'inscriptions_avis_promo_coherente');
  await err('promo NON cochée mais avec une version : refusé par la table', () => ligneBase(false, V1P, 'ok@exemple.ca'), 'inscriptions_avis_promo_coherente');
  await err('« promo_accepte » ne peut pas être NULL (colonne obligatoire)', () => q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, version_texte, promo_accepte) values ('Promo Null', '1 rue Ok', '+18195559951', '${V1}', null)`), 'null value');
  await err('une version des offres qui n\'existe pas : refusée (clé étrangère)', () => ligneBase(true, 'promo-fantome', 'ok@exemple.ca'), 'foreign key');
  await ligneBase(true, V1P, 'ok@exemple.ca');
  await ligneBase(false, null, null);
  eq('les deux cas permis passent : offres avec courriel et version ; sans offres ni version', await compte('inscriptions_avis'), 2);
  await err('une ligne du registre ne peut pas viser une version du texte qui n\'existe pas (offres)', () => q(`insert into public.consentements (canal, action, source, contact, version_texte) values ('courriel_promo', 'accord', 'page_avis', 'ok@exemple.ca', 'promo-fantome')`), 'foreign key');
  await q(`insert into public.textes_consentement (version, canal, texte) values ('promo-2027-v2', 'courriel_promo', 'Un nouveau texte des offres par courriel, version deux.')`);
  eq('une NOUVELLE version du texte des offres s\'ajoute (et « texte_promo_en_vigueur » de la vérification suivrait la plus récente)', (await q(`select version from public.textes_consentement where en_vigueur and canal = 'courriel_promo' order by cree_le desc, version desc limit 1`))[0].version.startsWith('promo-'), true);
  await effacerTexte('promo-2027-v2');
  await vider();

  log('  -- relier une inscription qui accepte les offres : la fiche reçoit le consentement exprès');
  const vieux = (id, jours) => q(`alter table public.consentements disable trigger consentements_immuables`).then(() => q(`update public.consentements set fait_le = now() - ($2 || ' days')::interval where inscription_id = $1`, [id, String(jours)])).then(() => q(`alter table public.consentements enable trigger consentements_immuables`));
  const idInsc = async (nom) => (await q(`select id from public.inscriptions_avis where nom = $1`, [nom]))[0].id;
  const relier = (nom, c) => idInsc(nom).then((id) => fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [id, c]));
  const fait = async (nom) => (await q(`select fait_le from public.consentements c join public.inscriptions_avis i on i.id = c.inscription_id where i.nom = $1 and c.canal = 'courriel_promo'`, [nom]))[0].fait_le;

  await promoUn('Appliquée Sans Courriel', 'sans.courriel@exemple.ca');
  await vieux(await idInsc('Appliquée Sans Courriel'), 9);
  const cSpectateur = await client('Spectateur', { courriel: 'spectateur@exemple.ca', cellulaire: '819 555 9969' });
  await q(`update public.clients set desabonne_promo_le = now() - interval '40 days' where id = $1`, [cSpectateur]);
  const cSans = await client('Fiche sans courriel');
  await q(`update public.clients set desabonne_promo_le = now() - interval '30 days' where id = $1`, [cSans]);
  const rep1 = await relier('Appliquée Sans Courriel', cSans);
  const l1 = await ligneClient(cSans);
  eq('fiche SANS courriel : « promo » = appliquee, la fiche reçoit le courriel de l\'inscription', [rep1.promo, l1.courriel], ['appliquee', 'sans.courriel@exemple.ca']);
  eq('… le consentement exprès porte la DATE DE L\'INSCRIPTION (il y a 9 jours), pas celle du lien, et le désabonnement des offres est levé', [Math.abs(new Date(l1.promo_consentement_expres_le).getTime() - new Date(await fait('Appliquée Sans Courriel')).getTime()) < 1000, Math.round((Date.now() - new Date(l1.promo_consentement_expres_le).getTime()) / 86400000), l1.desabonne_promo_le], [true, 9, null]);
  eq('… la vue dit que les offres par courriel sont permises, sans date d\'expiration (consentement exprès)', await sqlAs(admin, `select promo_courriel_ok, promo_implicite_expire_le from public.clients_avis where id = $1`, [cSans]), [{ promo_courriel_ok: true, promo_implicite_expire_le: null }]);
  eq('… et le registre : les DEUX lignes de l\'inscription sont reliées à la fiche', (await consents(`client_id = $1`, [cSans])).map((x) => x.canal).sort(), ['courriel_promo', 'texto']);

  await promoUn('Appliquée Même Courriel', 'meme@exemple.ca');
  const cMeme = await client('Fiche même courriel', { courriel: 'MEME@exemple.ca' });
  eq('fiche avec le MÊME courriel (écrit autrement) : appliquee', (await relier('Appliquée Même Courriel', cMeme)).promo, 'appliquee');
  eq('… la fiche a le consentement exprès', (await ligneClient(cMeme)).promo_consentement_expres_le !== null, true);

  await promoUn('Courriel Différent', 'celui.de.la.page@exemple.ca');
  const cAutre = await client('Fiche autre courriel', { courriel: 'autre.adresse@exemple.ca' });
  const rep2 = await relier('Courriel Différent', cAutre);
  const l2 = await ligneClient(cAutre);
  eq('fiche avec un AUTRE courriel : « promo » = courriel_different, rien n\'est appliqué (ni consentement exprès, ni changement du courriel)', [rep2.promo, l2.promo_consentement_expres_le, l2.courriel], ['courriel_different', null, 'autre.adresse@exemple.ca']);
  eq('… mais l\'inscription est reliée quand même et le numéro est inscrit aux textos', [rep2.statut, l2.avis_texto], ['reliee', true]);
  eq('… et le registre garde l\'accord aux offres avec le courriel de la PAGE (la preuve ne change pas)', (await consents(`canal = 'courriel_promo' and client_id = $1`, [cAutre])).map((x) => x.contact), ['celui.de.la.page@exemple.ca']);

  await promoUn('Désabonné De Tout', 'desab.tout@exemple.ca');
  const cDesab = await client('Fiche désabonnée de tous les courriels', { courriel: 'desab.tout@exemple.ca' });
  await desab('courriel', 'desab.tout@exemple.ca', 'lien_desabonnement');
  const rep3 = await relier('Désabonné De Tout', cDesab);
  eq('fiche désabonnée de TOUS les courriels : « promo » = desabonne_des_courriels, rien n\'est appliqué', [rep3.promo, (await ligneClient(cDesab)).promo_consentement_expres_le, (await ligneClient(cDesab)).desabonne_courriel_le !== null], ['desabonne_des_courriels', null, true]);

  await promoUn('Retrait Venu Après', 'retrait.apres@exemple.ca');
  await vieux(await idInsc('Retrait Venu Après'), 3);
  await desab('courriel_promo', 'retrait.apres@exemple.ca', 'lien_desabonnement');
  const cRetrait = await client('Fiche avant le retrait');
  const rep4 = await relier('Retrait Venu Après', cRetrait);
  eq('un RETRAIT des offres venu APRÈS l\'accord de la page : « promo » = retire_depuis, rien n\'est appliqué (le dernier mot est celui de la personne)', [rep4.promo, (await ligneClient(cRetrait)).promo_consentement_expres_le], ['retire_depuis', null]);

  await promoUn('Retrait Avant', 'retrait.avant@exemple.ca');
  await desab('courriel_promo', 'retrait.avant@exemple.ca', 'lien_desabonnement');
  await q(`alter table public.consentements disable trigger consentements_immuables`);
  await q(`update public.consentements set fait_le = now() - interval '5 days' where contact = 'retrait.avant@exemple.ca' and action = 'retrait'`);
  await q(`alter table public.consentements enable trigger consentements_immuables`);
  const cAvant = await client('Fiche retrait ancien');
  eq('un retrait ANTÉRIEUR à l\'accord de la page (la personne a changé d\'avis) ne bloque pas : appliquee', [(await relier('Retrait Avant', cAvant)).promo, (await ligneClient(cAvant)).promo_consentement_expres_le !== null], ['appliquee', true]);

  await promoUn('Retrait Autre Courriel', 'retrait.autre@exemple.ca');
  await desab('courriel_promo', 'quelquun.dautre@exemple.ca', 'lien_desabonnement');
  const cAutreRetrait = await client('Fiche retrait d\'un autre');
  eq('le retrait d\'un AUTRE courriel ne touche pas cette inscription : appliquee', (await relier('Retrait Autre Courriel', cAutreRetrait)).promo, 'appliquee');

  await promoUn('Sans Offres A Relier', 'sans.offres@exemple.ca', { promo: false, versionPromo: null });
  const cSansOffres = await client('Fiche sans offres', { courriel: 'sans.offres@exemple.ca' });
  eq('inscription SANS la case des offres : « promo » = non_demandee, la fiche n\'a aucun consentement exprès', [(await relier('Sans Offres A Relier', cSansOffres)).promo, (await ligneClient(cSansOffres)).promo_consentement_expres_le], ['non_demandee', null]);

  eq('le client « spectateur » n\'a été touché par AUCUN des liens ci-dessus (ni consentement exprès, ni désabonnement levé)', [(await ligneClient(cSpectateur)).promo_consentement_expres_le, (await ligneClient(cSpectateur)).desabonne_promo_le !== null, (await ligneClient(cSpectateur)).avis_texto], [null, true, false]);

  log('  -- la requête « verification » : un canal à la fois');
  await q(`insert into public.textes_consentement (version, canal, texte, cree_le) values ('promo-2099-futur', 'courriel_promo', 'Un texte des offres plus récent que tous les autres.', now() + interval '1 hour')`);
  const v2 = (await db.query(SQL30.slice(SQL30.lastIndexOf('select jsonb_build_object(')))).rows[0].verification;
  eq('avec un texte des offres PLUS RÉCENT : « texte_en_vigueur » reste celui des textos, « texte_promo_en_vigueur » est celui des offres', [v2.texte_en_vigueur, v2.texte_promo_en_vigueur], [V1, 'promo-2099-futur']);
  await effacerTexte('promo-2099-futur');
  await q(`insert into public.textes_consentement (version, canal, texte, cree_le) values ('texto-2099-futur', 'texto', 'Un texte des textos plus récent que tous les autres.', now() + interval '1 hour')`);
  const v3 = (await db.query(SQL30.slice(SQL30.lastIndexOf('select jsonb_build_object(')))).rows[0].verification;
  eq('avec un texte des TEXTOS plus récent : « texte_en_vigueur » le suit et « texte_promo_en_vigueur » ne change pas', [v3.texte_en_vigueur, v3.texte_promo_en_vigueur], ['texto-2099-futur', V1P]);
  await effacerTexte('texto-2099-futur');

  log('  -- noter un accord aux textos : seulement une version du texte DES TEXTOS');
  const cNoter = await client('Fiche noter', { cellulaire: '819 555 9960', courriel: 'noter@exemple.ca' });
  await err('un accord par texto noté avec la version du texte des OFFRES : refusé (mauvais canal)', () => fn(admin, `admin_enregistrer_consentement($1::uuid,'texto','accord','verbal',$2::text)`, [cNoter, V1P]), 'version_inconnue');
  eq('… rien n\'a été écrit', [(await ligneClient(cNoter)).avis_texto, (await consents(`client_id = $1`, [cNoter])).length], [false, 0]);

  await vider();
  await q(`delete from public.clients`);
  await headers({ 'x-forwarded-for': '203.0.113.10' });
}

log('\n=== DURCISSEMENT : LES CAS LIMITES QUE LES ERREURS VOLONTAIRES ONT FAIT DÉCOUVRIR ===');
{
  const desab = (canal, contact, source) => fn(null, `desabonner_contact($1::text,$2::text,$3::text)`, [canal, contact, source], 'service_role');
  const noter = (c, canal, action, source, version = null) => fn(admin, `admin_enregistrer_consentement($1::uuid,$2::text,$3::text,$4::text,$5::text)`, [c, canal, action, source, version]);
  const effacerTexte = async (version) => { await q(`alter table public.textes_consentement disable trigger textes_consentement_immuables`); await q(`delete from public.textes_consentement where version = $1`, [version]); await q(`alter table public.textes_consentement enable trigger textes_consentement_immuables`); };

  log('  -- les limites par adresse IP, chacune isolée des autres (des inscriptions semées avec une date précise)');
  const hashIp = async (ip) => (await q(`select encode(sha256(convert_to($1::text || '|' || (select sel from public.avis_sel limit 1), 'utf8')), 'hex') h`, [ip]))[0].h;
  let decalage = 0;
  const semer = async (ip, k, age) => {
    await q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, version_texte, ip_hash, cree_le) select 'Sem ' || g, 'Adresse ' || g || ' rue', '+1819558' || lpad((g + $4::int)::text, 4, '0'), '${V1}', $1, now() - $2::interval from generate_series(1, $3::int) g`, [await hashIp(ip), age, k, decalage]);
    decalage += k;
  };
  const accepte = async (ip) => { await headers({ 'x-forwarded-for': ip }); return (await inscrire('Essai Ip', '1 rue Essai', celNeuf(), null)).statut; };
  await vider();
  await semer('198.51.100.30', 4, '45 minutes');
  eq('4 inscriptions il y a 45 minutes : la 5ᵉ de l\'heure passe', await accepte('198.51.100.30'), 'enregistree');
  await err('… la suivante est refusée : la limite d\'une HEURE compte aussi celles d\'il y a 45 minutes (5 en tout)', () => accepte('198.51.100.30'), 'trop_de_demandes');
  await vider();
  await semer('198.51.100.31', 14, '5 hours');
  eq('14 inscriptions il y a 5 heures (hors de l\'heure) : la 15ᵉ de la journée passe', await accepte('198.51.100.31'), 'enregistree');
  await err('… la 16ᵉ est refusée par la limite de la JOURNÉE (une seule inscription dans l\'heure : ce n\'est pas la limite d\'une heure)', () => accepte('198.51.100.31'), 'trop_de_demandes');
  await vider();
  await semer('198.51.100.32', 15, '20 hours');
  await err('15 inscriptions il y a 20 heures comptent encore (la fenêtre est d\'un JOUR) : refusée', () => accepte('198.51.100.32'), 'trop_de_demandes');
  eq('… mais la limite est PROPRE à chaque adresse : une autre adresse passe', await accepte('198.51.100.36'), 'enregistree');
  await vider();
  await semer('198.51.100.33', 15, '25 hours');
  eq('15 inscriptions il y a 25 heures ne comptent plus : acceptée', await accepte('198.51.100.33'), 'enregistree');
  await vider();

  log('  -- les limites exactes de la page publique');
  await headers({ 'x-forwarded-for': '203.0.113.11' });
  eq('une adresse de 5 caractères est acceptée (limite exacte)', (await inscrire('Nom Cinq', '12345', celNeuf(), null)).statut, 'enregistree');
  await err('… 4 caractères : refusée', () => inscrire('Nom Quatre', '1234', celNeuf(), null), 'adresse_invalide');
  const cour150 = 'x'.repeat(145) + '@b.ca';
  eq('un courriel de 150 caractères est accepté (limite exacte)', [cour150.length, (await inscrire('Nom Courriel', '1 rue Courriel', celNeuf(), cour150)).statut], [150, 'enregistree']);
  await err('… 151 caractères : refusé', () => inscrire('Nom Courriel 2', '1 rue Courriel', celNeuf(), 'x' + cour150), 'courriel_invalide');
  await vider();

  log('  -- la forme d\'un courriel est aussi vérifiée par les TABLES (pas seulement par la page)');
  for (const c of ['a@b', 'a b@c.ca', '@c.ca', 'a@@c.ca', 'a@c.', 'a@.ca', 'sans-arobase.ca']) {
    await err(`fiche client : le courriel « ${c} » est refusé`, () => q(`insert into public.clients (nom, courriel) values ('Mauvais courriel', $1)`, [c]), 'clients_courriel_format');
    await err(`inscription : le courriel « ${c} » est refusé`, () => q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, courriel, version_texte) values ('Mauvais Courriel', '1 rue Ok', '+18195559900', $1, '${V1}')`, [c]), 'inscriptions_avis_courriel_format');
  }
  await q(`insert into public.clients (nom, courriel) values ('Bon courriel', 'a.b+c@d-e.co.ca')`);
  eq('… un courriel de forme ordinaire (a.b+c@d-e.co.ca) passe', await compte('clients'), 1);
  await q(`delete from public.clients`);

  log('  -- le cellulaire : la règle de la table tient même si le déclencheur est arrêté (deuxième ligne de défense)');
  await q(`alter table public.clients disable trigger clients_avant_ecriture`);
  for (const c of ['8195551234', '+8195551234', '+10195551234', '+11195551234', '+18190551234', '+18191551234', '+1819555123', '+181955512345']) {
    await err(`sans le déclencheur, la table refuse quand même le cellulaire « ${c} »`, () => q(`insert into public.clients (nom, cellulaire) values ('Mauvais cel', $1)`, [c]), 'clients_cellulaire_format');
  }
  await q(`insert into public.clients (nom, cellulaire) values ('Bon cel', '+18195551234')`);
  eq('… et un bon numéro (+1 819 555 1234) passe', await n(`select count(*)::int n from public.clients where cellulaire = '+18195551234'`), 1);
  await q(`delete from public.clients`);
  await q(`alter table public.clients enable trigger clients_avant_ecriture`);

  log('  -- la date du dernier contrat : les bornes exactes');
  await q(`insert into public.clients (nom, dernier_contrat_le) values ('Date basse', date '2000-01-01'), ('Date haute', date '2100-12-31')`);
  eq('les deux dates limites (2000-01-01 et 2100-12-31) sont acceptées', await compte('clients'), 2);
  await err('… le 1999-12-31 est refusé', () => q(`insert into public.clients (nom, dernier_contrat_le) values ('Trop tôt', date '1999-12-31')`), 'clients_dernier_contrat_plausible');
  await err('… le 2101-01-01 est refusé', () => q(`insert into public.clients (nom, dernier_contrat_le) values ('Trop tard', date '2101-01-01')`), 'clients_dernier_contrat_plausible');
  await q(`delete from public.clients`);

  log('  -- colonnes qui ne peuvent jamais être vides');
  await err('un texte de consentement sans texte (NULL) est refusé', () => q(`insert into public.textes_consentement (version, canal, texte) values ('v-null', 'texto', null)`), 'null value');
  await err('… « en_vigueur » ne peut pas être NULL', () => q(`insert into public.textes_consentement (version, canal, texte, en_vigueur) values ('v-null2', 'texto', 'Un texte assez long pour la règle', null)`), 'null value');
  await err('une inscription avec un statut NULL est refusée', () => q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, version_texte, statut) values ('Statut Null', '1 rue Ok', '+18195559901', '${V1}', null)`), 'null value');

  log('  -- le registre : même une modification qui ne change rien est refusée tant que la ligne n\'est reliée à personne');
  await q(`insert into public.consentements (canal, action, source, contact) values ('texto', 'retrait', 'texto_arret', '+18195559902')`);
  const idLibre = (await q(`select id from public.consentements where contact = '+18195559902'`))[0].id;
  await err('mettre « client_id » à NULL sur une ligne qui l\'est déjà : refusé (aucune modification du registre, même vide)', () => q(`update public.consentements set client_id = null where id = $1`, [idLibre]), 'registre_immuable');
  await vider();

  log('  -- les règles d\'accès ne visent que les personnes connectées');
  eq('les 4 règles d\'accès sont réservées au rôle « authenticated » (pas « public »)', (await q(`select tablename || '.' || policyname || ':' || roles::text r from pg_policies where schemaname = 'public' and tablename in ('clients','textes_consentement','inscriptions_avis','consentements') order by 1`)).map((x) => x.r),
    ['clients.clients_admin:{authenticated}', 'consentements.consentements_admin_lecture:{authenticated}', 'inscriptions_avis.inscriptions_avis_admin_lecture:{authenticated}', 'textes_consentement.textes_consentement_admin_lecture:{authenticated}']);

  log('  -- relier et écarter : seulement l\'inscription visée');
  await headers({ 'x-forwarded-for': '203.0.113.12' });
  const cA = await client('Client A relier');
  await inscrire('Insc A', '1 rue Un', celNeuf(), null);
  await inscrire('Insc B', '2 rue Deux', celNeuf(), null);
  await inscrire('Insc C', '3 rue Trois', celNeuf(), null);
  await desab('texto', '(819) 555-9703', 'texto_arret');   // un ARRET d'un numéro inconnu : une ligne du registre SANS fiche ni inscription
  const idDe = async (nom) => (await q(`select id from public.inscriptions_avis where nom = $1`, [nom]))[0].id;
  await fn(admin, `admin_relier_inscription($1::uuid,$2::uuid)`, [await idDe('Insc A'), cA]);
  eq('relier A : seule A est reliée ; B et C restent « nouvelle », non traitées', (await q(`select nom, statut, client_id is not null reliee, traitee_le is not null traitee from public.inscriptions_avis order by nom`)).map((x) => [x.nom, x.statut, x.reliee, x.traitee]), [['Insc A', 'reliee', true, true], ['Insc B', 'nouvelle', false, false], ['Insc C', 'nouvelle', false, false]]);
  eq('… seule la preuve (registre) de A est reliée au client : pas celles de B et de C, ni le retrait d\'un numéro inconnu', (await q(`select i.nom, c.client_id is not null reliee from public.consentements c left join public.inscriptions_avis i on i.id = c.inscription_id order by i.nom nulls last`)).map((x) => [x.nom, x.reliee]), [['Insc A', true], ['Insc B', false], ['Insc C', false], [null, false]]);
  await fn(admin, `admin_ignorer_inscription($1::uuid)`, [await idDe('Insc B')]);
  eq('écarter B : seule B est écartée ; C reste « nouvelle », non traitée ; A reste reliée', (await q(`select nom, statut, traitee_le is not null traitee from public.inscriptions_avis order by nom`)).map((x) => [x.nom, x.statut, x.traitee]), [['Insc A', 'reliee', true], ['Insc B', 'ignoree', true], ['Insc C', 'nouvelle', false]]);
  await vider();
  await q(`delete from public.clients`);

  log('  -- noter un consentement : paramètres absents, version retirée');
  const cN = await client('Client Null', { cellulaire: '819 555 9710', courriel: 'null@exemple.ca' });
  await err('canal absent (NULL) : refusé', () => noter(cN, null, 'accord', 'verbal'), 'canal_invalide');
  await err('… action absente (NULL) : refusée', () => noter(cN, 'texto', null, 'verbal', V1), 'action_invalide');
  await err('… source absente (NULL) : refusée', () => noter(cN, 'texto', 'accord', null, V1), 'source_invalide');
  await q(`insert into public.textes_consentement (version, canal, texte, en_vigueur) values ('texto-ancien', 'texto', 'Un ancien texte de consentement, retiré du service.', false)`);
  await err('… un accord avec une version qui n\'est plus en vigueur : refusé', () => noter(cN, 'texto', 'accord', 'verbal', 'texto-ancien'), 'version_inconnue');
  await err('… avec une version qui n\'existe pas : refusé', () => noter(cN, 'texto', 'accord', 'verbal', 'texto-fantome'), 'version_inconnue');
  await err('… sans version : refusé', () => noter(cN, 'texto', 'accord', 'verbal', null), 'version_inconnue');
  eq('… rien n\'a été écrit (le client n\'est pas inscrit, le registre est vide)', [(await ligneClient(cN)).avis_texto, await compte('consentements')], [false, 0]);
  await effacerTexte('texto-ancien');

  log('  -- un retrait ne touche que son client ; le registre garde les retraits des offres');
  const cR1 = await client('Retrait 1', { cellulaire: '819 555 9721', courriel: 'r1@exemple.ca' });
  const cR2 = await client('Retrait 2', { cellulaire: '819 555 9722', courriel: 'r2@exemple.ca' });
  for (const c of [cR1, cR2]) { await noter(c, 'texto', 'accord', 'verbal', V1); await noter(c, 'courriel_promo', 'accord', 'verbal'); }
  await noter(cR1, 'texto', 'retrait', 'verbal');
  eq('retrait des textos de R1 : R2 reste inscrit, sans date de désabonnement', [(await ligneClient(cR1)).avis_texto, (await ligneClient(cR2)).avis_texto, (await ligneClient(cR2)).desabonne_texto_le], [false, true, null]);
  await noter(cR1, 'courriel_promo', 'retrait', 'verbal');
  eq('retrait des offres de R1 : R1 perd son consentement exprès ; R2 garde le sien, sans date de désabonnement', [(await ligneClient(cR1)).promo_consentement_expres_le, (await ligneClient(cR1)).desabonne_promo_le !== null, (await ligneClient(cR2)).promo_consentement_expres_le !== null, (await ligneClient(cR2)).desabonne_promo_le], [null, true, true, null]);
  eq('… le registre garde ce retrait : canal courriel_promo, retrait, verbal, le courriel de R1', (await consents(`client_id = $1 and canal = 'courriel_promo' and action = 'retrait'`, [cR1])).map((x) => [x.source, x.contact]), [['verbal', 'r1@exemple.ca']]);
  eq('lien « plus d\'offres » de R2 : réponse, puis le registre garde courriel_promo, retrait, lien_desabonnement, le courriel (en minuscules)', [await desab('courriel_promo', 'R2@Exemple.ca', 'lien_desabonnement'), (await consents(`client_id = $1 and source = 'lien_desabonnement'`, [cR2])).map((x) => [x.canal, x.action, x.contact])], [{ statut: 'desabonne', clients: 1 }, [['courriel_promo', 'retrait', 'r2@exemple.ca']]]);

  log('  -- désabonner : paramètres absents');
  await err('canal absent (NULL) : refusé', () => desab(null, '819 555 9730', 'texto_arret'), 'canal_invalide');
  await err('… source absente (NULL) : refusée', () => desab('texto', '819 555 9730', null), 'source_invalide');
  await err('… courriel absent (NULL) : refusé', () => desab('courriel', null, 'lien_desabonnement'), 'contact_invalide');
  await err('… numéro absent (NULL) : refusé', () => desab('texto', null, 'texto_arret'), 'contact_invalide');
  await vider();
  await q(`delete from public.clients`);

  log('  -- la vue : un désabonnement coupe seulement son canal (même si la case d\'inscription est restée cochée : la vue est prudente)');
  const cV = await client('Vue 1', { cellulaire: '819 555 9741', courriel: 'v1@exemple.ca', avis_courriel: true });
  await noter(cV, 'texto', 'accord', 'verbal', V1);
  const vue2 = async (id) => (await sqlAs(admin, `select courriel_avis_ok, texto_avis_ok from public.clients_avis where id = $1`, [id]))[0];
  eq('client inscrit aux textos et aux courriels : les deux sont permis', await vue2(cV), { courriel_avis_ok: true, texto_avis_ok: true });
  await q(`update public.clients set desabonne_courriel_le = now() where id = $1`, [cV]);
  eq('désabonné des COURRIELS : les courriels sont coupés, les textos non', await vue2(cV), { courriel_avis_ok: false, texto_avis_ok: true });
  await q(`update public.clients set desabonne_courriel_le = null, desabonne_texto_le = now() where id = $1`, [cV]);
  eq('désabonné des TEXTOS : les textos sont coupés, les courriels non', await vue2(cV), { courriel_avis_ok: true, texto_avis_ok: false });
  await vider();
  await q(`delete from public.clients`);

  log('  -- la requête « verification » du bas du fichier dit vrai quand on change les droits (elle sert à contrôler le vrai Supabase)');
  const VERIF = SQL30.slice(SQL30.lastIndexOf('select jsonb_build_object('));
  const verif = async () => { await db.query('reset role'); return (await db.query(VERIF)).rows[0].verification; };
  const repos = await verif();
  eq('au repos : personne d\'extérieur ne lit les tables, nul ne peut écrire un consentement, « desabonner » est réservée au service, seul « inscrire_avis » est ouvert aux visiteurs', [repos.visiteur_peut_lire_les_tables, repos.connecte_peut_ecrire_le_consentement, repos.desabonner_reserve_au_service, repos.visiteur_peut_appeler], [false, false, true, ['inscrire_avis']]);
  for (const t of ['clients', 'inscriptions_avis', 'consentements', 'avis_sel', 'clients_avis']) {
    await q(`grant select on public.${t} to anon`);
    eq(`si un visiteur pouvait lire « ${t} » : la vérification le dit`, (await verif()).visiteur_peut_lire_les_tables, true);
    await q(`revoke select on public.${t} from anon`);
  }
  eq('… retiré de nouveau : la vérification redit « non »', (await verif()).visiteur_peut_lire_les_tables, false);
  for (const [libelle, donner, retirer] of [
    ['écrire dans le registre', `grant insert on public.consentements to authenticated`, `revoke insert on public.consentements from authenticated`],
    ['écrire « avis_texto » d\'une fiche', `grant update (avis_texto) on public.clients to authenticated`, `revoke update (avis_texto) on public.clients from authenticated`],
    ['écrire « desabonne_texto_le » d\'une fiche', `grant update (desabonne_texto_le) on public.clients to authenticated`, `revoke update (desabonne_texto_le) on public.clients from authenticated`],
  ]) {
    await q(donner);
    eq(`si un employé connecté pouvait ${libelle} : la vérification le dit`, (await verif()).connecte_peut_ecrire_le_consentement, true);
    await q(retirer);
  }
  eq('… retiré de nouveau : la vérification redit « non »', (await verif()).connecte_peut_ecrire_le_consentement, false);
  await q(`grant execute on function public.desabonner_contact(text, text, text) to authenticated`);
  eq('si un employé connecté pouvait appeler « desabonner_contact » : la vérification dit qu\'elle n\'est plus réservée au service', (await verif()).desabonner_reserve_au_service, false);
  await q(`revoke execute on function public.desabonner_contact(text, text, text) from authenticated`);
  await q(`revoke execute on function public.desabonner_contact(text, text, text) from service_role`);
  eq('si le service d\'envoi ne pouvait plus l\'appeler : la vérification le dit aussi', (await verif()).desabonner_reserve_au_service, false);
  await q(`grant execute on function public.desabonner_contact(text, text, text) to service_role`);
  await q(`grant execute on function public.admin_relier_inscription(uuid, uuid) to anon`);
  eq('si un visiteur pouvait appeler « admin_relier_inscription » : la vérification la nomme', (await verif()).visiteur_peut_appeler, ['admin_relier_inscription', 'inscrire_avis']);
  await q(`revoke execute on function public.admin_relier_inscription(uuid, uuid) from anon`);
  eq('… tout est revenu au repos', (await verif()).visiteur_peut_appeler, ['inscrire_avis']);

  await headers({ 'x-forwarded-for': '203.0.113.10' });
}

log('\n=== LES TAILLES : ASSEZ POUR TOUT UN ANNUAIRE, SANS RALENTIR ===');
{
  await q(`insert into public.clients (nom, courriel, cellulaire, type_client) select 'Client ' || g, 'c' || g || '@exemple.ca', '+1819557' || lpad(g::text, 4, '0'), 'particulier' from generate_series(1, 2000) g`);
  eq('2 000 fiches clients sont acceptées', await compte('clients'), 2000);
  const t0 = Date.now();
  const v = (await sqlAs(admin, `select count(*)::int n from public.clients_avis where promo_courriel_ok`))[0].n;
  vrai('… la vue se lit en moins de 3 secondes avec 2 000 fiches', Date.now() - t0 < 3000, (Date.now() - t0) + ' ms');
  eq('… (aucune n\'a de contrat : personne ne peut recevoir de promotions)', v, 0);
  await q(`delete from public.clients`);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
