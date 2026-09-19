// =====================================================================
// Edge Function « admin-employes » — ÉTAPE 10
// Gestion des comptes d'employés par l'administrateur (Joé) seulement.
//
// Actions (champ « action » du corps JSON) :
//   creer             { nom, telephone, nip? }   crée le compte (NIP tiré au hasard si absent)
//   desactiver        { id }                     l'employé ne voit plus rien et ne peut plus se connecter
//   reactiver         { id }                     l'inverse (employé saisonnier qui revient)
//   supprimer         { id }                     supprime s'il n'a AUCUN historique, sinon le désactive
//   reinitialiser_nip { id, nip? }               nouveau NIP (tiré au hasard si absent)
//
// Sécurité :
//   • Cette fonction utilise la clé secrète du serveur (SUPABASE_SERVICE_ROLE_KEY), fournie
//     automatiquement par Supabase. Elle n'est écrite nulle part dans ce fichier.
//   • L'appelant est vérifié à CHAQUE requête avec SON propre jeton : la base répond à est_admin().
//     (La clé publique de l'application est un jeton valide pour Supabase, mais est_admin() y répond « non ».)
//   • Le rôle d'un compte n'est jamais écrit ici : tout compte créé est un employé (défaut de la base).
//     Les comptes administrateur ne se modifient pas par cette fonction.
//   • Le NIP n'est jamais écrit dans les journaux.
//
// Le code de décision est séparé des appels à Supabase (voir « Deps ») pour être testé
// sans réseau : supabase/tests/test-etape-10.mjs.
// =====================================================================

declare const Deno: any;

export const DOMAINE_EMAIL = 'tel.entretienlapointe.ca';

