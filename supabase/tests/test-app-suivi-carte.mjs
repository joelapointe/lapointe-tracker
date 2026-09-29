// Demande 1 de Joé (29 sept. 2026) — LA CARTE SUIT LE CAMION (www/js/suivi-carte.js et ses branchements : carte.js, position.js, vehicules.js, arrets.js, passe.js, liste-arrets.js, index.html).
// Les VRAIS fichiers de l'application sont chargés dans un faux navigateur avec une fausse carte Leaflet (qui note chaque déplacement demandé et lance les mêmes événements que la vraie :
// « move » d'un marqueur, « dragstart », « zoomstart », « zoomend ») et une HORLOGE FAUSSE : le temps ne passe que quand le test le dit (le glissement du point est donc exact, sans attente réelle).
// Décisions de Joé : (1) le suivi s'allume tout seul au début de la passe (chauffeur ET passagers), s'éteint à la fin ; hors passe, seulement avec ◎ ; (2) « Suivre ce camion » pour l'administrateur ;
// (3) la rotation de la carte : plus tard. Ce que ce test ne peut PAS vérifier : l'effet réel sur un téléphone qui roule (essai de Joé) et la vraie Leaflet (essayée à part dans un navigateur).
// WWW_TEST : un autre dossier « www » (erreurs volontaires : voir erreurs-volontaires.mjs).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');

const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' }, JOE = { id: 'u-joe', nom: 'Joé', role: 'admin' };
const T0 = 1_800_000_000_000;

// ---------------------------------------------------------------------
// Une horloge fausse : setInterval / setTimeout / Date.now n'avancent que par avancer(ms)
// ---------------------------------------------------------------------
function horlogeFausse(depart) {
  let t = depart, seq = 0;
  const taches = [];
  const retirer = (id) => { const i = taches.findIndex((x) => x.id === id); if (i >= 0) taches.splice(i, 1); };
  return {
    now: () => t,
    setInterval: (fn, ms) => { const id = ++seq; taches.push({ id, fn, ms, prochain: t + ms }); return id; },
    setTimeout: (fn, ms) => { const id = ++seq; taches.push({ id, fn, ms, prochain: t + (ms || 0), unique: true }); return id; },
    clearInterval: retirer,
    clearTimeout: retirer,
    nbMinuteries: () => taches.length,
    async avancer(ms) {
      const fin = t + ms;
      for (;;) {
        const prochaine = taches.filter((x) => x.prochain <= fin).sort((a, b) => a.prochain - b.prochain || a.id - b.id)[0];
        if (!prochaine) break;
        t = prochaine.prochain;
        if (prochaine.unique) retirer(prochaine.id); else prochaine.prochain += prochaine.ms;
        prochaine.fn();
        await Promise.resolve();
      }
      t = fin;
    },
  };
}

const FICHIERS = ['js/config.js', 'js/position.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/carte.js', 'js/tours.js', 'js/vehicules.js', 'js/suivi-carte.js', 'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/problemes.js', 'js/photos.js'];

const PASSE = (id, equipe, o = {}) => ({ passe_id: id, equipe_id: equipe, chauffeur_id: 'u-x', je_suis_chauffeur: false, je_suis_a_bord: false, ...o });
const TOUR = (passes, o = {}) => ({ route_id: 'r1', tache: 't1', numero: 1, en_cours: true, total: 4, faits: 1, pourcentage: 25, arrets_faits: [], passes, ...o });
const CHAUFFEUR = (id = 'p1') => [TOUR([PASSE(id, 'e1', { chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true })])];
const PASSAGER = (id = 'p2') => [TOUR([PASSE(id, 'e2', { chauffeur_id: 'u-eric', je_suis_a_bord: true })])];

