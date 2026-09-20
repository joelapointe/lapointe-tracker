// Étape 14e — UNE PHOTO PAR PROBLÈME (www/js/photos.js, problemes.js, admin.js), testé avec les VRAIS fichiers de l'application
// chargés dans un faux navigateur (faux appareil photo, faux canvas, faux Storage) et un FAUX Supabase.
// Ce que ces tests ne peuvent pas vérifier : le vrai Storage (reel-etape-14e.mjs) et l'appareil photo d'un vrai téléphone.
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
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const MEC = 'Déneigement mécanique', CH = 'route-charette';
const LUC = { id: 'u-luc', nom: 'Luc', role: 'employe' }, JOE = { id: 'u-joe', nom: 'Joé', role: 'admin' };
const U = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');   // de vrais numéros au bon format
const UID_LUC = U(1), UID_MARC = U(2);
const UTIL_LUC = { id: UID_LUC, nom: 'Luc', role: 'employe' };

function monde(o = {}) {
  const els = {};
  const creer = (id) => {
    const classes = new Set(); const attrs = {};
    const e = { id, children: [], style: {}, textContent: '', _html: '', value: '', src: '', alt: '', disabled: false, className: '', onclick: null, dataset: {}, clics: 0,
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c), toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) },
      appendChild(c) { c.parent = this; this.children.push(c); return c; }, setAttribute(k, v) { attrs[k] = v; }, getAttribute(k) { return k in attrs ? attrs[k] : null; }, focus() {}, click() { this.clics++; },
      remove() { if (this.parent) this.parent.children = this.parent.children.filter((x) => x !== this); },
      querySelector(sel) { return this.children.find((c) => '.' + c.className === sel) ?? null; } };
    Object.defineProperty(e, 'innerHTML', { get() { return this._html; }, set(v) { this._html = v; if (v === '') this.children = []; } });
    return e;
  };
  const el = (id) => (els[id] ??= creer(id));
  const user = o.utilisateur ?? UTIL_LUC;
  const donnees = { stops: STOPS.map((s) => ({ ...s })), routes: [{ id: CH, nom: 'Charette', couleur: '#c8e63c', actif: true }], problemes: (o.problemes ?? []).map((p) => ({ ...p })), positions: [], equipes: [], equipage_periodes: [], tours: [] };
  const appels = { rpc: [], upload: [], signe: [], signes: [], insert: [], toasts: [], journal: [], retires: [], ecritures: [] };
  let nInsert = 0, nUpload = 0, nAttacher = 0, nUrl = 0;
  const scenario = (liste, n) => liste?.[n - 1] ?? liste?.defaut;
  const fauxDb = {
    rpc: async (nom, args) => {
      appels.rpc.push({ nom, args });
      if (nom === 'probleme_attacher_photo') {
        appels.journal.push('attacher'); nAttacher++;
        const sc = scenario(o.attacher, nAttacher);
        if (sc === 'reseau') throw new Error('Failed to fetch');
        if (sc?.erreur) return { data: null, error: { message: sc.erreur } };
        const p = donnees.problemes.find((x) => x.id === args.p_probleme_id);
        if (p) p.photo_chemin = user.id + '/' + p.id + '.jpg';
        return { data: { statut: 'attachee' }, error: null };
      }
      if (nom === 'tours_en_cours') return { data: [], error: null };
      return { data: null, error: { message: 'inconnu' } };
    },
    from: (table) => {
      const q = { op: 'select', valeur: null, filtres: [] };
      q.select = () => q;
      q.eq = (c, v) => { q.filtres.push([c, v]); return q; };
      q.order = () => q; q.is = () => q; q.limit = () => q; q.maybeSingle = () => q;
      q.insert = (v) => { q.op = 'insert'; q.valeur = v; return q; };
      q.update = (v) => { q.op = 'update'; q.valeur = v; return q; };
      q.delete = () => { q.op = 'delete'; return q; };
      q.then = (ok_, ko_) => {
        let res;
        if (q.op === 'insert') {
          appels.journal.push('insert'); appels.insert.push(q.valeur); nInsert++;
          const sc = scenario(o.insert, nInsert);
          if (sc === 'reseau') return Promise.reject(new Error('Failed to fetch')).then(ok_, ko_);
          if (sc?.erreur) res = { data: null, error: sc.erreur };
          else { q.valeur.forEach((v) => donnees.problemes.push({ lu: false, utilisateur_id: user.id, cree_le: new Date().toISOString(), photo_chemin: null, utilisateurs: { nom: user.nom }, ...v })); res = { data: null, error: null }; }
        } else if (q.op !== 'select') { appels.ecritures.push({ table, op: q.op, valeur: q.valeur }); res = { data: [], error: null }; }
        else res = { data: (donnees[table] ?? []).filter((r) => q.filtres.every(([c, v]) => !(c in r) || r[c] === v)), error: null };
        return Promise.resolve(res).then(ok_, ko_);
      };
      return q;
    },
    storage: { from: (bucket) => ({
      upload: async (chemin, blob, opts) => {
        appels.journal.push('upload'); appels.upload.push({ bucket, chemin, blob, opts }); nUpload++;
        const sc = scenario(o.upload, nUpload);
        if (sc === 'reseau') throw new Error('Failed to fetch');
        if (sc?.erreur) return { data: null, error: sc.erreur };
        return { data: { path: chemin }, error: null };
      },
      createSignedUrl: async (chemin, s) => { appels.signe.push([bucket, chemin, s]); nUrl++; if (o.signe === false) return { data: null, error: { message: 'refusé' } }; return { data: { signedUrl: 'https://fichiers.test/' + chemin + '?jeton=' + nUrl }, error: null }; },
      createSignedUrls: async (chemins, s) => { appels.signes.push([bucket, [...chemins], s]); if (o.signe === false) return { data: null, error: { message: 'refusé' } }; if (o.signesLance) throw new Error('Failed to fetch'); await attendre(o.delaiSignes ?? 0); return { data: chemins.map((c) => ({ path: c, signedUrl: 'https://fichiers.test/' + c + '?lot', error: null })), error: null }; },
    }) },
  };
  // Le faux appareil photo et le faux canvas : la taille du JPEG dépend des dimensions et de la qualité
  const essais = [], fermetures = [], urlsCreees = [];
  let nUrlObj = 0;
  const tailleJpeg = o.tailleJpeg ?? ((w, h, q) => Math.round(w * h * q * 0.15));
  const sandbox = {
    document: { getElementById: el, createElement: (tag) => (tag === 'canvas' ? { width: 0, height: 0, getContext() { return o.sansContexte ? null : { drawImage() {} }; },
      toBlob(cb, type, q) { essais.push([this.width, this.height, q, type]); cb(o.blobNull ? null : { size: tailleJpeg(this.width, this.height, q), type }); } } : creer(null)) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    window: { open() {} }, setTimeout, clearTimeout, setInterval, clearInterval, console,
    L: { divIcon: (opt) => opt, marker: () => { const m = { addTo() { return m; }, on() {}, setLatLng() { return m; }, setIcon() { return m; }, bindPopup() { return m; }, setPopupContent() { return m; } }; return m; }, polygon: () => ({ addTo() { return this; } }) },
    __map: { removeLayer() {}, flyTo() {} }, __fauxDb: fauxDb, setStatus() {}, hideLoading() {}, showErr() {},
    __toasts: appels.toasts,
    URL: { createObjectURL: () => { const u = 'blob:test/' + (++nUrlObj); urlsCreees.push(u); return u; }, revokeObjectURL: (u) => appels.retires.push(u) },
    ...(o.sansBitmap ? {} : { createImageBitmap: async (f, opt) => { if (o.bitmapErreur) throw new Error('decode'); essais.bitmap = [...(essais.bitmap ?? []), [f, opt]]; return { width: f.largeur ?? 4000, height: f.hauteur ?? 3000, close() { fermetures.push(1); } }; } }),
  };
  const ctx = vm.createContext(sandbox);
  for (const f of ['js/config.js', 'js/utilitaires.js', 'js/tours.js', 'js/vehicules.js', 'js/equipage.js', 'js/passe.js', 'js/resume-passe.js', 'js/arrets.js', 'js/routes.js', 'js/liste-arrets.js', 'js/problemes.js', 'js/photos.js', 'js/admin.js'])
    vm.runInContext(lire(f), ctx, { filename: f });
  vm.runInContext('db = __fauxDb; map = __map; currentUser = ' + JSON.stringify(user) + ';', ctx);
  vm.runInContext('toast = (m) => { __toasts.push(m); };', ctx);
  const w = {
    ctx, el, donnees, appels, essais, fermetures, urlsCreees,
    run: (code) => vm.runInContext(code, ctx),
    dernierToast: () => appels.toasts[appels.toasts.length - 1],
    charge: async () => { await w.run('loadStops()'); await attendre(20); return w; },
    fichier: (o2 = {}) => ({ type: 'image/jpeg', name: 'photo.jpg', largeur: 4000, hauteur: 3000, ...o2 }),
    champ: (f) => ({ files: f ? [f] : [], value: 'C:\\fakepath\\photo.jpg' }),
    fiche: (id = 's1') => { w.run(`openCard(${STOPS.findIndex((s) => s.id === id)})`); return el('sc-prob').innerHTML; },
    fin: () => vm.runInContext('clearInterval(_minuterieEnCours);_minuterieEnCours=null;', ctx),
  };
  tousLesMondes.push(w);
  return w;
}
const tousLesMondes = [];
const STOPS = [
  { id: 's1', adresse: '304 rue de l\'Église', client: 'TEST 1', route_id: CH, service: MEC, lat: 46.44, lon: -72.92, ordre: 0, actif: true },
  { id: 's2', adresse: '220 rue du Moulin', client: 'TEST 3', route_id: CH, service: MEC, lat: 46.443, lon: -72.922, ordre: 1, actif: true },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const pb = (n, o = {}) => ({ id: U(100 + n), stop_id: 's1', passe_id: null, utilisateur_id: UID_MARC, note: 'note ' + n, lu: false, cree_le: new Date(Date.now() - n * 60000).toISOString(), photo_chemin: null, utilisateurs: { nom: 'Marc' }, ...o });
const cheminDe = (uid, pid) => uid + '/' + pid + '.jpg';

// =====================================================================
log('=== RÉDUIRE LA PHOTO : 1280 px au plus, JPEG, légère, redressée ===');
{
  let m = await monde().charge();
  let blob = await m.run('reduirePhoto(' + JSON.stringify(m.fichier()) + ')');
  eq('une photo 4000×3000 : ramenée à 1280×960, JPEG, qualité 0,7', m.essais.map((e) => [e[0], e[1], e[2], e[3]]), [[1280, 960, 0.7, 'image/jpeg']]);
  vrai('… légère (bien sous 2 Mo) : environ 130 Ko', blob.size < 200000 && blob.size > 50000, blob.size);
  eq('la photo est lue « redressée comme le téléphone l\'a prise » (imageOrientation from-image)', m.essais.bitmap[0][1], { imageOrientation: 'from-image' });
  eq('la mémoire de l\'image est libérée (close)', m.fermetures.length, 1);

  m = await monde().charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier({ largeur: 800, hauteur: 600 })) + ')');
  eq('une petite photo (800×600) n\'est JAMAIS agrandie', m.essais.map((e) => [e[0], e[1]]), [[800, 600]]);
  m = await monde().charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier({ largeur: 3000, hauteur: 4000 })) + ')');
  eq('une photo verticale (3000×4000) : 960×1280', m.essais.map((e) => [e[0], e[1]]), [[960, 1280]]);

  m = await monde({ tailleJpeg: (w, h, q) => Math.round(w * h * q * 3) }).charge();
  blob = await m.run('reduirePhoto(' + JSON.stringify(m.fichier()) + ')');
  eq('trop lourde à 0,7 : on baisse la qualité ET les dimensions (essai 2 : 1024×768 à 0,55)', m.essais.map((e) => [e[0], e[1], e[2]]), [[1280, 960, 0.7], [1024, 768, 0.55]]);
  vrai('… et elle passe sous 1,8 Mo', blob.size <= 1800000, blob.size);
  m = await monde({ tailleJpeg: () => 5000000 }).charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier()) + ')').then(() => fail('aurait dû échouer'), (e) => eq('jamais assez légère : « photo_trop_lourde » après 3 essais', [e.message, m.essais.length], ['photo_trop_lourde', 3]));

  m = await monde().charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier({ type: 'application/pdf' })) + ')').then(() => fail('aurait dû échouer'), (e) => eq('un fichier qui n\'est pas une image : « pas_une_photo », rien n\'est dessiné', [e.message, m.essais.length], ['pas_une_photo', 0]));
  await m.run('reduirePhoto(null)').then(() => fail('aurait dû échouer'), (e) => eq('aucun fichier : refusé', e.message, 'pas_une_photo'));
  m = await monde({ bitmapErreur: true }).charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier()) + ')').then(() => fail('aurait dû échouer'), (e) => eq('une image qu\'on ne peut pas lire : « photo_illisible »', e.message, 'photo_illisible'));
  m = await monde().charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier({ largeur: 0 })) + ')').then(() => fail('aurait dû échouer'), (e) => eq('une image vide (0 pixel) : « photo_illisible », mémoire libérée', [e.message, m.fermetures.length], ['photo_illisible', 1]));
  m = await monde({ blobNull: true }).charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier()) + ')').then(() => fail('aurait dû échouer'), (e) => eq('le navigateur ne produit pas de JPEG : « photo_illisible »', e.message, 'photo_illisible'));
  m = await monde({ sansContexte: true }).charge();
  await m.run('reduirePhoto(' + JSON.stringify(m.fichier()) + ')').then(() => fail('aurait dû échouer'), (e) => eq('pas de canvas : « photo_illisible »', e.message, 'photo_illisible'));
}

