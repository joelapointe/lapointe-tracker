// Étape 12 — connexion dans l'application (www/js/auth.js), testée avec les VRAIS fichiers de l'application
// chargés dans un faux navigateur (faux document, faux localStorage) et un FAUX Supabase.
// Ce que ces tests ne peuvent pas vérifier : le vrai Supabase Auth (fait par le test réel : reel-etape-12.mjs et l'essai dans le navigateur).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');

// ---------------------------------------------------------------------
// Un « monde » = un faux navigateur + un faux Supabase, avec l'application chargée dedans
// ---------------------------------------------------------------------
function monde(o = {}) {
  const els = {};
  const el = (id) => els[id] ??= (() => {
    const classes = new Set(), attrs = {};
    return { id, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      textContent: '', value: '', style: {}, disabled: false, className: '', attrs, setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] };
  })();
  const stockage = new Map(Object.entries(o.stockage ?? {}));
  const appels = { signIn: [], signOut: [], selects: [], loadStops: 0, demarrerTracking: 0, arreterTracking: 0, reload: 0, hideLoading: 0 };
  const etat = { ecouteur: null };
  const reponses = { signIn: o.signIn ?? { data: { session: { user: { id: 'u-1' } } }, error: null }, profil: o.profil ?? { data: { id: 'u-1', nom: 'Luc', role: 'employe', actif: true, cree_le: 'x' }, error: null }, session: o.session ?? null };
  const fauxDb = {
    auth: {
      signInWithPassword: async (c) => { appels.signIn.push(c); if (o.signInLance) throw o.signInLance; return reponses.signIn; },
      getSession: async () => { if (o.getSessionLance) throw new Error('boum'); return { data: { session: reponses.session } }; },
      signOut: async (opts) => { appels.signOut.push(opts); if (etat.ecouteur) etat.ecouteur('SIGNED_OUT'); return { error: null }; },
      onAuthStateChange: (cb) => { etat.ecouteur = cb; return { data: { subscription: {} } }; },
    },
    from: (table) => ({ select: (colonnes) => { appels.selects.push({ table, colonnes }); return { eq: (c, v) => ({ maybeSingle: async () => { if (o.profilLance) throw new Error('reseau'); return reponses.profil; } }) }; } }),
  };
  const sandbox = {
    document: { getElementById: el },
    localStorage: { getItem: (k) => (stockage.has(k) ? stockage.get(k) : null), setItem: (k, v) => stockage.set(k, String(v)), removeItem: (k) => stockage.delete(k) },
    navigator: { onLine: o.enLigne ?? true },
    location: { reload: () => { appels.reload++; } },
    confirm: () => o.confirme ?? true,
    hideLoading: () => { appels.hideLoading++; },
    loadStops: () => { appels.loadStops++; },
    demarrerTracking: () => { appels.demarrerTracking++; },
    arreterTracking: async () => { appels.arreterTracking++; },
    __fauxDb: fauxDb,
    console,
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/auth.js']) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb;', ctx);
  return {
    ctx, el, stockage, appels, reponses,
    run: (code) => vm.runInContext(code, ctx),
    utilisateur: () => vm.runInContext('currentUser', ctx),
    saisir: (id, secret) => { el('l-tel').value = id; el('l-pin').value = secret; },
    ecran: () => el('login-screen').classList.contains('show'),
    erreur: () => el('login-err').textContent,
  };
}

