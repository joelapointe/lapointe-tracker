// =====================================================================
// Edge Function « calculer-parcours » — ÉTAPE 18b
// Calcule, pour l'administrateur (Joé) seulement, les TRONÇONS du tracé qui suit les rues : le trajet d'un client au suivant,
// dans l'ordre choisi (stops.ordre), pour chaque route et chaque type de service.
//
// Appel : POST, corps JSON facultatif :
//   { route_id?: uuid }     ne s'occuper que de cette route (sinon : toutes)
//   { refaire_sans_route?: true }   redemander aussi les tronçons où le service n'avait trouvé « aucune route »
// Réponse : { ok: true, calcules, sans_route, echecs, restants, total_troncons, limite_atteinte }
//   « restants » > 0 : il en reste à calculer (au plus 40 par appel, pour rester rapide) : rappeler la fonction.
//
// Ce que la fonction fait :
//   1) lit les arrêts actifs qui ont une position, les groupe par (route, type de service), les met dans l'ordre (ordre, puis date de
//      création, puis identifiant : exactement comme l'application) ;
//   2) en déduit les tronçons voulus (chaque client vers le suivant) et repère ceux qui MANQUENT ou qui sont PÉRIMÉS (un des deux arrêts a bougé) ;
//   3) pour chacun, demande le trajet en voiture à Geoapify (données OpenStreetMap), le simplifie (3 m de tolérance) et l'écrit dans
//      la table parcours_segments (fichier SQL 22). Un tronçon déjà bon n'est JAMAIS redemandé (chaque appel coûte 1 crédit chez Geoapify).
//
// Sécurité :
//   • L'appelant est vérifié à CHAQUE requête avec SON propre jeton : la base répond à est_admin() (comme admin-employes).
//   • La clé du service d'itinéraire est un SECRET Supabase (nom : GEOAPIFY_KEY), lu ici seulement. Elle n'est écrite nulle part dans ce
//     fichier ni dans l'application, et n'est jamais écrite dans les journaux.
//   • La table parcours_segments n'est écrite que par cette fonction (clé secrète du serveur) ; les positions viennent de la base,
//     jamais de l'appelant : personne ne peut faire tracer un trajet de son choix.
//   • Le journal ne contient ni adresses, ni noms, ni positions : seulement des nombres.
//
// Le code de décision est séparé des appels au monde extérieur (voir « Deps ») pour être testé sans réseau :
// supabase/tests/test-etape-18b.mjs.
// =====================================================================

declare const Deno: any;