// ---------------------------------------------------------------------
// Un monde : faux navigateur + fausse carte + les vrais fichiers
// ---------------------------------------------------------------------
function monde(o = {}) {
  const horloge = horlogeFausse(T0);
  class DateFausse extends Date { constructor(...a) { if (a.length) super(...a); else super(horloge.now()); } static now() { return horloge.now(); } }
  const els = {};
  const creer = (id) => {
    const classes = new Set();
    return { id, children: [], style: {}, textContent: '', innerHTML: '', value: '', disabled: false, className: '', onclick: null, attrs: {}, dataset: {},
      classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {}, remove() {}, querySelector() { return null; }, addEventListener() {} };
  };
  const el = (id) => (els[id] ??= creer(id));

  // Un marqueur Leaflet imité : setLatLng lance « move » (comme le vrai), on() / off() sans doublon
  const marqueurs = [];
  const faireMarqueur = (ll, opts) => {
    const ecout = {};
    const m = { ll: [ll[0], ll[1]], icone: opts && opts.icon, popup: null, popupMaj: 0, retire: false, deplacements: 0,
      addTo() { return m; }, getLatLng() { return m.ll; },
      setLatLng(p) { m.ll = [p[0], p[1]]; m.deplacements++; (ecout.move ?? []).slice().forEach((f) => f({ latlng: m.ll })); return m; },
      on(t, f) { const l = (ecout[t] ??= []); if (!l.includes(f)) l.push(f); return m; },
      off(t, f) { ecout[t] = (ecout[t] ?? []).filter((x) => x !== f); return m; },
      nbEcouteurs: (t) => (ecout[t] ?? []).length,
      setIcon(i) { m.icone = i; return m; }, bindPopup(h) { m.popup = h; return m; }, setPopupContent(h) { m.popup = h; m.popupMaj++; return m; } };
    marqueurs.push(m);
    return m;
  };
  const cercles = [];
  const carte = { zoom: 14, centre: [46.55, -72.75], appels: [], ecout: {},
    on(t, f) { const l = (carte.ecout[t] ??= []); if (!l.includes(f)) l.push(f); return carte; },
    off(t, f) { carte.ecout[t] = (carte.ecout[t] ?? []).filter((x) => x !== f); return carte; },
    tirer(t) { (carte.ecout[t] ?? []).slice().forEach((f) => f({ type: t })); },
    getZoom: () => carte.zoom, getCenter: () => carte.centre, getContainer: () => ({ style: {} }),
    setView(ll, z, opt) { carte.appels.push({ f: 'setView', ll: [ll[0], ll[1]], z, o: opt }); carte.centre = [ll[0], ll[1]]; if (z !== undefined) carte.zoom = z; return carte; },
    panTo(ll, opt) { carte.appels.push({ f: 'panTo', ll: [ll[0], ll[1]], o: opt }); carte.centre = [ll[0], ll[1]]; return carte; },
    flyTo(ll, z, opt) { carte.appels.push({ f: 'flyTo', ll: [ll[0], ll[1]], z, o: opt }); carte.centre = [ll[0], ll[1]]; carte.zoom = z; return carte; },
    removeLayer(m) { m.retire = true; }, addLayer() {} };
  const L = { divIcon: (opt) => opt, marker: faireMarqueur, polygon: () => ({ addTo() { return this; } }),
    circle: (ll, opts) => { const c = { ll: [ll[0], ll[1]], rayon: opts.radius, addTo() { return c; }, setLatLng(p) { c.ll = [p[0], p[1]]; return c; }, setRadius(r) { c.rayon = r; return c; } }; cercles.push(c); return c; },
    map: () => carte, tileLayer: () => ({ addTo() { return this; } }), layerGroup: () => ({ addTo() { return this; } }) };

  const lecturesGps = { ok: null };
  const toasts = [];
  const stockage = {};
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null), body: creer('body'), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; } },
    window: {}, navigator: { geolocation: { watchPosition: (ok_) => { lecturesGps.ok = ok_; return 1; } } },
    L, supabase: { createClient: () => ({ channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; } }) },
    setTimeout: horloge.setTimeout, clearTimeout: horloge.clearTimeout, setInterval: horloge.setInterval, clearInterval: horloge.clearInterval, Date: DateFausse, console,
    fetch: async () => ({ json: async () => ({ address: { road: 'Rue Test' } }) }), crypto: { randomUUID: () => 'x' },
    setStatus() {}, hideLoading() {}, showErr() {}, __toasts: toasts,
  };
  const ctx = vm.createContext(sandbox);
  for (const f of FICHIERS) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`var restaurerSession = function () {}; toast = (m) => { __toasts.push(m); }; afficherResume = async () => {};
    var __suivi = () => (suiviCarte ? { type: suiviCarte.type, passeId: suiviCarte.passeId, auto: suiviCarte.auto, attache: !!suiviCarte.marqueur } : null);
    currentUser = ${JSON.stringify(o.utilisateur ?? LUC)};`, ctx);

  const w = { ctx, el, carte, marqueurs, cercles, toasts, horloge,
    run: (c) => vm.runInContext(c, ctx),
    initCarte: () => vm.runInContext('initApp()', ctx),                           // carte.js pour de vrai : la carte fausse, ◎, le suivi du GPS
    demarrerGps: () => vm.runInContext('window.demarrerSuiviGps()', ctx),
    point: () => vm.runInContext('window._uMk', ctx),                             // mon point vert (dessiné par carte.js à la première lecture)
    suivi: () => vm.runInContext('__suivi()', ctx),
    suspendu: () => vm.runInContext('!!_suiviSuspendu', ctx),
    bouton: () => el('btn-suivi'),
    allume: () => el('btn-suivi').classList.contains('on'),
    // le suivi de la carte (navigateur/plugin) livre une lecture ; le service de position du téléphone (pendant ma passe) aussi, par noterPosition
    lectureCarte: (lat, lon, precision = 8, t = horloge.now()) => lecturesGps.ok({ coords: { latitude: lat, longitude: lon, accuracy: precision }, timestamp: t }),
    lectureFond: (lat, lon, precision = 5, t = horloge.now()) => vm.runInContext(`noterPosition(${lat}, ${lon}, ${precision === null ? 'null' : precision}, ${t})`, ctx),
    tours: (l) => vm.runInContext('tours = ' + JSON.stringify(l) + ';', ctx),
    bandeau: () => vm.runInContext('majBandeauPasse()', ctx),
    // les camions à l'écran : {passe, equipe, nom, lat, lon} ; la position est « d'à l'instant »
    camions: (l) => {
      const maintenant = new Date(horloge.now()).toISOString();
      vm.runInContext(`positionsVehicules = ${JSON.stringify(l.map((c) => ({ passe_id: c.passe, lat: c.lat, lon: c.lon, precision_m: 5, maj_le: maintenant })))};
        nomsVehicules = ${JSON.stringify(Object.fromEntries(l.map((c) => [c.equipe, c.nom])))}; majVehicules();`, ctx);
    },
    camion: (id) => vm.runInContext(`marqueursVehicules[${JSON.stringify(id)}] || null`, ctx),
    pans: () => carte.appels.filter((a) => a.f === 'panTo'),
    vues: () => carte.appels.filter((a) => a.f !== 'panTo'),
  };
  return w;
}
// Un monde où le point vert existe déjà (première lecture reçue)
async function mondeAvecPoint(o = {}) {
  const m = monde(o);
  m.initCarte();
  await m.demarrerGps();
  m.lectureCarte(46.5, -72.7, 8);
  return m;
}

