// Demande 5 (2 oct. 2026) — Edge Function « recevoir-texto » (supabase/functions/recevoir-texto/index.ts) : les textos que les clients envoient au numéro d'Entretien Lapointe (webhook de Twilio).
// ARRET désabonne (VRAIE base PGlite : fichier SQL 30, desabonner_contact), AIDE répond le message du dossier de Twilio, START ne réinscrit JAMAIS, le reste dit comment joindre Entretien Lapointe.
// La SIGNATURE de Twilio est vérifiée (la fonction est publique) : sans jeton, sans signature ou avec une fausse signature, RIEN n'est fait. Les signatures du test sont calculées par l'outil de Node (crypto),
// pas par la fonction ; l'exemple de la documentation de Twilio sert de repère. Ce que ce test NE peut PAS vérifier : le vrai Twilio (l'adresse signée, le jeton), le vrai Supabase ; un vrai texto « ARRET »
// (avec le vrai numéro, une fois la vérification de Twilio approuvée) le vérifiera.
// FONCTION_TEST (variable d'environnement) : une COPIE abîmée de la fonction, pour les « erreurs volontaires » ; la vraie fonction n'est jamais touchée.
import { fileURLToPath } from 'url';
const SQL_DIR = fileURLToPath(new URL('../', import.meta.url));
import { prepare } from './prepare.mjs';
import fs from 'fs';
import crypto from 'crypto';
import { stripTypeScriptTypes } from 'node:module';

const CODE = fs.readFileSync(process.env.FONCTION_TEST || (SQL_DIR + 'functions/recevoir-texto/index.ts'), 'utf8');
const F = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(CODE)).toString('base64'));
const { traiter, signatureTwilio, egalConstant, classer, twiml, MSG_AIDE, MSG_ARRET, MSG_ARRET_ECHEC, MSG_REINSCRIPTION, MSG_AUTRE } = F;

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
await db.exec(fs.readFileSync(SQL_DIR + '30-repertoire-clients-et-inscriptions.sql', 'utf8'));
const q = async (sql, p) => { await db.query('reset role'); return (await db.query(sql, p)).rows; };
const fiche = async (nom, o = {}) => {
  const c = { nom, adresse: '1 rue Test', ...o };
  const cols = Object.keys(c);
  return (await q(`insert into public.clients (${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(', ')}) returning id`, Object.values(c)))[0].id;
};
const etat = async (nom) => { const r = (await q(`select avis_texto, desabonne_texto_le is not null as desabonne from public.clients where nom = $1`, [nom]))[0]; return r.avis_texto + (r.desabonne ? ':désabonné' : ''); };
const registre = async () => (await q(`select c.nom as client, k.canal, k.action, k.source from public.consentements k left join public.clients c on c.id = k.client_id order by k.fait_le, c.nom nulls last`)).map((x) => `${x.client ?? '(inconnu)'}:${x.canal}:${x.action}:${x.source}`);