log('\n=== LA BOÎTE « SIGNALER UN PROBLÈME » : prendre, voir, retirer la photo ===');
{
  const m = await monde().charge();
  m.run('openCard(0)'); m.run('openProbleme()');
  eq('à l\'ouverture : pas de photo, l\'aperçu est caché, le bouton dit « Ajouter une photo »', [m.run('_photoChoisie'), m.el('prob-photo-apercu').style.display, m.el('prob-photo-btn').textContent], [null, 'none', '📷 Ajouter une photo']);
  vrai('… le problème a déjà son numéro (un vrai UUID) : le MÊME pour la photo et pour un renvoi', UUID.test(m.run('_idProbleme')), m.run('_idProbleme'));
  m.run('ouvrirAppareilPhoto()');
  eq('« 📷 » ouvre l\'appareil photo (le champ fichier caché est touché)', m.el('prob-photo-input').clics, 1);

  const champ = m.champ(m.fichier());
  await m.run('choisirPhotoProbleme(__champ)'.replace('__champ', 'globalThis.__c')) .catch(() => null);
  m.ctx.__c = champ;
  await m.run('choisirPhotoProbleme(__c)');
  eq('photo prise : mémorisée, aperçu visible avec la photo réduite et sa taille, bouton « Changer »', [m.run('_photoChoisie !== null'), m.el('prob-photo-apercu').style.display, m.el('prob-photo-img').src.startsWith('blob:test/'), /^\d+ Ko$/.test(m.el('prob-photo-taille').textContent), m.el('prob-photo-btn').textContent],
    [true, 'block', true, true, '📷 Changer la photo']);
  eq('le champ est vidé (on pourra reprendre la même photo)', champ.value, '');
  const premiere = m.run('_photoChoisie.url');
  m.ctx.__c = m.champ(m.fichier({ largeur: 2000, hauteur: 1500 }));
  await m.run('choisirPhotoProbleme(__c)');
  eq('reprendre une autre photo : l\'ancienne est libérée (pas de fuite de mémoire)', [m.appels.retires.includes(premiere), m.run('_photoChoisie.url') !== premiere], [true, true]);
  m.run('retirerPhotoProbleme()');
  eq('« ✕ Retirer » : plus de photo, aperçu caché, bouton « Ajouter »', [m.run('_photoChoisie'), m.el('prob-photo-apercu').style.display, m.el('prob-photo-btn').textContent], [null, 'none', '📷 Ajouter une photo']);
  m.ctx.__c = m.champ(m.fichier({ type: 'text/plain' }));
  await m.run('choisirPhotoProbleme(__c)');
  eq('un fichier qui n\'est pas une photo : message clair, aucune photo gardée', [m.dernierToast(), m.run('_photoChoisie')], ['⚠ Ce fichier n’est pas une photo.', null]);
  m.ctx.__c = m.champ(m.fichier({ largeur: 0 }));
  await m.run('choisirPhotoProbleme(__c)');
  eq('une photo illisible : message clair', m.dernierToast(), '⚠ Photo illisible. Reprends-la.');
  m.ctx.__c = m.champ(null);
  await m.run('choisirPhotoProbleme(__c)');
  eq('l\'appareil photo annulé (aucun fichier) : rien ne se passe', m.run('_photoChoisie'), null);
  m.ctx.__c = m.champ(m.fichier());
  await m.run('choisirPhotoProbleme(__c)');
  m.run('closeProbleme()');
  eq('« Annuler » la boîte : la photo est oubliée (et libérée)', [m.run('_photoChoisie'), m.appels.retires.length >= 3], [null, true]);
  m.run('openProbleme()');
  vrai('une nouvelle boîte : un NOUVEAU numéro de problème', UUID.test(m.run('_idProbleme')));
}