const CORS = {
  'Access-Control-Allow-Origin': '*',   // l'accès est protégé par le jeton, pas par l'origine
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------
// Ce que la fonction demande au monde extérieur (remplaçable dans les tests)
// ---------------------------------------------------------------------
export type Profil = { id: string; nom: string; telephone: string | null; role: string; actif: boolean };

export type Deps = {
  estAdmin(authorization: string): Promise<boolean>;
  profilParId(id: string): Promise<Profil | null>;
  profilParTelephone(telephone: string): Promise<Profil | null>;
  definirActif(id: string, actif: boolean): Promise<void>;
  aUnHistorique(id: string): Promise<boolean>;
  creerProfilEmploye(id: string, nom: string, telephone: string): Promise<void>;
  authCreer(a: { email: string; password: string; app_metadata: { nom: string; telephone: string } }): Promise<{ id: string } | { erreur: 'existe_deja' | 'echec' }>;
  authChangerMotDePasse(id: string, password: string): Promise<boolean>;
  authBloquer(id: string, bloque: boolean): Promise<boolean>;
  authSupprimer(id: string): Promise<boolean>;
  nipAleatoire(): string;
  journal(ligne: string): void;
};

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------
const EST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 10 chiffres, ou null. Accepte « 819-123-4567 », « (819) 123 4567 », « +1 819 123 4567 ». */
export function normaliserTelephone(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let t = v.replace(/[\s().\-+]/g, '');
  if (!/^[0-9]+$/.test(t)) return null;
  if (t.length === 11 && t.startsWith('1')) t = t.slice(1);
  return /^[2-9][0-9]{9}$/.test(t) ? t : null;   // indicatif régional : commence par 2 à 9
}

/** NIP trop facile à deviner : chiffres tous pareils (000000) ou suite (123456, 654321). */
export function nipTropFacile(nip: string): boolean {
  if (/^(\d)\1{5}$/.test(nip)) return true;
  const d = [...nip].map(Number);
  const pas = d[1] - d[0];
  return (pas === 1 || pas === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === pas);
}

export function nipValide(nip: unknown): nip is string {
  return typeof nip === 'string' && /^[0-9]{6}$/.test(nip);
}

/** NIP à 6 chiffres tiré au hasard (jamais 000000 / 123456…). */
export function genererNip(octets: (n: number) => Uint32Array): string {
  for (;;) {
    const nip = String(octets(1)[0] % 1_000_000).padStart(6, '0');
    if (!nipTropFacile(nip)) return nip;
  }
}

// ---------------------------------------------------------------------
// Réponses
// ---------------------------------------------------------------------
type Reponse = { statut: number; corps: Record<string, unknown> };
const ok = (corps: Record<string, unknown>): Reponse => ({ statut: 200, corps: { ok: true, ...corps } });
const refus = (statut: number, erreur: string, message: string): Reponse => ({ statut, corps: { ok: false, erreur, message } });

const NON_AUTORISE = refus(403, 'non_autorise', 'Réservé à l\'administrateur.');
const PAS_TROUVE = refus(404, 'employe_introuvable', 'Employé introuvable.');
const ADMIN_INTERDIT = refus(403, 'compte_administrateur', 'Un compte administrateur ne se gère pas ici.');

const decrire = (p: Profil) => ({ id: p.id, nom: p.nom, telephone: p.telephone, actif: p.actif });

// ---------------------------------------------------------------------
// Les actions
// ---------------------------------------------------------------------
async function employeCible(deps: Deps, id: unknown): Promise<{ profil: Profil } | { reponse: Reponse }> {
  if (typeof id !== 'string' || !EST_UUID.test(id)) return { reponse: refus(400, 'requete_invalide', 'Identifiant d\'employé invalide.') };
  const profil = await deps.profilParId(id.toLowerCase());
  if (!profil) return { reponse: PAS_TROUVE };
  if (profil.role !== 'employe') return { reponse: ADMIN_INTERDIT };
  return { profil };
}

function lireNip(corps: any, deps: Deps): { nip: string; genere: boolean } | Reponse {
  if (corps.nip === undefined || corps.nip === null || corps.nip === '') return { nip: deps.nipAleatoire(), genere: true };
  if (!nipValide(corps.nip)) return refus(400, 'nip_invalide', 'Le NIP doit contenir exactement 6 chiffres.');
  if (nipTropFacile(corps.nip)) return refus(400, 'nip_trop_facile', 'NIP trop facile à deviner (ex. 123456 ou 000000). Choisissez-en un autre.');
  return { nip: corps.nip, genere: false };
}

async function creer(deps: Deps, corps: any): Promise<Reponse> {
  const nom = typeof corps.nom === 'string' ? corps.nom.trim().replace(/\s+/g, ' ') : '';
  if (nom.length < 1 || nom.length > 100) return refus(400, 'nom_invalide', 'Le nom est obligatoire (100 caractères au maximum).');
  const telephone = normaliserTelephone(corps.telephone);
  if (!telephone) return refus(400, 'telephone_invalide', 'Numéro de téléphone invalide : 10 chiffres, par exemple 819 123-4567.');
  const n = lireNip(corps, deps);
  if ('statut' in n) return n;

  const existant = await deps.profilParTelephone(telephone);
  if (existant) {
    return refus(409, 'telephone_deja_utilise',
      `Ce numéro est déjà celui de ${existant.nom}${existant.actif ? '' : ' (compte désactivé : réactivez-le plutôt)'}.`);
  }

  // Le rôle n'est PAS fourni : la base met « employe » par défaut (déclencheur creer_profil_depuis_auth).
  const cree = await deps.authCreer({ email: `${telephone}@${DOMAINE_EMAIL}`, password: n.nip, app_metadata: { nom, telephone } });
  if ('erreur' in cree) {
    return cree.erreur === 'existe_deja'
      ? refus(409, 'telephone_deja_utilise', 'Ce numéro est déjà utilisé.')
      : refus(500, 'creation_echouee', 'La création du compte a échoué. Réessayez ; si le problème continue, regardez les journaux de la fonction.');
  }

  // Le profil est créé ICI, par le serveur (rôle « employe » écrit par la base, jamais par l'appelant) : Supabase Auth
  // écrit nom et téléphone APRÈS la création du compte, le déclencheur de la base ne peut donc pas s'en charger.
  // Puis vérification : le profil doit être exactement celui attendu, sinon on annule tout (pas de compte à moitié créé).
  let profil: Profil | null = null;
  let raison = 'profil_absent';
  try {
    await deps.creerProfilEmploye(cree.id, nom, telephone);
    profil = await deps.profilParId(cree.id);
    if (profil && (profil.role !== 'employe' || profil.telephone !== telephone || profil.nom !== nom)) { profil = null; raison = 'profil_different'; }
  } catch { raison = 'profil_erreur'; }
  if (!profil) {
    deps.journal(`creer detail: ${raison}`);
    const annule = await deps.authSupprimer(cree.id);
    return refus(500, 'profil_incorrect', annule
      ? 'Le compte a été annulé : le profil créé n\'est pas celui attendu.'
      : 'Le profil n\'a pas pu être créé ET le compte n\'a pas pu être annulé : vérifiez la liste des utilisateurs dans Supabase (Authentication > Users).');
  }
  return ok({ employe: decrire(profil), nip: n.nip, nip_genere: n.genere });
}

async function changerEtat(deps: Deps, id: unknown, actif: boolean): Promise<Reponse> {
  const c = await employeCible(deps, id);
  if ('reponse' in c) return c.reponse;
  // 1) la base d'abord : effet immédiat (l'employé ne voit plus rien) ; 2) ensuite la connexion.
  await deps.definirActif(c.profil.id, actif);
  const bloque = await deps.authBloquer(c.profil.id, !actif);
  if (!bloque) {
    return refus(500, 'connexion_non_modifiee',
      actif
        ? 'Le compte est réactivé dans la base, mais le déblocage de la connexion a échoué. Refaites l\'action.'
        : 'Le compte est désactivé dans la base (il ne voit plus rien), mais le blocage de la connexion a échoué. Refaites l\'action.');
  }
  return ok({ employe: decrire({ ...c.profil, actif }) });
}

async function supprimer(deps: Deps, id: unknown): Promise<Reponse> {
  const c = await employeCible(deps, id);
  if ('reponse' in c) return c.reponse;
  if (await deps.aUnHistorique(c.profil.id)) {
    const r = await changerEtat(deps, c.profil.id, false);
    return r.statut === 200
      ? ok({ resultat: 'desactive', raison: 'historique', employe: decrire({ ...c.profil, actif: false }),
             message: 'Cet employé a de l\'historique (quarts, passes…) : il a été désactivé au lieu d\'être supprimé.' })
      : r;
  }
  if (!(await deps.authSupprimer(c.profil.id))) {
    return refus(500, 'suppression_echouee', 'La suppression a échoué ; rien n\'a été supprimé. Vous pouvez désactiver l\'employé à la place.');
  }
  return ok({ resultat: 'supprime', employe: decrire(c.profil) });
}

async function reinitialiserNip(deps: Deps, corps: any): Promise<Reponse> {
  const c = await employeCible(deps, corps.id);
  if ('reponse' in c) return c.reponse;
  const n = lireNip(corps, deps);
  if ('statut' in n) return n;
  if (!(await deps.authChangerMotDePasse(c.profil.id, n.nip))) {
    return refus(500, 'nip_non_change', 'Le NIP n\'a pas pu être changé. Réessayez.');
  }
  return ok({ employe: decrire(c.profil), nip: n.nip, nip_genere: n.genere });
}

// ---------------------------------------------------------------------
// Point d'entrée (testable : reçoit une Request, renvoie une Response)
// ---------------------------------------------------------------------
export async function traiter(req: Request, deps: Deps): Promise<Response> {
  const repondre = (r: Reponse) => new Response(JSON.stringify(r.corps), { status: r.statut, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return repondre(refus(405, 'methode_refusee', 'POST seulement.'));

  const autorisation = req.headers.get('Authorization') ?? '';
  let action = '?';
  try {
    // 1) Qui appelle ? Un administrateur actif, sinon rien d'autre n'est lu ni fait.
    if (!/^Bearer\s+\S+$/i.test(autorisation) || !(await deps.estAdmin(autorisation))) {
      deps.journal('refus non_autorise');
      return repondre(NON_AUTORISE);
    }

    let corps: any;
    try { corps = await req.json(); } catch { corps = null; }
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return repondre(refus(400, 'requete_invalide', 'Corps JSON invalide.'));
    action = typeof corps.action === 'string' && /^[a-z_]{1,30}$/.test(corps.action) ? corps.action : '?';

    let r: Reponse;
    switch (action) {
      case 'creer':             r = await creer(deps, corps); break;
      case 'desactiver':        r = await changerEtat(deps, corps.id, false); break;
      case 'reactiver':         r = await changerEtat(deps, corps.id, true); break;
      case 'supprimer':         r = await supprimer(deps, corps.id); break;
      case 'reinitialiser_nip': r = await reinitialiserNip(deps, corps); break;
      default:                  r = refus(400, 'action_inconnue', 'Action inconnue.');
    }
    // Journal : l'action, le résultat, l'employé visé — jamais le NIP, le nom ni le téléphone.
    const cible = typeof corps.id === 'string' && EST_UUID.test(corps.id) ? ' id=' + corps.id : '';
    deps.journal(`${action} -> ${r.corps.ok ? 'ok' : r.corps.erreur}${cible}`);
    return repondre(r);
  } catch (e) {
    deps.journal(`${action} -> exception ${e instanceof Error ? e.name : 'inconnue'}`);
    return repondre(refus(500, 'erreur_interne', 'Erreur interne. Réessayez ; si le problème continue, regardez les journaux de la fonction.'));
  }
}

// ---------------------------------------------------------------------
// Branchement sur Supabase (seulement quand la fonction tourne dans Supabase)
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
  const COLONNES = 'id, nom, telephone, role, actif';

  return {
    async estAdmin(authorization) {
      // Le jeton de l'appelant, pas la clé secrète : la base voit QUI appelle.
      const c = createClient(url, anon, { ...opts, global: { headers: { Authorization: authorization } } });
      const { data, error } = await c.rpc('est_admin');
      return !error && data === true;
    },
    async profilParId(id) {
      const { data, error } = await admin.from('utilisateurs').select(COLONNES).eq('id', id).maybeSingle();
      if (error) throw new Error('lecture_profil');
      return data;
    },
    async profilParTelephone(telephone) {
      const { data, error } = await admin.from('utilisateurs').select(COLONNES).eq('telephone', telephone).maybeSingle();
      if (error) throw new Error('lecture_profil');
      return data;
    },
    async definirActif(id, actif) {
      const { error } = await admin.from('utilisateurs').update({ actif }).eq('id', id);
      if (error) throw new Error('ecriture_profil');
    },
    async aUnHistorique(id) {
      const { data, error } = await admin.rpc('_utilisateur_a_de_l_historique', { p_id: id });
      if (error) throw new Error('lecture_historique');
      return data === true;
    },
    async creerProfilEmploye(id, nom, telephone) {
      const { error } = await admin.rpc('_creer_profil_employe', { p_id: id, p_nom: nom, p_telephone: telephone });
      if (error) { console.log(`_creer_profil_employe refusé (code ${error.code ?? '?'})`); throw new Error('creation_profil'); }
    },
    async authCreer({ email, password, app_metadata }) {
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata });
      if (error || !data?.user) {
        console.log(`createUser refusé (statut ${error?.status ?? '?'}, code ${(error as any)?.code ?? '?'})`);
        return { erreur: (error as any)?.code === 'email_exists' ? 'existe_deja' : 'echec' };
      }
      return { id: data.user.id };
    },
    async authChangerMotDePasse(id, password) {
      const { error } = await admin.auth.admin.updateUserById(id, { password });
      if (error) console.log(`updateUserById refusé (statut ${error.status ?? '?'}, code ${(error as any).code ?? '?'})`);
      return !error;
    },
    async authBloquer(id, bloque) {
      // ~100 ans = bloqué « pour toujours » ; 'none' = débloqué.
      const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: bloque ? '876000h' : 'none' });
      if (error) console.log(`ban refusé (statut ${error.status ?? '?'}, code ${(error as any).code ?? '?'})`);
      return !error;
    },
    async authSupprimer(id) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) console.log(`deleteUser refusé (statut ${error.status ?? '?'}, code ${(error as any).code ?? '?'})`);
      return !error;
    },
    nipAleatoire: () => genererNip((n) => crypto.getRandomValues(new Uint32Array(n))),
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
