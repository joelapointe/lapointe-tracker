// Demande 2 de Joé (29 sept. 2026) — L'ICÔNE D'UN CAMION SUIT SA TÂCHE (www/js/icones-taches.js, vehicules.js, carte.js, liste-arrets.js, hors-reseau.js, admin-types-service.js, index.html, style.css).
// Décisions de Joé : (1) les icônes sont liées aux TÂCHES (types de service), pas au véhicule conduit ; (2) une BANQUE d'icônes, l'administrateur choisit celle de chaque tâche ;
// (3) UN SEUL marqueur pendant MA passe (mon camion à ma position remplace le point vert) ; un passager garde son point vert. Ses retouches : feuille d'ÉRABLE pour les feuilles, brouette
// et râteau pour l'entretien paysager, souffleuse À CHENILLES (comme une Honda HSS928) pour le déneigement manuel.
// Les VRAIS fichiers de l'application sont chargés dans un faux navigateur (fausse carte Leaflet, faux Supabase pour types_service, horloge fausse). Ce que ce test ne peut PAS vérifier :
// l'aspect réel des dessins et de la fenêtre de choix (essayés dans la vraie Leaflet et regardés à l'œil) et l'effet sur un vrai téléphone (l'essai de Joé).
// WWW_TEST : un autre dossier « www » (erreurs volontaires : voir erreurs-volontaires.mjs).
import vm from 'vm';
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));
const SQL27 = fs.readFileSync(fileURLToPath(new URL('../27-icones-des-taches.sql', import.meta.url)), 'utf8');

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const lire = (f) => fs.readFileSync(WWW + f, 'utf8');

const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' }, JOE = { id: 'u-joe', nom: 'Joé', role: 'admin' };
const T0 = 1_800_000_000_000;

