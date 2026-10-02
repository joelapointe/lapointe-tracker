// Demande 5, chantier C (1ᵉʳ oct. 2026) — Edge Function « envoyer-avis » (supabase/functions/envoyer-avis/index.ts) : aperçu, envoi par courriel (Resend) et par texto (Twilio), courriel d'essai.
// La fonction est testée avec de FAUSSES connexions à Resend et à Twilio, mais avec la VRAIE base (PGlite) : les fichiers SQL 30, 31 et 32 (modèles, journal, règles d'envoi, jeton de désabonnement)
// sont ceux de la vraie base. Ce que ces tests NE peuvent PAS vérifier : le vrai Supabase (jeton de l'appelant, clés), le vrai Resend et le vrai Twilio (un courriel d'essai à Joé, puis un vrai
// envoi, le vérifient sur la vraie base).
// FONCTION_TEST (variable d'environnement) : une COPIE abîmée de la fonction, pour les « erreurs volontaires » ; la vraie fonction n'est jamais touchée.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';
import { stripTypeScriptTypes } from 'node:module';

const CODE = fs.readFileSync(process.env.FONCTION_TEST || (SQL_DIR + 'functions/envoyer-avis/index.ts'), 'utf8');
const F = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(CODE)).toString('base64'));
const { traiter, delaiValide, lireLignes, lireCanaux, lienDesabonnement, texteCourriel, htmlCourriel, SITE, EXPEDITEUR, REPONDRE_A, MARQUE_LIEN } = F;

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));

const FILES = ['01-etape6-utilisateurs.sql', '02-etape7-modele-passes-quarts.sql', '03-etape8-regles-acces.sql', '04-etape9a-quarts-equipage.sql',
  '05-etape9b-passes-fermetures-export.sql', '13-etape13-taches-et-tours-partages.sql', '14-etape13d-retrait-stops-fait.sql', '15-etape14c-dernier-tour-visible.sql',
  '16-etape14e-photo-probleme.sql', '17-etape15-equipage-precedent.sql', '18-etape16d-heure-des-gestes-sans-reseau.sql', '19-etape16d-annulation-ignoree-precisee.sql'];
const db = await prepare(FILES);
await db.exec(`grant usage on schema public to service_role;`);
await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;`);
await db.exec(`alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
for (const f of ['30-repertoire-clients-et-inscriptions.sql', '31-avis-aux-clients.sql', '32-avis-canaux-et-apercu.sql']) await db.exec(fs.readFileSync(SQL_DIR + f, 'utf8'));
const q = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };
const ins = async (email, app) => (await db.query(`insert into auth.users(email, raw_app_meta_data) values ($1,$2::jsonb) returning id`, [email, JSON.stringify(app)])).rows[0].id;
const admin = await ins('joe@t.ca', { nom: 'Joé', role: 'admin' });
const nina = await ins('nina@t.ca', { nom: 'Nina', telephone: '8195550001' });
const MIDI = '2026-10-14T12:00:00-04:00';
let seq = 0;
const client = async (nom, o = {}) => {
  const c = { nom, adresse: '1 rue Test', ...o };
  const cols = Object.keys(c);
  return (await q(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, Object.values(c)))[0].id;
};
const tout = (nom, o = {}) => client(nom, { courriel: `c${++seq}@exemple.ca`, cellulaire: '819555' + String(3000 + seq), avis_courriel: true, avis_texto: true, ...o });
const vider = async () => { await q(`alter table public.avis_envois disable trigger avis_envois_immuables`); await q(`alter table public.avis_envois disable trigger avis_envois_pas_de_vidage`); await q(`delete from public.avis_envois`); await q(`alter table public.avis_envois enable trigger avis_envois_immuables`); await q(`alter table public.avis_envois enable trigger avis_envois_pas_de_vidage`); };
const compte = async () => (await q(`select count(*)::int n from public.avis_envois`))[0].n;
const L = (id, service = 'Coupe de gazon', adresse = '10 rue des Pins, Louiseville') => ({ client_id: id, service, adresse });