// =====================================================================
log('=== LE POINT VERT GLISSE JUSQU\'À CHAQUE LECTURE DU GPS, D\'OÙ QU\'ELLE VIENNE ===');
{
  const m = monde(); m.initCarte();
  eq('avant la première lecture : aucun point vert', m.point(), undefined);
  await m.demarrerGps();
  m.lectureCarte(46.5, -72.7, 8);
  const p = m.point();
  eq('la première lecture DESSINE le point vert (carte.js), au bon endroit', p && p.ll, [46.5, -72.7]);
  eq('… la carte s\'y centre une fois, au zoom 15 (comme avant)', m.vues().map((a) => [a.f, a.ll, a.z]), [['setView', [46.5, -72.7], 15]]);
  eq('… son cercle de précision montre 8 m', m.cercles.map((c) => c.rayon), [8]);

  await m.horloge.avancer(1000);
  m.lectureFond(46.501, -72.7, 5);   // une lecture du service de position du téléphone (pendant ma passe : une par seconde), UNE seconde plus tard
  eq('le point ne SAUTE pas : à l\'instant de la lecture il est encore à sa place', p.ll, [46.5, -72.7]);
  await m.horloge.avancer(500);
  vrai('… au milieu du glissement il est ENTRE les deux lectures', p.ll[0] > 46.5 && p.ll[0] < 46.501, JSON.stringify(p.ll));
  await m.horloge.avancer(600);
  eq('… et il arrive à la lecture après une seconde (l\'écart RÉEL entre les deux lectures)', p.ll, [46.501, -72.7]);
  eq('le cercle de précision suit le point', m.cercles[0].ll, p.ll);
  eq('… et prend la précision de la nouvelle lecture (5 m)', m.cercles[0].rayon, 5);
  m.lectureFond(46.5011, -72.7, null, m.horloge.now() + 1000);
  eq('une précision inconnue ne change pas le cercle', m.cercles[0].rayon, 5);

  await m.horloge.avancer(2000);
  const t1 = m.horloge.now();
  m.lectureFond(46.502, -72.7, 5, t1);
  m.lectureFond(46.9, -72.9, 5, t1);         // la MÊME lecture (même heure) reçue d'une deuxième source
  m.lectureFond(46.9, -72.9, 5, t1 - 500);   // une plus VIEILLE, arrivée en retard
  await m.horloge.avancer(4000);
  eq('une lecture qui ne dépasse pas la précédente (même heure, ou plus vieille) est IGNORÉE : elle ne coupe pas un glissement en cours', p.ll, [46.502, -72.7]);
  eq('… mais la dernière position connue du téléphone (lastPos) reste celle de la dernière lecture reçue', m.run('lastPos'), [46.9, -72.9]);

  // une lecture du suivi de la carte (le plugin de position du navigateur, lent) fait glisser le point, elle ne le déplace pas d'un coup
  await m.horloge.avancer(2000);
  m.lectureCarte(46.52, -72.7, 6);
  eq('une lecture du suivi de la carte fait GLISSER le point comme les autres : il ne saute pas', p.ll, [46.502, -72.7]);
  await m.horloge.avancer(3000);
  vrai('… il est en route', p.ll[0] > 46.502 && p.ll[0] < 46.52, JSON.stringify(p.ll));
  await m.horloge.avancer(3000);
  eq('… et arrive (la précision de cette lecture : 6 m)', [p.ll, m.cercles[0].rayon], [[46.52, -72.7], 6]);

  // un long silence : le glissement ne rampe jamais plus de 15 secondes
  const avantSilence = p.ll[0];
  await m.horloge.avancer(60_000);
  m.lectureFond(46.53, -72.7, 5);
  await m.horloge.avancer(14_000);
  vrai('après 60 s de silence, le glissement est plafonné : à 14 s il n\'est pas encore arrivé…', p.ll[0] > avantSilence && p.ll[0] < 46.53, JSON.stringify(p.ll));
  await m.horloge.avancer(1500);
  eq('… et il est arrivé à 15 s', p.ll, [46.53, -72.7]);
}

log('\n=== LE VÉHICULE GLISSE AUSSI QUAND L\'HEURE DE LA LECTURE EST UN TEXTE (serveur) OU UN NOMBRE (GPS) ===');
{
  const m = monde();
  for (const [nom, heure] of [['texte ISO (maj_le du serveur)', (ms) => new Date(ms).toISOString()], ['nombre de millisecondes (lecture du GPS)', (ms) => ms]]) {
    const mk = { ll: [46.5, -72.7], setLatLng(p) { mk.ll = [p[0], p[1]]; return mk; } };
    m.run(`__mk = null;`);
    m.ctx.__mk = mk;
    m.run(`deplacerMarqueurCamion(__mk, 46.5, -72.7, ${JSON.stringify(heure(m.horloge.now()))})`);
    await m.horloge.avancer(2000);
    m.run(`deplacerMarqueurCamion(__mk, 46.502, -72.7, ${JSON.stringify(heure(m.horloge.now()))})`);
    await m.horloge.avancer(1000);
    vrai(`heure en ${nom} : à mi-chemin de son glissement de 2 s`, mk.ll[0] >= 46.50085 && mk.ll[0] <= 46.50115, JSON.stringify(mk.ll));
    await m.horloge.avancer(1200);
    eq(`… puis arrivé (${nom})`, mk.ll, [46.502, -72.7]);
  }
}

// =====================================================================
log('\n=== LE BOUTON ◎ : ALLUME LE SUIVI DE LA CARTE, OU L\'ÉTEINT ===');
{
  const m = monde(); m.initCarte();
  m.run('window.centerUser()');
  eq('sans position du téléphone : un message, le suivi ne s\'allume pas', [m.toasts.at(-1), m.suivi(), m.allume()], ['📍 Position du téléphone pas encore trouvée', null, false]);
  await m.demarrerGps(); m.lectureCarte(46.5, -72.7);
  m.carte.appels.length = 0;
  m.run('window.centerUser()');
  eq('◎ avec une position : la carte suit MON point vert (pas déclenché tout seul)', m.suivi(), { type: 'moi', passeId: null, auto: false, attache: true });
  eq('… elle se centre dessus, au zoom 16 (sans animation)', m.carte.appels.map((a) => [a.f, a.ll, a.z, a.o]), [['setView', [46.5, -72.7], 16, { animate: false }]]);
  eq('… le bouton s\'allume (couleur + aria-pressed)', [m.allume(), m.bouton().attrs['aria-pressed']], [true, 'true']);
  m.run('window.centerUser()');
  eq('◎ de nouveau : le suivi s\'éteint, le bouton aussi', [m.suivi(), m.allume(), m.bouton().attrs['aria-pressed']], [null, false, 'false']);
  m.carte.zoom = 18; m.carte.appels.length = 0;
  m.run('window.centerUser()');
  eq('un zoom déjà plus rapproché que 16 est gardé (le suivi ne recule jamais)', [m.carte.zoom, m.carte.appels[0].z], [18, 18]);
  m.run('window.centerUser()');
  m.carte.zoom = 12; m.run('window.centerUser()');
  eq('… et un zoom trop éloigné revient à 16', m.carte.zoom, 16);
}