log('\n=== ENVOYER : le texte d\'abord, la photo ensuite ===');
{
  const ouvrirAvecPhoto = async (o = {}) => { const m = await monde(o).charge(); m.run('openCard(0)'); m.run('openProbleme()'); m.el('prob-note').value = 'Entrée bloquée'; m.ctx.__c = m.champ(m.fichier()); await m.run('choisirPhotoProbleme(__c)'); return m; };

  let m = await ouvrirAvecPhoto();
  const id = m.run('_idProbleme');
  await m.run('envoyerProbleme()');
  eq('l\'ordre : le PROBLÈME est enregistré, PUIS la photo est envoyée, PUIS elle est reliée', m.appels.journal, ['insert', 'upload', 'attacher']);
  eq('le problème est inséré avec son numéro (celui qui nomme la photo)', [m.appels.insert[0][0].id, m.appels.insert[0][0].note], [id, 'Entrée bloquée']);
  const up = m.appels.upload[0];
  eq('la photo : espace privé « photos-problemes », chemin « numéro-employé/numéro-problème.jpg », JPEG, JAMAIS de remplacement', [up.bucket, up.chemin, up.opts], ['photos-problemes', cheminDe(UID_LUC, id), { contentType: 'image/jpeg', upsert: false }]);
  vrai('… c\'est bien la photo RÉDUITE qui part (pas l\'original)', up.blob.size < 200000 && up.blob.type === 'image/jpeg', JSON.stringify(up.blob));
  eq('… puis probleme_attacher_photo avec le numéro du problème', m.appels.rpc.filter((r) => r.nom === 'probleme_attacher_photo').map((r) => r.args), [{ p_probleme_id: id }]);
  eq('message « avec photo » ; boîte et fiche fermées ; photo oubliée', [m.dernierToast(), m.el('prob-overlay').classList.contains('open'), m.el('stop-card').classList.contains('open'), m.run('_photoChoisie')], ['⚠ Problème signalé avec photo !', false, false, null]);
  eq('aucune écriture directe de photo_chemin (seule la fonction du serveur le fait)', m.appels.ecritures, []);

  m = await monde().charge(); m.run('openCard(0)'); m.run('openProbleme()'); m.el('prob-note').value = 'Sans photo';
  await m.run('envoyerProbleme()');
  eq('SANS photo : aucun envoi de fichier, aucune liaison, message habituel', [m.appels.journal, m.dernierToast()], [['insert'], '⚠ Problème signalé !']);

  // La photo échoue : le problème est quand même signalé
  for (const [nom, opts] of [['réseau coupé pendant l\'envoi de la photo', { upload: { defaut: 'reseau' } }], ['le Storage refuse la photo', { upload: { defaut: { erreur: { message: 'new row violates row-level security policy', statusCode: '403' } } } }],
    ['la liaison échoue (« photo_introuvable »)', { attacher: { defaut: { erreur: 'photo_introuvable' } } }], ['la liaison échoue (réseau)', { attacher: { defaut: 'reseau' } }]]) {
    const x = await ouvrirAvecPhoto(opts);
    await x.run('envoyerProbleme()');
    eq(`${nom} : le problème est signalé quand même, message honnête, boîte fermée`, [x.appels.insert.length, x.dernierToast(), x.el('prob-overlay').classList.contains('open')], [1, '⚠ Problème envoyé, photo non envoyée', false]);
    vrai('… le problème apparaît sur la fiche (orange)', x.run('problemesNonLus.length') === 1);
  }
  m = await ouvrirAvecPhoto({ upload: { defaut: { erreur: { message: 'The resource already exists', statusCode: '409' } } } });
  await m.run('envoyerProbleme()');
  eq('la photo est DÉJÀ là (réponse perdue puis renvoi, erreur 409) : ce n\'est pas un échec, on relie la photo', [m.appels.journal, m.dernierToast()], [['insert', 'upload', 'attacher'], '⚠ Problème signalé avec photo !']);

  // Le texte échoue : rien n'est perdu, même identifiant au renvoi
  m = await ouvrirAvecPhoto({ insert: { 0: 'reseau' } });
  const id2 = m.run('_idProbleme');
  await m.run('envoyerProbleme()');
  eq('le TEXTE n\'a pas pu partir : aucun envoi de photo, message, la note ET la photo restent dans la boîte', [m.appels.upload.length, m.dernierToast(), m.el('prob-overlay').classList.contains('open'), m.run('_photoChoisie !== null'), m.el('prob-note').value], [0, '❌ Problème non envoyé (pas de réseau ?). Réessaie.', true, true, 'Entrée bloquée']);
  await m.run('envoyerProbleme()');
  eq('au renvoi : LE MÊME numéro de problème (jamais deux problèmes), puis la photo', [m.appels.insert.map((v) => v[0].id), m.appels.upload[0].chemin], [[id2, id2], cheminDe(UID_LUC, id2)]);
  m = await ouvrirAvecPhoto({ insert: { 0: { erreur: { code: '23505', message: 'duplicate key value violates unique constraint' } } } });
  await m.run('envoyerProbleme()');
  eq('le problème existait déjà sous ce numéro (réponse perdue, doublon de clé 23505) : traité comme réussi, la photo part', [m.appels.journal, m.dernierToast()], [['insert', 'upload', 'attacher'], '⚠ Problème signalé avec photo !']);
  m = await ouvrirAvecPhoto({ insert: { 0: { erreur: { code: '42501', message: 'permission denied' } } } });
  await m.run('envoyerProbleme()');
  eq('un vrai refus (droits) : pas de photo envoyée, le message d\'erreur', [m.appels.upload.length, m.dernierToast()], [0, '❌ Problème non envoyé (pas de réseau ?). Réessaie.']);

  // Double toucher
  m = await ouvrirAvecPhoto({ upload: { defaut: 'reseau' } });
  await Promise.all([m.run('envoyerProbleme()'), m.run('envoyerProbleme()'), m.run('envoyerProbleme()')]);
  eq('trois touchers sur « Envoyer » : UN seul problème', m.appels.insert.length, 1);
}

