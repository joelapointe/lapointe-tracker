// =====================================================================
// Edge Function « envoyer-avis » — DEMANDE 5, CHANTIER C (1ᵉʳ octobre 2026)
// Avertir les clients : « nous passons chez vous dans environ X heures » (courriel par Resend, texto par Twilio).
//
// Actions (champ « action » du corps JSON) :
//   apercu          { delai, lignes, canaux? }   montre, SANS RIEN ÉCRIRE ni envoyer, ce qui partirait : pour chaque client et chaque canal, « a_envoyer » (avec le message exact) ou « refuse » (avec le motif)
//   envoyer         { delai, lignes, canaux? }   écrit le journal, envoie, note le résultat de chaque envoi ; rend le résumé
//   essai_courriel  {}                           envoie UN courriel d'essai (marqué « [ESSAI] ») à l'adresse de l'administrateur qui appelle — jamais à un client, rien n'est écrit au journal
//     delai  : « 1h » à « 72h » ou « demain » ;   lignes : [{ client_id, service, adresse }] (300 au plus) ;   canaux : ['courriel'], ['texto'] ou les deux (par défaut : le courriel, et le texto SEULEMENT s'il est activé)
//
// Sécurité :
//   • L'appelant est vérifié à CHAQUE requête avec SON propre jeton : un administrateur actif seulement (la base répond à est_admin()). Sinon rien d'autre n'est lu ni fait.
//   • Toutes les RÈGLES (qui reçoit quoi, jamais de texto de 21 h à 6 h, un seul avis par client par canal et par jour, les messages) sont dans la base (fichiers SQL 31 et 32) : cette fonction ne
//     fabrique JAMAIS un message ni ne décide à qui l'envoyer ; elle envoie ce que la base a préparé, mot pour mot, puis note le résultat.
//   • Les clés (Resend, Twilio) sont des SECRETS de Supabase, jamais écrites ici. Sans le secret TEXTOS_ACTIFS = « oui » (et les 3 secrets de Twilio), AUCUN texto ne part : le canal « texto » est refusé
//     avant d'écrire quoi que ce soit. (À activer seulement après l'approbation de la vérification de Twilio.)
//   • Les journaux de la fonction ne contiennent ni nom, ni courriel, ni téléphone, ni message : seulement des nombres et des identifiants.
//
// Le code de décision est séparé des appels à Supabase, à Resend et à Twilio (voir « Deps ») pour être testé sans réseau : supabase/tests/test-envoyer-avis.mjs.
// =====================================================================

declare const Deno: any;

export const SITE = 'https://www.entretienlapointe.ca';
export const EXPEDITEUR = 'Entretien Lapointe <avis@entretienlapointe.ca>';
export const REPONDRE_A = 'info@entretienlapointe.ca';
export const MARQUE_LIEN = '[lien de désabonnement]';   // le repère que la base met dans les courriels (SQL 31 : _avis_rendre)