function horlogeFausse(depart) {
  let t = depart, seq = 0;
  const taches = [];
  const retirer = (id) => { const i = taches.findIndex((x) => x.id === id); if (i >= 0) taches.splice(i, 1); };
  return {
    now: () => t,
    setInterval: (fn, ms) => { const id = ++seq; taches.push({ id, fn, ms, prochain: t + ms }); return id; },
    setTimeout: (fn, ms) => { const id = ++seq; taches.push({ id, fn, ms, prochain: t + (ms || 0), unique: true }); return id; },
    clearInterval: retirer, clearTimeout: retirer,
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

const FICHIERS = ['js/config.js', 'js/position.js', 'js/utilitaires.js', 'js/hors-reseau.js', 'js/file-attente.js', 'js/carte.js', 'js/tours.js', 'js/icones-taches.js', 'js/vehicules.js', 'js/suivi-carte.js',
  'js/equipage.js', 'js/equipage-panneau.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/problemes.js', 'js/photos.js', 'js/liste-arrets.js', 'js/admin-types-service.js'];
const TYPES_DEPART = [
  { id: 'ts-1', nom: 'Déneigement mécanique', actif: true, icone: null }, { id: 'ts-2', nom: 'Déneigement manuel', actif: true, icone: null },
  { id: 'ts-3', nom: 'Épandage de sel', actif: true, icone: null }, { id: 'ts-4', nom: 'Entretien paysager', actif: true, icone: null },
  { id: 'ts-5', nom: 'Coupe de gazon', actif: true, icone: null }, { id: 'ts-6', nom: 'Engrais', actif: true, icone: null },
  { id: 'ts-7', nom: 'Ramassage de feuilles', actif: true, icone: null }, { id: 'ts-8', nom: 'Autre', actif: true, icone: null },
];
const PASSE = (id, equipe, o = {}) => ({ passe_id: id, equipe_id: equipe, chauffeur_id: 'u-x', je_suis_chauffeur: false, je_suis_a_bord: false, ...o });
const TOUR = (passes, o = {}) => ({ route_id: 'r1', tache: 'Coupe de gazon', numero: 1, en_cours: true, total: 4, faits: 1, pourcentage: 25, arrets_faits: [], passes, ...o });

function monde(o = {}) {
  const horloge = horlogeFausse(T0);
  class DateFausse extends Date { constructor(...a) { if (a.length) super(...a); else super(horloge.now()); } static now() { return horloge.now(); } }
  const els = {};
  const creer = (id) => {
    const classes = new Set();
    const e = { id, children: [], style: {}, textContent: '', _html: '', value: '', disabled: false, className: '', onclick: null, attrs: {}, dataset: {},
      classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k]; }, focus() {}, remove() {}, querySelector() { return null; }, addEventListener() {} };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (v === '') this.children = []; } });
    return e;
  };
  const el = (id) => (els[id] ??= creer(id));

  const marqueurs = [];
  const faireMarqueur = (ll, opts) => {
    const ecout = {};
    const m = { ll: [ll[0], ll[1]], icone: opts && opts.icon, popup: null, popupLie: 0, popupDelie: 0, iconeMaj: 0, retire: false,
      addTo() { return m; }, getLatLng() { return m.ll; },
      setLatLng(p) { m.ll = [p[0], p[1]]; (ecout.move ?? []).slice().forEach((f) => f({ latlng: m.ll })); return m; },
      on(t, f) { const l = (ecout[t] ??= []); if (!l.includes(f)) l.push(f); return m; }, off(t, f) { ecout[t] = (ecout[t] ?? []).filter((x) => x !== f); return m; },
      setIcon(i) { m.icone = i; m.iconeMaj++; return m; },
      bindPopup(h) { m.popup = h; m.popupLie++; return m; }, setPopupContent(h) { m.popup = h; return m; }, unbindPopup() { m.popup = null; m.popupDelie++; return m; } };
    marqueurs.push(m);
    return m;
  };
  const carte = { zoom: 14, centre: [46.55, -72.75], ecout: {},
    on(t, f) { (carte.ecout[t] ??= []).push(f); return carte; }, off() { return carte; },
    getZoom: () => carte.zoom, getCenter: () => carte.centre, getContainer: () => ({ style: {} }),
    setView(ll, z) { carte.centre = [ll[0], ll[1]]; if (z !== undefined) carte.zoom = z; return carte; }, panTo(ll) { carte.centre = [ll[0], ll[1]]; return carte; },
    flyTo(ll, z) { carte.centre = [ll[0], ll[1]]; carte.zoom = z; return carte; }, removeLayer(m) { m.retire = true; }, addLayer() {} };
  const L = { divIcon: (opt) => opt, marker: faireMarqueur, polygon: () => ({ addTo() { return this; } }),
    circle: (ll, opts) => { const c = { ll, rayon: opts.radius, addTo() { return c; }, setLatLng(p) { c.ll = p; return c; }, setRadius(r) { c.rayon = r; return c; } }; return c; },
    map: () => carte, tileLayer: () => ({ addTo() { return this; } }), layerGroup: () => ({ addTo() { return this; } }) };

  // Le faux serveur : SEULE la table types_service est lue et modifiée ici
  const donnees = { types_service: (o.types ?? TYPES_DEPART).map((t) => ({ ...t })) };
  const appels = { selects: [], eq: [], ecritures: [] };
  const fauxDb = {
    channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
    rpc: async () => ({ data: null, error: null }),
    auth: { onAuthStateChange() {}, getSession: async () => ({ data: { session: null } }), signOut: async () => ({}) },
    from: (table) => {
      const q = { op: 'select', cols: null, filtres: [] };
      q.select = (c) => { q.cols = c; appels.selects.push([table, c]); return q; };
      q.eq = (c, v) => { q.filtres.push([c, v]); appels.eq.push([table, c, v]); return q; };
      q.order = () => q;
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.then = (ok_, ko_) => Promise.resolve().then(async () => {
        if (o.panneReseau?.()) throw new TypeError('Failed to fetch');
        if (q.op === 'select') {
          if (o.sansColonneIcone && /icone/.test(q.cols || '')) return { data: null, error: { code: '42703', message: 'column types_service.icone does not exist' } };
          if (o.erreurLecture) return { data: null, error: { message: 'lecture refusée' } };
          let lignes = donnees[table].map((x) => ({ ...x }));
          q.filtres.forEach(([c, v]) => { lignes = lignes.filter((l) => l[c] === v); });
          const cols = String(q.cols || '*').split(',').map((s) => s.trim());
          if (!cols.includes('*')) lignes = lignes.map((l) => Object.fromEntries(cols.map((c) => [c, l[c]])));
          return { data: lignes, error: null };
        }
        appels.ecritures.push({ table, op: 'update', valeur: q.valeur, filtres: q.filtres });
        if (o.erreurEcriture) return { data: null, error: o.erreurEcriture };
        const cible = donnees[table].find((x) => q.filtres.every(([c, v]) => x[c] === v));
        if (cible) Object.assign(cible, q.valeur);
        return { data: null, error: null };
      }).then(ok_, ko_);
      return q;
    },
  };

  const lecturesGps = { ok: null };
  const toasts = [];
  const stockage = {};
  const sandbox = {
    document: { getElementById: el, createElement: () => creer(null), body: creer('body'), addEventListener() {}, removeEventListener() {} },
    localStorage: { getItem: (k) => (k in stockage ? stockage[k] : null), setItem: (k, v) => { stockage[k] = String(v); }, removeItem: (k) => { delete stockage[k]; } },
    window: {}, navigator: { geolocation: { watchPosition: (ok_) => { lecturesGps.ok = ok_; return 1; } } },
    L, supabase: { createClient: () => fauxDb },
    setTimeout: horloge.setTimeout, clearTimeout: horloge.clearTimeout, setInterval: horloge.setInterval, clearInterval: horloge.clearInterval, Date: DateFausse, console,
    fetch: async () => ({ json: async () => ({ address: { road: 'Rue Test' } }) }), crypto: { randomUUID: () => 'x' },
    setStatus() {}, hideLoading() {}, showErr() {}, __toasts: toasts,
  };
  const ctx = vm.createContext(sandbox);
  for (const f of FICHIERS) vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext(`var restaurerSession = function () {}; toast = (m) => { __toasts.push(m); }; afficherResume = async () => {}; currentUser = ${JSON.stringify(o.utilisateur ?? JOE)};`, ctx);
  vm.runInContext('initApp()', ctx);   // la carte fausse (map), le faux serveur (db), ◎, le suivi du GPS

  const w = { ctx, el, carte, marqueurs, toasts, horloge, donnees, appels,
    run: (c) => vm.runInContext(c, ctx),
    demarrerGps: () => vm.runInContext('window.demarrerSuiviGps()', ctx),
    point: () => vm.runInContext('window._uMk', ctx),
    lectureCarte: (lat, lon, precision = 8) => lecturesGps.ok({ coords: { latitude: lat, longitude: lon, accuracy: precision }, timestamp: horloge.now() }),
    lectureFond: (lat, lon, precision = 5) => vm.runInContext(`noterPosition(${lat}, ${lon}, ${precision}, ${horloge.now()})`, ctx),
    tours: (l) => vm.runInContext('tours = ' + JSON.stringify(l) + ';', ctx),
    camions: (l) => {   // les positions que le SERVEUR connaît : {passe, equipe, nom, lat, lon}
      const maintenant = new Date(horloge.now()).toISOString();
      vm.runInContext(`positionsVehicules = ${JSON.stringify(l.map((c) => ({ passe_id: c.passe, lat: c.lat, lon: c.lon, precision_m: 5, maj_le: maintenant })))};
        nomsVehicules = Object.assign(nomsVehicules, ${JSON.stringify(Object.fromEntries(l.map((c) => [c.equipe, c.nom])))});`, ctx);
    },
    majVehicules: () => vm.runInContext('majVehicules()', ctx),
    camion: (id) => vm.runInContext(`marqueursVehicules[${JSON.stringify(id)}] || null`, ctx),
    idsCamions: () => vm.runInContext('Object.keys(marqueursVehicules)', ctx),
    svg: (cle, classe) => vm.runInContext(`svgIcone(${JSON.stringify(cle)}, ${classe === undefined ? 'undefined' : JSON.stringify(classe)})`, ctx),
    par: (cle) => vm.runInContext(`ICONES_TACHES[${JSON.stringify(cle)}].svg`, ctx),
    dernierToast: () => toasts[toasts.length - 1],
    // l'onglet « Services » : ses lignes
    lignes: () => el('admin-body').children.filter((c) => c.className === 'emp-item'),
    ligne: (nom) => el('admin-body').children.find((c) => c.className === 'emp-item' && c.children[0].children[0].textContent === nom),
    ouvert: () => el('icone-tache-overlay').classList.contains('open'),
    tuiles: () => el('it-grille').children,
  };
  return w;
}
async function mondeAvecPoint(o = {}) {
  const m = monde(o);
  await m.demarrerGps();
  m.lectureCarte(46.5, -72.7, 8);
  return m;
}
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