const JETON = 'jeton-de-test-0123456789abcdef';
const URL_PUBLIQUE = 'https://xyz.supabase.co/functions/v1/recevoir-texto';
// La signature, calculée par l'outil de Node (pas par la fonction)
const signer = (params, jeton = JETON, url = URL_PUBLIQUE) => crypto.createHmac('sha1', jeton).update(url + [...params].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([k, v]) => k + v).join('')).digest('base64');
const corpsForm = (params) => new URLSearchParams(params).toString();
const journalFonction = [];
function monde(o = {}) {
  const m = { desabonnements: [] };
  const deps = {
    jeton: () => { if (o.jetonException) throw new Error('boum'); return o.jeton === undefined ? JETON : o.jeton; },
    url: () => o.url ?? URL_PUBLIQUE,
    desabonner: async (tel) => {
      m.desabonnements.push(tel);
      if (o.desabonnerException) throw new Error('boum');
      if (o.desabonnerEchec) return { ok: false };
      await db.query('reset role'); await db.query('set role service_role');
      try { await db.query(`select public.desabonner_contact('texto', $1, 'texto_arret')`, [tel]); return { ok: true }; }
      catch (e) { return { ok: false }; }
      finally { await db.query('reset role'); }
    },
    journal: (l) => { journalFonction.push(l); },
  };
  m.deps = deps;
  return m;
}
// Une demande de Twilio : le corps du formulaire et la signature (bonne, par défaut)
async function appel(deps, params, { methode = 'POST', signature, jetonSignature = JETON, urlSignature = URL_PUBLIQUE, sansSignature = false, corpsBrut } = {}) {
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (!sansSignature) headers['X-Twilio-Signature'] = signature ?? signer(params, jetonSignature, urlSignature);
  const r = await traiter(new Request('https://xyz.supabase.co/functions/v1/recevoir-texto', { method: methode, headers, body: methode === 'POST' ? (corpsBrut ?? corpsForm(params)) : undefined }), deps);
  return { statut: r.status, corps: await r.text(), type: r.headers.get('Content-Type') };
}
const SMS = (de, texte, extra = []) => [['MessageSid', 'SM' + crypto.randomBytes(8).toString('hex')], ['From', de], ['To', '+18885648069'], ['Body', texte], ['NumMedia', '0'], ...extra];
const dequoter = (xml) => xml.replace(/<[^>]+>/g, '').replace(/&apos;/g, '\'').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
const reponse = (r) => (/<Message>/.test(r.corps) ? dequoter(r.corps) : null);

