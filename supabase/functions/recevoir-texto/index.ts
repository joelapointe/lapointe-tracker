// =====================================================================
// Edge Function « recevoir-texto » — DEMANDE 5 (2 octobre 2026)
// Reçoit les TEXTOS que les clients envoient au numéro d'Entretien Lapointe ((888) 564-8069) : c'est le « webhook » de Twilio (« A message comes in », méthode POST).
//   ARRET (ou STOP, ARRÊT, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT…) : le client est DÉSABONNÉ des avis par texto (fonction de la base desabonner_contact, fichier SQL 30 : la fiche, le registre des
//     consentements, les inscriptions en attente) et reçoit une confirmation.
//   AIDE (ou HELP, INFO) : le message d'aide EXACT promis aux opérateurs dans le dossier de vérification de Twilio.
//   START (ou UNSTOP, YES) : jamais de réinscription par texto (le dossier de Twilio promet « aucun mot-clé d'inscription par texto » : l'accord vient de la page web, avec sa preuve) : on explique comment se réinscrire.
//   tout autre message : on dit comment joindre Entretien Lapointe (ce numéro n'envoie que des avis et ne lit pas les réponses).
// Un mot-clé ne compte que s'il est LE message entier (aux majuscules, aux accents et à la ponctuation près) : « ARRET », « arrêt. », « Stop ! ». « ARRET SVP » n'en est pas un (le message de réponse rappelle quoi écrire).
//
// Sécurité :
//   • Cette fonction est PUBLIQUE (Twilio n'a pas de jeton Supabase : « Verify JWT » est DÉSACTIVÉ au déploiement). Toute demande doit donc porter la SIGNATURE de Twilio (en-tête X-Twilio-Signature :
//     HMAC-SHA1 de l'adresse publique + les paramètres triés, avec le jeton d'authentification de Twilio, secret TWILIO_AUTH_TOKEN). Signature absente ou fausse : 403, RIEN n'est lu ni fait.
//   • Elle ÉCHOUE FERMÉ : sans le secret TWILIO_AUTH_TOKEN, elle refuse TOUT (403). Elle ne désabonne donc jamais personne sur la foi d'une demande qu'on ne peut pas vérifier.
//   • L'adresse signée est celle que Twilio a dans sa console : https://<projet>.supabase.co/functions/v1/recevoir-texto (construite à partir de SUPABASE_URL, jamais de l'adresse reçue).
//   • Si l'enregistrement du désabonnement échoue, on le DIT au client (message d'échec honnête) : jamais un faux « c'est noté ».
//   • Les journaux de la fonction ne contiennent ni numéro de téléphone ni texte de message : seulement le genre de message et le résultat.
//
// Le code de décision est séparé des appels à Supabase (voir « Deps ») pour être testé sans réseau : supabase/tests/test-recevoir-texto.mjs.
// =====================================================================

declare const Deno: any;

// Les textes envoyés aux clients. L'AIDE est EXACTEMENT celui du dossier de vérification de Twilio (ne pas le changer sans changer le dossier).
export const MSG_AIDE = 'Entretien Lapointe : avis de service seulement (jour ou heure de passage, horaire). Aide : appelez le 819 268-8069 ou écrivez à info@entretienlapointe.ca. ARRET pour ne plus recevoir ces avis.';
export const MSG_ARRET = 'Entretien Lapointe : c\'est noté, vous ne recevrez plus d\'avis par texto. Pour toute question : 819 268-8069.';
export const MSG_ARRET_ECHEC = 'Entretien Lapointe : nous n\'avons pas pu enregistrer votre demande. Appelez le 819 268-8069 ou écrivez à info@entretienlapointe.ca pour ne plus recevoir ces avis.';
export const MSG_REINSCRIPTION = 'Entretien Lapointe : pour recevoir de nouveau nos avis par texto, inscrivez-vous sur www.entretienlapointe.ca/avis.html ou appelez le 819 268-8069.';
export const MSG_AUTRE = 'Entretien Lapointe : ce numéro envoie des avis de service et ne lit pas les réponses. Pour nous joindre : 819 268-8069 ou info@entretienlapointe.ca. ARRET pour ne plus recevoir ces avis.';