log('\n=== LA FICHE D\'UN ARRÊT : miniatures et « Ajouter une photo » ===');
{
  const avecPhoto = pb(1, { photo_chemin: cheminDe(UID_MARC, U(101)) });
  let m = await monde({ problemes: [avecPhoto] }).charge();
  let h = m.fiche();
  vrai('la photo d\'un problème : d\'abord un bouton 📷 (le lien n\'est pas encore connu), touchable', h.includes('class="sc-prob-photo vide"') && h.includes(`voirPhoto('${avecPhoto.photo_chemin}')`), h);
  await attendre(60);
  h = m.el('sc-prob').innerHTML;
  eq('les liens manquants sont demandés UNE fois (durée d\'une heure), pour la bonne photo', m.appels.signes, [['photos-problemes', [avecPhoto.photo_chemin], 3600]]);
  vrai('… puis la fiche se redessine avec la MINIATURE (lien temporaire signé, jamais une adresse publique)', h.includes('<img class="sc-prob-photo"') && h.includes('https://fichiers.test/' + avecPhoto.photo_chemin), h);
  await m.run('majCarte()'); await m.run('majCarte()'); await attendre(30);
  eq('redessiner la fiche ne redemande PAS les liens (pas de boucle)', m.appels.signes.length, 1);

  const trois = [1, 2, 3].map((n) => pb(n, { id: U(200 + n), photo_chemin: cheminDe(UID_MARC, U(200 + n)) }));
  m = await monde({ problemes: trois }).charge(); m.fiche(); await attendre(60);
  eq('trois problèmes avec photo : UN seul lot de trois liens', [m.appels.signes.length, m.appels.signes[0][1].length], [1, 3]);

  m = await monde({ problemes: [avecPhoto], signe: false }).charge(); m.fiche(); await attendre(60);
  await m.run('majCarte()'); await attendre(30);
  eq('le serveur refuse le lien : le bouton 📷 reste, on ne redemande pas en boucle (attente d\'une minute)', [m.el('sc-prob').innerHTML.includes('sc-prob-photo vide'), m.appels.signes.length], [true, 1]);
  m = await monde({ problemes: [avecPhoto], signesLance: true }).charge(); m.fiche(); await attendre(60);
  eq('réseau coupé pendant la demande des liens : aucun plantage, le bouton 📷 reste', m.el('sc-prob').innerHTML.includes('sc-prob-photo vide'), true);

  // « Ajouter une photo » : MES problèmes sans photo seulement
  const miens = pb(5, { id: U(305), utilisateur_id: UID_LUC, utilisateurs: { nom: 'Luc' } });
  const dautres = pb(6, { id: U(306) });
  const miensAvec = pb(7, { id: U(307), utilisateur_id: UID_LUC, photo_chemin: cheminDe(UID_LUC, U(307)) });
  m = await monde({ problemes: [miens, dautres, miensAvec] }).charge(); h = m.fiche();
  eq('mon problème SANS photo : le bouton « 📷 Ajouter une photo » (relié à CE problème)', h.includes(`ajouterPhotoApres('${U(305)}')`), true);
  eq('le problème d\'un AUTRE sans photo : aucun bouton', h.includes(`ajouterPhotoApres('${U(306)}')`), false);
  eq('mon problème qui a déjà sa photo : pas de bouton « Ajouter »', h.includes(`ajouterPhotoApres('${U(307)}')`), false);

  // L'ajout après coup
  m = await monde({ problemes: [miens] }).charge(); m.fiche();
  m.run(`ajouterPhotoApres('${U(305)}')`);
  eq('« Ajouter une photo » ouvre l\'appareil photo', m.el('prob-photo-apres').clics, 1);
  m.ctx.__c = m.champ(m.fichier());
  await m.run('photoApresChoisie(__c)');
  eq('la photo est réduite, envoyée au bon chemin, reliée à CE problème', [m.appels.journal, m.appels.upload[0].chemin, m.appels.rpc.filter((r) => r.nom === 'probleme_attacher_photo')[0].args], [['upload', 'attacher'], cheminDe(UID_LUC, U(305)), { p_probleme_id: U(305) }]);
  await attendre(60);
  eq('message ; la fiche montre maintenant la photo (et plus le bouton « Ajouter »)', [m.dernierToast(), m.el('sc-prob').innerHTML.includes('<img class="sc-prob-photo"'), m.el('sc-prob').innerHTML.includes('ajouterPhotoApres')], ['📷 Photo ajoutée !', true, false]);
  m = await monde({ problemes: [miens], upload: { defaut: 'reseau' } }).charge(); m.fiche(); m.run(`ajouterPhotoApres('${U(305)}')`); m.ctx.__c = m.champ(m.fichier());
  await m.run('photoApresChoisie(__c)');
  eq('l\'envoi échoue : message clair, le bouton « Ajouter » reste pour réessayer', [m.dernierToast(), m.el('sc-prob').innerHTML.includes('ajouterPhotoApres')], ['❌ Photo non envoyée. Réessaie.', true]);
  m = await monde({ problemes: [miens] }).charge(); m.fiche(); m.run(`ajouterPhotoApres('${U(305)}')`); m.ctx.__c = m.champ(m.fichier({ type: 'application/pdf' }));
  await m.run('photoApresChoisie(__c)');
  eq('un fichier qui n\'est pas une photo : message clair, rien n\'est envoyé', [m.dernierToast(), m.appels.upload.length], ['⚠ Ce fichier n’est pas une photo.', 0]);
  m = await monde({ problemes: [miens], attacher: { defaut: { erreur: 'photo_introuvable' } } }).charge(); m.fiche(); m.run(`ajouterPhotoApres('${U(305)}')`); m.ctx.__c = m.champ(m.fichier());
  await m.run('photoApresChoisie(__c)');
  eq('une erreur du serveur (« photo_introuvable ») n\'est pas prise pour une photo illisible', m.dernierToast(), '❌ Photo non envoyée. Réessaie.');
  m = await monde({ problemes: [miens] }).charge(); m.fiche(); m.run(`ajouterPhotoApres('${U(305)}')`); m.ctx.__c = m.champ(m.fichier());
  await Promise.all([m.run('photoApresChoisie(__c)'), m.run('photoApresChoisie(__c)')]);
  eq('deux fois de suite : UN seul envoi', m.appels.upload.length, 1);

  // Textes piégés
  const pieges = [pb(8, { id: U(308), photo_chemin: "x');alert(1);//" }), pb(9, { id: "');alert(2);//", utilisateur_id: UID_LUC, utilisateurs: { nom: 'Luc' } }), pb(10, { id: U(310), photo_chemin: cheminDe(UID_MARC, U(310)).replace('.jpg', 'X') }), pb(11, { id: U(311), photo_chemin: cheminDe(UID_MARC, U(311)).replace('.jpg', 'xjpg') })];
  m = await monde({ problemes: pieges }).charge(); h = m.fiche(); await attendre(40); h = m.el('sc-prob').innerHTML;
  vrai('un chemin de photo ou un numéro qui n\'a pas la bonne forme n\'est JAMAIS mis dans la page (rien de touchable, rien d\'exécutable)', !h.includes('alert') && !h.includes('voirPhoto') && !h.includes('ajouterPhotoApres') && m.appels.signes.length === 0, h);
}