log('=== LES TEXTES ET LA SIGNATURE (FONCTIONS PURES) ===');
{
  eq('le message d’AIDE est EXACTEMENT celui promis aux opérateurs dans le dossier de vérification de Twilio', MSG_AIDE, 'Entretien Lapointe : avis de service seulement (jour ou heure de passage, horaire). Aide : appelez le 819 268-8069 ou écrivez à info@entretienlapointe.ca. ARRET pour ne plus recevoir ces avis.');
  eq('les autres textes envoyés aux clients (à faire approuver par Joé)', [MSG_ARRET, MSG_ARRET_ECHEC, MSG_REINSCRIPTION, MSG_AUTRE], [
    'Entretien Lapointe : c\'est noté, vous ne recevrez plus d\'avis par texto. Pour toute question : 819 268-8069.',
    'Entretien Lapointe : nous n\'avons pas pu enregistrer votre demande. Appelez le 819 268-8069 ou écrivez à info@entretienlapointe.ca pour ne plus recevoir ces avis.',
    'Entretien Lapointe : pour recevoir de nouveau nos avis par texto, inscrivez-vous sur www.entretienlapointe.ca/avis.html ou appelez le 819 268-8069.',
    'Entretien Lapointe : ce numéro envoie des avis de service et ne lit pas les réponses. Pour nous joindre : 819 268-8069 ou info@entretienlapointe.ca. ARRET pour ne plus recevoir ces avis.']);
  eq('aucun de ces textes ne promet de réinscription par texto (le dossier de Twilio : « aucun mot-clé d’inscription par texto »)', [MSG_ARRET, MSG_ARRET_ECHEC, MSG_REINSCRIPTION, MSG_AUTRE, MSG_AIDE].some((t) => /répondez (START|OUI|YES)|START pour/i.test(t)), false);
  const exemple = [['CallSid', 'CA1234567890ABCDE'], ['Caller', '+14158675310'], ['Digits', '1234'], ['From', '+14158675310'], ['To', '+18005551212']];
  eq('l’EXEMPLE DE LA DOCUMENTATION de Twilio (adresse, jeton « 12345 », 5 paramètres) donne la signature publiée', await signatureTwilio('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', exemple), 'GvWf1cFY/Q7PnoempGyD5oXAezc=');
  eq('… les paramètres sont triés par nom (peu importe l’ordre reçu)', await signatureTwilio('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', [...exemple].reverse()), 'GvWf1cFY/Q7PnoempGyD5oXAezc=');
  const melange = [['b', '2'], ['B', '1'], ['a', '3'], ['Z', '9'], ['_x', 'é à'], ['a', '4']];
  eq('la fonction et l’outil de Node donnent la MÊME signature (majuscules avant minuscules, doublons dans l’ordre reçu, accents)', await signatureTwilio(JETON, URL_PUBLIQUE, melange), signer(melange));
  eq('… une autre adresse, un autre jeton ou un autre paramètre : une autre signature', [await signatureTwilio(JETON, URL_PUBLIQUE + '/', melange), await signatureTwilio(JETON + 'x', URL_PUBLIQUE, melange), await signatureTwilio(JETON, URL_PUBLIQUE, [...melange, ['c', '1']])].map((s) => s === signer(melange)), [false, false, false]);
  eq('sans paramètre : la signature de l’adresse seule', await signatureTwilio(JETON, URL_PUBLIQUE, []), signer([]));
  eq('la comparaison en temps constant : mêmes textes, textes différents, longueurs différentes, vides', [egalConstant('abc=', 'abc='), egalConstant('abc=', 'abd='), egalConstant('abc=', 'abc'), egalConstant('', ''), egalConstant('', 'a')], [true, false, false, true, false]);
  const c = (t) => classer(t);
  eq('ARRET : le message ENTIER, sans égard aux majuscules, aux accents, à la ponctuation ni aux espaces autour', ['ARRET', 'arret', 'Arrêt', 'ARRÊT', '  arret  ', 'Arret.', 'arrêt !', '« arrêt »', '"STOP"', 'ARRETER', 'désabonner', 'DESABONNEMENT'].map(c), Array(12).fill('arret'));
  eq('… les mots-clés de Twilio et des opérateurs : STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT', ['STOP', 'stop', 'Stop.', 'STOPALL', 'Unsubscribe', 'CANCEL', 'end', 'QUIT'].map(c), Array(8).fill('arret'));
  eq('AIDE : AIDE, HELP, INFO (mêmes tolérances)', ['AIDE', 'aide', 'Help', 'HELP?', 'info', ' Aide. '].map(c), Array(6).fill('aide'));
  eq('START : START, UNSTOP, YES — jamais une réinscription', ['START', 'unstop', 'Yes', 'start !'].map(c), Array(4).fill('start'));
  eq('tout le reste est « autre » : un mot-clé dans une phrase, un mot proche, « oui », « annuler », vide, pas du texte', ['ARRET SVP', 'Merci!', 'ok', 'OUI', 'non', 'arret arret', 'STOP SVP', 'ANNULER', 'Aidez-moi', 'STOPPER', 'Ne pas passer demain', '', '   ', 'S T O P'].concat([null, 5, undefined]).map(c), Array(17).fill('autre'));
  const t = twiml(MSG_ARRET);
  eq('la réponse TwiML : un message, en XML, avec les apostrophes protégées', [t.status, t.headers.get('Content-Type'), await t.text()], [200, 'text/xml; charset=utf-8', '<?xml version="1.0" encoding="UTF-8"?><Response><Message>Entretien Lapointe : c&apos;est noté, vous ne recevrez plus d&apos;avis par texto. Pour toute question : 819 268-8069.</Message></Response>']);
  eq('… aucun message : une réponse vide ; le texte est toujours protégé (&, <, >, ")', [await twiml(null).text(), await twiml('a & b <c> "d"').text()], ['<?xml version="1.0" encoding="UTF-8"?><Response></Response>', '<?xml version="1.0" encoding="UTF-8"?><Response><Message>a &amp; b &lt;c&gt; &quot;d&quot;</Message></Response>']);
}

