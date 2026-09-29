// Un LECTEUR DE PDF minuscule et STRICT, pour les tests seulement : il relit le fichier fabriqué par www/js/pdf-simple.js, octet par octet, sans se fier à l'écrivain
// (la table des positions, les longueurs des contenus, l'arbre des pages), puis rend ce qui est dessiné sur chaque page : textes (position, taille, gras, couleur), traits, rectangles.
// Les positions rendues sont celles de l'écrivain (origine en HAUT à gauche, y vers le bas). Toute anomalie est notée dans « erreurs » (un fichier correct : aucune erreur).
// N'est PAS un lecteur de PDF général : il ne comprend que ce que pdf-simple.js écrit.

const cp1252 = new TextDecoder('windows-1252');
const ascii = (octets) => Array.from(octets, (b) => String.fromCharCode(b)).join('');

export function lirePdf(octets) {
  const erreurs = [];
  const err = (m) => erreurs.push(m);
  const texteComplet = ascii(octets);   // (chaque octet = un caractère : les positions sont des positions d'octets)
  if (!texteComplet.startsWith('%PDF-1.4\n%')) err('le fichier ne commence pas par « %PDF-1.4 » suivi d\'une ligne de commentaire binaire');
  if (!(octets[10] > 127 && octets[11] > 127 && octets[12] > 127 && octets[13] > 127 && octets[14] === 10)) err('la 2e ligne devrait contenir des octets > 127 (fichier binaire)');
  if (!texteComplet.endsWith('\n%%EOF\n')) err('le fichier ne se termine pas par « %%EOF »');

  // startxref → xref
  const fin = texteComplet.lastIndexOf('startxref\n');
  const m = /^startxref\n(\d+)\n%%EOF\n$/.exec(texteComplet.slice(fin));
  let debutXref = -1;
  if (fin < 0 || !m) err('« startxref » introuvable ou mal formé');
  else debutXref = Number(m[1]);
  const xrefTexte = debutXref >= 0 ? texteComplet.slice(debutXref) : '';
  if (debutXref >= 0 && !xrefTexte.startsWith('xref\n0 ')) err('startxref ne pointe pas sur « xref »');
  const entete = /^xref\n0 (\d+)\n/.exec(xrefTexte);
  const nbEntrees = entete ? Number(entete[1]) : 0;
  const decalages = [];
  if (entete) {
    let p = entete[0].length;
    for (let n = 0; n < nbEntrees; n++) {
      const e = xrefTexte.slice(p, p + 20);
      if (!/^\d{10} \d{5} [nf] \n$/.test(e)) { err('entrée ' + n + ' de la table xref mal formée : ' + JSON.stringify(e)); break; }
      if (n === 0 && e !== '0000000000 65535 f \n') err('la 1re entrée de la table xref doit être « 0000000000 65535 f »');
      if (n > 0) decalages[n] = Number(e.slice(0, 10));
      p += 20;
    }
    const trailer = /^trailer\n<< \/Size (\d+) \/Root 1 0 R \/Info 5 0 R >>\nstartxref\n/.exec(xrefTexte.slice(p));
    if (!trailer) err('la « trailer » est mal formée');
    else if (Number(trailer[1]) !== nbEntrees) err('/Size (' + trailer[1] + ') ≠ nombre d\'entrées (' + nbEntrees + ')');
  }

  // chaque objet, à sa place annoncée
  const objets = new Map();   // n → {texte, flux (octets ou null)}
  for (let n = 1; n < nbEntrees; n++) {
    const debut = decalages[n];
    const tete = n + ' 0 obj\n';
    if (texteComplet.slice(debut, debut + tete.length) !== tete) { err('l\'objet ' + n + ' n\'est pas à la position annoncée (' + debut + ')'); continue; }
    const corps = texteComplet.slice(debut + tete.length);
    const finObjet = corps.indexOf('\nendobj\n');
    // un objet « flux » : le mot « stream » suit le dictionnaire ; sa longueur est celle de /Length (les octets du flux peuvent contenir n'importe quoi)
    const mFlux = /^(<< \/Length (\d+) >>)\nstream\n/.exec(corps);
    if (mFlux) {
      const longueur = Number(mFlux[2]);
      const debutFlux = mFlux[0].length;
      const apres = corps.slice(debutFlux + longueur, debutFlux + longueur + '\nendstream\nendobj\n'.length);
      if (apres !== '\nendstream\nendobj\n') err('le contenu ' + n + ' n\'a pas la longueur annoncée (/Length ' + longueur + ')');
      objets.set(n, { texte: mFlux[1], flux: octets.slice(debut + tete.length + debutFlux, debut + tete.length + debutFlux + longueur) });
    } else {
      if (finObjet < 0) { err('l\'objet ' + n + ' ne se termine pas par « endobj »'); continue; }
      objets.set(n, { texte: corps.slice(0, finObjet), flux: null });
    }
  }
  if (objets.get(1)?.texte !== '<< /Type /Catalog /Pages 2 0 R >>') err('le catalogue est mal formé');
  const arbre = /^<< \/Type \/Pages \/Count (\d+) \/Kids \[((?:\d+ 0 R ?)+)\] >>$/.exec(objets.get(2)?.texte ?? '');
  if (!arbre) err('l\'arbre des pages est mal formé');
  const enfants = arbre ? arbre[2].trim().split(' 0 R').map((x) => x.trim()).filter(Boolean).map(Number) : [];
  if (arbre && Number(arbre[1]) !== enfants.length) err('/Count ne correspond pas au nombre de pages');
  const polices = [objets.get(3)?.texte, objets.get(4)?.texte];
  if (polices[0] !== '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>') err('la police F1 est mal décrite');
  if (polices[1] !== '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>') err('la police F2 est mal décrite');

  // les informations
  const info = {};
  const it = objets.get(5)?.texte ?? '';
  const hex = (s) => { const b = s.match(/[0-9A-F]{4}/g) || []; return b.slice(1).map((h) => String.fromCharCode(parseInt(h, 16))).join(''); };
  const mt = /\/Title <(FEFF[0-9A-F]*)>/.exec(it); if (mt) info.titre = hex(mt[1]);
  const ma = /\/Author <(FEFF[0-9A-F]*)>/.exec(it); if (ma) info.auteur = hex(ma[1]);
  const md = /\/CreationDate \(D:(\d{14})\)/.exec(it); if (md) info.date = md[1];
  if (!/\/Producer \(Lapointe Tracker\)/.test(it)) err('l\'information « Producer » manque');

  // les pages
  const pages = [];
  for (const n of enfants) {
    const p = objets.get(n)?.texte ?? '';
    const mp = /^<< \/Type \/Page \/Parent 2 0 R \/MediaBox \[0 0 ([\d.]+) ([\d.]+)\] \/Resources << \/Font << \/F1 3 0 R \/F2 4 0 R >> >> \/Contents (\d+) 0 R >>$/.exec(p);
    if (!mp) { err('la page ' + n + ' est mal formée : ' + p.slice(0, 120)); continue; }
    if (Number(mp[3]) !== n + 1) err('le contenu de la page ' + n + ' n\'est pas l\'objet suivant');
    const flux = objets.get(Number(mp[3]))?.flux;
    if (!flux) { err('la page ' + n + ' n\'a pas de contenu'); continue; }
    pages.push({ objet: n, largeur: Number(mp[1]), hauteur: Number(mp[2]), ...lireContenu(flux, Number(mp[2]), err, n) });
  }
  return { erreurs, info, pages, nbObjets: nbEntrees - 1, taille: octets.length };
}