// ── Les fausses dépendances : la vraie base, un faux Resend, un faux Twilio ─────────────────
const SIGS = { avis_preparer: ['p_par uuid', 'p_delai text', 'p_lignes jsonb', 'p_maintenant timestamptz', 'p_canaux text[]'], avis_apercu: ['p_par uuid', 'p_delai text', 'p_lignes jsonb', 'p_maintenant timestamptz', 'p_canaux text[]'],
  avis_marquer: ['p_id uuid', 'p_statut text', 'p_fournisseur_id text', 'p_erreur text'], avis_jeton: ['p_client_id uuid', 'p_canal text'] };
const journalFonction = [];
function monde(o = {}) {
  const m = { courriels: [], textos: [], rpcs: [], enCours: 0, maxEnCours: 0 };
  let appelsMarquer = 0;
  const deps = {
    identifier: async (aut) => ({ 'Bearer admin': { id: admin, courriel: o.courrielAdmin === undefined ? 'joe@exemple.ca' : o.courrielAdmin }, 'Bearer employe': null, 'Bearer faux-admin': { id: nina, courriel: 'nina@exemple.ca' }, 'Basic abc': { id: admin, courriel: 'joe@exemple.ca' }, 'Bearer': { id: admin, courriel: 'joe@exemple.ca' } })[aut] ?? null,
    rpc: async (nom, args) => {
      m.rpcs.push(nom);
      if (o.rpcErreur?.[nom]) { const e = typeof o.rpcErreur[nom] === 'function' ? o.rpcErreur[nom](++appelsMarquer) : o.rpcErreur[nom]; if (e) return { data: null, error: { message: e } }; }
      const sig = SIGS[nom];
      const noms = sig.map((s) => s.split(' ')[0]).filter((n) => n in args);
      const params = noms.map((n, i) => `${n} => $${i + 1}::${sig.find((s) => s.startsWith(n + ' ')).split(' ')[1]}`);
      const valeurs = noms.map((n) => (n === 'p_lignes' ? JSON.stringify(args[n]) : args[n]));
      await db.query('reset role'); await db.query('set role service_role');
      try { return { data: (await db.query(`select public.${nom}(${params.join(', ')}) as r`, valeurs)).rows[0].r, error: null }; }
      catch (e) { return { data: null, error: { message: e.message } }; }
      finally { await db.query('reset role'); }
    },
    modeleCourriel: async () => (o.sansModele ? null : (await q(`select objet, texte from public.avis_modeles where canal = 'courriel' and variante = 'heures' and en_vigueur`))[0]),
    courriel: async (c) => {
      m.enCours++; m.maxEnCours = Math.max(m.maxEnCours, m.enCours);
      try {
        if (o.delaiEnvoi) await new Promise((r) => setTimeout(r, o.delaiEnvoi));
        m.courriels.push(c);
        if (o.courrielException?.(c)) throw new TypeError('boom');
        const e = o.courrielEchec?.(c); if (e) return { erreur: e };
        return { id: 're_' + m.courriels.length };
      } finally { m.enCours--; }
    },
    texto: async (t) => { m.textos.push(t); const e = o.textoEchec?.(t); return e ? { erreur: e } : { id: 'SM' + m.textos.length }; },
    textosActifs: () => o.textos === true,
    maintenant: () => o.maintenant ?? MIDI,
    journal: (l) => { journalFonction.push(l); },
  };
  m.deps = deps;
  return m;
}
async function appel(deps, corps, { auth = 'Bearer admin', methode = 'POST', brut } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers.Authorization = auth;
  const r = await traiter(new Request('https://x.test/envoyer-avis', { method: methode, headers, body: methode === 'POST' ? (brut ?? JSON.stringify(corps)) : undefined }), deps);
  let j = null; try { j = await r.json(); } catch { /* 204 */ }
  return { statut: r.status, corps: j, entetes: r.headers };
}
const ENV = (delai, lignes, extra = {}) => ({ action: 'envoyer', delai, lignes, ...extra });
const APE = (delai, lignes, extra = {}) => ({ action: 'apercu', delai, lignes, ...extra });