log('=== LA SIGNATURE : QUI PEUT APPELER LA FONCTION ===');
{
  const m = monde();
  const p = SMS('+18195550001', 'ARRET');
  eq('une autre méthode que POST (GET, PUT, DELETE) : refusée (405), rien n’est lu', [(await appel(m.deps, p, { methode: 'GET', sansSignature: true })).statut, (await appel(m.deps, p, { methode: 'PUT' })).statut, (await appel(m.deps, p, { methode: 'DELETE' })).statut], [405, 405, 405]);
  eq('SANS la signature de Twilio : 403, rien n’est fait', [(await appel(m.deps, p, { sansSignature: true })).statut, m.desabonnements.length], [403, 0]);
  eq('une FAUSSE signature (vide, au hasard, du mauvais jeton, de la mauvaise adresse) : 403, rien n’est fait', [(await appel(m.deps, p, { signature: '' })).statut, (await appel(m.deps, p, { signature: 'AAAA' })).statut, (await appel(m.deps, p, { jetonSignature: 'autre-jeton' })).statut, (await appel(m.deps, p, { urlSignature: 'https://autre.exemple/functions/v1/recevoir-texto' })).statut].concat(m.desabonnements.length), [403, 403, 403, 403, 0]);
  eq('une demande modifiée après la signature (le texte ou le numéro changé) : 403, rien n’est fait', [(await appel(m.deps, p, { signature: signer(SMS('+18195550001', 'STOP'), JETON), corpsBrut: corpsForm(p) })).statut, (await appel(m.deps, p, { signature: signer(p), corpsBrut: corpsForm(p.map(([k, v]) => (k === 'From' ? [k, '+18195559999'] : [k, v]))) })).statut, m.desabonnements.length], [403, 403, 0]);
  eq('une signature en majuscules, avec une lettre de plus ou de moins : 403', [(await appel(m.deps, p, { signature: signer(p).toUpperCase() })).statut, (await appel(m.deps, p, { signature: signer(p) + 'A' })).statut, (await appel(m.deps, p, { signature: signer(p).slice(0, -1) })).statut], [403, 403, 403]);
  const refuse = await appel(m.deps, p, { sansSignature: true });
  eq('le refus ne dit rien d’utile (« Refusé. », texte simple) et n’est jamais une réponse TwiML', [refuse.corps, refuse.type, /<Response/.test(refuse.corps)], ['Refusé.', 'text/plain; charset=utf-8', false]);
  const m2 = monde({ jeton: null });
  eq('SANS le jeton de Twilio (le secret n’existe pas encore) : la fonction ÉCHOUE FERMÉ — tout est refusé (403), même une demande « signée » avec un jeton vide, avec le texte « null » ou « undefined » (ce qu’un code naïf utiliserait comme clé), ou avec le jeton d’avant', [(await appel(m2.deps, p)).statut, (await appel(m2.deps, p, { jetonSignature: '' })).statut, (await appel(m2.deps, p, { jetonSignature: 'null' })).statut, (await appel(m2.deps, p, { jetonSignature: 'undefined' })).statut, m2.desabonnements.length], [403, 403, 403, 403, 0]);
  const m3 = monde({ jeton: '' });
  eq('… un jeton VIDE est comme un jeton absent', [(await appel(m3.deps, p, { jetonSignature: '' })).statut, m3.desabonnements.length], [403, 0]);
  const bonne = await appel(m.deps, p);
  eq('la BONNE signature : 200, une réponse TwiML', [bonne.statut, bonne.type, /^<\?xml version="1.0" encoding="UTF-8"\?><Response>/.test(bonne.corps)], [200, 'text/xml; charset=utf-8', true]);
  eq('un corps trop grand (plus de 20 000 caractères) : refusé (400), même bien signé', (await appel(m.deps, [], { corpsBrut: 'Body=' + 'a'.repeat(21000), signature: signer([['Body', 'a'.repeat(21000)]]) })).statut, 400);
  const m4 = monde({ jetonException: true });
  eq('une exception en cours de route : 500, rien n’est dit au client, rien n’est fait', [(await appel(m4.deps, p)).statut, m4.desabonnements.length], [500, 0]);
}