log('\n=== LA CARTE GARDE LE POINT AU CENTRE, SANS TOUCHER AU ZOOM ===');
{
  const m = await mondeAvecPoint(); const p = m.point();
  m.run('window.centerUser()'); m.carte.appels.length = 0;
  await m.horloge.avancer(1000); m.lectureFond(46.502, -72.7, 5);
  await m.horloge.avancer(1200);
  vrai('à chaque pas du glissement, la carte se recentre sur le point, SANS animation', m.pans().length >= 6 && m.pans().every((a) => a.o && a.o.animate === false), String(m.pans().length));
  eq('… et elle finit exactement sur la lecture', m.carte.centre, [46.502, -72.7]);
  eq('… le point est toujours au centre : la carte a suivi le point à chaque pas (dernier recentrage = position du point)', m.pans().at(-1).ll, p.ll);
  eq('… sans jamais toucher au zoom ni redemander une vue', m.vues().length, 0);
  eq('un seul écouteur « move » de plus sur le point pendant le suivi (celui de la carte) : pas de fuite', p.nbEcouteurs('move'), 2);
  m.run('window.centerUser()');
  eq('… et il est retiré quand le suivi s\'éteint (il ne reste que le cercle de précision)', p.nbEcouteurs('move'), 1);
  m.carte.appels.length = 0;
  await m.horloge.avancer(1000); m.lectureFond(46.503, -72.7, 5); await m.horloge.avancer(1200);
  eq('suivi éteint : la carte ne bouge PLUS, même si le point bouge', m.carte.appels.length, 0);
}

log('\n=== DÉPLACER LA CARTE À LA MAIN ÉTEINT LE SUIVI ===');
{
  const m = await mondeAvecPoint(); const p = m.point();
  m.run('window.centerUser()');
  m.carte.tirer('dragstart');
  eq('la main sur la carte (dragstart) : le suivi s\'éteint, le bouton aussi', [m.suivi(), m.allume()], [null, false]);
  m.carte.appels.length = 0;
  await m.horloge.avancer(1000); m.lectureFond(46.502, -72.7, 5); await m.horloge.avancer(1200);
  eq('… et la carte reste là où la personne l\'a mise', m.carte.appels.length, 0);
  eq('… le point, lui, continue de glisser', p.ll, [46.502, -72.7]);
  m.run('window.centerUser()');
  eq('◎ le rallume, et recentre', [m.suivi() && m.suivi().type, m.vues().length], ['moi', 1]);
  m.run('window.centerUser()');
  m.carte.tirer('dragstart');
  eq('déplacer la carte quand rien n\'est suivi ne fait rien', [m.suivi(), m.allume()], [null, false]);
  eq('les écouteurs de la carte ne sont posés qu\'UNE fois, malgré tous ces allumages', ['dragstart', 'zoomstart', 'zoomend'].map((t) => (m.carte.ecout[t] || []).length), [1, 1, 1]);
}

log('\n=== UN ZOOM (PINCEMENT) NE COUPE PAS LE SUIVI : LA CARTE SE RECENTRE À SA FIN ===');
{
  const m = await mondeAvecPoint(); const p = m.point();
  m.run('window.centerUser()'); m.carte.appels.length = 0;
  m.carte.tirer('zoomstart');
  await m.horloge.avancer(1000); m.lectureFond(46.502, -72.7, 5); await m.horloge.avancer(1200);
  eq('pendant le zoom, la carte n\'est pas déplacée par le suivi (elle serait en conflit avec les doigts)', m.pans().length, 0);
  eq('… le suivi reste allumé', m.suivi() && m.suivi().type, 'moi');
  m.carte.tirer('zoomend');
  eq('à la fin du zoom, la carte se recentre sur le point', m.pans().map((a) => [a.ll, a.o]), [[p.ll, { animate: false }]]);
  // un zoom dont la fin n'arrive jamais
  m.carte.appels.length = 0;
  m.carte.tirer('zoomstart');
  await m.horloge.avancer(1000); m.lectureFond(46.503, -72.7, 5, m.horloge.now() + 8000);
  await m.horloge.avancer(3900);
  eq('un zoom qui n\'a pas fini : la carte attend…', m.pans().length, 0);
  await m.horloge.avancer(4000);
  vrai('… mais pas plus de 5 secondes : après, le suivi reprend tout seul (aucune fin de zoom ne peut le bloquer pour toujours)', m.pans().length > 0, String(m.pans().length));
  m.run('window.centerUser()'); m.carte.appels.length = 0;   // (◎ éteint le suivi)
  m.carte.tirer('zoomstart'); m.carte.tirer('zoomend');
  eq('un zoom quand rien n\'est suivi ne déplace pas la carte', m.carte.appels.length, 0);
}

// =====================================================================
log('\n=== AU DÉBUT DE MA PASSE, LE SUIVI S\'ALLUME TOUT SEUL (chauffeur), UNE SEULE FOIS ===');
{
  const m = await mondeAvecPoint(); const p = m.point();
  m.carte.appels.length = 0;
  m.bandeau();
  eq('aucune passe : le suivi ne s\'allume pas', [m.suivi(), m.allume()], [null, false]);
  m.tours(CHAUFFEUR('p1')); m.bandeau();
  eq('je deviens chauffeur d\'une passe : la carte suit MON point, tout seul', m.suivi(), { type: 'moi', passeId: null, auto: true, attache: true });
  eq('… le bouton est allumé, la carte est centrée sur moi au zoom 16', [m.allume(), m.vues().map((a) => [a.ll, a.z])], [true, [[[46.5, -72.7], 16]]]);
  m.carte.appels.length = 0;
  m.bandeau(); m.bandeau();
  eq('chaque redessin de l\'écran (le bandeau se redessine tout le temps) ne relance PAS le suivi', m.carte.appels.length, 0);

  m.carte.tirer('dragstart');
  m.bandeau();
  eq('la personne déplace la carte : le suivi est éteint, et un redessin ne le rallume JAMAIS (une seule fois par passe)', [m.suivi(), m.allume()], [null, false]);

  m.run('window.centerUser()');
  eq('◎ le rallume à la demande (manuel : ne s\'éteindra pas tout seul)', m.suivi() && m.suivi().auto, false);
  m.tours([]); m.bandeau();
  eq('ma passe finit : un suivi allumé À LA MAIN reste (c\'est le choix de la personne)', m.suivi() && m.suivi().type, 'moi');
  m.run('window.centerUser()');

  m.tours(CHAUFFEUR('p2')); m.bandeau();
  eq('une NOUVELLE passe (autre numéro) : le suivi se rallume tout seul', m.suivi(), { type: 'moi', passeId: null, auto: true, attache: true });
  m.tours([]); m.bandeau();
  eq('la passe finit : le suivi qui s\'était allumé tout seul s\'ÉTEINT', [m.suivi(), m.allume()], [null, false]);
  eq('… et ne repart pas au redessin suivant', (m.bandeau(), m.suivi()), null);

  m.tours(CHAUFFEUR('p2')); m.bandeau();
  eq('la même passe qui REVIENT après avoir fini (passe rouverte par l\'annulation du dernier arrêt) : le suivi repart, la passe recommence', m.suivi() && m.suivi().auto, true);
  m.tours(CHAUFFEUR('p3')); m.bandeau();
  eq('… et une passe différente aussi', m.suivi() && m.suivi().auto, true);
  m.run('currentUser = null'); m.bandeau();
  eq('personne de connecté (déconnexion) : le suivi automatique s\'éteint', m.suivi(), null);
}