log('\n=== LA VISIONNEUSE : la photo en grand ===');
{
  const chemin = cheminDe(UID_MARC, U(101));
  let m = await monde().charge();
  const p = m.run(`voirPhoto('${chemin}')`);
  eq('touchée : la visionneuse s\'ouvre tout de suite (le lien est demandé ensuite)', m.el('photo-overlay').classList.contains('open'), true);
  await p;
  eq('la photo s\'affiche, le lien est signé pour une heure', [m.el('photo-plein').src, m.appels.signe], ['https://fichiers.test/' + chemin + '?jeton=1', [['photos-problemes', chemin, 3600]]]);
  await m.run(`voirPhoto('${chemin}')`);
  eq('la même photo une 2e fois : le lien est réutilisé (pas de nouvelle demande)', m.appels.signe.length, 1);
  m.run('fermerPhoto()');
  eq('« ✕ » (ou toucher l\'image) ferme et vide l\'image', [m.el('photo-overlay').classList.contains('open'), m.el('photo-plein').src], [false, '']);
  m = await monde({ signe: false }).charge();
  await m.run(`voirPhoto('${chemin}')`);
  eq('lien refusé : la visionneuse se ferme, message clair', [m.el('photo-overlay').classList.contains('open'), m.dernierToast()], [false, '❌ Photo introuvable']);
  m = await monde().charge();
  const q = m.run(`voirPhoto('${chemin}')`); m.run('fermerPhoto()'); await q;
  eq('fermée avant l\'arrivée du lien : l\'image ne s\'affiche pas après coup', m.el('photo-plein').src, '');
}