const CHEMIN = '/functions/v1/recevoir-texto';
const TAILLE_MAX = 20000;   // un texto fait au plus 1 600 caractères ; Twilio ajoute ~30 paramètres
const EST_TELEPHONE = /^\+1[2-9][0-9]{2}[2-9][0-9]{6}$/;   // un numéro nord-américain en format international (celui de la base : _cellulaire_normalise)

// ---------------------------------------------------------------------
// Ce que la fonction demande au monde extérieur (remplaçable dans les tests)
// ---------------------------------------------------------------------
export type Deps = {
  /** Le jeton d'authentification de Twilio (secret TWILIO_AUTH_TOKEN), ou null s'il n'existe pas : la fonction refuse alors tout. */
  jeton(): string | null;
  /** L'adresse publique EXACTE de cette fonction, celle que Twilio a dans sa console (sert à la signature). */
  url(): string;
  /** Désabonne ce numéro des avis par texto (fonction de la base desabonner_contact). */
  desabonner(telephone: string): Promise<{ ok: boolean }>;
  journal(ligne: string): void;
};

// ---------------------------------------------------------------------
// La signature de Twilio
// ---------------------------------------------------------------------
/** base64( HMAC-SHA1( jeton, adresse + les paramètres triés par nom, chacun écrit « nom » puis « valeur » sans rien entre les deux ) ). */
export async function signatureTwilio(jeton: string, url: string, params: [string, string][]): Promise<string> {
  const tries = [...params].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const donnees = url + tries.map(([k, v]) => k + v).join('');
  const encodeur = new TextEncoder();
  const cle = await crypto.subtle.importKey('raw', encodeur.encode(jeton), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cle, encodeur.encode(donnees)));
  let binaire = '';
  for (const o of signature) binaire += String.fromCharCode(o);
  return btoa(binaire);
}

/** Comparaison en temps constant (la durée ne dépend pas de l'endroit où les deux textes diffèrent). */
export function egalConstant(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let d = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) d |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return d === 0;
}