log('\n=== UN PASSAGER SUIT LE CAMION OÙ IL EST À BORD (position reçue du serveur) ===');
{
  const m = await mondeAvecPoint({ utilisateur: LUC });
  m.carte.appels.length = 0;
  m.tours(PASSAGER('p2')); m.bandeau();
  eq('à bord d\'un camion sans le conduire : la carte suit LE CAMION (tout seul)', m.suivi(), { type: 'camion', passeId: 'p2', auto: true, attache: false });
  eq('… le camion n\'est pas encore dessiné (pas de position reçue) : la carte attend, ne bouge pas, le bouton est allumé', [m.vues().length + m.pans().length, m.allume()], [0, true]);
  m.camions([{ passe: 'p2', equipe: 'e2', nom: 'Camion 2', lat: 46.6, lon: -72.8 }]);
  eq('dès que le camion apparaît, la carte s\'y attache et s\'y centre (zoom 16 au moins)', [m.suivi().attache, m.vues().map((a) => [a.ll, a.z])], [true, [[[46.6, -72.8], 16]]]);
  m.carte.appels.length = 0;
  await m.horloge.avancer(3000);
  m.camions([{ passe: 'p2', equipe: 'e2', nom: 'Camion 2', lat: 46.603, lon: -72.8 }]);
  await m.horloge.avancer(3200);
  vrai('le camion glisse (position du serveur, toutes les 3 s) et la carte le suit à chaque pas', m.pans().length >= 15 && m.pans().every((a) => a.o.animate === false), String(m.pans().length));
  eq('… elle finit sur le camion', m.carte.centre, [46.603, -72.8]);
  eq('le camion suivi est celui de MA passe : mon point vert ne pilote pas la carte', m.point().nbEcouteurs('move'), 1);

  m.camions([]);
  eq('le camion disparaît (sa passe est finie) : le suivi s\'éteint', [m.suivi(), m.allume()], [null, false]);
  eq('… et son écouteur est retiré', m.camion('p2'), null);

  m.tours([]); m.bandeau();
  const n = await mondeAvecPoint({ utilisateur: LUC });
  n.tours(PASSAGER('p2')); n.bandeau(); n.tours(CHAUFFEUR('p9')); n.bandeau();
  eq('un passager qui devient chauffeur d\'une autre passe : la carte suit MON point', n.suivi(), { type: 'moi', passeId: null, auto: true, attache: true });
  n.tours(PASSAGER('p2')); n.bandeau();
  eq('… et revenir ensuite à la passe où j\'étais passager est un nouveau changement de passe : la carte suit le camion à nouveau', n.suivi(), { type: 'camion', passeId: 'p2', auto: true, attache: false });

  const q = await mondeAvecPoint({ utilisateur: LUC });
  q.tours(PASSAGER('p2')); q.bandeau(); q.tours([]); q.bandeau();
  eq('je ne suis plus à bord (retiré de l\'équipage) : le suivi qui s\'était allumé tout seul s\'éteint', q.suivi(), null);
}

log('\n=== ◎ HORS PASSE, ET ◎ POUR UN PASSAGER ===');
{
  const m = await mondeAvecPoint({ utilisateur: LUC });
  m.tours(PASSAGER('p2')); m.bandeau(); m.carte.tirer('dragstart');
  m.run('window.centerUser()');
  eq('un passager touche ◎ pendant que son camion n\'est pas dessiné : il suit son propre point vert', m.suivi() && m.suivi().type, 'moi');
  m.run('window.centerUser()');
  m.camions([{ passe: 'p2', equipe: 'e2', nom: 'Camion 2', lat: 46.6, lon: -72.8 }]);
  m.run('window.centerUser()');
  eq('… et quand le camion est dessiné : il suit LE CAMION où il est à bord', m.suivi(), { type: 'camion', passeId: 'p2', auto: false, attache: true });
  const n = await mondeAvecPoint({ utilisateur: LUC });
  n.tours(CHAUFFEUR('p1')); n.camions([{ passe: 'p1', equipe: 'e1', nom: 'Camion 1', lat: 46.5, lon: -72.7 }]); n.bandeau(); n.run('window.centerUser()'); n.run('window.centerUser()');
  eq('le chauffeur, lui, suit toujours son propre point (même si son camion est dessiné)', n.suivi() && n.suivi().type, 'moi');
}

log('\n=== LA CARTE N\'EXISTE PAS ENCORE : LA PASSE N\'EST PAS « OUBLIÉE » ===');
{
  const m = monde();
  m.tours(CHAUFFEUR('p1')); m.bandeau();
  eq('ma passe est déjà là avant que la carte soit créée : rien ne plante, rien ne s\'allume', m.suivi(), null);
  m.initCarte(); await m.demarrerGps(); m.lectureCarte(46.5, -72.7, 8);
  m.bandeau();
  eq('… dès que la carte existe, le premier redessin allume le suivi (la passe n\'avait pas été marquée comme traitée)', m.suivi(), { type: 'moi', passeId: null, auto: true, attache: true });
}

log('\n=== UN POINT PAS ENCORE DESSINÉ : LE SUIVI ATTEND LA PREMIÈRE LECTURE ===');
{
  const m = monde(); m.initCarte();
  m.tours(CHAUFFEUR('p1')); m.bandeau();
  eq('ma passe commence avant la première lecture du GPS : le suivi attend', [m.suivi(), m.vues().length], [{ type: 'moi', passeId: null, auto: true, attache: false }, 0]);
  await m.demarrerGps(); m.lectureCarte(46.5, -72.7, 8);
  eq('la première lecture dessine le point : la carte s\'y attache et s\'y centre au zoom 16 (après le zoom 15 du premier point)', [m.suivi().attache, m.vues().map((a) => a.z)], [true, [15, 16]]);
  await m.horloge.avancer(1000); m.lectureFond(46.501, -72.7, 5); await m.horloge.avancer(1200);
  eq('… puis elle suit', m.carte.centre, [46.501, -72.7]);
}