log('\n=== LE PANNEAU ADMINISTRATEUR : la photo de chaque problème ===');
{
  const stopInfo = { adresse: '304 rue de l\'Église', service: MEC, client: 'TEST 1' };
  const lignes = [{ id: U(401), note: 'avec photo', cree_le: new Date().toISOString(), photo_chemin: cheminDe(UID_MARC, U(401)), stops: stopInfo, utilisateurs: { nom: 'Marc' }, passes: null },
    { id: U(402), note: 'sans photo', cree_le: new Date().toISOString(), photo_chemin: null, stops: stopInfo, utilisateurs: { nom: 'Marc' }, passes: null }];
  const m = await monde({ utilisateur: JOE, problemes: lignes }).charge();
  await m.run('chargerPanneauAdmin()'); await attendre(60);
  const cartes = m.el('admin-body').children.filter((c) => c.innerHTML && c.innerHTML.includes('💬'));
  const imgs = (c) => c.children.filter((x) => x.className === 'admin-prob-photo');
  eq('le problème AVEC photo montre une miniature (lien signé) ; celui SANS photo n\'en montre pas', [imgs(cartes[0]).length, imgs(cartes[1]).length, imgs(cartes[0])[0].src.startsWith('https://fichiers.test/')], [1, 0, true]);
  await imgs(cartes[0])[0].onclick(); await attendre(30);
  eq('toucher la miniature : la visionneuse s\'ouvre avec la photo', [m.el('photo-overlay').classList.contains('open'), m.el('photo-plein').src.startsWith('https://fichiers.test/')], [true, true]);
  eq('le panneau lit la colonne photo_chemin (colonnes nommées)', lire('js/admin.js').includes("select('id, note, cree_le, photo_chemin, stops(adresse,service,client)"), true);
}