log('=== LES FONCTIONS PURES ===');
{
  eq('le lien de désabonnement : page du site, identifiant du client et jeton (encodés)', lienDesabonnement('abc-123', 'x y&z'), `${SITE}/desabonnement.html?c=abc-123&t=x%20y%26z`);
  eq('le courriel en texte : TOUS les repères deviennent le lien', texteCourriel(`a ${MARQUE_LIEN} b ${MARQUE_LIEN}`, 'https://l'), 'a https://l b https://l');
  const h = htmlCourriel(`Bonjour <b>&"\n\nLigne 2 ${MARQUE_LIEN}`, 'https://l?c=1&t=2');
  eq('le courriel en HTML : le message est échappé (rien ne glisse du HTML), les sauts de ligne sont gardés, le repère devient un lien échappé', [h.includes('Bonjour &lt;b&gt;&amp;&quot;<br>\n<br>\nLigne 2 <a href="https://l?c=1&amp;t=2">Se désabonner</a>'), /<script|<b>/.test(h)], [true, false]);
  eq('les délais valides : « 1h » à « 72h » et « demain » ; rien d’autre', [['1h', '9h', '24h', '72h', 'demain'].map(delaiValide), ['0h', '73h', '99h', '100h', '3', 'h', '3 h', 'Demain', '01h', '', null, 5, undefined].map(delaiValide)], [[true, true, true, true, true], [false, false, false, false, false, false, false, false, false, false, false, false, false]]);
  eq('l’expéditeur, l’adresse de réponse, le site et le repère du lien (le repère est celui que la base met dans les courriels)', [EXPEDITEUR, REPONDRE_A, SITE, MARQUE_LIEN], ['Entretien Lapointe <avis@entretienlapointe.ca>', 'info@entretienlapointe.ca', 'https://www.entretienlapointe.ca', '[lien de désabonnement]']);
  const lire = (v) => lireLignes(v);
  const bon = { client_id: 'AAAAAAAA-0000-4000-8000-000000000001', service: 'S', adresse: 'A' };
  eq('une ligne valide : l’identifiant est mis en minuscules', lire([bon])[0].client_id, 'aaaaaaaa-0000-4000-8000-000000000001');
  for (const [t, v] of [['une liste vide', []], ['pas une liste', { a: 1 }], ['aucune liste', undefined], ['301 lignes', Array.from({ length: 301 }, () => bon)], ['une ligne en texte', ['x']], ['une ligne vide', [null]], ['un identifiant invalide', [{ ...bon, client_id: 'x' }]], ['un identifiant absent', [{ service: 'S', adresse: 'A' }]],
    ['un service vide', [{ ...bon, service: '  ' }]], ['un service de 101 caractères', [{ ...bon, service: 'x'.repeat(101) }]], ['une adresse vide', [{ ...bon, adresse: '' }]], ['une adresse de 201 caractères', [{ ...bon, adresse: 'x'.repeat(201) }]], ['un service numérique', [{ ...bon, service: 5 }]]]) {
    eq(`${t} : refusé (400)`, lire(v).statut, 400);
  }
  eq('300 lignes : acceptées', lire(Array.from({ length: 300 }, () => bon)).length, 300);
  const dActifs = { textosActifs: () => true }, dInactifs = { textosActifs: () => false };
  eq('canaux absents : les deux si les textos sont activés, sinon le courriel seulement', [lireCanaux(undefined, dActifs), lireCanaux(null, dInactifs)], [['courriel', 'texto'], ['courriel']]);
  eq('canaux : sans doublon, toujours dans l’ordre courriel puis texto', lireCanaux(['texto', 'courriel', 'texto'], dActifs), ['courriel', 'texto']);
  eq('le texto demandé alors que les textos ne sont pas activés : refusé (409), « textos_non_actives »', [lireCanaux(['texto'], dInactifs).statut, lireCanaux(['courriel', 'texto'], dInactifs).corps.erreur], [409, 'textos_non_actives']);
  for (const v of [[], 'courriel', ['sms'], ['courriel', null], [5]]) eq(`les canaux ${JSON.stringify(v)} : refusés (400)`, lireCanaux(v, dActifs).statut, 400);
}