const CORS = {
  'Access-Control-Allow-Origin': '*',   // l'accès est protégé par le jeton, pas par l'origine
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ---------------------------------------------------------------------
// Ce que la fonction demande au monde extérieur (remplaçable dans les tests)
// ---------------------------------------------------------------------
export type Admin = { id: string; courriel: string | null };
export type Resultat<T> = { data: T; error: null } | { data: null; error: { message: string } };
export type Deps = {
  /** L'administrateur actif qui appelle (d'après SON jeton), ou null. */
  identifier(authorization: string): Promise<Admin | null>;
  /** Un appel d'une fonction de la base, avec la clé du service (avis_apercu, avis_preparer, avis_marquer, avis_jeton). */
  rpc(nom: string, args: Record<string, unknown>): Promise<Resultat<any>>;
  /** Le modèle de courriel « heures » en vigueur (pour le courriel d'essai seulement). */
  modeleCourriel(): Promise<{ objet: string; texte: string } | null>;
  courriel(m: { a: string; objet: string; texte: string; html: string; lien: string }): Promise<{ id: string } | { erreur: string }>;
  texto(m: { a: string; corps: string }): Promise<{ id: string } | { erreur: string }>;
  /** Les textos sont-ils activés ? (secret TEXTOS_ACTIFS = « oui » ET les 3 secrets de Twilio) */
  textosActifs(): boolean;
  /** L'heure de la demande à passer à la base : null en production (la base prend la sienne) ; une heure fixe seulement dans les essais. */
  maintenant(): string | null;
  journal(ligne: string): void;
};

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------
const EST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EST_DELAI = /^(demain|[1-9][0-9]?h)$/;
/** « 1h » à « 72h » ou « demain » (la base le vérifie aussi : ici, pour refuser avant de rien appeler). */
export const delaiValide = (d: unknown): d is string => typeof d === 'string' && EST_DELAI.test(d) && (d === 'demain' || Number(d.slice(0, -1)) <= 72);
const CANAUX = ['courriel', 'texto'];

type Reponse = { statut: number; corps: Record<string, unknown> };
const ok = (corps: Record<string, unknown>): Reponse => ({ statut: 200, corps: { ok: true, ...corps } });
const refus = (statut: number, erreur: string, message: string): Reponse => ({ statut, corps: { ok: false, erreur, message } });
const NON_AUTORISE = refus(403, 'non_autorise', 'Réservé à l\'administrateur.');

export type Ligne = { client_id: string; service: string; adresse: string };

/** Les lignes reçues, nettoyées ; ou une réponse de refus. */
export function lireLignes(v: unknown): Ligne[] | Reponse {
  if (!Array.isArray(v) || v.length < 1 || v.length > 300) return refus(400, 'requete_invalide', 'La liste des clients doit contenir de 1 à 300 clients.');
  const lignes: Ligne[] = [];
  for (const x of v) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) return refus(400, 'requete_invalide', 'Une ligne de la liste est illisible.');
    const o = x as Record<string, unknown>;
    if (typeof o.client_id !== 'string' || !EST_UUID.test(o.client_id)) return refus(400, 'requete_invalide', 'Un identifiant de client est invalide.');
    if (typeof o.service !== 'string' || o.service.trim().length < 1 || o.service.length > 100) return refus(400, 'requete_invalide', 'Le service d\'un client est vide ou trop long (100 caractères au plus).');
    if (typeof o.adresse !== 'string' || o.adresse.trim().length < 1 || o.adresse.length > 200) return refus(400, 'requete_invalide', 'L\'adresse d\'un client est vide ou trop longue (200 caractères au plus).');
    lignes.push({ client_id: o.client_id.toLowerCase(), service: o.service, adresse: o.adresse });
  }
  return lignes;
}