log('\n=== LE CODE : la page, aucune adresse publique, aucune écriture directe ===');
{
  const html = lire('index.html'), css = lire('css/style.css'), fichiers = fs.readdirSync(WWW + 'js').filter((f) => f.endsWith('.js'));
  const sansCommentaires = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const tous = fichiers.map((f) => [f, sansCommentaires(lire('js/' + f))]);
  vrai('la page charge photos.js après problemes.js et avant demarrage.js', html.indexOf('js/problemes.js') < html.indexOf('js/photos.js') && html.indexOf('js/photos.js') < html.lastIndexOf('js/demarrage.js'));
  vrai('l\'appareil photo : champ fichier caché, images seulement, caméra arrière (capture)', /id="prob-photo-input" type="file" accept="image\/\*" capture="environment" style="display:none"/.test(html) && /id="prob-photo-apres" type="file" accept="image\/\*" capture="environment" style="display:none"/.test(html));
  vrai('la page a le bouton 📷, l\'aperçu, « Retirer » et la visionneuse', ['id="prob-photo-btn"', 'onclick="ouvrirAppareilPhoto()"', 'id="prob-photo-apercu"', 'onclick="retirerPhotoProbleme()"', 'id="photo-overlay"', 'onclick="fermerPhoto()"', 'id="photo-plein"'].every((x) => html.includes(x)));
  vrai('AUCUNE adresse publique de photo (l\'espace est privé : seulement des liens signés)', !tous.some(([, s]) => /getPublicUrl|\/object\/public\//.test(s)), tous.filter(([, s]) => /getPublicUrl|\/object\/public\//.test(s)).map(([f]) => f).join());
  vrai('la photo est toujours envoyée SANS remplacement possible (upsert: false) et en JPEG', /upsert:false/.test(sansCommentaires(lire('js/photos.js'))) && /contentType:'image\/jpeg'/.test(sansCommentaires(lire('js/photos.js'))));
  vrai('l\'application n\'écrit jamais photo_chemin elle-même (seulement la fonction du serveur)', !tous.some(([, s]) => /photo_chemin\s*:/.test(s) && /\.(insert|update|upsert)\(/.test(s.slice(Math.max(0, s.search(/photo_chemin\s*:/) - 200), s.search(/photo_chemin\s*:/) + 200))));
  vrai('la photo est envoyée APRÈS le texte (l\'insertion du problème vient avant l\'envoi du fichier dans envoyerProbleme)', (() => { const s = sansCommentaires(lire('js/problemes.js')); return s.indexOf(".insert([{id:_idProbleme") < s.indexOf('envoyerPhotoProbleme(_idProbleme'); })());
  vrai('la miniature d\'une photo fait au moins 64 px de côté, les boutons au moins 36 px, la visionneuse est au-dessus de tout', /\.sc-prob-photo\{[^}]*width:64px;height:64px/.test(css) && /\.sc-prob-ajout\{[^}]*min-height:36px/.test(css) && /#photo-overlay\{[^}]*z-index:4500/.test(css));
  vrai('la photo réduite est limitée à 1280 px et sous 2 Mo (comme l\'espace privé)', /PHOTO_COTE_MAX=1280/.test(lire('js/photos.js')) && /PHOTO_OCTETS_MAX=1800000/.test(lire('js/photos.js')));
}

tousLesMondes.forEach((w) => w.fin());
console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