// =====================================================================
log('\n=== LA FICHE D\'UN CLIENT MET LE SUIVI EN PAUSE, ET IL REPREND À SA FERMETURE ===');
{
  const STOPS = "stops = [{ id: 's1', adresse: '1 rue A', client: 'X', service: 't1', route_id: 'r1', lat: 46.52, lon: -72.72, actif: true }, { id: 's2', adresse: '2 rue B', client: 'Y', service: 't1', route_id: 'r1', lat: 46.53, lon: -72.73, actif: true }];";
  const m = await mondeAvecPoint(); const p = m.point();
  m.run(STOPS);
  m.run('window.centerUser()'); m.carte.appels.length = 0;
  m.run('openCard(0)');
  eq('ouvrir la fiche : le suivi se met en pause (bouton éteint), la carte va vers le client', [m.suivi(), m.suspendu(), m.allume(), m.carte.appels.map((a) => [a.f, a.ll])], [null, true, false, [['flyTo', [46.52, -72.72]]]]);
  eq('… le point ne pilote plus la carte pendant la fiche', p.nbEcouteurs('move'), 1);
  m.carte.appels.length = 0;
  await m.horloge.avancer(1000); m.lectureFond(46.502, -72.7, 5); await m.horloge.avancer(1200);
  eq('… la carte reste sur le client', m.carte.appels.length, 0);
  m.run('closeCard()');
  eq('fermer la fiche : le suivi REPREND (bouton allumé), la carte revient sur mon point, AU ZOOM D\'AVANT LA FICHE (elle l\'avait rapprochée à 17)', [m.suivi() && m.suivi().type, m.suspendu(), m.allume(), m.carte.appels.map((a) => [a.f, a.ll, a.z])], ['moi', false, true, [['setView', [46.502, -72.7], 16]]]);
  m.run('window.centerUser()'); m.carte.zoom = 18; m.run('window.centerUser()');   // (éteint, puis rallumé à 18)
  m.run('openCard(0)'); m.carte.appels.length = 0; m.run('closeCard()');
  eq('… un zoom plus rapproché (18) est retrouvé lui aussi', m.carte.appels.map((a) => [a.f, a.z]), [['setView', 18]]);
  m.carte.zoom = 14;   // la personne a éloigné la carte en pinçant, tout en suivant
  m.run('openCard(0)'); m.carte.appels.length = 0; m.run('closeCard()');
  eq('… et un zoom volontairement éloigné (14) aussi : le suivi ne le remonte pas de force', m.carte.appels.map((a) => [a.f, a.z]), [['setView', 14]]);

  m.run('openCard(1)'); m.carte.tirer('dragstart'); m.carte.appels.length = 0;
  m.run('closeCard()');
  eq('déplacer la carte PENDANT la fiche : le suivi ne reprend pas à la fermeture', [m.suivi(), m.suspendu(), m.carte.appels.length], [null, false, 0]);

  m.run('window.centerUser()'); m.run('openCard(0)'); m.run('window.centerUser()');
  eq('toucher ◎ pendant la fiche : le suivi s\'allume tout de suite (choix explicite)', [m.suivi() && m.suivi().type, m.suspendu()], ['moi', false]);
  m.run('closeCard()');
  eq('… et fermer la fiche ne change rien de plus', m.suivi() && m.suivi().type, 'moi');

  m.run('window.centerUser()'); m.carte.appels.length = 0;
  m.run('openCard(0)'); m.run('closeCard()');
  eq('rien n\'est suivi : ouvrir puis fermer la fiche n\'allume rien', [m.suivi(), m.allume(), m.suspendu()], [null, false, false]);

  m.run('openCard(0)'); m.run('openCard(1)'); m.run('closeCard()');
  eq('changer de fiche sans la fermer (toucher un autre client) : rien de spécial', m.suivi(), null);

  const a = await mondeAvecPoint({ utilisateur: LUC });
  a.run(STOPS); a.tours(CHAUFFEUR('p1')); a.bandeau();
  a.run('openCard(0)');
  a.tours([]); a.bandeau();
  a.run('closeCard()');
  eq('ma passe finit PENDANT la fiche (suivi tout seul en pause) : il ne reprend pas à la fermeture', [a.suivi(), a.suspendu()], [null, false]);

  const a2 = await mondeAvecPoint({ utilisateur: LUC });
  a2.run(STOPS); a2.tours(CHAUFFEUR('p1')); a2.bandeau();
  a2.run('openCard(0)'); a2.run('closeCard()');
  eq('une fiche ouverte puis fermée pendant un suivi allumé tout seul : il reprend, et reste « automatique »', a2.suivi() && a2.suivi().auto, true);
  a2.tours([]); a2.bandeau();
  eq('… il s\'éteint donc quand la passe finit', a2.suivi(), null);

  const b = await mondeAvecPoint({ utilisateur: JOE });
  b.run(STOPS);
  b.tours([TOUR([PASSE('p-marc', 'e2', { chauffeur_id: 'u-marc' })])]);
  b.camions([{ passe: 'p-marc', equipe: 'e2', nom: 'Camion 2', lat: 46.6, lon: -72.8 }]);
  b.run("basculerSuiviCamion('p-marc')"); b.run('openCard(0)');
  b.camions([]); b.run('closeCard()');
  eq('le camion suivi disparaît PENDANT la fiche : le suivi ne reprend pas (il n\'y a plus de camion)', [b.suivi(), b.suspendu()], [null, false]);
}