// =====================================================================
log('=== LA BANQUE D\'ICÔNES : 13 DESSINS, CLÉS SÛRES, AUCUN CODE ===');
{
  const m = monde();
  const cles = m.run('clesIcones()');
  eq('la banque contient 13 icônes', cles.length, 13);
  eq('… celles que Joé a demandées y sont : tracteur, zéro-turn, tondeuse, épandeur, camion, feuille d\'érable, brouette et râteau, souffleuse à chenilles', ['tracteur', 'zero-turn', 'tondeuse', 'epandeur', 'camion-benne', 'feuille-erable', 'paysager', 'souffleuse'].every((c) => cles.includes(c)), true);
  const regleSql = new RegExp(SQL27.match(/icone ~ '([^']+)'/)[1]);
  eq('chaque clé respecte LA MÊME règle que la base (lue dans le fichier SQL 27)', cles.filter((c) => !regleSql.test(c)), []);
  eq('la règle du fichier SQL est bien « minuscules, chiffres, tirets, 1 à 30 »', regleSql.source, '^[a-z0-9-]{1,30}$');
  eq('les noms affichés sont tous remplis et différents', new Set(cles.map((c) => m.run(`nomIcone(${JSON.stringify(c)})`))).size, 13);
  eq('la feuille s\'appelle « Feuille d\'érable » (comme Joé l\'a dit), la brouette « Brouette et râteau »', [m.run(`nomIcone('feuille-erable')`), m.run(`nomIcone('paysager')`)], ['Feuille d’érable', 'Brouette et râteau']);
  const permis = /^(<(circle|path|rect|g)( (cx|cy|r|d|x|y|width|height|rx|transform|class)="[^"<>]*")*\/?>|<\/g>)+$/;
  for (const c of cles) {
    const corps = m.par(c);
    vrai(`« ${c} » : seulement des formes dessinées (cercle, tracé, rectangle, groupe) — ni script, ni lien, ni style, ni couleur écrite en dur`, permis.test(corps) && !/<script|on\w+=|href|style=|#[0-9a-f]{3,6}|fill=|stroke=/i.test(corps), corps.slice(0, 80));
    eq(`« ${c} » : les classes ne sont que ico-f (fond d'une roue) et ico-p (point plein)`, [...corps.matchAll(/class="([^"]*)"/g)].map((x) => x[1]).filter((k) => k !== 'ico-f' && k !== 'ico-p'), []);
    eq(`« ${c} » : les groupes sont bien fermés`, (corps.match(/<g[ >]/g) || []).length, (corps.match(/<\/g>/g) || []).length);
  }
  const s = m.svg('tracteur');
  eq('svgIcone : un SVG en ligne de 48 × 32, décoratif (aria-hidden), qui prend la couleur du texte', [s.startsWith('<svg class="ico" viewBox="0 0 48 32" aria-hidden="true" focusable="false">'), s.endsWith('</svg>'), s.includes(m.par('tracteur'))], [true, true, true]);
  eq('… avec une classe de l\'appelant', m.svg('tracteur', 'camion-ico').startsWith('<svg class="ico camion-ico" '), true);
  for (const inconnue of ['nimporte-quoi', 'constructor', '__proto__', 'toString', '', null, undefined, 42]) {
    const r = m.run(`svgIcone(${JSON.stringify(inconnue)})`);
    eq(`une clé inconnue (${JSON.stringify(inconnue)}) donne l'icône générique (véhicule), jamais une erreur`, r, m.svg('vus'));
  }
  eq('estCleIcone refuse ce qui n\'est pas une clé de la banque (noms hérités de JavaScript compris)', ['constructor', '__proto__', 'hasOwnProperty', 'Tracteur', 'tracteur ', null, 3].map((c) => m.run(`estCleIcone(${JSON.stringify(c)})`)), [false, false, false, false, false, false, false]);
  eq('… et accepte les vraies', clesIcones13(m).every((c) => m.run(`estCleIcone(${JSON.stringify(c)})`)), true);
}
function clesIcones13(m) { return m.run('clesIcones()'); }

log('\n=== L\'ICÔNE DÉDUITE DU NOM D\'UNE TÂCHE (tant que l\'administrateur n\'en a pas choisi) ===');
{
  const m = monde();
  const par = (nom) => m.run(`iconeParNom(${JSON.stringify(nom)})`);
  const attendus = [['Déneigement mécanique', 'tracteur'], ['Déneigement manuel', 'souffleuse'], ['Épandage de sel', 'camion-benne'], ['Entretien paysager', 'paysager'],
    ['Coupe de gazon', 'zero-turn'], ['Engrais', 'epandeur'], ['Ramassage de feuilles', 'feuille-erable'], ['Autre', 'vus']];
  for (const [nom, cle] of attendus) eq(`« ${nom} » → ${cle}`, par(nom), cle);
  eq('les majuscules et les accents n\'y changent rien', [par('DÉNEIGEMENT MANUEL'), par('deneigement manuel'), par('ÉPANDAGE DE SEL'), par('epandage de sel'), par('COUPE DE GAZON')], ['souffleuse', 'souffleuse', 'camion-benne', 'camion-benne', 'zero-turn']);
  eq('des variantes de noms que Joé pourrait créer', [par('Tonte de pelouse'), par('Épandage d\'engrais'), par('Ramassage des feuilles d\'automne'), par('Entretien des plates-bandes'), par('Taille de haies'), par('Déneigement des toits'), par('Déglaçage'), par('Épandage de sable')],
    ['zero-turn', 'epandeur', 'feuille-erable', 'paysager', 'paysager', 'tracteur', 'camion-benne', 'camion-benne']);
  eq('un nom inconnu, vide ou absent → l\'icône générique', [par('Nettoyage de vitres'), par(''), par(null), par(undefined), par('__proto__')], ['vus', 'vus', 'vus', 'vus', 'vus']);
  eq('« sel » est un MOT (« sélection », « salle » ne sont pas du sel)', [par('Sélection'), par('Salle')], ['vus', 'vus']);
  eq('le sel passe avant « épandage » (le sel se répand avec un camion, l\'engrais avec un épandeur)', [par('Épandage de sel'), par('Épandage')], ['camion-benne', 'epandeur']);
  eq('« déneigement manuel » (ou « à la pelle », « à la main ») passe avant « déneigement »', [par('Déneigement à la pelle'), par('Déneigement à la main'), par('Manuel : neige'), par('Déneigement')], ['souffleuse', 'souffleuse', 'souffleuse', 'tracteur']);
}

log('\n=== L\'ICÔNE CHOISIE PAR L\'ADMINISTRATEUR PASSE AVANT L\'ICÔNE DÉDUITE ===');
{
  const m = monde();
  const de = (t) => m.run(`iconeDeTache(${JSON.stringify(t)})`);
  eq('rien de choisi : l\'icône déduite du nom', [de('Coupe de gazon'), de('Épandage de sel')], ['zero-turn', 'camion-benne']);
  m.run(`installerIconesTaches([{nom:'Coupe de gazon',icone:'tondeuse'},{nom:'Épandage de sel',icone:'pickup-lame'}])`);
  eq('deux icônes choisies : elles gagnent', [de('Coupe de gazon'), de('Épandage de sel')], ['tondeuse', 'pickup-lame']);
  eq('… et seulement pour LEUR tâche (les autres restent déduites)', [de('Engrais'), de('Déneigement manuel')], ['epandeur', 'souffleuse']);
  m.run(`installerIconesTaches([{nom:'Coupe de gazon',icone:'cle-qui-nexiste-pas'},{nom:'Engrais',icone:null},{nom:'Autre'},null,{icone:'tracteur'},{nom:'__proto__',icone:'tracteur'}])`);
  eq('une clé inconnue, vide ou absente est ignorée : l\'icône déduite reprend', [de('Coupe de gazon'), de('Engrais'), de('Autre')], ['zero-turn', 'epandeur', 'vus']);
  eq('… un nom hérité de JavaScript ne donne rien de spécial', [de('__proto__'), de('constructor'), de('toString')], ['vus', 'vus', 'vus']);
  eq('… et seules les clés VALIDES sont retenues (rien d\'autre ne reste dans la mémoire des icônes choisies)', m.run('Object.keys(iconesTachesChoisies)'), []);
  m.run(`installerIconesTaches([{nom:'Coupe de gazon',icone:'tondeuse'},{nom:'Engrais',icone:'bidon'},{nom:'Autre',icone:'pelle'}])`);
  eq('une seule mémoire par tâche, seulement les clés valides', m.run('Object.keys(iconesTachesChoisies).sort()'), ['Autre', 'Coupe de gazon']);
  m.run(`iconesTachesChoisies = {'Coupe de gazon': 'cle-qui-nexiste-pas', 'Engrais': 42, 'Autre': 'pelle'}`);
  eq('même si la mémoire était abîmée (clé inconnue, nombre), l\'icône rendue est toujours une icône de la banque', [de('Coupe de gazon'), de('Engrais'), de('Autre')], ['zero-turn', 'epandeur', 'pelle']);
  m.run(`installerIconesTaches('pas une liste')`);
  eq('une liste absurde est ignorée (aucune icône choisie, aucune erreur)', [de('Coupe de gazon'), m.run('Object.keys(iconesTachesChoisies).length')], ['zero-turn', 0]);
}

log('\n=== LA LECTURE DES ICÔNES (chargerTypesService) : jamais bloquante, gardée pour le hors réseau ===');
{
  const types = TYPES_DEPART.map((t) => (t.nom === 'Coupe de gazon' ? { ...t, icone: 'tondeuse' } : t));
  const m = monde({ types });
  await m.run('chargerTypesService()');
  eq('elle lit le nom ET l\'icône des types ACTIFS seulement', [m.appels.selects.at(-1), m.appels.eq.some((e) => e[0] === 'types_service' && e[1] === 'actif' && e[2] === true)], [['types_service', 'nom, icone'], true]);
  eq('le menu de « ＋ Nouveau stop » a toujours ses 8 types', m.run('typesServiceActifs.length'), 8);
  eq('l\'icône choisie est connue de la carte', m.run(`iconeDeTache('Coupe de gazon')`), 'tondeuse');
  // la copie gardée sur le téléphone : une lecture qui échoue ensuite garde les dernières icônes
  m.run(`installerIconesTaches([])`);
  eq('(on efface ce que la carte savait)', m.run(`iconeDeTache('Coupe de gazon')`), 'zero-turn');
  await m.run('restaurerIconesTaches()');
  eq('la copie du téléphone rend l\'icône choisie (démarrage sans réseau)', m.run(`iconeDeTache('Coupe de gazon')`), 'tondeuse');

  // le fichier SQL 27 pas encore exécuté : la colonne n'existe pas
  const sans = monde({ types, sansColonneIcone: true });
  await sans.run('chargerTypesService()');
  eq('sans la colonne « icone » (SQL 27 pas encore exécuté) : elle relit les seuls noms, le menu marche, aucun message d\'erreur', [sans.appels.selects.map((s) => s[1]), sans.run('typesServiceActifs.length'), sans.toasts.length], [['nom, icone', 'nom'], 8, 0]);
  eq('… les icônes sont alors celles que les noms laissent deviner', sans.run(`iconeDeTache('Coupe de gazon')`), 'zero-turn');

  // le signal disparaît : les dernières icônes connues
  let panne = false;
  const p = monde({ types, panneReseau: () => panne });
  await p.run('chargerTypesService()');
  panne = true;
  p.run(`installerIconesTaches([])`);
  await p.run('chargerTypesService()');
  eq('sans réseau : le menu prend ses types par défaut ET les dernières icônes connues reviennent', [p.run(`iconeDeTache('Coupe de gazon')`), p.run('typesServiceActifs.length')], ['tondeuse', 8]);
  const l = monde({ erreurLecture: true });
  await l.run('chargerTypesService()');
  eq('une lecture refusée : rien ne plante, aucune icône choisie', [l.run(`iconeDeTache('Coupe de gazon')`), l.toasts.length], ['zero-turn', 0]);
}

// =====================================================================
log('\n=== SUR LA CARTE : LE CAMION PORTE L\'ICÔNE DE SA TÂCHE (plus le petit tracteur pour tout le monde) ===');
{
  const m = await mondeAvecPoint({ utilisateur: LUC });
  m.tours([TOUR([PASSE('p-a', 'e1', { chauffeur_id: 'u-marc' })], { tache: 'Déneigement mécanique' }), TOUR([PASSE('p-b', 'e2', { chauffeur_id: 'u-eric' })], { tache: 'Coupe de gazon', route_id: 'r2' }),
    TOUR([PASSE('p-c', 'e3', { chauffeur_id: 'u-nina' })], { tache: 'Épandage de sel', route_id: 'r3' }), TOUR([PASSE('p-d', 'e4', { chauffeur_id: 'u-lea' })], { tache: 'Truc que personne ne connaît', route_id: 'r4' })]);
  m.camions([{ passe: 'p-a', equipe: 'e1', nom: 'Camion 1', lat: 46.6, lon: -72.8 }, { passe: 'p-b', equipe: 'e2', nom: 'Zéro-turn 2', lat: 46.61, lon: -72.81 },
    { passe: 'p-c', equipe: 'e3', nom: 'Camion 3', lat: 46.62, lon: -72.82 }, { passe: 'p-d', equipe: 'e4', nom: 'Camion 4', lat: 46.63, lon: -72.83 }]);
  m.majVehicules();
  const html = (id) => m.camion(id).icone.html;
  eq('déneigement mécanique → le tracteur, dans l\'étiquette (avec le nom et le pourcentage)', [html('p-a').includes(m.svg('tracteur', 'camion-ico')), html('p-a').includes('Camion 1'), html('p-a').includes('25 %')], [true, true, true]);
  eq('coupe de gazon → le zéro-turn', html('p-b').includes(m.svg('zero-turn', 'camion-ico')), true);
  eq('épandage de sel → le camion', html('p-c').includes(m.svg('camion-benne', 'camion-ico')), true);
  eq('une tâche inconnue → l\'icône générique (véhicule)', html('p-d').includes(m.svg('vus', 'camion-ico')), true);
  eq('le petit tracteur 🚜 n\'est plus utilisé (ni dans l\'étiquette ni dans la bulle)', ['p-a', 'p-b', 'p-c', 'p-d'].map((id) => html(id).includes('🚜') || m.camion(id).popup.includes('🚜')), [false, false, false, false]);
  eq('la bulle porte la même icône, en petit, devant le nom du camion', m.camion('p-b').popup.startsWith('<b>' + m.svg('zero-turn', 'bulle-ico') + ' Zéro-turn 2</b>'), true);
  eq('l\'icône de l\'étiquette est un SVG dans une classe « camion-ico » (jamais dans un « span » : le style du nom s\'y appliquerait)', /<div class="camion">(<svg class="ico camion-ico"[^>]*>.*?<\/svg>)<span>/.test(html('p-a')), true);

  // l'administrateur choisit : les camions de cette tâche changent
  m.run(`installerIconesTaches([{nom:'Coupe de gazon',icone:'tondeuse'}])`);
  m.majVehicules();
  eq('quand l\'administrateur choisit la tondeuse pour « Coupe de gazon » : l\'étiquette ET la bulle du camion la montrent', [html('p-b').includes(m.svg('tondeuse', 'camion-ico')), m.camion('p-b').popup.includes(m.svg('tondeuse', 'bulle-ico'))], [true, true]);
  eq('… les camions des autres tâches ne changent pas', html('p-a').includes(m.svg('tracteur', 'camion-ico')), true);

  // un nom piégé reste du texte
  m.tours([TOUR([PASSE('p-a', 'e1', { chauffeur_id: 'u-marc' })], { tache: '<img src=x onerror=alert(1)>' })]);
  m.majVehicules();
  eq('une tâche au nom piégé : du TEXTE dans la bulle (aucun code exécuté), icône générique', [m.camion('p-a').popup.includes('<img'), m.camion('p-a').popup.includes('&lt;img src=x onerror=alert(1)&gt;'), html('p-a').includes(m.svg('vus', 'camion-ico'))], [false, true, true]);
}

// =====================================================================
log('\n=== UN SEUL MARQUEUR PENDANT MA PASSE : MON CAMION REMPLACE LE POINT VERT ===');
{
  const MOI = (id = 'p1', tache = 'Coupe de gazon') => TOUR([PASSE(id, 'e1', { chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true })], { tache });
  const m = await mondeAvecPoint({ utilisateur: LUC });
  const p = m.point();
  eq('sans passe : le point vert est un simple rond vert (comme avant)', [p.icone.html.includes('border-radius:50%'), p.iconeMaj, p.popup], [true, 0, null]);
  m.tours([MOI()]);
  m.majVehicules();
  eq('je conduis : le point devient MON CAMION (l\'icône de ma tâche, le nom du véhicule, l\'avancement) — le rond vert disparaît', [p.icone.html.includes(m.svg('zero-turn', 'camion-ico')), p.icone.html.includes('border-radius:50%'), p.icone.html.includes('25 %')], [true, false, true]);
  eq('… et aucun DEUXIÈME marqueur n\'est dessiné pour ma passe (le camion venu du serveur, en retard, n\'existe pas)', m.idsCamions(), []);
  eq('… la bulle de mon camion est rattachée au point (toucher mon camion l\'ouvre)', [p.popupLie, p.popup.includes('Chauffeur'), p.popup.includes(m.svg('zero-turn', 'bulle-ico'))], [1, true, true]);
  eq('… même pour l\'administrateur, ma bulle n\'a PAS de bouton « Suivre ce camion » (c\'est mon camion)', (() => { m.run(`currentUser = ${JSON.stringify(JOE)}`); m.tours([{ ...MOI(), passes: [PASSE('p1', 'e1', { chauffeur_id: 'u-joe', je_suis_chauffeur: true, je_suis_a_bord: true })] }]); m.majVehicules(); const r = p.popup.includes('camion-suivre'); m.run(`currentUser = ${JSON.stringify(LUC)}`); m.tours([MOI()]); m.majVehicules(); return r; })(), false);

  // le camion suit ma position exacte (le point continue de glisser à chaque lecture)
  await m.horloge.avancer(1000); m.lectureFond(46.501, -72.7, 5);
  await m.horloge.avancer(1200);
  eq('mon camion est à MA position exacte, et il glisse avec mes lectures GPS (une par seconde)', p.ll, [46.501, -72.7]);

  // rien à refaire quand rien ne change
  const iconesAvant = p.iconeMaj, liesAvant = p.popupLie;
  m.majVehicules(); m.majVehicules();
  eq('relire les camions sans changement ne redessine NI l\'étiquette NI la bulle (un toucher n\'est pas perdu)', [p.iconeMaj, p.popupLie], [iconesAvant, liesAvant]);
  m.tours([{ ...MOI(), faits: 3, pourcentage: 75 }]);
  m.majVehicules();
  eq('… mais l\'avancement qui change les redessine', [p.icone.html.includes('75 %'), p.popup.includes('3/4'), p.popupLie], [true, true, liesAvant]);

  // la route affichée ne cache jamais MON camion
  m.run(`routeActive = 'une-autre-route'`);
  m.majVehicules();
  eq('même si la carte n\'affiche que ANOTHER route, mon camion reste mon camion', p.icone.html.includes(m.svg('zero-turn', 'camion-ico')), true);
  m.run(`routeActive = null`);

  // les icônes changent en cours de passe
  m.run(`installerIconesTaches([{nom:'Coupe de gazon',icone:'tondeuse'}])`);
  m.majVehicules();
  eq('l\'administrateur change l\'icône de ma tâche : mon camion la prend', p.icone.html.includes(m.svg('tondeuse', 'camion-ico')), true);
  m.run(`installerIconesTaches([])`);

  // GPS trop vieux : le camion est « périmé » (semi-transparent), comme les autres
  await m.horloge.avancer(4 * 60_000);
  m.majVehicules();
  eq('sans lecture du GPS depuis 4 minutes, mon camion est estompé (« perime »), comme un camion dont la position est vieille', p.icone.html.startsWith('<div class="camion perime">'), true);
  m.lectureFond(46.502, -72.7, 5);
  m.majVehicules();
  eq('… il redevient net dès qu\'une lecture arrive', p.icone.html.startsWith('<div class="camion">'), true);

  // ma passe finit : le rond vert revient, sans bulle
  m.tours([]);
  m.majVehicules();
  eq('ma passe finit : le point redevient le simple rond vert, sans bulle', [p.icone.html.includes('border-radius:50%'), p.popup, p.popupDelie], [true, null, 1]);
  const iconesApres = p.iconeMaj;
  m.majVehicules(); m.majVehicules();
  eq('… et relire les camions n\'y touche plus', p.iconeMaj, iconesApres);
  m.tours([MOI('p2', 'Déneigement mécanique')]);
  m.majVehicules();
  eq('une nouvelle passe : le point redevient mon camion, avec l\'icône de SA tâche', [p.icone.html.includes(m.svg('tracteur', 'camion-ico')), p.popupLie], [true, 2]);
}
{
  // un PASSAGER garde son point vert (il peut s'éloigner du camion) ; il voit le camion où il est à bord comme les autres
  const m = await mondeAvecPoint({ utilisateur: LUC });
  const p = m.point();
  m.tours([TOUR([PASSE('p-eric', 'e2', { chauffeur_id: 'u-eric', je_suis_a_bord: true })], { tache: 'Déneigement mécanique' })]);
  m.camions([{ passe: 'p-eric', equipe: 'e2', nom: 'Camion 2', lat: 46.6, lon: -72.8 }]);
  m.majVehicules();
  eq('passager : mon point reste un rond vert (aucun changement)', [p.icone.html.includes('border-radius:50%'), p.popup, p.iconeMaj], [true, null, 0]);
  eq('… et le camion où je suis à bord est dessiné comme tout camion, avec l\'icône de sa tâche', [m.idsCamions(), m.camion('p-eric').icone.html.includes(m.svg('tracteur', 'camion-ico'))], [['p-eric'], true]);
}
{
  // la passe commence AVANT la première lecture du GPS : le point est mon camion dès qu'il existe
  const m = monde({ utilisateur: LUC });
  m.tours([TOUR([PASSE('p1', 'e1', { chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true })], { tache: 'Engrais' })]);
  m.majVehicules();
  eq('avant la première lecture du GPS : rien n\'est dessiné (pas de position, pas de camion)', [m.point(), m.idsCamions()], [undefined, []]);
  await m.demarrerGps();
  m.lectureCarte(46.5, -72.7, 8);
  eq('dès la première lecture le point est dessiné ET c\'est déjà mon camion (icône de l\'engrais : l\'épandeur)', m.point().icone.html.includes(m.svg('epandeur', 'camion-ico')), true);
}
{
  // Pas encore de point vert (le téléphone n'a pas encore de position) : mon camion est dessiné comme les autres, d'après le serveur, et suit la route affichée ; à la première lecture il devient le point
  const m = monde({ utilisateur: LUC });
  m.tours([TOUR([PASSE('p1', 'e1', { chauffeur_id: 'u-luc', je_suis_chauffeur: true, je_suis_a_bord: true })], { tache: 'Engrais' })]);
  m.camions([{ passe: 'p1', equipe: 'e1', nom: 'Camion 1', lat: 46.6, lon: -72.8 }]);
  m.majVehicules();
  eq('sans point vert : mon camion est dessiné comme un camion parmi d\'autres (position du serveur), avec l\'icône de sa tâche', [m.idsCamions(), m.camion('p1').icone.html.includes(m.svg('epandeur', 'camion-ico'))], [['p1'], true]);
  eq('… sans bouton « Suivre ce camion » (c\'est le mien), même pour l\'administrateur', (() => { m.run(`currentUser = ${JSON.stringify(JOE)}`); m.majVehicules(); const r = m.camion('p1').popup.includes('camion-suivre'); m.run(`currentUser = ${JSON.stringify(LUC)}`); return r; })(), false);
  m.run(`routeActive = 'une-autre-route'`); m.majVehicules();
  eq('… et il suit la route affichée, comme les autres (une autre route : il disparaît)', m.idsCamions(), []);
  m.run(`routeActive = null`); m.majVehicules();
  await m.demarrerGps();
  m.lectureCarte(46.5, -72.7, 8);
  eq('à la première lecture du GPS : le camion venu du serveur est RETIRÉ et le point devient mon camion (une seule marque)', [m.idsCamions(), m.point().icone.html.includes(m.svg('epandeur', 'camion-ico'))], [[], true]);
}
{
  // sans le module d'icônes (fichier absent) : l'ancien petit tracteur, jamais de plantage
  const m = monde({ utilisateur: LUC });
  m.run('svgIcone = undefined; iconeDeTache = undefined;');
  m.tours([TOUR([PASSE('p-a', 'e1', { chauffeur_id: 'u-marc' })])]);
  m.camions([{ passe: 'p-a', equipe: 'e1', nom: 'Camion 1', lat: 46.6, lon: -72.8 }]);
  m.majVehicules();
  eq('sans la banque d\'icônes, le camion garde le petit tracteur 🚜 et rien ne plante', [m.camion('p-a').icone.html.includes('🚜'), m.camion('p-a').popup.includes('🚜')], [true, true]);
}

// =====================================================================
log('\n=== L\'ONGLET « SERVICES » : L\'ICÔNE DE CHAQUE TÂCHE ===');
{
  const types = TYPES_DEPART.map((t) => (t.nom === 'Coupe de gazon' ? { ...t, icone: 'tondeuse' } : (t.nom === 'Engrais' ? { ...t, icone: 'cle-abimee' } : t)));
  const m = monde({ types });
  await m.run('chargerTypesServiceAdmin()');
  eq('la liste lit aussi l\'icône de chaque type', m.appels.selects.at(-1), ['types_service', 'id, nom, actif, icone']);
  eq('une clé abîmée dans la base (« cle-abimee ») n\'est jamais dessinée telle quelle : le bouton montre l\'icône que le nom laisse deviner (l\'épandeur)', m.ligne('Engrais').children[3].innerHTML, m.svg('epandeur'));
  eq('… et la fenêtre ne la marque pas comme choisie (« Par défaut » l\'est)', (() => { m.ligne('Engrais').children[3].onclick(); const r = m.tuiles().filter((t) => t.className.includes('choisie')).map((t) => t.children[0].textContent); m.run('fermerIconeTache()'); return r; })(), ['Par défaut (Épandeur)']);
  eq('les 8 types sont là, chacun avec un bouton d\'icône EN DERNIER dans sa ligne (les trois premiers éléments n\'ont pas bougé)', m.lignes().map((l) => [l.children.length, l.children[3].className]), Array(8).fill([4, 'ts-ico']));
  const ico = (nom) => m.ligne(nom).children[3];
  eq('un type sans icône choisie montre l\'icône que son nom laisse deviner', [ico('Déneigement mécanique').innerHTML, ico('Épandage de sel').innerHTML], [m.svg('tracteur'), m.svg('camion-benne')]);
  eq('un type avec une icône choisie montre celle-là', ico('Coupe de gazon').innerHTML, m.svg('tondeuse'));
  eq('le bouton dit à quoi il sert (lecteur d\'écran) : le type, l\'icône, « toucher pour la changer »', ico('Coupe de gazon').attrs['aria-label'], 'Icône de Coupe de gazon : Tondeuse. Toucher pour la changer');

  // ouvrir la fenêtre
  ico('Déneigement mécanique').onclick();
  eq('toucher le bouton ouvre la fenêtre « Icône de … »', [m.ouvert(), m.el('it-titre').textContent], [true, 'Icône de « Déneigement mécanique »']);
  eq('… avec « Par défaut (Tracteur) » d\'abord, puis les 13 icônes de la banque', [m.tuiles().length, m.tuiles()[0].children[0].textContent, m.tuiles().slice(1).map((t) => t.children[0].textContent)],
    [14, 'Par défaut (Tracteur)', m.run('clesIcones().map(nomIcone)')]);
  eq('… rien n\'a encore été choisi : c\'est « Par défaut » qui est marqué', m.tuiles().map((t) => t.className + '|' + t.attrs['aria-pressed']).filter((x) => x.includes('choisie')), ['it-tuile choisie|true']);
  eq('… chaque tuile montre son dessin', m.tuiles().slice(1).map((t) => t.innerHTML), m.run('clesIcones()').map((c) => m.svg(c, 'it-ico')));
  m.el('icone-tache-overlay').classList.add('open');
  m.run(`bgClickIconeTache({target: document.getElementById('it-grille')})`);
  eq('toucher DANS la fenêtre ne la ferme pas', m.ouvert(), true);
  m.run(`bgClickIconeTache({target: document.getElementById('icone-tache-overlay')})`);
  eq('toucher EN DEHORS la ferme', m.ouvert(), false);

  // une icône déjà choisie est marquée
  ico('Coupe de gazon').onclick();
  eq('pour un type qui a une icône choisie, c\'est CETTE tuile qui est marquée (pas « Par défaut »)', m.tuiles().filter((t) => t.className.includes('choisie')).map((t) => t.children[0].textContent), ['Tondeuse']);
  eq('… et « Par défaut » montre l\'icône du nom : le zéro-turn', [m.tuiles()[0].children[0].textContent, m.tuiles()[0].innerHTML], ['Par défaut (Tondeuse zéro-turn)', m.svg('zero-turn', 'it-ico')]);
  m.run('fermerIconeTache()');
  eq('« Fermer » ferme la fenêtre', m.ouvert(), false);
}
{
  // choisir une icône
  const m = await mondeAvecPoint({ utilisateur: JOE });
  m.tours([TOUR([PASSE('p-a', 'e1', { chauffeur_id: 'u-marc' })], { tache: 'Ramassage de feuilles' })]);
  m.camions([{ passe: 'p-a', equipe: 'e1', nom: 'Camion 1', lat: 46.6, lon: -72.8 }]);
  await m.run('chargerTypesService()');
  m.majVehicules();
  eq('(départ) le camion qui ramasse des feuilles porte la feuille d\'érable', m.camion('p-a').icone.html.includes(m.svg('feuille-erable', 'camion-ico')), true);
  await m.run('chargerTypesServiceAdmin()');
  m.ligne('Ramassage de feuilles').children[3].onclick();
  const tuile = (texte) => m.tuiles().find((t) => t.children[0].textContent === texte);
  await tuile('Souffleur à feuilles').onclick();
  eq('toucher une icône : UNE écriture directe sur « types_service », pour le bon type, avec la bonne clé', m.appels.ecritures, [{ table: 'types_service', op: 'update', valeur: { icone: 'souffleur' }, filtres: [['id', 'ts-7']] }]);
  eq('… un message clair, la fenêtre se ferme', [m.dernierToast(), m.ouvert()], ['✔ Icône de Ramassage de feuilles : Souffleur à feuilles', false]);
  eq('… la liste est relue : la ligne montre la nouvelle icône', m.ligne('Ramassage de feuilles').children[3].innerHTML, m.svg('souffleur'));
  eq('… et la carte suit tout de suite : le camion de cette tâche porte la nouvelle icône', m.camion('p-a').icone.html.includes(m.svg('souffleur', 'camion-ico')), true);
  eq('… la nouvelle icône est celle que la carte connaît pour cette tâche', m.run(`iconeDeTache('Ramassage de feuilles')`), 'souffleur');

  // revenir à « Par défaut »
  m.ligne('Ramassage de feuilles').children[3].onclick();
  eq('la fenêtre marque maintenant l\'icône choisie', m.tuiles().filter((t) => t.className.includes('choisie')).map((t) => t.children[0].textContent), ['Souffleur à feuilles']);
  await m.tuiles()[0].onclick();
  eq('« Par défaut » écrit « vide » (null) : la base ne garde aucun choix', m.appels.ecritures.at(-1), { table: 'types_service', op: 'update', valeur: { icone: null }, filtres: [['id', 'ts-7']] });
  eq('… message clair ; la carte reprend l\'icône déduite du nom (la feuille d\'érable)', [m.dernierToast(), m.camion('p-a').icone.html.includes(m.svg('feuille-erable', 'camion-ico'))], ['✔ Icône de Ramassage de feuilles : par défaut', true]);
  eq('… et la ligne aussi', m.ligne('Ramassage de feuilles').children[3].innerHTML, m.svg('feuille-erable'));
}
{
  // les échecs : rien ne change, message clair, la fenêtre reste ouverte pour réessayer
  const essai = async (o, cle = 'pelle') => {
    const m = monde(o);
    await m.run('chargerTypesServiceAdmin()');
    m.ligne('Engrais').children[3].onclick();
    const tuile = m.tuiles().find((t) => t.children[0].textContent === 'Pelle à neige');
    await tuile.onclick();
    return { m, toast: m.dernierToast(), ouverte: m.ouvert(), icone: m.donnees.types_service.find((t) => t.nom === 'Engrais').icone };
  };
  let panne = false;
  const a = await essai({ panneReseau: () => false, erreurEcriture: { message: 'Failed to fetch' } });
  eq('une écriture sans réseau : « rien n\'a été changé », la fenêtre reste ouverte, la base n\'a pas bougé', [a.toast, a.ouverte, a.icone], ['📴 Pas de réseau : rien n’a été changé.', true, null]);
  const b = await essai({ erreurEcriture: { code: '42703', message: 'column "icone" of relation "types_service" does not exist' } });
  eq('le SQL 27 pas encore exécuté : un message qui dit quoi faire', [b.toast, b.ouverte], ['❌ La base n’est pas encore à jour pour les icônes : le fichier SQL 27 est à exécuter dans Supabase.', true]);
  const c = await essai({ erreurEcriture: { code: 'PGRST204', message: "Could not find the 'icone' column of 'types_service' in the schema cache" } });
  eq('… même message quand c\'est PostgREST qui ne connaît pas la colonne', c.toast, '❌ La base n’est pas encore à jour pour les icônes : le fichier SQL 27 est à exécuter dans Supabase.');
  const d = await essai({ erreurEcriture: { code: '23514', message: 'new row violates check constraint "types_service_icone_format"' } });
  eq('une autre erreur du serveur : son message tel quel', d.toast, '❌ new row violates check constraint "types_service_icone_format"');
  const e = monde({ types: TYPES_DEPART });
  await e.run('chargerTypesServiceAdmin()');
  e.ligne('Engrais').children[3].onclick();
  const avant = e.appels.ecritures.length;
  await e.run(`choisirIconeTache('cle-qui-nexiste-pas')`);
  await e.run(`choisirIconeTache('__proto__')`);
  eq('une clé qui n\'est pas dans la banque n\'est JAMAIS écrite', e.appels.ecritures.length, avant);
  e.run('_typeIconeEnEdition = null');
  const messagesAvant = e.toasts.length;
  await e.run(`choisirIconeTache('pelle')`);
  eq('sans type ouvert, rien n\'est écrit, aucun message, aucune erreur cachée (l\'appel se termine avant de toucher au serveur)', [e.appels.ecritures.length, e.toasts.length], [avant, messagesAvant]);
  void panne;
}

// =====================================================================
log('\n=== LE CÂBLAGE : PAGE, STYLE, HORS RÉSEAU, MENU DÉROULANT ===');
{
  const page = lire('index.html'), css = lire('css/style.css'), veh = lire('js/vehicules.js'), carte = lire('js/carte.js'), lst = lire('js/liste-arrets.js'), hr = lire('js/hors-reseau.js'), adm = lire('js/admin-types-service.js');
  vrai('la page charge icones-taches.js après tours.js et AVANT vehicules.js', page.indexOf('js/tours.js') < page.indexOf('js/icones-taches.js') && page.indexOf('js/icones-taches.js') < page.indexOf('js/vehicules.js'));
  vrai('la page a la fenêtre du choix de l\'icône : un titre, une grille, un bouton « Fermer », un toucher en dehors', /<div id="icone-tache-overlay" onclick="bgClickIconeTache\(event\)">\s*<div id="icone-tache-modal">\s*<h2 id="it-titre">[^<]*<\/h2>\s*<div id="it-grille"><\/div>[\s\S]*?onclick="fermerIconeTache\(\)">Fermer<\/button>/.test(page));
  vrai('le style : icônes en trait de la couleur du texte, fond d\'une roue, points pleins', /\.ico\{[^}]*fill:none;stroke:currentColor/.test(css) && /\.ico \.ico-f\{fill:var\(--ico-fond,#1a1f26\);?\}/.test(css) && /\.ico \.ico-p\{fill:currentColor;stroke:none;?\}/.test(css));
  vrai('le style : l\'icône de l\'étiquette prend la couleur du nom, celle de la bulle est foncée sur fond blanc', /\.camion \.camion-ico\{color:#c8e63c;?\}/.test(css) && /\.bulle-ico\{[^}]*color:#1a1f26;--ico-fond:#fff/.test(css));
  vrai('le style : le bouton d\'icône de l\'onglet Services s\'affiche À GAUCHE (order:-1) et fait au moins 40 px de haut', /\.emp-item \.ts-ico\{order:-1;[^}]*height:40px/.test(css));
  vrai('le style : la fenêtre du choix monte du bas comme les autres, avec la barre d\'accueil d\'un iPhone respectée (sa propre marge : la liste partagée des autres fenêtres n\'est pas touchée), et défile si la banque est longue', /#icone-tache-overlay\{display:none;position:fixed;inset:0;[^}]*align-items:flex-end;padding-bottom:var\(--sa-bottom\);\}/.test(css) && /#icone-tache-modal\{[^}]*max-height:85vh;overflow-y:auto/.test(css));
  vrai('le style : les tuiles de la banque en grille de 3, la tuile choisie encadrée', /#it-grille\{display:grid;grid-template-columns:repeat\(3,/.test(css) && /\.it-tuile\.choisie\{border-color:var\(--accent\)/.test(css));
  eq('vehicules.js : le petit tracteur 🚜 n\'existe plus qu\'une fois, comme REPLI quand la banque d\'icônes est absente', (veh.match(/🚜/g) || []).length, 1);
  vrai('vehicules.js : l\'étiquette et la bulle passent par l\'icône de la TÂCHE du tour (c.tour.tache / t.tache), pas du véhicule', /htmlIconeTache\(c\.tour\.tache,'camion-ico'\)/.test(veh) && /htmlIconeTache\(t\.tache,'bulle-ico'\)/.test(veh));
  vrai('vehicules.js : « mon camion » passe par le point vert (majMonCamion, AVANT vus[…]) ; sans point vert il est dessiné comme les autres et suit la route affichée', /if\(c\.moi\)\{\s*if\(majMonCamion\(c,perime\)\)\{moiSurLaCarte=true;return;\}[^\n]*\n[^\n]*\n\s*if\(routeActive!==null&&c\.tour\.route_id!==routeActive\) return;\s*\}\s*vus\[c\.passeId\]=true;/.test(veh) && /if\(!moi&&routeActive!==null&&t\.route_id!==routeActive\) return;/.test(veh));
  vrai('vehicules.js : quand je ne conduis pas (ou plus), le point vert est rétabli', /if\(!moiSurLaCarte\) retablirPointVert\(\);/.test(veh));
  vrai('carte.js : le rond vert vient d\'UNE seule fonction (iconePointVert), utilisée au départ et quand ma passe finit ; la première lecture rappelle majVehicules', (carte.match(/function iconePointVert\(\)/g) || []).length === 1 && /icon:iconePointVert\(\)/.test(carte) && /majVehicules\(\);[^\n]*\n\s*if\(typeof suiviMarqueurCree==='function'\)/.test(carte) && /m\.setIcon\(iconePointVert\(\)\)/.test(veh));
  vrai('liste-arrets.js : la lecture demande « nom, icone », relit les seuls noms si la colonne manque, garde les icônes pour le hors réseau', /select\('nom, icone'\)\.eq\('actif',true\)\.order\('nom'\)/.test(lst) && /if\(r\.error\) r=await db\.from\('types_service'\)\.select\('nom'\)\.eq\('actif',true\)\.order\('nom'\)/.test(lst) && /lectureReussie\('iconesTaches',lignes\)/.test(lst));
  vrai('hors-reseau.js : au démarrage sans signal, les dernières icônes connues sont remises (et ne comptent pas dans « données de … »)', /if\(typeof restaurerIconesTaches==='function'\) await restaurerIconesTaches\(\);/.test(hr) && !/for\(const nom of \[[^\]]*iconesTaches/.test(hr));
  vrai('admin-types-service.js : l\'icône s\'écrit par une écriture directe (jamais de fonction serveur, jamais de suppression), et seulement une clé de la banque ou « vide »', /db\.from\('types_service'\)\.update\(\{icone:cle\}\)\.eq\('id',t\.id\)/.test(adm) && !/\.delete\(\)/.test(adm) && !/functions\.invoke/.test(adm) && /if\(cle!==null&&!estCleIcone\(cle\)\) return;/.test(adm));
  vrai('admin-types-service.js : la liste demande l\'icône et se replie sur « id, nom, actif » si la colonne manque', /select\('id, nom, actif, icone'\)\.order\('nom'\)/.test(adm) && /if\(r\.error\) r=await db\.from\('types_service'\)\.select\('id, nom, actif'\)\.order\('nom'\)/.test(adm));
  vrai('renommer un type n\'écrit toujours que le nom (l\'icône choisie reste)', /update\(\{nom\}\)\.eq\('id',enEdition\)/.test(adm));
  eq('icones-taches.js ne contient aucune couleur écrite en dur (elle vient du style : chaque endroit a la sienne)', /#[0-9a-fA-F]{3,6}\b/.test(lire('js/icones-taches.js').replace(/\/\/.*$/gm, '')), false);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
