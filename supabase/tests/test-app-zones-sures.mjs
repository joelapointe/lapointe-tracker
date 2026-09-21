// Préparation iPhone : les zones sûres (encoche en haut, barre d'accueil en bas). Sur Android et sur ordinateur elles valent 0 : rien ne change.
// Ce test lit index.html et css/style.css (WWW_TEST : un autre dossier « www », pour les erreurs volontaires).
import fs from 'fs';
import { fileURLToPath } from 'url';
const WWW = process.env.WWW_TEST ? process.env.WWW_TEST.split('\\').join('/').replace(/\/?$/, '/') : fileURLToPath(new URL('../../www/', import.meta.url));

let ok = 0, ko = 0;
const log = (s) => console.log(s);
const pass = (l) => { ok++; log('  ✔ ' + l); };
const fail = (l, d) => { ko++; log('  ✘ ' + l + (d ? '  -> ' + d : '')); };
const vrai = (l, c, d) => (c ? pass(l) : fail(l, d));
const eq = (l, a, b) => (JSON.stringify(a) === JSON.stringify(b) ? pass(l) : fail(l, `obtenu ${JSON.stringify(a)}, attendu ${JSON.stringify(b)}`));

const html = fs.readFileSync(WWW + 'index.html', 'utf8');
const css = fs.readFileSync(WWW + 'css/style.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const regles = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim().replace(/\s+/g, ' '), corps: m[2].replace(/\s+/g, '') }));
const de = (sel) => regles.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel));
const derniere = (sel) => de(sel).pop();

log('=== LA PAGE ET LES VARIABLES ===');
{
  const meta = html.match(/<meta name="viewport"[^>]*>/)?.[0] ?? '';
  vrai('la page demande tout l\'écran (viewport-fit=cover) : sinon un iPhone ne donne jamais ses zones sûres', meta.includes('viewport-fit=cover'), meta);
  vrai('… et garde ses réglages d\'avant (largeur de l\'appareil, pas de zoom)', meta.includes('width=device-width') && meta.includes('user-scalable=no'), meta);
  const racine = regles.find((r) => r.sel === ':root')?.corps ?? '';
  eq('--sa-top et --sa-bottom viennent de l\'appareil, avec 0px si l\'appareil n\'en donne pas (Android, ordinateur : rien ne change)',
    [racine.includes('--sa-top:env(safe-area-inset-top,0px)'), racine.includes('--sa-bottom:env(safe-area-inset-bottom,0px)')], [true, true]);
}

log('\n=== LE HAUT DE L\'ÉCRAN : RIEN NE PASSE SOUS L\'ENCOCHE ===');
{
  eq('la barre du haut (logo) est descendue de la zone sûre', derniere('#topbar')?.corps.includes('padding:calc(10px+var(--sa-top))'), true);
  eq('la bannière de placement d\'un arrêt aussi', derniere('#placement-banner')?.corps.includes('calc(12px+var(--sa-top))'), true);
  // (certains éléments ont plusieurs règles : on regarde celle qui les POSE)
  for (const sel of ['#controls', '#sync', '#passe-bandeau', '#bandeau-reseau', '#photo-x'])
    eq(`« ${sel} » (posé à N pixels du haut) tient compte de la zone sûre`, de(sel).some((r) => /top:calc\(\d+px\+var\(--sa-top\)\)/.test(r.corps)), true);
  // Règle générale : aucun élément collé en haut avec un décalage fixe sans la zone sûre
  const fautifs = regles.filter((r) => /position:(absolute|fixed)/.test(r.corps) && /(^|;)top:[1-9]\d*px/.test(r.corps) && !r.corps.includes('--sa-top')).map((r) => r.sel);
  eq('AUCUN élément posé à N pixels du haut sans zone sûre (règle générale, pour les écrans à venir)', fautifs, []);
  const collesHaut = regles.filter((r) => /position:(absolute|fixed)/.test(r.corps) && /(^|;)top:0(;|$)/.test(r.corps) && /(^|;)left:0/.test(r.corps) && /(^|;)right:0/.test(r.corps) && !/(^|;)bottom:0/.test(r.corps) && !r.corps.includes('--sa-top')).map((r) => r.sel);
  eq('AUCUNE barre collée tout en haut (top:0) sans zone sûre', collesHaut, []);
}

log('\n=== LE BAS DE L\'ÉCRAN : RIEN NE PASSE SOUS LA BARRE D\'ACCUEIL ===');
{
  const barre = derniere('#bottombar')?.corps ?? '';
  eq('la barre du bas (compte, zone, progression) s\'allonge de la zone sûre et pousse ses boutons au-dessus', [barre.includes('height:calc(72px+var(--sa-bottom))'), barre.includes('padding-bottom:var(--sa-bottom)')], [true, true]);
  eq('la fiche d\'un arrêt reste au-dessus de la barre du bas', /bottom:calc\(72px\+var\(--sa-bottom\)\)/.test(derniere('#stop-card')?.corps ?? ''), true);
  eq('le message flottant aussi', /bottom:calc\(80px\+var\(--sa-bottom\)\)/.test(derniere('#toast')?.corps ?? ''), true);
  const fautifs = regles.filter((r) => /position:(absolute|fixed)/.test(r.corps) && /(^|;)bottom:[1-9]\d*px/.test(r.corps) && !r.corps.includes('--sa-bottom')).map((r) => r.sel);
  eq('AUCUN élément posé à N pixels du bas sans zone sûre (règle générale)', fautifs, []);
  const listeFenetres = ['#liste-overlay', '#overlay', '#admin-overlay', '#routes-overlay', '#nouvelle-route-overlay', '#prob-overlay', '#debut-overlay', '#choix-overlay', '#equipage-overlay'];
  const groupe = regles.find((r) => listeFenetres.every((s) => r.sel.split(',').map((x) => x.trim()).includes(s)));
  eq('les 9 fenêtres qui montent du bas de l\'écran (liste des arrêts, débuter, équipage, problème…) restent au-dessus de la barre d\'accueil', groupe?.corps.includes('padding-bottom:var(--sa-bottom)'), true);
  // Ces fenêtres sont bien alignées en bas (sinon la règle ci-dessus ne les concernerait pas)
  eq('… et elles sont bien toutes alignées en bas', listeFenetres.every((s) => /align-items:flex-end/.test(de(s).find((r) => /align-items/.test(r.corps))?.corps ?? '')), true);
}

console.log(`\n===== RÉSULTAT : ${ok} réussis, ${ko} échoués =====`);
process.exit(ko ? 1 : 0);