log('=== ARRET : LE DÉSABONNEMENT DANS LA VRAIE BASE ===');
{
  // trois fiches : deux au MÊME numéro (un couple), une autre ; une inscription en attente au même numéro
  await fiche('Alice Inscrite', { cellulaire: '+18195550001', avis_texto: true, courriel: 'alice@exemple.ca', avis_courriel: true });
  await fiche('Alain Inscrit', { cellulaire: '819-555-0001', avis_texto: true });   // (le déclencheur le met en +18195550001)
  await fiche('Carl Autre', { cellulaire: '+18195550003', avis_texto: true });
  const versionTexte = (await q(`select version from public.textes_consentement where canal = 'texto' and en_vigueur order by cree_le desc limit 1`))[0].version;
  await q(`insert into public.inscriptions_avis (nom, adresse, cellulaire, version_texte, statut) values ('Alice (inscription)', '1 rue A', '+18195550001', $1, 'nouvelle')`, [versionTexte]);
  eq('(départ : les trois fiches sont inscrites aux textos)', [await etat('Alice Inscrite'), await etat('Alain Inscrit'), await etat('Carl Autre')], ['true', 'true', 'true']);
  const m = monde();
  const r = await appel(m.deps, SMS('+18195550001', 'ARRET'));
  eq('ARRET : 200, la réponse est la confirmation (« c’est noté… »)', [r.statut, reponse(r)], [200, MSG_ARRET]);
  eq('… la fonction de la base a reçu le numéro de l’expéditeur (une seule fois)', m.desabonnements, ['+18195550001']);
  eq('la VRAIE base : les DEUX fiches de ce numéro sont désabonnées des textos ; l’autre fiche n’a pas bougé', [await etat('Alice Inscrite'), await etat('Alain Inscrit'), await etat('Carl Autre')], ['false:désabonné', 'false:désabonné', 'true']);
  eq('… le désabonnement par courriel n’est PAS touché (ARRET ne vaut que pour les textos)', (await q(`select desabonne_courriel_le is null as intact, avis_courriel from public.clients where nom = 'Alice Inscrite'`))[0], { intact: true, avis_courriel: true });
  eq('… le registre des consentements garde un retrait « texto_arret » PAR FICHE (Alain et Alice), après celui — sans client — de l’appel bien signé fait plus haut pour ce numéro avant que les fiches existent ; l’inscription en attente est ignorée', [await registre(), (await q(`select statut from public.inscriptions_avis where nom = 'Alice (inscription)'`))[0].statut],
    [['(inconnu):texto:retrait:texto_arret', 'Alain Inscrit:texto:retrait:texto_arret', 'Alice Inscrite:texto:retrait:texto_arret'], 'ignoree']);
  const r2 = await appel(m.deps, SMS('+18195550001', 'ARRET'));
  eq('un 2ᵉ ARRET du même numéro : tout de même « c’est noté » (rien ne casse)', [r2.statut, reponse(r2), await etat('Alice Inscrite')], [200, MSG_ARRET, 'false:désabonné']);
  // les variantes d'écriture
  await fiche('Béa Accent', { cellulaire: '+18195550010', avis_texto: true });
  await fiche('Bob Stop', { cellulaire: '+18195550011', avis_texto: true });
  await fiche('Cléo Majuscules', { cellulaire: '+18195550012', avis_texto: true });
  for (const [nom, tel, texte] of [['Béa Accent', '+18195550010', ' arrêt. '], ['Bob Stop', '+18195550011', 'Stop !'], ['Cléo Majuscules', '+18195550012', 'ARRÊT']]) {
    const rv = await appel(m.deps, SMS(tel, texte));
    eq(`« ${texte} » désabonne aussi (${nom}) et répond la confirmation`, [await etat(nom), reponse(rv)], ['false:désabonné', MSG_ARRET]);
  }
  // pas un mot-clé : rien ne change
  await fiche('Dan Poli', { cellulaire: '+18195550020', avis_texto: true });
  const avant = m.desabonnements.length;
  const rs = await appel(m.deps, SMS('+18195550020', 'ARRET SVP'));
  eq('« ARRET SVP » n’est PAS un mot-clé : personne n’est désabonné, la réponse dit comment joindre Entretien Lapointe (et rappelle ARRET)', [await etat('Dan Poli'), m.desabonnements.length - avant, reponse(rs)], ['true', 0, MSG_AUTRE]);
  // un numéro qui n'est dans aucune fiche
  const ri = await appel(m.deps, SMS('+18195559999', 'STOP'));
  eq('STOP d’un numéro qui n’est dans AUCUNE fiche : « c’est noté », et le retrait est gardé au registre (sans client)', [reponse(ri), (await registre()).at(-1)], [MSG_ARRET, '(inconnu):texto:retrait:texto_arret']);
  // numéro illisible
  const avant2 = m.desabonnements.length;
  const rn = [await appel(m.deps, SMS('abc', 'ARRET')), await appel(m.deps, SMS('', 'ARRET')), await appel(m.deps, [['Body', 'ARRET']]), await appel(m.deps, SMS('+1819555000', 'ARRET')), await appel(m.deps, SMS('+442071838750', 'ARRET'))];
  eq('un numéro illisible, absent ou hors Amérique du Nord : la fonction de la base n’est PAS appelée ; le client reçoit le message d’échec (pas un faux « c’est noté »)', [m.desabonnements.length - avant2, rn.map((x) => x.statut), rn.map(reponse)], [0, Array(5).fill(200), Array(5).fill(MSG_ARRET_ECHEC)]);
}