// Le contenu d'une page : une instruction par ligne (c'est ainsi que pdf-simple.js l'écrit)
function lireContenu(flux, hauteur, err, numeroPage) {
  const textes = [], traits = [], rects = [];
  let i = 0;
  const ligne = () => {
    if (i >= flux.length) return null;
    let j = i;
    while (j < flux.length && flux[j] !== 10) j++;
    const l = flux.slice(i, j);
    i = j + 1;
    return l;
  };
  let couleurRemplissage = '0 0 0', couleurTrait = '0 0 0', epaisseur = 0.5;
  let police = null, taille = null, position = null, dansTexte = false, courant = null;
  const bas = (y) => Math.round((hauteur - y) * 100) / 100;
  const nombres = (s) => s.split(' ').map(Number);
  for (;;) {
    const l = ligne();
    if (l === null) break;
    const t = ascii(l);
    let r;
    if (t === 'BT') { if (dansTexte) err('page ' + numeroPage + ' : BT imbriqué'); dansTexte = true; courant = {}; continue; }
    if (t === 'ET') { if (!dansTexte || !courant.montre) err('page ' + numeroPage + ' : ET sans texte'); dansTexte = false; if (courant && courant.montre) textes.push(courant); courant = null; continue; }
    if ((r = /^\/(F1|F2) ([\d.]+) Tf$/.exec(t))) { if (!dansTexte) err('page ' + numeroPage + ' : Tf hors d\'un texte'); police = r[1]; taille = Number(r[2]); courant.gras = police === 'F2'; courant.taille = taille; continue; }
    if ((r = /^([\d.]+ [\d.]+ [\d.]+) rg$/.exec(t))) { couleurRemplissage = r[1]; if (dansTexte) courant.couleur = r[1]; continue; }
    if ((r = /^([\d.]+ [\d.]+ [\d.]+) RG$/.exec(t))) { couleurTrait = r[1]; continue; }
    if ((r = /^([\d.]+) w$/.exec(t))) { epaisseur = Number(r[1]); continue; }
    if ((r = /^(-?[\d.]+) (-?[\d.]+) Td$/.exec(t))) { if (!dansTexte) err('page ' + numeroPage + ' : Td hors d\'un texte'); courant.x = Number(r[1]); courant.y = bas(Number(r[2])); continue; }
    if (t.startsWith('(') && dansTexte) {
      // « (texte) Tj » : comme le veut la norme PDF, une chaîne entre parenthèses peut contenir des parenthèses NON échappées si elles sont équilibrées ; une parenthèse ou une barre
      // oblique inverse échappée (\( \) \\) compte pour un caractère. La chaîne finit à la parenthèse fermante qui remet le compte de parenthèses ouvertes à zéro.
      const octets = [];
      let k = 1, ouvertes = 1;
      for (; k < l.length; k++) {
        if (l[k] === 92) { octets.push(l[k + 1]); k++; continue; }
        if (l[k] === 40) ouvertes++;
        if (l[k] === 41) { ouvertes--; if (ouvertes === 0) break; }
        octets.push(l[k]);
      }
      if (ouvertes !== 0 || ascii(l.slice(k)) !== ') Tj') err('page ' + numeroPage + ' : la chaîne du texte n\'est pas fermée comme il faut (parenthèses déséquilibrées, ou « Tj » absent)');
      courant.texte = cp1252.decode(Uint8Array.from(octets));
      courant.montre = true;
      continue;
    }
    if ((r = /^(-?[\d.]+) (-?[\d.]+) m$/.exec(t))) { position = [Number(r[1]), bas(Number(r[2]))]; continue; }
    if ((r = /^(-?[\d.]+) (-?[\d.]+) l$/.exec(t))) { if (!position) err('page ' + numeroPage + ' : l sans m'); else traits.push({ x1: position[0], y1: position[1], x2: Number(r[1]), y2: bas(Number(r[2])), couleur: couleurTrait, epaisseur }); continue; }
    if (t === 'S' && position) { position = null; continue; }
    if ((r = /^(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re$/.exec(t))) { const [x, yBas, w, h] = nombres(t.replace(' re', '')); rects.push({ x, y: bas(yBas + h), l: w, h, remplissage: couleurRemplissage, contour: couleurTrait, epaisseur, op: null }); continue; }
    if (t === 'f' || t === 'B' || (t === 'S' && rects.length && rects[rects.length - 1].op === null)) {
      const d = rects[rects.length - 1];
      if (!d || d.op !== null) { err('page ' + numeroPage + ' : « ' + t + ' » sans rectangle'); continue; }
      d.op = t;
      if (t === 'f') d.contour = null; else if (t === 'S') d.remplissage = null;
      continue;
    }
    err('page ' + numeroPage + ' : instruction inconnue : ' + JSON.stringify(t.slice(0, 60)));
  }
  if (dansTexte) err('page ' + numeroPage + ' : un texte n\'est pas fermé (ET manquant)');
  return { textes, traits, rects };
}