// =====================================================================
log('=== IDENTIFIANT : numéro de téléphone ou courriel ===');
{
  const m = monde();
  const id = (s) => m.run(`identifiantConnexion(${JSON.stringify(s)})`);
  for (const [saisie, attendu] of [['8191234567', '8191234567@tel.entretienlapointe.ca'], ['819-123-4567', '8191234567@tel.entretienlapointe.ca'], ['(819) 123 4567', '8191234567@tel.entretienlapointe.ca'],
    ['+1 819 123-4567', '8191234567@tel.entretienlapointe.ca'], ['1-819-123-4567', '8191234567@tel.entretienlapointe.ca'], ['  819.123.4567  ', '8191234567@tel.entretienlapointe.ca']])
    eq(`numéro « ${saisie} »`, [id(saisie).email, id(saisie).admin], [attendu, false]);
  eq('courriel : mis en minuscules, reconnu comme administrateur', [id('  Joe@Exemple.CA ').email, id('Joe@Exemple.CA').admin], ['joe@exemple.ca', true]);
  for (const mauvais of ['', '   ', '123456789', '81912345678', '0191234567', '1191234567', 'abc', '+33 6 12 34 56 78', null, undefined])
    vrai(`saisie refusée : ${JSON.stringify(mauvais)}`, !!id(mauvais).erreur && !id(mauvais).email, JSON.stringify(id(mauvais)));
}

log('\n=== LIBELLÉS DU FORMULAIRE ===');
{
  const m = monde();
  m.el('l-tel').value = '819 123-4567'; m.run('majChampsConnexion()');
  eq('numéro : « NIP (6 chiffres) », clavier numérique, 6 caractères maximum', [m.el('l-pin-label').textContent, m.el('l-pin').attrs.inputmode, m.el('l-pin').attrs.maxlength], ['NIP (6 chiffres)', 'numeric', '6']);
  m.el('l-tel').value = 'joe@exemple.ca'; m.run('majChampsConnexion()');
  eq('courriel : « Mot de passe », clavier de texte, longueur libre', [m.el('l-pin-label').textContent, m.el('l-pin').attrs.inputmode, m.el('l-pin').attrs.maxlength], ['Mot de passe', 'text', '128']);
}

log('\n=== MESSAGES D\'ERREUR (en français, sans détail technique) ===');
{
  const m = monde();
  const msg = (e) => m.run(`messageErreurConnexion(${JSON.stringify(e)})`);
  eq('mauvais numéro ou NIP', msg({ code: 'invalid_credentials', status: 400 }), 'Numéro ou NIP incorrect.');
  eq('compte désactivé (bloqué)', msg({ code: 'user_banned', status: 400 }), 'Ce compte est désactivé. Communique avec Joé.');
  eq('trop d\'essais', msg({ code: 'over_request_rate_limit', status: 429 }), 'Trop d’essais. Attends quelques minutes, puis réessaie.');
  eq('pas de réseau', msg({ name: 'AuthRetryableFetchError', status: 0 }), 'Pas de réseau. Vérifie ta connexion, puis réessaie.');
  eq('erreur inconnue : message générique', msg({ code: 'weird', status: 500 }), 'Connexion impossible. Réessaie.');
  vrai('aucun message ne contient de détail technique (code, HTTP, stack)', ['invalid_credentials', 'user_banned', 'over_request_rate_limit', 'weird'].every((c) => !/invalid_|user_banned|over_request|weird|HTTP|Error/.test(msg({ code: c, status: 400 }))));
}

// =====================================================================
log('\n=== CONNEXION D\'UN EMPLOYÉ ===');
{
  const m = monde();
  m.saisir('(819) 555-0101', '123 457');
  await m.run('doLogin()');
  eq('Supabase Auth reçoit le courriel technique et le NIP (espaces retirés)', m.appels.signIn, [{ email: '8195550101@tel.entretienlapointe.ca', password: '123457' }]);
  eq('le profil est demandé en NOMMANT les colonnes (jamais « * »)', m.appels.selects, [{ table: 'utilisateurs', colonnes: 'id, nom, role, actif, cree_le' }]);
  eq('la personne connectée : id, nom, rôle seulement (ni téléphone, ni NIP)', m.utilisateur(), { id: 'u-1', nom: 'Luc', role: 'employe' });
  eq('l\'écran de connexion est fermé, l\'application charge les arrêts', [m.ecran(), m.appels.loadStops], [false, 1]);
  eq('le NIP tapé est effacé du champ', m.el('l-pin').value, '');
  eq('le bouton « Déconnexion » de la barre du haut devient visible ; le nom s\'affiche dans la barre du bas', [m.el('btn-deconnexion').style.display, m.el('btn-deconnexion').attrs.title, m.el('op-name').textContent], ['flex', 'Se déconnecter (Luc)', 'Luc']);
  eq('un employé ne voit pas les boutons d\'administration', ['bb-add', 'btn-nouveau-liste', 'btn-del', 'bb-admin'].map((i) => m.el(i).style.display), ['none', 'none', 'none', 'none']);
  eq('profil gardé pour l\'usage hors réseau : id, nom, rôle seulement', JSON.parse(m.stockage.get('lp_profil')), { id: 'u-1', nom: 'Luc', role: 'employe' });
  eq('l\'ancien suivi GPS reste désactivé (il écrirait dans une table refaite)', m.appels.demarrerTracking, 0);
  eq('le bouton est réactivé', [m.el('login-btn').disabled, m.el('login-btn').textContent], [false, 'Connexion →']);
}