/** Les canaux demandés : sans doublon, dans l'ordre courriel puis texto ; ou une réponse de refus. */
export function lireCanaux(v: unknown, deps: Deps): string[] | Reponse {
  let canaux: string[];
  if (v === undefined || v === null) canaux = deps.textosActifs() ? ['courriel', 'texto'] : ['courriel'];
  else if (!Array.isArray(v) || v.length < 1 || v.some((c) => typeof c !== 'string' || !CANAUX.includes(c))) return refus(400, 'canaux_invalides', 'Les canaux demandés sont invalides (« courriel », « texto » ou les deux).');
  else canaux = CANAUX.filter((c) => (v as string[]).includes(c));
  if (canaux.includes('texto') && !deps.textosActifs()) {
    return refus(409, 'textos_non_actives', 'Les textos ne sont pas encore activés (en attente de l\'approbation de Twilio). Rien n\'a été écrit ni envoyé.');
  }
  return canaux;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Le lien de désabonnement d'un client (page publique du site). */
export function lienDesabonnement(clientId: string, jeton: string): string {
  return `${SITE}/desabonnement.html?c=${encodeURIComponent(clientId)}&t=${encodeURIComponent(jeton)}`;
}

/** Le courriel en texte simple : le repère devient le vrai lien. */
export function texteCourriel(message: string, lien: string): string {
  return message.split(MARQUE_LIEN).join(lien);
}

/** Le courriel en HTML : le message est échappé (rien de ce qui vient de la base ne peut glisser du HTML), les sauts de ligne sont gardés, le repère devient un lien. */
export function htmlCourriel(message: string, lien: string): string {
  const morceaux = message.split(MARQUE_LIEN).map((m) => esc(m).replace(/\r?\n/g, '<br>\n'));
  const corps = morceaux.join(`<a href="${esc(lien)}">Se désabonner</a>`);
  return `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; color: #222;">${corps}</div>`;
}

const sansPrefixe = (m: string) => m.replace(/^❌\s*/, '');

function erreurBase(e: { message: string }): Reponse {
  const m = String(e.message || '');
  if (/non_autorise/.test(m)) return NON_AUTORISE;
  if (/delai_invalide/.test(m)) return refus(400, 'delai_invalide', 'Le délai est invalide (« 1h » à « 72h » ou « demain »).');
  if (/lignes_invalides/.test(m)) return refus(400, 'requete_invalide', 'La liste des clients est invalide.');
  if (/canaux_invalides/.test(m)) return refus(400, 'canaux_invalides', 'Les canaux demandés sont invalides.');
  if (/modele_introuvable/.test(m)) return refus(500, 'modele_introuvable', 'Aucun modèle de message n\'est en vigueur (voir la table avis_modeles).');
  if (/Could not find the function|PGRST202|42883/.test(m)) return refus(500, 'sql_absent', 'Les fichiers SQL 31 et 32 ne sont pas tous exécutés chez Supabase.');
  return refus(500, 'base_erreur', 'La base a refusé la demande. Regardez les journaux de la fonction.');
}

// ---------------------------------------------------------------------
// Les actions
// ---------------------------------------------------------------------
function argsBase(admin: Admin, delai: string, lignes: Ligne[], canaux: string[], deps: Deps): Record<string, unknown> {
  const a: Record<string, unknown> = { p_par: admin.id, p_delai: delai, p_lignes: lignes, p_canaux: canaux };
  const quand = deps.maintenant();
  if (quand) a.p_maintenant = quand;
  return a;
}

function lireDemande(corps: any, deps: Deps): { delai: string; lignes: Ligne[]; canaux: string[] } | Reponse {
  if (!delaiValide(corps.delai)) return refus(400, 'delai_invalide', 'Le délai est invalide (« 1h » à « 72h » ou « demain »).');
  const lignes = lireLignes(corps.lignes);
  if (!Array.isArray(lignes)) return lignes;
  const canaux = lireCanaux(corps.canaux, deps);
  if (!Array.isArray(canaux)) return canaux;
  return { delai: corps.delai, lignes, canaux };
}

function compter(lignes: any[]) {
  const n = (f: (x: any) => boolean) => lignes.filter(f).length;
  return {
    a_envoyer: n((x) => x.statut === 'a_envoyer'),
    envoyes: n((x) => x.statut === 'envoye'),
    echecs: n((x) => x.statut === 'echec'),
    refuses: n((x) => x.statut === 'refuse'),
  };
}

async function apercu(deps: Deps, admin: Admin, d: { delai: string; lignes: Ligne[]; canaux: string[] }): Promise<Reponse> {
  const r = await deps.rpc('avis_apercu', argsBase(admin, d.delai, d.lignes, d.canaux, deps));
  if (r.error) return erreurBase(r.error);
  const lignes = (r.data?.lignes ?? []) as any[];
  return ok({ apercu: true, jour: r.data?.jour, heure_permise_texto: r.data?.heure_permise_texto, resume: compter(lignes), lignes });
}

/** Envoie UNE ligne « en attente » (déjà au journal) et note le résultat. Rend le statut final. */
async function envoyerLigne(deps: Deps, l: any): Promise<{ statut: 'envoye' | 'echec'; marquage: boolean }> {
  let resultat: { id: string } | { erreur: string };
  try {
    if (l.canal === 'courriel') {
      const j = await deps.rpc('avis_jeton', { p_client_id: l.client_id, p_canal: 'courriel' });
      if (j.error || typeof j.data !== 'string' || !j.data) resultat = { erreur: 'jeton_indisponible' };
      else {
        const lien = lienDesabonnement(l.client_id, j.data);
        resultat = await deps.courriel({ a: l.destinataire, objet: l.objet, texte: texteCourriel(l.message, lien), html: htmlCourriel(l.message, lien), lien });
      }
    } else {
      resultat = await deps.texto({ a: l.destinataire, corps: l.message });
    }
  } catch (e) {
    resultat = { erreur: 'exception ' + (e instanceof Error ? e.name : 'inconnue') };
  }
  const envoye = 'id' in resultat;
  const args = envoye ? { p_id: l.id, p_statut: 'envoye', p_fournisseur_id: resultat.id } : { p_id: l.id, p_statut: 'echec', p_erreur: String((resultat as { erreur: string }).erreur).slice(0, 400) };
  // Le résultat DOIT être noté : on réessaie une fois (un courriel parti sans trace au journal serait le pire cas)
  let marque = await deps.rpc('avis_marquer', args).catch(() => ({ error: { message: 'exception' } } as any));
  if (marque.error) marque = await deps.rpc('avis_marquer', args).catch(() => ({ error: { message: 'exception' } } as any));
  if (marque.error) deps.journal(`avis_marquer a échoué pour ${l.id} (${envoye ? 'envoyé' : 'échec'})`);
  return { statut: envoye ? 'envoye' : 'echec', marquage: !marque.error };
}

async function envoyer(deps: Deps, admin: Admin, d: { delai: string; lignes: Ligne[]; canaux: string[] }): Promise<Reponse> {
  const r = await deps.rpc('avis_preparer', argsBase(admin, d.delai, d.lignes, d.canaux, deps));
  if (r.error) return erreurBase(r.error);
  const lignes = (r.data?.lignes ?? []) as any[];
  const finales: any[] = lignes.map((l) => ({ id: l.id, client_id: l.client_id, canal: l.canal, statut: l.statut, motif: l.motif ?? null }));
  const aEnvoyer = lignes.map((l, i) => ({ l, i })).filter((x) => x.l.statut === 'en_attente');
  let marquagesRates = 0;
  // 5 envois à la fois : assez vite pour une tempête, assez doux pour les fournisseurs
  for (let debut = 0; debut < aEnvoyer.length; debut += 5) {
    await Promise.all(aEnvoyer.slice(debut, debut + 5).map(async ({ l, i }) => {
      const f = await envoyerLigne(deps, l);
      finales[i].statut = f.statut;
      if (f.statut === 'echec') finales[i].motif = 'echec_fournisseur';
      if (!f.marquage) marquagesRates++;
    }));
  }
  const resume = compter(finales);
  const corps: Record<string, unknown> = { lot_id: r.data?.lot_id, jour: r.data?.jour, heure_permise_texto: r.data?.heure_permise_texto, resume, lignes: finales };
  if (marquagesRates) corps.avertissement = `${marquagesRates} envoi(s) ont été faits mais n'ont pas pu être notés au journal : vérifiez le journal et les journaux de la fonction.`;
  deps.journal(`envoyer -> ${resume.envoyes} envoyé(s), ${resume.echecs} échec(s), ${resume.refuses} refusé(s) (lot ${r.data?.lot_id})`);
  return ok(corps);
}

async function essaiCourriel(deps: Deps, admin: Admin): Promise<Reponse> {
  if (!admin.courriel) return refus(400, 'courriel_absent', 'Le compte de l\'administrateur n\'a pas de courriel : impossible d\'envoyer un essai.');
  const m = await deps.modeleCourriel();
  if (!m) return refus(500, 'modele_introuvable', 'Aucun modèle de courriel n\'est en vigueur (voir la table avis_modeles).');
  const rendre = (t: string) => t.split('{delai_long}').join('3 heures').split('{delai}').join('3 h').split('{service}').join('Coupe de gazon').split('{adresse}').join('10 rue des Pins, Louiseville').split('{lien}').join(MARQUE_LIEN);
  const lien = `${SITE}/desabonnement.html`;
  const message = rendre(m.texte);
  const r = await deps.courriel({ a: admin.courriel, objet: '[ESSAI] ' + rendre(m.objet), texte: texteCourriel(message, lien), html: htmlCourriel(message, lien), lien });
  if ('erreur' in r) return refus(502, 'envoi_echoue', 'Le courriel d\'essai n\'a pas pu être envoyé : ' + sansPrefixe(r.erreur));
  deps.journal('essai_courriel -> ok');
  return ok({ essai: true, id: r.id });
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
    const admin = /^Bearer\s+\S+$/i.test(autorisation) ? await deps.identifier(autorisation) : null;
    if (!admin) {
      deps.journal('refus non_autorise');
      return repondre(NON_AUTORISE);
    }

    let corps: any;
    try { corps = await req.json(); } catch { corps = null; }
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return repondre(refus(400, 'requete_invalide', 'Corps JSON invalide.'));
    action = typeof corps.action === 'string' && /^[a-z_]{1,30}$/.test(corps.action) ? corps.action : '?';

    let r: Reponse;
    if (action === 'essai_courriel') r = await essaiCourriel(deps, admin);
    else if (action === 'apercu' || action === 'envoyer') {
      const d = lireDemande(corps, deps);
      r = 'statut' in d ? d : action === 'apercu' ? await apercu(deps, admin, d) : await envoyer(deps, admin, d);
    } else r = refus(400, 'action_inconnue', 'Action inconnue.');
    deps.journal(`${action} -> ${r.corps.ok ? 'ok' : r.corps.erreur}`);
    return repondre(r);
  } catch (e) {
    deps.journal(`${action} -> exception ${e instanceof Error ? e.name : 'inconnue'}`);
    return repondre(refus(500, 'erreur_interne', 'Erreur interne. Réessayez ; si le problème continue, regardez les journaux de la fonction.'));
  }
}