// ---------------------------------------------------------------------
// Quel genre de message ?
// ---------------------------------------------------------------------
const ARRET = new Set(['ARRET', 'ARRETER', 'DESABONNER', 'DESABONNEMENT', 'STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const AIDE = new Set(['AIDE', 'HELP', 'INFO']);
const START = new Set(['START', 'UNSTOP', 'YES']);
export type Genre = 'arret' | 'aide' | 'start' | 'autre';

/** Le message ENTIER, sans accents ni majuscules, sans espaces ni ponctuation ni guillemets autour, est-il un mot-clé ? */
export function classer(corps: unknown): Genre {
  if (typeof corps !== 'string') return 'autre';
  const mot = corps.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/^[\s"'«»]+|[\s.!?,;:"'«»]+$/gu, '');
  if (ARRET.has(mot)) return 'arret';
  if (AIDE.has(mot)) return 'aide';
  if (START.has(mot)) return 'start';
  return 'autre';
}

// ---------------------------------------------------------------------
// Les réponses (TwiML : le message de réponse que Twilio envoie au client)
// ---------------------------------------------------------------------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const XML = { 'Content-Type': 'text/xml; charset=utf-8' };
/** La réponse TwiML : un message à envoyer au client (ou aucun). */
export const twiml = (texte: string | null): Response =>
  new Response('<?xml version="1.0" encoding="UTF-8"?><Response>' + (texte ? '<Message>' + esc(texte) + '</Message>' : '') + '</Response>', { status: 200, headers: XML });
const refus = (statut: number, texte: string): Response => new Response(texte, { status: statut, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/** La valeur du premier paramètre de ce nom, ou undefined. */
const valeur = (params: [string, string][], nom: string): string | undefined => params.find(([k]) => k === nom)?.[1];

// ---------------------------------------------------------------------
// Point d'entrée (testable : reçoit une Request, renvoie une Response)
// ---------------------------------------------------------------------
export async function traiter(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== 'POST') return refus(405, 'POST seulement.');
  try {
    // 1) Sans le jeton de Twilio, on ne peut RIEN vérifier : tout est refusé (échoue fermé).
    const jeton = deps.jeton();
    if (!jeton) { deps.journal('refus jeton_absent'); return refus(403, 'Refusé.'); }

    // 2) La demande doit venir de Twilio : signature de l'adresse publique + des paramètres.
    let brut = '';
    try { brut = await req.text(); } catch { brut = ''; }
    if (brut.length > TAILLE_MAX) { deps.journal('refus trop_grand'); return refus(400, 'Demande trop grande.'); }
    const params = [...new URLSearchParams(brut).entries()];
    const recue = req.headers.get('X-Twilio-Signature') ?? '';
    const attendue = await signatureTwilio(jeton, deps.url(), params);
    if (!recue || !egalConstant(recue, attendue)) { deps.journal('refus signature'); return refus(403, 'Refusé.'); }

    // 3) Le message du client
    const genre = classer(valeur(params, 'Body') ?? '');
    if (genre === 'arret') {
      const de = valeur(params, 'From') ?? '';
      if (!EST_TELEPHONE.test(de)) { deps.journal('arret -> numero_invalide'); return twiml(MSG_ARRET_ECHEC); }
      let ok = false;
      try { ok = (await deps.desabonner(de)).ok === true; } catch { ok = false; }
      deps.journal(`arret -> ${ok ? 'ok' : 'echec'}`);
      return twiml(ok ? MSG_ARRET : MSG_ARRET_ECHEC);
    }
    if (genre === 'aide') { deps.journal('aide'); return twiml(MSG_AIDE); }
    if (genre === 'start') { deps.journal('start'); return twiml(MSG_REINSCRIPTION); }
    deps.journal('autre');
    return twiml(MSG_AUTRE);
  } catch (e) {
    deps.journal(`exception ${e instanceof Error ? e.name : 'inconnue'}`);
    return refus(500, 'Erreur interne.');
  }
}

// ---------------------------------------------------------------------
// Branchement sur Supabase (seulement quand la fonction tourne dans Supabase)
// ---------------------------------------------------------------------
async function depsReelles(): Promise<Deps> {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const url = Deno.env.get('SUPABASE_URL');
  const cle = (ancienne: string, dictionnaire: string): string | undefined => {
    const v = Deno.env.get(ancienne);
    if (v) return v;
    try { const d = JSON.parse(Deno.env.get(dictionnaire) ?? '{}'); return d.default ?? Object.values(d)[0]; } catch { return undefined; }
  };
  const service = cle('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS');
  if (!url || !service) throw new Error('configuration_manquante');
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    jeton: () => Deno.env.get('TWILIO_AUTH_TOKEN') || null,
    url: () => url.replace(/\/+$/, '') + CHEMIN,
    async desabonner(telephone) {
      const { error } = await admin.rpc('desabonner_contact', { p_canal: 'texto', p_contact: telephone, p_source: 'texto_arret' });
      if (error) { console.log(`rpc desabonner_contact refusé (code ${error.code ?? '?'})`); return { ok: false }; }
      return { ok: true };
    },
    journal: (ligne) => console.log(ligne),
  };
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  let deps: Promise<Deps> | null = null;
  Deno.serve((req: Request) => {
    if (req.method !== 'POST') return Promise.resolve(refus(405, 'POST seulement.'));
    deps ??= depsReelles();
    return deps.then((d) => traiter(req, d)).catch(() => {
      deps = null;
      return refus(500, 'Configuration manquante.');
    });
  });
}