// =====================================================================
log('\n=== L\'ADMINISTRATEUR : « 📌 SUIVRE CE CAMION » DANS LA BULLE DU CAMION ===');
{
  const CAMION = [{ passe: 'p-marc', equipe: 'e2', nom: 'Camion 2', lat: 46.6, lon: -72.8 }];
  const e = await mondeAvecPoint({ utilisateur: LUC });
  e.tours([TOUR([PASSE('p-marc', 'e2', { chauffeur_id: 'u-marc' })])]); e.camions(CAMION);
  vrai('un EMPLOYÉ ne voit pas le bouton dans la bulle du camion (demande de Joé : administrateur seulement)', !e.camion('p-marc').popup.includes('camion-suivre'), e.camion('p-marc').popup);
  e.run("basculerSuiviCamion('p-marc')");
  eq('… et même s\'il appelait la fonction, rien ne se passe', e.suivi(), null);

  const m = await mondeAvecPoint({ utilisateur: JOE }); const p = m.point();
  m.tours([TOUR([PASSE('p-marc', 'e2', { chauffeur_id: 'u-marc' })])]); m.camions(CAMION);
  const html = m.camion('p-marc').popup;
  vrai('l\'administrateur voit le bouton « 📌 Suivre ce camion » dans la bulle du camion', html.includes('class="camion-suivre"') && html.includes('📌 Suivre ce camion'), html);
  vrai('… relié à basculerSuiviCamion, l\'identifiant passe par data-passe (du TEXTE, jamais du code)', html.includes('data-passe="p-marc"') && html.includes('onclick="basculerSuiviCamion(this.dataset.passe)"'), html);
  m.carte.appels.length = 0;
  m.run("basculerSuiviCamion('p-marc')");
  eq('toucher le bouton : la carte suit CE camion (manuel), centrée dessus au zoom 16', [m.suivi(), m.vues().map((a) => [a.ll, a.z])], [{ type: 'camion', passeId: 'p-marc', auto: false, attache: true }, [[[46.6, -72.8], 16]]]);
  eq('… le bouton ◎ s\'allume', m.allume(), true);
  eq('… PENDANT le toucher la bulle n\'est pas remplacée (Leaflet la fermerait : il ne reconnaîtrait plus un toucher venu de la bulle)', m.camion('p-marc').popupMaj, 0);
  await m.horloge.avancer(0);
  vrai('… elle est mise à jour juste APRÈS le toucher : le texte du bouton devient « ⏹ Ne plus suivre ce camion »', m.camion('p-marc').popup.includes('⏹ Ne plus suivre ce camion') && !m.camion('p-marc').popup.includes('📌 Suivre ce camion'), m.camion('p-marc').popup);
  m.carte.appels.length = 0;
  await m.horloge.avancer(3000);
  m.camions([{ ...CAMION[0], lat: 46.603 }]);
  await m.horloge.avancer(3200);
  eq('le camion avance : la carte le suit jusqu\'au bout', m.carte.centre, [46.603, -72.8]);
  m.run("basculerSuiviCamion('p-marc')");
  await m.horloge.avancer(0);
  eq('retoucher le bouton : le suivi s\'arrête, le texte revient', [m.suivi(), m.camion('p-marc').popup.includes('📌 Suivre ce camion'), m.allume()], [null, true, false]);
  m.carte.appels.length = 0;
  await m.horloge.avancer(3000);
  m.camions([{ ...CAMION[0], lat: 46.606 }]);
  await m.horloge.avancer(3200);
  eq('… et la carte ne suit plus', m.carte.appels.length, 0);

  // suivre un autre camion remplace le premier (un seul suivi à la fois)
  const AUTRE = [{ passe: 'p-a', equipe: 'e1', nom: 'Camion 1', lat: 46.7, lon: -72.9 }, { passe: 'p-b', equipe: 'e3', nom: 'Camion 3', lat: 46.8, lon: -73 }];
  m.tours([TOUR([PASSE('p-a', 'e1'), PASSE('p-b', 'e3')])]); m.camions(AUTRE);
  m.run("basculerSuiviCamion('p-a')"); m.run("basculerSuiviCamion('p-b')"); await m.horloge.avancer(0);
  eq('suivre un autre camion remplace le premier : un seul suivi à la fois', m.suivi(), { type: 'camion', passeId: 'p-b', auto: false, attache: true });
  eq('… le premier camion n\'est plus relié à la carte, le second oui', [m.camion('p-a').nbEcouteurs('move'), m.camion('p-b').nbEcouteurs('move')], [0, 1]);
  // un AUTRE camion qui apparaît, ou qui disparaît, ne dérange pas le suivi
  m.carte.appels.length = 0;
  const TROIS = [...AUTRE, { passe: 'p-c', equipe: 'e4', nom: 'Camion 4', lat: 46.9, lon: -73.1 }];
  m.tours([TOUR([PASSE('p-a', 'e1'), PASSE('p-b', 'e3'), PASSE('p-c', 'e4')])]); m.camions(TROIS);
  eq('un autre camion apparaît : la carte suivie ne saute pas vers lui (aucune nouvelle vue demandée)', [m.vues().length, m.suivi() && m.suivi().passeId], [0, 'p-b']);
  m.camions([AUTRE[1]]);
  eq('deux AUTRES camions disparaissent : on suit toujours celui-là', [m.suivi() && m.suivi().passeId, m.camion('p-b').nbEcouteurs('move'), m.allume()], ['p-b', 1, true]);
  m.carte.tirer('dragstart');
  eq('la main sur la carte arrête le suivi d\'un camion aussi', [m.suivi(), m.camion('p-b').nbEcouteurs('move')], [null, 0]);

  // la bulle ouverte n'est redessinée QUE si son texte change (un toucher sur son bouton ne doit pas être perdu par un redessin au même instant)
  const y = await mondeAvecPoint({ utilisateur: JOE });
  y.tours([TOUR([PASSE('p-marc', 'e2', { chauffeur_id: 'u-marc' })])]); y.camions(CAMION);
  const bulleAvant = y.camion('p-marc').popup;
  y.camions(CAMION); y.camions(CAMION);
  eq('les positions sont relues (toutes les 3 s) sans que rien ne change : la bulle n\'est PAS redessinée', [y.camion('p-marc').popupMaj, y.camion('p-marc').popup === bulleAvant], [0, true]);
  y.run("basculerSuiviCamion('p-marc')");
  await y.horloge.avancer(0);
  eq('… mais elle l\'est quand son texte change (le bouton devient « Ne plus suivre »)', [y.camion('p-marc').popupMaj, y.camion('p-marc').popup.includes('⏹ Ne plus suivre ce camion')], [1, true]);
  y.tours([TOUR([PASSE('p-marc', 'e2', { chauffeur_id: 'u-marc' })], { faits: 2, pourcentage: 50 })]); y.camions(CAMION);
  eq('… et elle l\'est aussi quand l\'avancement change (50 %)', [y.camion('p-marc').popupMaj, y.camion('p-marc').popup.includes('(50 %)')], [2, true]);

  // un identifiant piégé
  const x = await mondeAvecPoint({ utilisateur: JOE });
  x.tours([TOUR([PASSE('p"><img src=x onerror=alert(1)>', 'e2')])]);
  x.camions([{ passe: 'p"><img src=x onerror=alert(1)>', equipe: 'e2', nom: 'Camion 2', lat: 46.6, lon: -72.8 }]);
  const h = x.camion('p"><img src=x onerror=alert(1)>').popup;
  vrai('un identifiant de passe piégé reste du TEXTE dans la bulle (aucun code exécuté)', !h.includes('<img') && h.includes('data-passe="p&quot;&gt;&lt;img'), h);
}