const CORS = {
  'Access-Control-Allow-Origin': '*',   // l'accès est protégé par le jeton, pas par l'origine
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const TRONCONS_PAR_APPEL = 40;        // au plus 40 trajets demandés par appel (le forfait gratuit donne 3 000 crédits par jour)
export const PAUSE_ENTRE_APPELS_MS = 250;    // le forfait gratuit accepte quelques demandes par seconde : on reste sous la limite
export const PAUSE_LIMITE_MS = 1500;         // un refus « trop de demandes » : on attend, puis un seul nouvel essai
export const DUREE_MAX_APPEL_MS = 100_000;   // au bout de 100 s de travail, on n'entame plus de nouveau tronçon (Supabase coupe une fonction à 150 s) : l'application rappelle
export const TOLERANCE_M = 3;                // la ligne est simplifiée : un point qui dévie de moins de 3 m de la ligne est retiré
export const DISTANCE_CONFONDUS_M = 8;       // deux clients à moins de 8 m l'un de l'autre : rien à demander au service
const EPSILON_POSITION = 1e-7;               // deux positions identiques à 1e-7 degré près (≈ 1 cm)

// ---------------------------------------------------------------------
// Ce que la fonction demande au monde extérieur (remplaçable dans les tests)
// ---------------------------------------------------------------------
export type Arret = { id: string; route_id: string | null; service: string | null; lat: number | null; lon: number | null; ordre: number | null };
export type Point = { lat: number; lon: number };
export type SegmentGarde = { de_arret_id: string; vers_arret_id: string; de_lat: number; de_lon: number; vers_lat: number; vers_lon: number; statut: string };
export type SegmentAEcrire = {
  de_arret_id: string; vers_arret_id: string; de_lat: number; de_lon: number; vers_lat: number; vers_lon: number;
  statut: 'ok' | 'sans_route'; trace: [number, number][] | null; distance_m: number | null; duree_s: number | null;
};
export type Trajet = { trace: [number, number][]; distance_m: number; duree_s: number };
export type Itineraire = Trajet | { erreur: 'sans_route' | 'cle_refusee' | 'limite' | 'indisponible' };

export type Deps = {
  estAdmin(authorization: string): Promise<boolean>;
  cleGeoapifyPresente(): boolean;
  lireArrets(): Promise<Arret[]>;                          // les arrêts ACTIFS, dans l'ordre : ordre, date de création, identifiant
  lireSegments(): Promise<SegmentGarde[]>;
  ecrireSegment(s: SegmentAEcrire): Promise<void>;         // écrit ou remplace le tronçon (de_arret_id, vers_arret_id)
  itineraire(de: Point, vers: Point): Promise<Itineraire>;
  attendre(ms: number): Promise<void>;
  maintenant(): number;                                    // l'heure en millisecondes (remplaçable dans les tests)
  journal(ligne: string): void;
};

// ---------------------------------------------------------------------
// Les tronçons voulus
// ---------------------------------------------------------------------
const EST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function valeurOrdre(a: Arret): number {
  const n = Number(a && a.ordre);
  return isFinite(n) ? n : 0;
}

/** Trie par « ordre » ; à égalité, l'ordre de départ est gardé (comme enOrdre dans www/js/ordre.js). */
export function enOrdre(liste: Arret[]): Arret[] {
  return liste.map((s, i) => ({ s, i })).sort((a, b) => valeurOrdre(a.s) - valeurOrdre(b.s) || a.i - b.i).map((x) => x.s);
}

function aUnePosition(a: Arret): boolean {
  return !!a.lat && !!a.lon && isFinite(a.lat) && isFinite(a.lon);
}

/** Les suites de clients : une par (route, type de service), chacune dans l'ordre. Un arrêt sans route, sans service ou sans position n'en fait pas partie. */
export function sequences(arrets: Arret[]): Arret[][] {
  const groupes = new Map<string, Arret[]>();
  for (const a of arrets) {
    if (!a.route_id || !a.service || !aUnePosition(a)) continue;
    const cle = a.route_id + '|' + a.service;
    let g = groupes.get(cle);
    if (!g) { g = []; groupes.set(cle, g); }
    g.push(a);
  }
  return [...groupes.values()].map(enOrdre);
}

export type Paire = { de: Arret; vers: Arret };

/** Chaque client vers le suivant, sans doublon (un même couple peut revenir dans deux suites). */
export function paires(suites: Arret[][]): Paire[] {
  const vus = new Set<string>();
  const sortie: Paire[] = [];
  for (const s of suites) {
    for (let i = 0; i + 1 < s.length; i++) {
      const cle = s[i].id + '|' + s[i + 1].id;
      if (s[i].id === s[i + 1].id || vus.has(cle)) continue;
      vus.add(cle);
      sortie.push({ de: s[i], vers: s[i + 1] });
    }
  }
  return sortie;
}

const memePosition = (a: number, b: number) => Math.abs(a - b) < EPSILON_POSITION;

/** Le tronçon gardé vaut-il encore ? (les deux arrêts n'ont pas bougé depuis le calcul) */
export function segmentValide(s: SegmentGarde | undefined, p: Paire): boolean {
  return !!s && memePosition(s.de_lat, p.de.lat!) && memePosition(s.de_lon, p.de.lon!) && memePosition(s.vers_lat, p.vers.lat!) && memePosition(s.vers_lon, p.vers.lon!);
}

/** Les tronçons à calculer : ceux qui manquent ou qui sont périmés. « sans_route » compte comme fait (on ne redemande pas), sauf si refaireSansRoute. */
export function manquants(voulus: Paire[], gardes: SegmentGarde[], refaireSansRoute = false): Paire[] {
  const index = new Map(gardes.map((s) => [s.de_arret_id + '|' + s.vers_arret_id, s]));
  return voulus.filter((p) => {
    const s = index.get(p.de.id + '|' + p.vers.id);
    if (!segmentValide(s, p)) return true;
    return refaireSansRoute && s!.statut === 'sans_route';
  });
}

// ---------------------------------------------------------------------
// La ligne : lecture de la réponse de Geoapify, simplification, arrondi
// ---------------------------------------------------------------------
/** Distance en mètres entre deux positions (formule de haversine). */
export function distanceM(a: Point, b: Point): number {
  const R = 6371008.8, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Lit la réponse GeoJSON de Geoapify (GET /v1/routing) : features[0].geometry est un « MultiLineString » (une ligne par étape, points [longitude, latitude]),
 * features[0].properties.distance (mètres) et .time (secondes). Renvoie la ligne en [latitude, longitude] (l'ordre de Leaflet), ou null si la réponse est inutilisable.
 */
export function lireGeoapify(json: any): Trajet | null {
  const f = json?.features?.[0];
  const g = f?.geometry;
  if (!g || !Array.isArray(g.coordinates)) return null;
  let lignes: any[];
  if (g.type === 'MultiLineString') lignes = g.coordinates;
  else if (g.type === 'LineString') lignes = [g.coordinates];
  else return null;
  const points: [number, number][] = [];
  for (const ligne of lignes) {
    if (!Array.isArray(ligne)) return null;
    for (const c of ligne) {
      if (!Array.isArray(c) || typeof c[0] !== 'number' || typeof c[1] !== 'number') return null;
      const lon = c[0], lat = c[1];
      if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
      const dernier = points[points.length - 1];
      if (!dernier || dernier[0] !== lat || dernier[1] !== lon) points.push([lat, lon]);   // (le point d'arrivée d'une étape est le départ de la suivante)
    }
  }
  if (points.length < 2) return null;
  const distance = Number(f.properties?.distance), temps = Number(f.properties?.time);
  return { trace: points, distance_m: isFinite(distance) ? Math.round(distance) : 0, duree_s: isFinite(temps) ? Math.round(temps) : 0 };
}

/** Douglas-Peucker : retire les points qui s'écartent de moins de « tolerance » mètres de la ligne ; le premier et le dernier point restent toujours. */
export function simplifier(pts: [number, number][], tolerance: number): [number, number][] {
  if (pts.length <= 2) return pts.slice();
  const ky = 110540, kx = 111320 * Math.cos(pts[0][0] * Math.PI / 180);
  const X = pts.map((p) => p[1] * kx), Y = pts.map((p) => p[0] * ky);
  const garde = new Uint8Array(pts.length);
  garde[0] = 1; garde[pts.length - 1] = 1;
  const pile: [number, number][] = [[0, pts.length - 1]];
  while (pile.length) {
    const [a, b] = pile.pop()!;
    const dx = X[b] - X[a], dy = Y[b] - Y[a], l2 = dx * dx + dy * dy;
    let dmax = 0, imax = -1;
    for (let i = a + 1; i < b; i++) {
      let d: number;
      if (l2 === 0) d = Math.hypot(X[i] - X[a], Y[i] - Y[a]);
      else {
        const t = Math.max(0, Math.min(1, ((X[i] - X[a]) * dx + (Y[i] - Y[a]) * dy) / l2));
        d = Math.hypot(X[i] - (X[a] + t * dx), Y[i] - (Y[a] + t * dy));
      }
      if (d > dmax) { dmax = d; imax = i; }
    }
    if (imax >= 0 && dmax > tolerance) { garde[imax] = 1; pile.push([a, imax], [imax, b]); }
  }
  return pts.filter((_, i) => garde[i]);
}

/** 5 décimales (≈ 1 m) : assez fin pour une ligne sur une carte, et la table reste petite. Deux points voisins qui deviennent identiques sont fusionnés. */
export function arrondir(pts: [number, number][]): [number, number][] {
  const r = (x: number) => Math.round(x * 1e5) / 1e5;
  const sortie: [number, number][] = [];
  for (const p of pts) {
    const q: [number, number] = [r(p[0]), r(p[1])];
    const d = sortie[sortie.length - 1];
    if (!d || d[0] !== q[0] || d[1] !== q[1]) sortie.push(q);
  }
  if (sortie.length < 2) return [[r(pts[0][0]), r(pts[0][1])], [r(pts[pts.length - 1][0]), r(pts[pts.length - 1][1])]];
  return sortie;
}

// ---------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------
type Reponse = { statut: number; corps: Record<string, unknown> };
const ok = (corps: Record<string, unknown>): Reponse => ({ statut: 200, corps: { ok: true, ...corps } });
const refus = (statut: number, erreur: string, message: string): Reponse => ({ statut, corps: { ok: false, erreur, message } });

const NON_AUTORISE = refus(403, 'non_autorise', 'Réservé à l\'administrateur.');

// ---------------------------------------------------------------------
// Le calcul
// ---------------------------------------------------------------------
async function calculer(deps: Deps, corps: any): Promise<Reponse> {
  if (corps.route_id !== undefined && (typeof corps.route_id !== 'string' || !EST_UUID.test(corps.route_id))) {
    return refus(400, 'requete_invalide', 'Identifiant de route invalide.');
  }
  if (!deps.cleGeoapifyPresente()) {
    return refus(500, 'cle_absente', 'La clé Geoapify n\'est pas enregistrée : Supabase > Edge Functions > Secrets > ajouter GEOAPIFY_KEY.');
  }
  const refaire = corps.refaire_sans_route === true;
  const arrets = await deps.lireArrets();
  const retenus = corps.route_id ? arrets.filter((a) => a.route_id === String(corps.route_id).toLowerCase()) : arrets;
  const voulus = paires(sequences(retenus));
  const aFaire = manquants(voulus, await deps.lireSegments(), refaire);

  let calcules = 0, sansRoute = 0, echecs = 0, traites = 0, limite = false;
  const lot = aFaire.slice(0, TRONCONS_PAR_APPEL);
  const debut = deps.maintenant();
  for (const p of lot) {
    if (deps.maintenant() - debut > DUREE_MAX_APPEL_MS) break;   // trop long : ce qui reste sera fait à l'appel suivant (« restants »)
    const de: Point = { lat: p.de.lat!, lon: p.de.lon! }, vers: Point = { lat: p.vers.lat!, lon: p.vers.lon! };
    const base = { de_arret_id: p.de.id, vers_arret_id: p.vers.id, de_lat: de.lat, de_lon: de.lon, vers_lat: vers.lat, vers_lon: vers.lon };

    // Deux clients au même endroit : aucun trajet à demander (et aucun crédit dépensé)
    const separes = distanceM(de, vers);
    if (separes < DISTANCE_CONFONDUS_M) {
      await deps.ecrireSegment({ ...base, statut: 'ok', trace: [[de.lat, de.lon], [vers.lat, vers.lon]], distance_m: Math.round(separes), duree_s: 0 });
      calcules++; traites++;
      continue;
    }

    let r = await deps.itineraire(de, vers);
    if ('erreur' in r && r.erreur === 'limite') {   // « trop de demandes » : on attend un peu, puis UN nouvel essai
      await deps.attendre(PAUSE_LIMITE_MS);
      r = await deps.itineraire(de, vers);
    }
    if ('erreur' in r) {
      if (r.erreur === 'cle_refusee') {
        deps.journal(`calculer -> cle_refusee (calcules=${calcules})`);
        return refus(502, 'cle_refusee', 'Geoapify a refusé la clé : vérifiez GEOAPIFY_KEY dans Supabase > Edge Functions > Secrets (et que la clé est active chez Geoapify).');
      }
      if (r.erreur === 'limite') { limite = true; break; }
      if (r.erreur === 'sans_route') {
        await deps.ecrireSegment({ ...base, statut: 'sans_route', trace: null, distance_m: null, duree_s: null });
        sansRoute++; traites++;
      } else {
        echecs++;   // panne passagère du service : rien n'est écrit, un prochain appel réessaiera
      }
    } else {
      const trace = arrondir(simplifier(r.trace, TOLERANCE_M));
      await deps.ecrireSegment({ ...base, statut: 'ok', trace, distance_m: r.distance_m, duree_s: r.duree_s });
      calcules++; traites++;
    }
    await deps.attendre(PAUSE_ENTRE_APPELS_MS);
  }
  const restants = aFaire.length - traites;
  deps.journal(`calculer -> ok calcules=${calcules} sans_route=${sansRoute} echecs=${echecs} restants=${restants} total=${voulus.length}${limite ? ' limite' : ''}`);
  return ok({ calcules, sans_route: sansRoute, echecs, restants, total_troncons: voulus.length, limite_atteinte: limite });
}

// ---------------------------------------------------------------------
// Point d'entrée (testable : reçoit une Request, renvoie une Response)
// ---------------------------------------------------------------------
export async function traiter(req: Request, deps: Deps): Promise<Response> {
  const repondre = (r: Reponse) => new Response(JSON.stringify(r.corps), { status: r.statut, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return repondre(refus(405, 'methode_refusee', 'POST seulement.'));

  const autorisation = req.headers.get('Authorization') ?? '';
  try {
    // 1) Qui appelle ? Un administrateur actif, sinon rien d'autre n'est lu ni fait.
    if (!/^Bearer\s+\S+$/i.test(autorisation) || !(await deps.estAdmin(autorisation))) {
      deps.journal('refus non_autorise');
      return repondre(NON_AUTORISE);
    }
    // 2) Le corps est facultatif (un appel sans rien = « tout mettre à jour »)
    const texte = await req.text();
    let corps: any = {};
    if (texte.trim() !== '') {
      try { corps = JSON.parse(texte); } catch { corps = null; }
    }
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return repondre(refus(400, 'requete_invalide', 'Corps JSON invalide.'));
    return repondre(await calculer(deps, corps));
  } catch (e) {
    deps.journal(`calculer -> exception ${e instanceof Error ? e.name + ':' + e.message.slice(0, 40) : 'inconnue'}`);
    return repondre(refus(500, 'erreur_interne', 'Erreur interne. Réessayez ; si le problème continue, regardez les journaux de la fonction.'));
  }
}

// ---------------------------------------------------------------------
// Branchement sur Supabase et sur Geoapify (seulement quand la fonction tourne dans Supabase)
// ---------------------------------------------------------------------
async function depsSupabase(): Promise<Deps> {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const url = Deno.env.get('SUPABASE_URL');
  // Anciennes clés (fournies automatiquement) ; à défaut, les nouvelles clés (dictionnaires JSON).
  const cle = (ancienne: string, dictionnaire: string): string | undefined => {
    const v = Deno.env.get(ancienne);
    if (v) return v;
    try { const d = JSON.parse(Deno.env.get(dictionnaire) ?? '{}'); return d.default ?? Object.values(d)[0]; } catch { return undefined; }
  };
  const anon = cle('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS');
  const service = cle('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
  if (!url || !anon || !service) throw new Error('configuration_manquante');
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, service, opts);
  const cleGeoapify = (Deno.env.get('GEOAPIFY_KEY') ?? '').trim();

  // Le service de données rend au plus 1 000 lignes par requête : on lit par tranches
  const lireTout = async (requete: (de: number, a: number) => Promise<{ data: any[] | null; error: any }>): Promise<any[]> => {
    const tout: any[] = [];
    for (let de = 0; ; de += 1000) {
      const { data, error } = await requete(de, de + 999);
      if (error) throw new Error('lecture');
      tout.push(...(data ?? []));
      if (!data || data.length < 1000) return tout;
    }
  };

  return {
    async estAdmin(authorization) {
      // Le jeton de l'appelant, pas la clé secrète : la base voit QUI appelle.
      const c = createClient(url, anon, { ...opts, global: { headers: { Authorization: authorization } } });
      const { data, error } = await c.rpc('est_admin');
      return !error && data === true;
    },
    cleGeoapifyPresente: () => cleGeoapify.length > 0,
    lireArrets: () => lireTout((de, a) => admin.from('stops').select('id, route_id, service, lat, lon, ordre').eq('actif', true)
      .order('ordre', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(de, a)),
    lireSegments: () => lireTout((de, a) => admin.from('parcours_segments').select('de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, vers_lon, statut')
      .order('de_arret_id', { ascending: true }).order('vers_arret_id', { ascending: true }).range(de, a)),
    async ecrireSegment(s) {
      const { error } = await admin.from('parcours_segments').upsert({ ...s, calcule_le: new Date().toISOString() }, { onConflict: 'de_arret_id,vers_arret_id' });
      if (error) { console.log(`ecriture parcours_segments refusée (code ${error.code ?? '?'})`); throw new Error('ecriture_segment'); }
    },
    async itineraire(de, vers) {
      // GET https://api.geoapify.com/v1/routing?waypoints=lat,lon|lat,lon&mode=drive&apiKey=… → GeoJSON (voir lireGeoapify).
      // L'adresse complète contient la clé : elle n'est JAMAIS écrite dans le journal (seulement le code de réponse).
      const waypoints = encodeURIComponent(`${de.lat},${de.lon}|${vers.lat},${vers.lon}`);
      const adresse = `https://api.geoapify.com/v1/routing?waypoints=${waypoints}&mode=drive&apiKey=${encodeURIComponent(cleGeoapify)}`;
      let r: Response;
      try { r = await fetch(adresse, { signal: AbortSignal.timeout(20000) }); }
      catch { console.log('Geoapify : pas de réponse'); return { erreur: 'indisponible' }; }
      if (r.status === 401 || r.status === 403) { console.log(`Geoapify : clé refusée (${r.status})`); return { erreur: 'cle_refusee' }; }
      if (r.status === 429) { console.log('Geoapify : trop de demandes (429)'); return { erreur: 'limite' }; }
      if (r.status === 400 || r.status === 404) { console.log(`Geoapify : demande refusée (${r.status})`); return { erreur: 'sans_route' }; }
      if (!r.ok) { console.log(`Geoapify : erreur ${r.status}`); return { erreur: 'indisponible' }; }
      let json: any;
      try { json = await r.json(); } catch { return { erreur: 'indisponible' }; }
      const lu = lireGeoapify(json);
      return lu ?? { erreur: 'sans_route' };
    },
    attendre: (ms) => new Promise((r) => setTimeout(r, ms)),
    maintenant: () => Date.now(),
    journal: (ligne) => console.log(ligne),
  };
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  let deps: Promise<Deps> | null = null;
  Deno.serve((req: Request) => {
    if (req.method === 'OPTIONS') return traiter(req, null as unknown as Deps);   // la pré-vérification CORS n'a pas besoin de Supabase
    deps ??= depsSupabase();
    return deps.then((d) => traiter(req, d)).catch(() => {
      deps = null;
      return new Response(JSON.stringify({ ok: false, erreur: 'configuration', message: 'La fonction n\'est pas configurée correctement.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    });
  });
}