log('=== ARRET : QUAND L’ENREGISTREMENT ÉCHOUE ===');
{
  await fiche('Éva Panne', { cellulaire: '+18195550030', avis_texto: true });
  const m = monde({ desabonnerEchec: true });
  const r = await appel(m.deps, SMS('+18195550030', 'ARRET'));
  eq('la base refuse : le client reçoit le message d’ÉCHEC (jamais un faux « c’est noté »), la fiche n’a pas bougé', [r.statut, reponse(r), await etat('Éva Panne')], [200, MSG_ARRET_ECHEC, 'true']);
  const m2 = monde({ desabonnerException: true });
  const r2 = await appel(m2.deps, SMS('+18195550030', 'ARRET'));
  eq('la fonction de la base plante (exception) : même réponse honnête', [r2.statut, reponse(r2), await etat('Éva Panne')], [200, MSG_ARRET_ECHEC, 'true']);
  const m3 = monde();
  const r3 = await appel(m3.deps, SMS('+18195550030', 'ARRET'));
  eq('puis, la base revenue : « ARRET » marche', [reponse(r3), await etat('Éva Panne')], [MSG_ARRET, 'false:désabonné']);
}

log('=== AIDE, START ET LES AUTRES MESSAGES ===');
{
  await fiche('Fred Aide', { cellulaire: '+18195550040', avis_texto: true });
  await fiche('Gina Partie', { cellulaire: '+18195550041', avis_texto: false, desabonne_texto_le: '2026-09-30T12:00:00Z' });
  const m = monde();
  const avant = (await registre()).length;
  for (const texte of ['AIDE', 'help', 'Info']) {
    const r = await appel(m.deps, SMS('+18195550040', texte));
    eq(`« ${texte} » : EXACTEMENT le message d’aide du dossier de Twilio ; personne n’est désabonné`, [r.statut, reponse(r), await etat('Fred Aide')], [200, MSG_AIDE, 'true']);
  }
  for (const texte of ['START', 'unstop', 'YES']) {
    const r = await appel(m.deps, SMS('+18195550041', texte));
    eq(`« ${texte} » : on explique comment se réinscrire (page web) ; JAMAIS de réinscription par texto : Gina reste désabonnée`, [r.statut, reponse(r), await etat('Gina Partie')], [200, MSG_REINSCRIPTION, 'false:désabonné']);
  }
  for (const texte of ['Merci!', 'Pouvez-vous passer demain plutôt ?', 'OUI', '']) {
    const r = await appel(m.deps, SMS('+18195550040', texte));
    eq(`« ${texte} » : la réponse dit comment joindre Entretien Lapointe ; personne n’est désabonné`, [r.statut, reponse(r), await etat('Fred Aide')], [200, MSG_AUTRE, 'true']);
  }
  eq('AIDE, START et les autres messages n’ont écrit RIEN (ni désabonnement, ni registre)', [m.desabonnements.length, (await registre()).length - avant], [0, 0]);
  const rv = await appel(m.deps, [], {});
  eq('une demande bien signée mais SANS texte ni numéro : traitée comme « autre » (la réponse dit comment joindre Entretien Lapointe)', [rv.statut, reponse(rv)], [200, MSG_AUTRE]);
  const rb = await appel(m.deps, SMS('+18195550040', 'ARRET'), { corpsBrut: corpsForm(SMS('+18195550040', 'ARRET')) + '&Inconnu=1', signature: signer([...SMS('+18195550040', 'ARRET'), ['Inconnu', '1']]) });
  vrai('(un paramètre de plus que Twilio ajoute un jour : sans importance si la signature le couvre)', rb.statut === 200 || rb.statut === 403);
}