log('=== QUI PEUT APPELER LA FONCTION ===');
{
  const m = monde();
  const sans = await appel(m.deps, APE('2h', []), { auth: null });
  eq('sans jeton : refusé (403), rien d’appelé', [sans.statut, sans.corps.erreur, m.rpcs.length], [403, 'non_autorise', 0]);
  eq('un jeton mal formé (même si la base le reconnaîtrait) : refusé sans rien appeler', [(await appel(m.deps, APE('2h', []), { auth: 'Basic abc' })).statut, (await appel(m.deps, APE('2h', []), { auth: 'Bearer' })).statut, m.rpcs.length], [403, 403, 0]);
  eq('un jeton qui n’est pas celui d’un administrateur : refusé, rien d’appelé ni d’envoyé', [(await appel(m.deps, ENV('2h', [L('aaaaaaaa-0000-4000-8000-000000000001')]), { auth: 'Bearer employe' })).statut, m.rpcs.length, m.courriels.length, m.textos.length], [403, 0, 0, 0]);
  eq('la pré-vérification (OPTIONS) : 204 avec les en-têtes CORS, sans rien vérifier', [(await appel(m.deps, null, { methode: 'OPTIONS', auth: null })).statut, (await appel(m.deps, null, { methode: 'OPTIONS', auth: null })).entetes.get('access-control-allow-origin')], [204, '*']);
  eq('une autre méthode que POST : 405', (await appel(m.deps, null, { methode: 'GET' })).statut, 405);
  eq('un corps qui n’est pas du JSON, une liste, un texte, un nombre ou « null » : 400 « requete_invalide »', [(await appel(m.deps, null, { brut: 'pas du json' })), (await appel(m.deps, null, { brut: '[1]' })), (await appel(m.deps, null, { brut: '"texte"' })), (await appel(m.deps, null, { brut: '5' })), (await appel(m.deps, null, { brut: 'null' }))].map((x) => x.statut + ':' + x.corps.erreur), Array(5).fill('400:requete_invalide'));
  eq('une action inconnue (ou absente) : 400', [(await appel(m.deps, { action: 'supprimer_tout' })).corps.erreur, (await appel(m.deps, {})).corps.erreur], ['action_inconnue', 'action_inconnue']);
  const faux = await appel(m.deps, ENV('2h', [L('aaaaaaaa-0000-4000-8000-000000000001')]), { auth: 'Bearer faux-admin' });
  eq('un jeton « valide » dont la base ne reconnaît PAS un administrateur (désactivé entre-temps) : la base refuse, rien n’est envoyé', [faux.statut, faux.corps.erreur, m.courriels.length, await compte()], [403, 'non_autorise', 0, 0]);
}

log('=== LES REFUS AVANT D’ÉCRIRE OU D’ENVOYER ===');
{
  const a = await tout('Client des refus');
  const m = monde();
  for (const d of ['0h', '73h', '3', 'h', '3 h', 'Demain', '', null, 5]) eq(`le délai ${JSON.stringify(d)} : refusé (400)`, (await appel(m.deps, ENV(d, [L(a)]))).corps.erreur, 'delai_invalide');
  eq('une liste vide : refusée', (await appel(m.deps, ENV('2h', []))).corps.erreur, 'requete_invalide');
  eq('des canaux invalides : refusés', (await appel(m.deps, ENV('2h', [L(a)], { canaux: ['sms'] }))).corps.erreur, 'canaux_invalides');
  const t = await appel(m.deps, ENV('2h', [L(a)], { canaux: ['courriel', 'texto'] }));
  eq('le texto demandé alors que les textos ne sont pas activés : refusé (409) AVANT de rien écrire', [t.statut, t.corps.erreur, await compte(), m.courriels.length, m.textos.length], [409, 'textos_non_actives', 0, 0, 0]);
  eq('… l’aperçu aussi', (await appel(m.deps, APE('2h', [L(a)], { canaux: ['texto'] }))).corps.erreur, 'textos_non_actives');
  eq('aucun de ces refus n’a appelé la base', m.rpcs.length, 0);
}