log('\n=== CONNEXION DE L\'ADMINISTRATEUR ===');
{
  const m = monde({ profil: { data: { id: 'u-1', nom: 'Joé', role: 'admin', actif: true, cree_le: 'x' }, error: null } });
  m.saisir('Joe@Exemple.ca', 'un mot de passe long');
  await m.run('doLogin()');
  eq('courriel en minuscules, mot de passe transmis TEL QUEL (espaces conservés)', m.appels.signIn, [{ email: 'joe@exemple.ca', password: 'un mot de passe long' }]);
  eq('l\'administrateur voit les boutons d\'administration', ['bb-add', 'btn-nouveau-liste', 'btn-del', 'bb-admin'].map((i) => m.el(i).style.display), ['flex', 'flex', 'flex', 'flex']);
  eq('l\'administrateur : bouton « Déconnexion » visible, couronne devant son nom', [m.el('btn-deconnexion').style.display, m.el('op-name').textContent], ['flex', '👑 Joé']);
}

log('\n=== ÉCHECS DE CONNEXION ===');
{
  let m = monde({ signIn: { data: { session: null }, error: { code: 'invalid_credentials', status: 400 } } });
  m.saisir('819 555 0101', '999999');
  await m.run('doLogin()');
  eq('mauvais NIP : message clair, personne de connecté, aucun profil demandé', [m.erreur(), m.utilisateur(), m.appels.selects.length, m.appels.loadStops], ['Numéro ou NIP incorrect.', null, 0, 0]);
  eq('… et le bouton est réactivé pour réessayer', [m.el('login-btn').disabled, m.el('login-btn').textContent], [false, 'Connexion →']);

  m = monde();
  m.saisir('819 555', '123457');
  await m.run('doLogin()');
  eq('numéro trop court : refusé SANS appeler Supabase', [m.appels.signIn.length, m.erreur()], [0, 'Numéro de téléphone invalide : 10 chiffres, indicatif régional compris.']);

  m = monde();
  m.saisir('819 555 0101', '');
  await m.run('doLogin()');
  eq('NIP vide : refusé SANS appeler Supabase', [m.appels.signIn.length, m.erreur()], [0, 'Remplis tous les champs.']);

  m = monde({ signIn: { data: { session: null }, error: { code: 'user_banned', status: 400 } } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('compte désactivé (bloqué par Supabase Auth)', m.erreur(), 'Ce compte est désactivé. Communique avec Joé.');

  m = monde({ signIn: { data: { session: null }, error: { code: 'over_request_rate_limit', status: 429 } } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('trop d\'essais', m.erreur(), 'Trop d’essais. Attends quelques minutes, puis réessaie.');

  m = monde({ signInLance: Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }) });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('réseau coupé pendant la connexion : message clair, bouton réactivé', [m.erreur(), m.el('login-btn').disabled], ['Pas de réseau. Vérifie ta connexion, puis réessaie.', false]);
}

log('\n=== COMPTE DÉSACTIVÉ OU SANS PROFIL (le serveur répond, mais ne montre rien) ===');
for (const [libelle, profil] of [['profil marqué inactif', { data: { id: 'u-1', nom: 'Luc', role: 'employe', actif: false }, error: null }], ['aucun profil visible (désactivé : la base ne montre plus rien)', { data: null, error: null }]]) {
  const m = monde({ profil, stockage: { lp_profil: JSON.stringify({ id: 'u-1', nom: 'Luc', role: 'employe' }) } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq(`${libelle} : refusé, message clair`, [m.utilisateur(), m.erreur(), m.ecran()], [null, 'Ce compte est désactivé ou n’est pas configuré. Communique avec Joé.', true]);
  eq('… la session de CE téléphone est fermée (locale seulement), l\'ancien profil effacé, rien chargé', [m.appels.signOut, m.stockage.has('lp_profil'), m.appels.loadStops], [[{ scope: 'local' }], false, 0]);
}

log('\n=== PANNE DE RÉSEAU APRÈS LA CONNEXION (zones mortes) : on ne déconnecte personne ===');
{
  let m = monde({ profil: { data: null, error: { message: 'TypeError: Failed to fetch' } }, stockage: { lp_profil: JSON.stringify({ id: 'u-1', nom: 'Luc', role: 'employe' }) } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('profil connu de cet appareil : l\'application s\'ouvre hors réseau', [m.utilisateur(), m.ecran(), m.appels.signOut.length], [{ id: 'u-1', nom: 'Luc', role: 'employe' }, false, 0]);

  m = monde({ profilLance: true, stockage: { lp_profil: JSON.stringify({ id: 'u-1', nom: 'Luc', role: 'employe' }) } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('même chose si la requête échoue par exception', [m.utilisateur()?.nom, m.appels.signOut.length], ['Luc', 0]);

  m = monde({ profil: { data: null, error: { message: 'Failed to fetch' } } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('aucun profil gardé : message de réseau, MAIS la session n\'est pas fermée (on pourra réessayer)', [m.utilisateur(), m.erreur(), m.appels.signOut.length, m.ecran()], [null, 'Pas de réseau. Vérifie ta connexion, puis réessaie.', 0, true]);

  m = monde({ profil: { data: null, error: { message: 'Failed to fetch' } }, stockage: { lp_profil: JSON.stringify({ id: 'AUTRE-PERSONNE', nom: 'Marc', role: 'admin' }) } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('le profil gardé appartient à UNE AUTRE personne : jamais utilisé', [m.utilisateur(), m.ecran()], [null, true]);

  m = monde({ profil: { data: null, error: { message: 'Failed to fetch' } }, stockage: { lp_profil: '{"id":"u-1","nom":"Luc","role":"superadmin"}' } });
  m.saisir('819 555 0101', '123457'); await m.run('doLogin()');
  eq('un profil gardé avec un rôle inventé est ignoré', m.utilisateur(), null);
}

log('\n=== REPRISE DE SESSION AU DÉMARRAGE ===');
{
  let m = monde({ session: { user: { id: 'u-1' } }, stockage: { lp_user: JSON.stringify({ id: 'x', nom: 'Vieux', telephone: '8195550000', pin: '1234', role: 'admin', approuve: true }) } });
  await m.run('restaurerSession()');
  eq('session déjà ouverte : l\'application s\'ouvre directement, sans redemander le NIP', [m.utilisateur(), m.ecran(), m.appels.hideLoading, m.appels.loadStops], [{ id: 'u-1', nom: 'Luc', role: 'employe' }, false, 1, 1]);
  eq('l\'ANCIEN profil gardé en clair (avec le NIP) est effacé du téléphone', m.stockage.has('lp_user'), false);
  eq('on n\'a jamais fait confiance à l\'ancien profil : c\'est le serveur qui décide du rôle', m.utilisateur().role, 'employe');

  m = monde({ session: null });
  await m.run('restaurerSession()');
  eq('aucune session : écran de connexion', [m.utilisateur(), m.ecran(), m.appels.hideLoading], [null, true, 1]);

  m = monde({ getSessionLance: true });
  await m.run('restaurerSession()');
  eq('lecture de la session impossible : écran de connexion, pas de plantage', [m.utilisateur(), m.ecran()], [null, true]);

  m = monde({ session: { user: { id: 'u-1' } }, profil: { data: { id: 'u-1', nom: 'Luc', role: 'employe', actif: false }, error: null } });
  await m.run('restaurerSession()');
  eq('session d\'un compte devenu inactif : retour à la connexion avec l\'explication', [m.utilisateur(), m.ecran(), m.erreur()], [null, true, 'Ce compte est désactivé ou n’est pas configuré. Communique avec Joé.']);

  m = monde({ session: { user: { id: 'u-1' } }, profil: { data: null, error: { message: 'Failed to fetch' } }, stockage: { lp_profil: JSON.stringify({ id: 'u-1', nom: 'Luc', role: 'employe' }) } });
  await m.run('restaurerSession()');
  eq('démarrage sans réseau : l\'application s\'ouvre avec le profil gardé, l\'employé reste connecté', [m.utilisateur()?.nom, m.ecran(), m.appels.signOut.length], ['Luc', false, 0]);

  m = monde({ session: { user: { id: 'u-1' } }, profil: { data: null, error: { message: 'Failed to fetch' } } });
  await m.run('restaurerSession()');
  eq('démarrage sans réseau ET sans profil gardé : écran avec message, session conservée', [m.ecran(), m.erreur(), m.appels.signOut.length], [true, 'Pas de réseau. Vérifie ta connexion, puis réessaie.', 0]);
}

log('\n=== SESSION TERMINÉE PAR SUPABASE (renouvellement refusé, compte bloqué…) ===');
{
  const m = monde({ session: { user: { id: 'u-1' } } });
  await m.run('restaurerSession()');
  eq('connecté', m.utilisateur()?.nom, 'Luc');
  m.appels.signOut.length = 0;
  m.ctx.__ecouteur = null;
  // Supabase annonce la fin de session sans que l'employé ait cliqué « Se déconnecter »
  await m.run('__fauxDb.auth.signOut({scope:"local"})');
  eq('retour à l\'écran de connexion avec un message clair', [m.utilisateur(), m.ecran(), m.erreur()], [null, true, 'Session terminée. Reconnecte-toi.']);
  eq('l\'ancien profil gardé est effacé', m.stockage.has('lp_profil'), false);
  eq('le bouton « Déconnexion » est caché (personne n\'est connecté)', m.el('btn-deconnexion').style.display, 'none');
}
{
  const m = monde({ session: { user: { id: 'u-1' } } });
  await m.run('restaurerSession()');
  await m.run('fermerSessionLocale()');
  eq('fermeture volontaire (compte désactivé) : PAS de message « Session terminée » qui écraserait l\'explication', m.erreur(), '');
}

log('\n=== DÉCONNEXION VOLONTAIRE ===');
{
  let m = monde({ session: { user: { id: 'u-1' } }, confirme: false });
  await m.run('restaurerSession()');
  await m.run('doLogout()');
  eq('« Annuler » à la confirmation : rien ne change', [m.utilisateur()?.nom, m.appels.signOut.length, m.appels.reload], ['Luc', 0, 0]);

  m = monde({ session: { user: { id: 'u-1' } } });
  await m.run('restaurerSession()');
  await m.run('doLogout()');
  eq('« Se déconnecter » : session LOCALE fermée (les autres appareils du même compte restent connectés), page rechargée', [m.appels.signOut, m.appels.reload], [[{ scope: 'local' }], 1]);
  eq('… le suivi est arrêté, l\'ancien profil gardé est effacé, personne n\'est connecté', [m.appels.arreterTracking, m.stockage.has('lp_profil'), m.utilisateur()], [1, false, null]);
  eq('… sans message « Session terminée » (c\'est un choix de l\'employé)', m.erreur(), '');
}

// =====================================================================
log('\n=== CONTRÔLES DU CODE DE L\'APPLICATION (plus rien de l\'ancien système) ===');
{
  const auth = lire('js/auth.js'), html = lire('index.html'), css = lire('css/style.css'), admin = lire('js/admin.js'), carte = lire('js/carte.js');
  const tous = ['js/config.js', 'js/utilitaires.js', 'js/auth.js', 'js/carte.js', 'js/arrets.js', 'js/routes.js', 'js/problemes.js', 'js/admin.js', 'js/liste-arrets.js', 'js/tracking.js', 'js/placement.js', 'js/demarrage.js', 'index.html'].map((f) => [f, lire(f)]);
  vrai('aucun « select(\'*\') » sur utilisateurs (la base l\'interdit)', !tous.some(([, s]) => /from\('utilisateurs'\)\s*\.select\('\*'\)/.test(s)), tous.filter(([, s]) => /from\('utilisateurs'\)\s*\.select\('\*'\)/.test(s)).map(([f]) => f).join(','));
  vrai('plus aucune trace du NIP à 4 chiffres, de « pin », d\'« approuve » ni de l\'inscription', !tous.some(([, s]) => /\.eq\('pin'|approuve|doSignup|showSignup|signup-|pending-screen|PIN \(4/.test(s)), tous.filter(([, s]) => /approuve|doSignup|showSignup|signup-|pending-screen|PIN \(4/.test(s)).map(([f]) => f).join(','));
  vrai('l\'ancien profil complet n\'est plus JAMAIS enregistré dans le téléphone (seul « lp_user » est cité pour être EFFACÉ)', !tous.some(([, s]) => /setItem\('lp_user'/.test(s)) && /removeItem\('lp_user'\)/.test(auth));
  vrai('aucune clé secrète dans l\'application (seule la clé publique « anon » existe)', tous.every(([, s]) => !/service_role|sb_secret/.test(s)));
  vrai('le champ NIP est limité à 6 chiffres numériques par défaut', /id="l-pin"[^>]*maxlength="6"[^>]*inputmode="numeric"/.test(html));
  vrai('le formulaire se soumet avec la touche Entrée (vrai <form>) et permet au téléphone de mémoriser le numéro (autocomplete)', /<form id="login-box" onsubmit="doLogin\(\);return false;"/.test(html) && /autocomplete="username"/.test(html));
  vrai('« NIP oublié » renvoie à Joé (pas de réinitialisation libre)', /NIP oublié \? Communique avec Joé/.test(html));
  vrai('le panneau admin ne parle plus de comptes en attente', !/comptes? en attente/i.test(admin));
  vrai('les fichiers de l\'application chargent auth.js AVANT carte.js et demarrage.js EN DERNIER', html.indexOf('js/auth.js') < html.indexOf('js/carte.js') && html.lastIndexOf('js/demarrage.js') > html.indexOf('js/placement.js'));
  vrai('carte.js reprend la session par restaurerSession()', /restaurerSession\(\)/.test(carte));
  const barreHaut = (html.match(/<div id="topbar">[\s\S]*?<div id="addr-row">/) || [''])[0];
  vrai('un VRAI bouton « Déconnexion » existe dans la barre du haut, relié à doLogout()', /<button id="btn-deconnexion" type="button" onclick="doLogout\(\)"[^>]*>[\s\S]*Déconnexion[\s\S]*<\/button>/.test(barreHaut), barreHaut.slice(0, 200));
  vrai('l\'ancien bandeau invisible « role-badge » n\'existe plus nulle part', !tous.some(([, s]) => /role-badge/.test(s)) && !/role-badge/.test(css));
  vrai('le bouton a une zone de toucher d\'au moins 44 px (règle du pouce sur téléphone) et capte les touchers malgré la barre du haut', /#btn-deconnexion\{[^}]*min-height:44px/.test(css) && /#btn-deconnexion\{[^}]*pointer-events:all/.test(css));
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