log('=== LES JOURNAUX NE CONTIENNENT AUCUNE DONNÉE PERSONNELLE ===');
{
  const lignes = [...new Set(journalFonction)];
  vrai('les journaux de la fonction : seulement le genre de message et le résultat (ni numéro de téléphone, ni texte de message)', lignes.every((l) => /^(refus (jeton_absent|signature|trop_grand)|arret -> (ok|echec|numero_invalide)|aide|start|autre|exception \w+)$/.test(l)), lignes.join(' | '));
  vrai('… et ils ont bien noté les refus, les désabonnements, les échecs et les autres genres', ['refus signature', 'refus jeton_absent', 'arret -> ok', 'arret -> echec', 'arret -> numero_invalide', 'aide', 'start', 'autre'].every((l) => lignes.includes(l)), lignes.join(' | '));
}

log('=== LE CODE ===');
{
  const sansCommentaires = CODE.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  eq('aucune clé n’est écrite dans le code (jeton Twilio, identifiant « AC… », clés Supabase)', [/\bAC[0-9a-f]{32}\b/.test(CODE), /\b[0-9a-f]{32}\b/.test(sansCommentaires), /eyJ[A-Za-z0-9_-]{20,}/.test(CODE), /sb_secret_/.test(CODE)], [false, false, false, false]);
  eq('le jeton est lu du SECRET TWILIO_AUTH_TOKEN ; l’adresse signée vient de SUPABASE_URL (jamais de l’adresse reçue)', [CODE.includes(`Deno.env.get('TWILIO_AUTH_TOKEN')`), CODE.includes(`url.replace(/\\/+$/, '') + CHEMIN`), /const CHEMIN = '\/functions\/v1\/recevoir-texto'/.test(CODE), /req\.url/.test(sansCommentaires)], [true, true, true, false]);
  eq('la base est appelée par la fonction du fichier SQL 30 (« desabonner_contact », canal « texto », source « texto_arret ») ; la fonction n’écrit dans aucune table elle-même', [CODE.includes(`admin.rpc('desabonner_contact', { p_canal: 'texto', p_contact: telephone, p_source: 'texto_arret' })`), /\.from\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(sansCommentaires)], [true, false]);
  eq('aucune réinscription : la base n’est appelée que pour ARRET (« desabonner » : sa déclaration, son seul appel, sa réalisation ; une seule fonction de la base)', [(sansCommentaires.match(/desabonner\(/g) || []).length, (sansCommentaires.match(/rpc\(/g) || []).length], [3, 1]);
  eq('aucun texto n’est envoyé par cette fonction (elle répond seulement en TwiML : ni appel à Twilio ni fetch)', [/fetch\(|api\.twilio\.com|Messages\.json/.test(sansCommentaires)], [false]);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