log('=== L’APERÇU : RIEN N’EST ÉCRIT NI ENVOYÉ ===');
{
  await vider();
  const a = await tout('Client de l’aperçu'), b = await client('Client sans avis', { courriel: 'b@exemple.ca' });
  const m = monde();
  const r = await appel(m.deps, APE('3h', [L(a), L(b)]));
  eq('aperçu : 200, « apercu », chaque client avec son statut (courriel seulement : les textos ne sont pas activés)', [r.statut, r.corps.apercu, r.corps.lignes.map((x) => x.canal + ':' + x.statut + (x.motif ? ':' + x.motif : ''))], [200, true, ['courriel:a_envoyer', 'courriel:refuse:pas_active']]);
  eq('… le résumé', r.corps.resume, { a_envoyer: 1, envoyes: 0, echecs: 0, refuses: 1 });
  vrai('… le message exact y est (celui qui partira)', /nous passons chez vous|passerons chez vous d'ici environ 3 heures/.test(r.corps.lignes[0].message) && /\[lien de désabonnement\]/.test(r.corps.lignes[0].message), r.corps.lignes[0].message);
  eq('… RIEN n’a été écrit au journal ni envoyé', [await compte(), m.courriels.length, m.textos.length], [0, 0, 0]);
  const mt = monde({ textos: true });
  const r2 = await appel(mt.deps, APE('3h', [L(a)]));
  eq('textos activés : l’aperçu montre les deux canaux', r2.corps.lignes.map((x) => x.canal), ['courriel', 'texto']);
  eq('… et ne les envoie pas non plus', [mt.textos.length, mt.courriels.length, await compte()], [0, 0, 0]);
  const mn = monde({ maintenant: '2026-10-14T22:00:00-04:00', textos: true });
  const r3 = await appel(mn.deps, APE('3h', [L(a)]));
  eq('la nuit : le texto est refusé « hors_heures », le courriel est « a_envoyer » ; l’heure permise est annoncée', [r3.corps.lignes.map((x) => x.statut + (x.motif ? ':' + x.motif : '')), r3.corps.heure_permise_texto], [['a_envoyer', 'refuse:hors_heures'], false]);
}

log('=== ENVOYER PAR COURRIEL ===');
{
  await vider();
  const a = await tout('Client du courriel', { courriel: 'client.un@exemple.ca' });
  const m = monde();
  const r = await appel(m.deps, ENV('3h', [L(a, 'Gazon & <b>sel</b>', '10 rue des Pins, Louiseville')]));
  eq('envoyer : 200 ; UN courriel envoyé, aucun texto', [r.statut, m.courriels.length, m.textos.length], [200, 1, 0]);
  const c = m.courriels[0];
  const lig = (await q(`select statut, fournisseur_id, envoye_le is not null ok, message, objet, destinataire, erreur, motif from public.avis_envois`))[0];
  eq('le courriel part à l’adresse de la fiche, avec l’objet de la base', [c.a, c.objet], ['client.un@exemple.ca', lig.objet]);
  eq('… le texte est EXACTEMENT le message du journal, le repère devenu le lien', c.texte, lig.message.split(MARQUE_LIEN).join(c.lien));
  const jeton = (await q(`select public.avis_jeton($1::uuid, 'courriel') j`, [a]))[0].j;
  eq('… le lien est celui de la page de désabonnement, avec le jeton de la base', c.lien, `${SITE}/desabonnement.html?c=${a}&t=${jeton}`);
  eq('… le HTML contient le lien et le texte échappé (rien du service n’est du HTML)', [c.html.includes(`<a href="${c.lien.replace(/&/g, '&amp;')}">Se désabonner</a>`), c.html.includes('Gazon &amp; &lt;b&gt;sel&lt;/b&gt;'), /<b>sel/.test(c.html)], [true, true, false]);
  eq('le journal : « envoyé », avec l’identifiant du fournisseur et l’heure', [lig.statut, lig.fournisseur_id, lig.ok, lig.erreur, lig.motif], ['envoye', 're_1', true, null, null]);
  eq('la réponse : le résumé et la ligne (sans le message)', [r.corps.resume, r.corps.lignes.map((x) => [x.canal, x.statut, x.motif, 'message' in x]), r.corps.lot_id !== undefined], [{ a_envoyer: 0, envoyes: 1, echecs: 0, refuses: 0 }, [['courriel', 'envoye', null, false]], true]);
  const des = await q(`select public.avis_desabonner_par_jeton($1::uuid, $2::text) r`, [a, new URL(c.lien).searchParams.get('t')]);
  eq('LE LIEN FONCTIONNE de bout en bout : le jeton du courriel désabonne vraiment le client', [des[0].r, (await q(`select desabonne_courriel_le is not null d from public.clients where id = $1`, [a]))[0].d], [{ statut: 'desabonne' }, true]);
  const m2 = monde();
  eq('… et un 2ᵉ envoi le même jour est refusé par la base, sans envoyer', [(await appel(m2.deps, ENV('3h', [L(a)]))).corps.lignes.map((x) => x.motif), m2.courriels.length], [['desabonne'], 0]);
}

log('=== ENVOYER PAR TEXTO (SEULEMENT S’ILS SONT ACTIVÉS) ===');
{
  await vider();
  const a = await tout('Client des deux canaux');
  const m = monde({ textos: true });
  const r = await appel(m.deps, ENV('2h', [L(a)]));
  eq('canaux absents et textos activés : un courriel ET un texto', [r.corps.lignes.map((x) => x.canal + ':' + x.statut), m.courriels.length, m.textos.length], [['courriel:envoye', 'texto:envoye'], 1, 1]);
  const lig = (await q(`select message, destinataire, fournisseur_id, statut from public.avis_envois where canal = 'texto'`))[0];
  eq('le texto part au cellulaire de la fiche avec EXACTEMENT le message du journal ; son identifiant est noté', [m.textos[0].a === lig.destinataire, m.textos[0].corps === lig.message, lig.fournisseur_id, lig.statut], [true, true, 'SM1', 'envoye']);
  await vider();
  const mt = monde({ textos: true });
  const rt = await appel(mt.deps, ENV('2h', [L(a)], { canaux: ['texto'] }));
  eq('« texto » seulement : aucun courriel, et rien d’écrit pour le courriel', [mt.courriels.length, mt.textos.length, (await q(`select canal from public.avis_envois`)).map((x) => x.canal), rt.corps.lignes.length], [0, 1, ['texto'], 1]);
  await vider();
  const mn = monde({ textos: true, maintenant: '2026-10-14T23:00:00-04:00' });
  const rn = await appel(mn.deps, ENV('2h', [L(a)]));
  eq('la nuit : le courriel part, le texto est refusé par la base (jamais envoyé) et le journal le dit', [mn.courriels.length, mn.textos.length, rn.corps.lignes.map((x) => x.canal + ':' + x.statut + ':' + x.motif), (await q(`select canal, statut, motif from public.avis_envois order by canal`)).map((x) => x.canal + ':' + x.statut + ':' + x.motif)], [1, 0, ['courriel:envoye:null', 'texto:refuse:hors_heures'], ['courriel:envoye:null', 'texto:refuse:hors_heures']]);
  await vider();
  const me = monde({ textos: true, textoEchec: () => 'twilio 400 code 21211' });
  const re = await appel(me.deps, ENV('2h', [L(a)]));
  eq('un texto refusé par Twilio : « échec » au journal avec la raison ; le courriel part quand même', [re.corps.lignes.map((x) => x.canal + ':' + x.statut), (await q(`select canal, statut, erreur, motif from public.avis_envois order by canal`)).map((x) => [x.canal, x.statut, x.erreur, x.motif])], [['courriel:envoye', 'texto:echec'], [['courriel', 'envoye', null, null], ['texto', 'echec', 'twilio 400 code 21211', 'echec_fournisseur']]]);
}

log('=== LES ÉCHECS D’ENVOI ET LEUR NOTE AU JOURNAL ===');
{
  await vider();
  const a = await tout('Client des échecs'), b = await tout('Autre client des échecs');
  const m = monde({ courrielEchec: (c) => (c.a.startsWith('c' + (seq - 1)) ? null : 'resend 422 invalid_to_address') });
  const r = await appel(m.deps, ENV('2h', [L(a), L(b)]));
  eq('un courriel refusé par Resend : « échec » avec la raison ; l’autre part ; le résumé le dit', [r.corps.resume, (await q(`select statut, erreur, motif from public.avis_envois order by cree_le, statut`)).map((x) => x.statut).sort()], [{ a_envoyer: 0, envoyes: 1, echecs: 1, refuses: 0 }, ['echec', 'envoye']]);
  eq('… la raison est au journal, avec le motif « echec_fournisseur »', (await q(`select erreur, motif from public.avis_envois where statut = 'echec'`))[0], { erreur: 'resend 422 invalid_to_address', motif: 'echec_fournisseur' });
  eq('… la ligne en échec de la réponse porte aussi le motif', r.corps.lignes.find((x) => x.statut === 'echec').motif, 'echec_fournisseur');
  const m2 = monde();
  const r2 = await appel(m2.deps, ENV('2h', [L(a), L(b)]));
  eq('un envoi en échec n’empêche pas de RÉESSAYER le même jour (le courriel déjà parti, lui, est refusé)', r2.corps.lignes.map((x) => x.statut + ':' + x.motif).sort(), ['envoye:null', 'refuse:deja_averti_aujourdhui']);
  await vider();
  const mx = monde({ courrielException: () => true });
  const rx = await appel(mx.deps, ENV('2h', [L(a)]));
  eq('une EXCEPTION pendant l’envoi n’arrête rien : « échec » au journal avec son nom', [rx.statut, rx.corps.resume.echecs, (await q(`select erreur from public.avis_envois`))[0].erreur], [200, 1, 'exception TypeError']);
  await vider();
  const mm = monde({ rpcErreur: { avis_marquer: (n) => (n === 1 ? 'coupure' : null) } });
  const rm = await appel(mm.deps, ENV('2h', [L(a)]));
  eq('la note au journal échoue UNE fois : la fonction réessaie et la note passe', [rm.corps.avertissement, (await q(`select statut from public.avis_envois`))[0].statut, mm.rpcs.filter((n) => n === 'avis_marquer').length], [undefined, 'envoye', 2]);
  await vider();
  const m3 = monde({ rpcErreur: { avis_marquer: 'coupure' } });
  const r3 = await appel(m3.deps, ENV('2h', [L(a)]));
  eq('la note échoue DEUX fois : le courriel est parti, la réponse AVERTIT (jamais un silence) et la ligne reste « en attente » à vérifier', [/n'ont pas pu être notés/.test(r3.corps.avertissement), (await q(`select statut from public.avis_envois`))[0].statut, journalFonction.some((l) => /avis_marquer a échoué/.test(l))], [true, 'en_attente', true]);
  await vider();
  const mj = monde({ rpcErreur: { avis_jeton: 'coupure' } });
  const rj = await appel(mj.deps, ENV('2h', [L(a)]));
  eq('pas de jeton de désabonnement : AUCUN courriel ne part (jamais sans le lien), « échec » au journal', [mj.courriels.length, rj.corps.resume.echecs, (await q(`select erreur from public.avis_envois`))[0].erreur], [0, 1, 'jeton_indisponible']);
}

log('=== LES REFUS DE LA BASE ===');
{
  await vider();
  const a = await tout('Client de la base');
  const m = monde({ rpcErreur: { avis_preparer: 'delai_invalide' } });
  eq('la base refuse le délai : 400 clair, rien envoyé', [(await appel(m.deps, ENV('2h', [L(a)]))).corps.erreur, m.courriels.length], ['delai_invalide', 0]);
  for (const [msg, erreur, statut] of [['non_autorise', 'non_autorise', 403], ['modele_introuvable', 'modele_introuvable', 500], ['canaux_invalides', 'canaux_invalides', 400], ['lignes_invalides', 'requete_invalide', 400], ['Could not find the function public.avis_preparer', 'sql_absent', 500], ['quelque chose', 'base_erreur', 500]]) {
    const x = monde({ rpcErreur: { avis_preparer: msg } });
    const r = await appel(x.deps, ENV('2h', [L(a)]));
    eq(`la base répond « ${msg} » : ${statut} « ${erreur} », rien envoyé`, [r.statut, r.corps.erreur, x.courriels.length], [statut, erreur, 0]);
  }
  const x = monde({ rpcErreur: { avis_apercu: 'Could not find the function' } });
  eq('l’aperçu aussi', (await appel(x.deps, APE('2h', [L(a)]))).corps.erreur, 'sql_absent');
}

log('=== BEAUCOUP DE CLIENTS À LA FOIS ===');
{
  await vider();
  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await tout('Client ' + i));
  const m = monde({ delaiEnvoi: 15 });
  const r = await appel(m.deps, ENV('2h', ids.map((id) => L(id))));
  eq('12 clients : 12 courriels, tous notés « envoyé »', [m.courriels.length, r.corps.resume.envoyes, (await q(`select count(*)::int n from public.avis_envois where statut = 'envoye'`))[0].n], [12, 12, 12]);
  eq('… au plus 5 envois en même temps (doux pour les fournisseurs)', m.maxEnCours <= 5 && m.maxEnCours >= 2, true);
  eq('… chaque ligne de la réponse correspond au bon client', r.corps.lignes.map((x) => x.client_id), ids);
}

log('=== LE COURRIEL D’ESSAI ===');
{
  await vider();
  const m = monde();
  const r = await appel(m.deps, { action: 'essai_courriel' });
  eq('l’essai : 200 ; UN courriel, à l’adresse de l’administrateur qui appelle', [r.statut, m.courriels.length, m.courriels[0].a], [200, 1, 'joe@exemple.ca']);
  const c = m.courriels[0];
  eq('… l’objet est marqué [ESSAI] ; le message est rendu (aucun repère {…} ne reste) ; le lien de désabonnement est celui de la page, sans jeton', [c.objet.startsWith('[ESSAI] Entretien Lapointe : nous passons chez vous d’ici environ 3 heures'.replace('’', "'")), /[{}]/.test(c.texte + c.objet), c.lien, c.texte.includes(c.lien)], [true, false, `${SITE}/desabonnement.html`, true]);
  eq('… le message est celui du modèle en vigueur', [c.texte.includes('pour le service « Coupe de gazon » (adresse : 10 rue des Pins, Louiseville)'), c.texte.includes('Charette (Québec) G0X 1E0')], [true, true]);
  eq('… RIEN n’est écrit au journal', await compte(), 0);
  eq('un administrateur sans courriel : 400', [(await appel(monde({ courrielAdmin: null }).deps, { action: 'essai_courriel' })).corps.erreur], ['courriel_absent']);
  eq('aucun modèle en vigueur : 500, rien envoyé', (await (async () => { const x = monde({ sansModele: true }); return [(await appel(x.deps, { action: 'essai_courriel' })).corps.erreur, x.courriels.length]; })()), ['modele_introuvable', 0]);
  const e = await appel(monde({ courrielEchec: () => 'resend 403 domain_not_verified' }).deps, { action: 'essai_courriel' });
  eq('Resend refuse : 502 avec la raison', [e.statut, e.corps.erreur, /domain_not_verified/.test(e.corps.message)], [502, 'envoi_echoue', true]);
  eq('un employé ne peut pas demander d’essai', (await appel(monde().deps, { action: 'essai_courriel' }, { auth: 'Bearer employe' })).statut, 403);
}

log('=== LES JOURNAUX DE LA FONCTION ET LE CODE ===');
{
  const texte = journalFonction.join('\n');
  vrai('les journaux de la fonction ne contiennent AUCUN courriel, téléphone, nom de client ni message', !/@|\b819\b|\b\d{3}[ -]\d{3,4}\b|Client |Gazon|Entretien Lapointe|Bonjour/.test(texte), texte.slice(0, 300));
  vrai('… ils notent les actions et les résultats', /envoyer -> 1 envoyé/.test(texte) && /refus non_autorise/.test(texte) && /essai_courriel -> ok/.test(texte), texte.slice(0, 300));
  const code = CODE;   // (le code essayé : la vraie fonction, ou la copie abîmée des erreurs volontaires)
  eq('aucune clé n’est écrite dans le code (Resend « re_… », Twilio « AC… » et jeton, clés Supabase « eyJ… » ou « sb_secret_ »)', [/\bre_[A-Za-z0-9]{20,}/.test(code), /\bAC[0-9a-f]{32}\b/.test(code), /eyJ[A-Za-z0-9_-]{20,}/.test(code), /sb_secret_/.test(code)], [false, false, false, false]);
  eq('les clés sont lues des SECRETS (RESEND_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, TEXTOS_ACTIFS)', ['RESEND_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM', 'TEXTOS_ACTIFS'].map((s) => code.includes(`Deno.env.get('${s}')`)), [true, true, true, true, true]);
  eq('les textos exigent « oui » ET les trois secrets de Twilio', /Deno\.env\.get\('TEXTOS_ACTIFS'\) === 'oui' && !!sid\(\) && !!jeton\(\) && !!de\(\)/.test(code), true);
  eq('les appels aux fournisseurs : Resend (expéditeur, adresse de réponse, désabonnement en un clic) et Twilio (compte, numéro, message)', [code.includes("'https://api.resend.com/emails'"), code.includes('from: EXPEDITEUR'), code.includes('reply_to: REPONDRE_A'), code.includes("'List-Unsubscribe': `<${m.lien}>`"), code.includes('https://api.twilio.com/2010-04-01/Accounts/'), code.includes('To: m.a, From: de(), Body: m.corps')], [true, true, true, true, true, true]);
  eq('la fonction n’écrit jamais directement dans les tables (seulement des fonctions de la base) et ne fabrique aucun message', [/\.from\('avis_envois'\)|\.insert\(|\.update\(|\.delete\(/.test(code), /nous passons chez vous|nous passerons chez vous/.test(code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))], [false, false]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