// =====================================================================
log('\n=== CARTE.JS, POSITION.JS ET LE RESTE DU CÂBLAGE ===');
{
  const page = lire('index.html'), carte = lire('js/carte.js'), pos = lire('js/position.js'), arr = lire('js/arrets.js'), pas = lire('js/passe.js'), veh = lire('js/vehicules.js'), lst = lire('js/liste-arrets.js'), css = lire('css/style.css');
  const btn = /<button class="ctrl" id="btn-suivi" type="button" onclick="centerUser\(\)" aria-label="[^"]+" aria-pressed="false"[^>]*>◎<\/button>/;
  vrai('la page a le bouton ◎ (id btn-suivi, relié à centerUser(), aria-pressed), entre 🗺 et 🛣', btn.test(page) && page.indexOf('id="btn-map"') < page.indexOf('id="btn-suivi"') && page.indexOf('id="btn-suivi"') < page.indexOf('id="btn-trace"'));
  vrai('la page charge suivi-carte.js après vehicules.js et avant demarrage.js', page.indexOf('js/vehicules.js') < page.indexOf('js/suivi-carte.js') && page.indexOf('js/suivi-carte.js') < page.indexOf('js/demarrage.js'));
  vrai('◎ (centerUser) allume/éteint le suivi de la carte : plus de recentrage unique', /window\.centerUser=function\(\)\{basculerSuiviCarte\(\);\};/.test(carte) && !/window\.centerUser=[^\n]*flyTo/.test(carte));
  vrai('carte.js ne déplace plus le point vert à la main (il glisse par majPointVert) : plus de setLatLng([lat,lon]) dans la lecture du GPS', !/_uMk\.setLatLng\(\[lat,lon\]\)/.test(carte) && !/_uCk\.setLatLng\(\[lat,lon\]\)/.test(carte));
  vrai('… le cercle de précision suit le point par l\'événement « move »', /_uMk\.on\('move',e=>window\._uCk\.setLatLng\(e\.latlng\)\)/.test(carte));
  vrai('… et le suivi de la carte est prévenu quand le point vert est dessiné', /suiviMarqueurCree\(\)/.test(carte));
  vrai('position.js : CHAQUE lecture (noterPosition) fait glisser le point vert (majPointVert), avec son heure', /if\(typeof majPointVert==='function'\) majPointVert\(lat,lon,lastPosInfo\.precision,t\);/.test(pos));
  vrai('arrets.js : ouvrir une fiche met le suivi en pause AVANT que la carte s\'envole vers le client', /suspendreSuiviCarte\(\);[^\n]*\n\s*map\.flyTo\(\[s\.lat,s\.lon\]/.test(arr));
  vrai('arrets.js : fermer la fiche reprend le suivi', /function closeCard\(\)\{[^}]*reprendreSuiviCarte\(\)/s.test(arr));
  vrai('liste-arrets.js : ajouter un arrêt arrête le suivi AVANT que la carte s\'envole vers lui', /arreterSuiviCarte\(\);[^\n]*\n\s*map\.flyTo\(\[saved\.lat,saved\.lon\]/.test(lst));
  vrai('placement.js : « Placer sur la carte » (4 points touchés) arrête le suivi : la carte ne bouge pas toute seule pendant qu\'on touche ses coins', /function activerPlacement\(\)\{\s*if\(typeof arreterSuiviCarte==='function'\) arreterSuiviCarte\(\);/.test(lire('js/placement.js')));
  vrai('vehicules.js : la bulle d\'un camion n\'est redessinée que si son texte change', /if\(m\._bulleHtml!==bulle\)\{m\._bulleHtml=bulle;m\.setPopupContent\(bulle\);\}/.test(veh));
  vrai('suivi-carte.js : la bulle est rafraîchie APRÈS le toucher (setTimeout), jamais pendant : Leaflet fermerait la bulle (essai réel dans le vrai Leaflet)', /if\(typeof majVehicules==='function'\) setTimeout\(majVehicules,0\);/.test(lire('js/suivi-carte.js')));
  vrai('passe.js : chaque redessin du bandeau de la passe met le suivi au diapason de ma passe', /function majBandeauPasse\(\)\{\s*const b=document\.getElementById\('passe-bandeau'\);\s*if\(!b\) return;\s*if\(typeof majSuiviSelonPasse==='function'\) majSuiviSelonPasse\(\);/.test(pas));
  vrai('vehicules.js : un camion dessiné prévient le suivi ; un camion retiré aussi', /suiviMarqueurCree\(\);/.test(veh) && /suiviCamionRetire\(id\);/.test(veh));
  vrai('la feuille de style a le bouton de la bulle (40 px de haut) ; l\'état « allumé » de ◎ réutilise .ctrl.on', /\.camion-suivre\{[^}]*min-height:40px/.test(css) && /\.ctrl\.on\{/.test(css));

  // Aucun autre fichier ne déplace la carte : un futur code qui le ferait devrait arrêter le suivi (sinon la carte et le suivi se battent)
  const fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const deplacent = fichiers.filter((f) => /\bmap\.(flyTo|setView|fitBounds|panTo|panBy|flyToBounds|setZoom|zoomIn|zoomOut|setMaxBounds)\(/.test(lire('js/' + f)));
  eq('seuls carte.js (premier point), arrets.js (fiche), liste-arrets.js (nouvel arrêt) et suivi-carte.js déplacent la carte : un nouveau code qui la déplacerait doit arrêter ou suspendre le suivi', deplacent.sort(), ['arrets.js', 'carte.js', 'liste-arrets.js', 'suivi-carte.js']);
}

log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