// ---------------------------------------------------------------------
// Branchement sur Supabase, Resend et Twilio (seulement quand la fonction tourne dans Supabase)
// ---------------------------------------------------------------------
async function avecDelai(url: string, init: Record<string, unknown>, ms = 20000): Promise<Response> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, signal: c.signal }); } finally { clearTimeout(t); }
}

async function depsReelles(): Promise<Deps> {
  const { createClient } = await import('npm:@supabase/supabase-js@2');
  const url = Deno.env.get('SUPABASE_URL');
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

  const resendKey = () => Deno.env.get('RESEND_API_KEY') ?? '';
  const sid = () => Deno.env.get('TWILIO_ACCOUNT_SID') ?? '';
  const jeton = () => Deno.env.get('TWILIO_AUTH_TOKEN') ?? '';
  const de = () => Deno.env.get('TWILIO_FROM') ?? '';
  const textosActifs = () => Deno.env.get('TEXTOS_ACTIFS') === 'oui' && !!sid() && !!jeton() && !!de();

  return {
    async identifier(authorization) {
      // Le jeton de l'appelant, pas la clé secrète : la base voit QUI appelle.
      const c = createClient(url, anon, { ...opts, global: { headers: { Authorization: authorization } } });
      const { data: u, error: eu } = await c.auth.getUser(authorization.replace(/^Bearer\s+/i, ''));   // (le jeton est donné explicitement : il n'y a pas de session dans une fonction)
      if (eu || !u?.user?.id) return null;
      const { data, error } = await c.rpc('est_admin');
      if (error || data !== true) return null;
      return { id: u.user.id, courriel: u.user.email ?? null };
    },
    async rpc(nom, args) {
      const { data, error } = await admin.rpc(nom, args);
      if (error) { console.log(`rpc ${nom} refusé (code ${error.code ?? '?'})`); return { data: null, error: { message: `${error.code ?? ''} ${error.message ?? ''}`.trim() } }; }
      return { data, error: null };
    },
    async modeleCourriel() {
      const { data } = await admin.from('avis_modeles').select('objet, texte').eq('canal', 'courriel').eq('variante', 'heures').eq('en_vigueur', true).order('cree_le', { ascending: false }).limit(1);
      return data && data[0] ? { objet: data[0].objet, texte: data[0].texte } : null;
    },
    async courriel(m) {
      if (!resendKey()) return { erreur: 'resend_non_configure' };
      try {
        const r = await avecDelai('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey()}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: EXPEDITEUR, to: [m.a], reply_to: REPONDRE_A, subject: m.objet, text: m.texte, html: m.html, headers: { 'List-Unsubscribe': `<${m.lien}>` } }),
        });
        const d: any = await r.json().catch(() => ({}));
        if (r.ok && typeof d.id === 'string') return { id: d.id };
        console.log(`Resend refusé (statut ${r.status}, nom ${d?.name ?? '?'})`);
        return { erreur: `resend ${r.status} ${String(d?.name ?? d?.message ?? '').slice(0, 120)}`.trim() };
      } catch (e) { return { erreur: 'resend injoignable ' + (e instanceof Error ? e.name : '') }; }
    },
    async texto(m) {
      if (!textosActifs()) return { erreur: 'textos_non_actives' };
      try {
        const corps = new URLSearchParams({ To: m.a, From: de(), Body: m.corps });
        const r = await avecDelai(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid())}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: 'Basic ' + btoa(`${sid()}:${jeton()}`), 'Content-Type': 'application/x-www-form-urlencoded' },
          body: corps.toString(),
        });
        const d: any = await r.json().catch(() => ({}));
        if (r.ok && typeof d.sid === 'string') return { id: d.sid };
        console.log(`Twilio refusé (statut ${r.status}, code ${d?.code ?? '?'})`);
        return { erreur: `twilio ${r.status} code ${d?.code ?? '?'}` };
      } catch (e) { return { erreur: 'twilio injoignable ' + (e instanceof Error ? e.name : '') }; }
    },
    textosActifs,
    maintenant: () => null,
    journal: (ligne) => console.log(ligne),
  };
}

if (typeof Deno !== 'undefined' && typeof Deno.serve === 'function') {
  let deps: Promise<Deps> | null = null;
  Deno.serve((req: Request) => {
    if (req.method === 'OPTIONS') return traiter(req, null as unknown as Deps);   // la pré-vérification CORS n'a pas besoin de Supabase
    deps ??= depsReelles();
    return deps.then((d) => traiter(req, d)).catch(() => {
      deps = null;
      return new Response(JSON.stringify({ ok: false, erreur: 'configuration', message: 'La fonction n\'est pas configurée correctement.' }),
        { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });
    });
  });
}
