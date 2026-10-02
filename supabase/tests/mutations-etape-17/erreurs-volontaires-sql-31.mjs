// Demande 5, chantier C — outil des ERREURS VOLONTAIRES du fichier SQL 31 (modèles de messages, journal des avis, règles d'envoi, lien de désabonnement) (ne fait PAS partie de « npm test »).
//   node mutations-etape-17/erreurs-volontaires-sql-31.mjs               (toutes les mutations)
//   ONLY=3,7 node mutations-etape-17/erreurs-volontaires-sql-31.mjs      (seulement celles-là)
// Chaque mutation abîme UNE règle dans une COPIE (dossier temporaire) du fichier SQL 31 (variable SQL31_TEST) ; test-avis-envois.mjs doit alors ÉCHOUER (ou planter).
// Le vrai fichier n'est JAMAIS touché (l'outil le vérifie à la fin).
// [nom, texte exact (UNE fois dans le fichier, sauf si le 4ᵉ élément est « tous »), texte abîmé, « tous » (remplacer toutes les occurrences), « aussi » : d'autres paires [texte, texte abîmé] appliquées en même temps]
// (Mutations NON essayées parce qu'ÉQUIVALENTES : effacer le code « delete » d'un déclencheur d'immuabilité (le déclencheur refuse quand même, par sa comparaison) ; retirer le droit « anon » de avis_desabonner_par_jeton (Supabase le redonne d'office à anon par ses privilèges par défaut) ; permuter {delai} et {delai_long} (le premier n'est pas contenu dans le second) ;
//  retirer SEUL le contrôle « déjà averti » de la fonction (l'index unique refuse alors et la fonction attrape l'erreur : même résultat) : on retire donc le contrôle ET l'index ensemble.)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const TESTS = fileURLToPath(new URL('../', import.meta.url));
const FICHIER = fileURLToPath(new URL('../../31-avis-aux-clients.sql', import.meta.url));
const SOURCE = fs.readFileSync(FICHIER, 'utf8');
const TMP = path.join(os.tmpdir(), 'sql-31-mutation-' + (process.env.ONLY || 'tout').replace(/[^0-9]/g, '_') + '.sql');
const ONLY = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;

const TEXTO_H = `Entretien Lapointe : nous passerons chez vous dans environ {delai} pour le service « {service} ». Merci de ramasser les objets sur le terrain pour éviter les bris. Questions : textez le 819 268-8069. ARRET pour ne plus recevoir ces avis.`;
const TEXTO_D = `Entretien Lapointe : nous passerons chez vous demain pour le service « {service} ». Merci de ramasser les objets sur le terrain pour éviter les bris. Questions : textez le 819 268-8069. ARRET pour ne plus recevoir ces avis.`;
const TRIGGER_COMPARE = `new.version_modele, new.objet, new.message)\n     is distinct from\n     (old.id, old.lot_id, old.cree_le, old.jour, old.envoye_par, old.client_id, old.canal, old.destinataire, old.delai, old.service, old.adresse, old.version_modele, old.objet, old.message)`;
const INSERT1 = `values (v_lot, v_jour, p_par, v_c.id, v_canal, v_dest, p_delai, v_service, v_adresse, v_modele.version, v_objet, v_message, v_statut, v_motif, p_maintenant)`;

const M = [
  // — les gardes et la ré-exécution
  ['le contrôle « le fichier 30 a été exécuté » est retiré', `if to_regclass('public.clients') is null or to_regclass('public.avis_sel') is null or to_regclass('public.consentements') is null then`, `if false then`],
  ['ré-exécuter le fichier plante (table des modèles sans « if not exists »)', `create table if not exists public.avis_modeles (`, `create table public.avis_modeles (`],
  ['ré-exécuter le fichier plante (table du journal sans « if not exists »)', `create table if not exists public.avis_envois (`, `create table public.avis_envois (`],
  ['ré-exécuter le fichier plante (modèles sans « on conflict do nothing »)', `on conflict (version, canal, variante) do nothing;`, `;`],
  // — les textes approuvés
  ['texto « heures » : « environ » retiré', TEXTO_H, TEXTO_H.replace('dans environ {delai}', 'dans {delai}')],
  ['texto « heures » : ARRET retiré', TEXTO_H, TEXTO_H.replace(' ARRET pour ne plus recevoir ces avis.', '')],
  ['texto « heures » : le service n\'est plus nommé', TEXTO_H, TEXTO_H.replace(' pour le service « {service} »', '')],
  ['texto « demain » : « demain » remplacé par « aujourd\'hui »', TEXTO_D, TEXTO_D.replace('chez vous demain', 'chez vous aujourd\'hui')],
  ['texto « demain » : le numéro de téléphone est faux', TEXTO_D, TEXTO_D.replace('819 268-8069', '819 268-8060')],
  ['courriel « heures » : l\'objet est changé', `$t$Entretien Lapointe : nous passons chez vous d'ici environ {delai_long}$t$`, `$t$Nous passons chez vous d'ici environ {delai_long}$t$`],
  ['courriel « heures » : l\'adresse du passage n\'est plus dans le corps', `d'ici environ {delai_long} pour le service « {service} » (adresse : {adresse}).`, `d'ici environ {delai_long} pour le service « {service} ».`],
  ['courriel « demain » : l\'adresse du passage n\'est plus dans le corps', `Nous passerons chez vous demain pour le service « {service} » (adresse : {adresse}).`, `Nous passerons chez vous demain pour le service « {service} ».`],
  ['les courriels n\'ont plus le lien de désabonnement', `Ne plus recevoir ces avis : {lien}$t$`, `Ne plus recevoir ces avis.$t$`, 'tous'],
  ['les courriels n\'ont plus l\'adresse postale', `Entretien Lapointe · 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0 · info@entretienlapointe.ca`, `Entretien Lapointe · info@entretienlapointe.ca`, 'tous'],
  ['les courriels n\'invitent plus à ramasser les objets', `Merci de ramasser d'ici là les objets qui se trouvent sur le terrain (jouets, boyaux, décorations, etc.) afin d'éviter tout bris.`, `Merci de votre compréhension.`, 'tous'],
  ['les modèles peuvent être modifiés (déclencheur retiré)', `create trigger avis_modeles_immuables before update or delete on public.avis_modeles\n  for each row execute function public._avis_modeles_immuables();`, `select 1;`],
  ['le texte d\'un modèle peut changer', `if (new.version, new.canal, new.variante, new.objet, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.variante, old.objet, old.texte, old.cree_le) then`, `if (new.version, new.canal, new.variante, new.objet, new.cree_le) is distinct from (old.version, old.canal, old.variante, old.objet, old.cree_le) then`],
  ['un modèle texto peut avoir un objet', `or (canal = 'texto' and objet is null))`, `or (canal = 'texto'))`],
  // — la table du journal
  ['le journal accepte un canal « sms »', `constraint avis_envois_canal_liste check (canal in ('courriel', 'texto')),`, `constraint avis_envois_canal_liste check (canal in ('courriel', 'texto', 'sms')),`],
  ['le journal n\'accepte plus « refuse »', `check (statut in ('en_attente', 'envoye', 'echec', 'refuse')),`, `check (statut in ('en_attente', 'envoye', 'echec')),`],
  ['le journal accepte n\'importe quel délai', `constraint avis_envois_delai_format check (delai = 'demain' or delai ~ '^[1-9][0-9]?h$'),`, `constraint avis_envois_delai_format check (true),`],
  ['un refus peut n\'avoir AUCUN motif', `constraint avis_envois_refus_motif check ((statut = 'refuse') = (motif is not null) or statut = 'echec'),`, `constraint avis_envois_refus_motif check (true),`],
  ['« envoyé » peut n\'avoir aucun identifiant du fournisseur', `constraint avis_envois_envoye_coherent check (statut <> 'envoye' or (envoye_le is not null and fournisseur_id is not null))`, `constraint avis_envois_envoye_coherent check (true)`],
  ['un avis peut viser un client qui n\'existe pas (plus de clé étrangère)', `client_id      uuid not null references public.clients(id),`, `client_id      uuid not null,`],
  ['l\'index « un avis par jour » n\'est plus unique', `create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`, `create index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`],
  ['l\'index « un avis par jour » bloque aussi les envois en échec', `create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`, `create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye', 'echec');`],
  ['l\'index « un avis par jour » ignore le canal', `(client_id, canal, jour) where statut in ('en_attente', 'envoye');`, `(client_id, jour) where statut in ('en_attente', 'envoye');`],
  // — le journal à l'épreuve des modifications
  ['le message d\'une ligne peut être modifié', TRIGGER_COMPARE, TRIGGER_COMPARE.replace('new.objet, new.message)', 'new.objet)').replace('old.objet, old.message)', 'old.objet)')],
  ['une ligne « envoyée » peut encore changer', `  if old.statut <> 'en_attente' then\n    raise exception 'journal_immuable';\n  end if;`, ``],
  ['le journal peut être vidé (truncate)', `create trigger avis_envois_pas_de_vidage before truncate on public.avis_envois\n  for each statement execute function public._avis_envois_pas_de_vidage();`, `select 1;`],
  ['le journal est sans la sécurité par ligne (RLS)', `alter table public.avis_envois enable row level security;`, `select 1;`],
  ['tout administrateur ET tout employé lit le journal', `create policy avis_envois_admin_lecture on public.avis_envois for select to authenticated using ((select public.est_admin()));`, `create policy avis_envois_admin_lecture on public.avis_envois for select to authenticated using (true);`],
  ['les modèles sont lisibles par tous les employés', `create policy avis_modeles_admin_lecture on public.avis_modeles for select to authenticated using ((select public.est_admin()));`, `create policy avis_modeles_admin_lecture on public.avis_modeles for select to authenticated using (true);`],
  ['une personne connectée peut écrire dans le journal', `grant select on public.avis_modeles, public.avis_envois to authenticated;`, `grant select, insert, update, delete on public.avis_modeles, public.avis_envois to authenticated;`],
  ['un visiteur peut lire le journal (le retrait des droits est oublié)', `revoke all on public.avis_modeles, public.avis_envois from public, anon, authenticated;`, `select 1;`],
  // — qui peut préparer
  ['n\'importe qui peut préparer un avis (le contrôle de l\'administrateur est retiré)', `if p_par is null or not exists (select 1 from public.utilisateurs u where u.id = p_par and u.role = 'admin' and u.actif) then`, `if false then`],
  ['un administrateur désactivé peut préparer un avis', `where u.id = p_par and u.role = 'admin' and u.actif) then`, `where u.id = p_par and u.role = 'admin') then`],
  ['un employé peut préparer un avis', `where u.id = p_par and u.role = 'admin' and u.actif) then`, `where u.id = p_par and u.actif) then`],
  ['une personne connectée peut appeler avis_preparer', `grant execute on function public.avis_preparer(uuid, text, jsonb, timestamptz)   to service_role;`, `grant execute on function public.avis_preparer(uuid, text, jsonb, timestamptz)   to service_role, authenticated;`],
  ['une personne connectée peut appeler avis_marquer', `grant execute on function public.avis_marquer(uuid, text, text, text)            to service_role;`, `grant execute on function public.avis_marquer(uuid, text, text, text)            to service_role, authenticated;`],
  ['un visiteur peut obtenir un jeton (le retrait des droits est oublié)', `revoke all on function public.avis_jeton(uuid, text)                             from public, anon, authenticated;`, `select 1;`],
  ['avis_preparer n\'a plus de chemin de recherche fermé', `language plpgsql security definer set search_path = ''\nas $$\ndeclare\n  v_heures   integer;`, `language plpgsql security definer\nas $$\ndeclare\n  v_heures   integer;`],
  // — les délais
  ['un délai de 100 heures est accepté', `if v_heures > 72 then`, `if v_heures > 100 then`],
  ['le délai n\'est plus validé', `if p_delai is null or not (p_delai = 'demain' or p_delai ~ '^[1-9][0-9]?h$') then`, `if p_delai is null then`],
  ['« 1 heure » devient « 1 heures »', `case when v_heures > 1 then 's' else '' end`, `'s'`],
  ['le texto dit « 3 » au lieu de « 3 h »', `v_court := v_heures || ' h';`, `v_court := v_heures::text;`],
  ['« demain » utilise les textes « heures »', `    v_variante := 'demain';`, `    v_variante := 'heures';`],
  // — les lignes
  ['plus de 300 lignes sont acceptées', `jsonb_array_length(p_lignes) > 300`, `jsonb_array_length(p_lignes) > 3000`],
  ['une liste vide est acceptée', `or jsonb_array_length(p_lignes) = 0`, ``],
  ['un service de 1000 caractères est accepté', `char_length(v_service) not between 1 and 100`, `char_length(v_service) not between 1 and 1000`],
  ['un identifiant de client mal écrit est accepté', `coalesce(v_ligne ->> 'client_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`, `false`],
  ['une fiche archivée reçoit un avis', `if not found or not v_c.actif then`, `if not found then`],
  // — les heures
  ['aucun texto de 21 h à 6 h : la limite du matin passe à 5 h', `v_local::time >= time '06:00'`, `v_local::time >= time '05:00'`],
  ['… la limite du matin est exclue', `v_local::time >= time '06:00'`, `v_local::time > time '06:00'`],
  ['… la limite du soir est incluse', `v_local::time < time '21:00'`, `v_local::time <= time '21:00'`],
  ['… la limite du soir passe à 22 h', `v_local::time < time '21:00'`, `v_local::time < time '22:00'`],
  ['les heures ne tiennent plus compte du fuseau du Québec', `v_local := p_maintenant at time zone 'America/Toronto';`, `v_local := p_maintenant at time zone 'UTC';`],
  ['le jour n\'est plus celui du Québec', `v_jour := v_local::date;`, `v_jour := (p_maintenant at time zone 'UTC')::date;`],
  // — qui reçoit quoi
  ['plusieurs avis le même jour sont permis (le contrôle ET l’index retirés)', `if v_motif is null and exists (select 1 from public.avis_envois e where e.client_id = v_c.id and e.canal = v_canal and e.jour = v_jour and e.statut in ('en_attente', 'envoye')) then`, `if false then`, false, [[`create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`, `create index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`]]],
  ['un avis déjà « envoyé » ne bloque pas le suivant (contrôle ET index)', `e.jour = v_jour and e.statut in ('en_attente', 'envoye')) then`, `e.jour = v_jour and e.statut in ('en_attente')) then`, false, [[`create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`, `create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente');`]]],
  ['un avis « en attente » ne bloque pas le suivant (contrôle ET index)', `e.jour = v_jour and e.statut in ('en_attente', 'envoye')) then`, `e.jour = v_jour and e.statut in ('envoye')) then`, false, [[`create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`, `create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('envoye');`]]],
  ['un avis en échec bloque le reste de la journée (contrôle ET index)', `e.jour = v_jour and e.statut in ('en_attente', 'envoye')) then`, `e.jour = v_jour and e.statut in ('en_attente', 'envoye', 'echec')) then`, false, [[`create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');`, `create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye', 'echec');`]]],
  ['un client désabonné des courriels reçoit quand même', `if v_c.desabonne_courriel_le is not null then v_motif := 'desabonne';`, `if false then v_motif := 'desabonne';`],
  ['un client désabonné des textos reçoit quand même', `if v_c.desabonne_texto_le is not null then v_motif := 'desabonne';`, `if false then v_motif := 'desabonne';`],
  ['« avertir par courriel » n\'est plus exigé', `elsif not v_c.avis_courriel then v_motif := 'pas_active';`, `elsif false then v_motif := 'pas_active';`],
  ['l\'inscription aux textos n\'est plus exigée', `elsif not v_c.avis_texto then v_motif := 'pas_active';`, `elsif false then v_motif := 'pas_active';`],
  ['un courriel est « envoyé » à une fiche sans courriel', `elsif v_c.courriel is null then v_motif := 'pas_de_coordonnee';`, `elsif false then v_motif := 'pas_de_coordonnee';`],
  ['les heures permises ne sont plus vérifiées pour le texto', `elsif not v_heure_ok then v_motif := 'hors_heures';`, `elsif false then v_motif := 'hors_heures';`],
  ['le courriel est aussi bloqué la nuit', `        if v_c.desabonne_courriel_le is not null then v_motif := 'desabonne';`, `        if not v_heure_ok then v_motif := 'hors_heures';\n        elsif v_c.desabonne_courriel_le is not null then v_motif := 'desabonne';`],
  ['la course entre deux demandes plante au lieu de refuser', `      exception when unique_violation then`, `      exception when no_data_found then`],
  ['le courriel et le texto vont au même destinataire', `        v_dest := v_c.cellulaire;`, `        v_dest := v_c.courriel;`],
  ['seul le courriel est préparé (le texto est oublié)', `foreach v_canal in array array['courriel', 'texto'] loop`, `foreach v_canal in array array['courriel'] loop`],
  ['la ligne du journal porte l\'heure du serveur au lieu de celle de la demande', INSERT1, INSERT1.replace('p_maintenant)', 'now())')],
  ['le modèle utilisé n\'est plus le plus récent', `order by m.cree_le desc, m.version desc limit 1;`, `order by m.cree_le asc, m.version asc limit 1;`],
  ['un modèle retiré (en_vigueur faux) est quand même utilisé', `from public.avis_modeles m where m.canal = v_canal and m.variante = v_variante and m.en_vigueur order by`, `from public.avis_modeles m where m.canal = v_canal and m.variante = v_variante order by`],
  ['l\'absence de modèle n\'arrête plus rien', `      if not found then\n        raise exception 'modele_introuvable';\n      end if;`, ``],
  ['le service peut glisser des accolades dans un message', `translate(coalesce(p_brut, ''), '{}', '()')`, `coalesce(p_brut, '')`],
  ['les espaces et les tabulations ne sont plus nettoyés', `'[\\x01-\\x1f\\x7f ]+', ' ', 'g'`, `'[\\x01-\\x08]+', ' ', 'g'`],
  // — noter le résultat
  ['« envoyé » est accepté sans identifiant du fournisseur', `    if coalesce(btrim(p_fournisseur_id), '') = '' then\n      raise exception 'fournisseur_requis';\n    end if;\n`, ``],
  ['une ligne déjà marquée peut être re-marquée', `  if v_e.statut <> 'en_attente' then\n    raise exception 'avis_deja_marque';\n  end if;`, ``],
  ['un statut inconnu est accepté', `if p_statut is null or p_statut not in ('envoye', 'echec') then`, `if p_statut is null then`],
  ['la raison d\'un échec n\'est pas limitée à 500 caractères', `left(coalesce(nullif(btrim(p_erreur), ''), 'erreur inconnue'), 500)`, `coalesce(nullif(btrim(p_erreur), ''), 'erreur inconnue')`],
  ['une raison vide n\'est pas remplacée', `left(coalesce(nullif(btrim(p_erreur), ''), 'erreur inconnue'), 500)`, `left(coalesce(p_erreur, ''), 500)`],
  ['un échec n\'est plus noté avec son motif', `statut = 'echec', erreur = left(coalesce(nullif(btrim(p_erreur), ''), 'erreur inconnue'), 500), motif = 'echec_fournisseur' where id = p_id;`, `statut = 'echec', erreur = left(coalesce(nullif(btrim(p_erreur), ''), 'erreur inconnue'), 500), motif = 'echec_fournisseur' where id = p_id and false;`],
  ['une ligne inconnue n\'est plus signalée', `  if not found then\n    raise exception 'avis_introuvable';\n  end if;`, ``],
  // — le lien de désabonnement
  ['le jeton ne dépend plus du secret de la base', ` || '|' || (select s.sel from public.avis_sel s limit 1), 'utf8')), 'hex'), 1, 32)`, ` || '|', 'utf8')), 'hex'), 1, 32)`],
  ['le jeton est le même pour tous les canaux', `p_client_id::text || '|' || coalesce(p_canal, '')`, `p_client_id::text || '|'`],
  ['le jeton est raccourci à 8 caractères', `, 'hex'), 1, 32)`, `, 'hex'), 1, 8)`],
  ['n\'importe quel jeton désabonne (la vérification est retirée)', `if p_client_id is null or p_jeton is null or p_jeton <> public.avis_jeton(p_client_id, 'courriel') then`, `if p_client_id is null then`],
  ['un client sans courriel donne une autre réponse', `  if not found or v_c.courriel is null then\n    raise exception 'lien_invalide';\n  end if;`, `  if not found then\n    raise exception 'lien_invalide';\n  end if;`],
  ['le désabonnement n\'est plus inscrit au registre', `  perform public.desabonner_contact('courriel', v_c.courriel, 'lien_desabonnement');`, `  null;`],
  ['le désabonnement dit « texto_arret » au lieu du lien', `  perform public.desabonner_contact('courriel', v_c.courriel, 'lien_desabonnement');`, `  perform public.desabonner_contact('courriel', v_c.courriel, 'texto_arret');`],
  ['le désabonnement touche les textos au lieu des courriels', `  perform public.desabonner_contact('courriel', v_c.courriel, 'lien_desabonnement');`, `  perform public.desabonner_contact('texto', v_c.cellulaire, 'lien_desabonnement');`],
];

let detectees = 0, essayees = 0; const rapport = [];
try {
  for (const [i, [nom, de, vers, tous, aussi]] of M.entries()) {
    if (ONLY && !ONLY.includes(i + 1)) continue;
    essayees++;
    const n = SOURCE.split(de).length - 1;
    if (tous ? n < 1 : n !== 1) { rapport.push(`?? ${i + 1}. TEXTE ${n === 0 ? 'INTROUVABLE' : 'EN ' + n + ' EXEMPLAIRES'} : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    let mut = tous ? SOURCE.split(de).join(vers) : SOURCE.replace(de, () => vers);
    for (const [d2, v2] of aussi || []) { if (mut.split(d2).length !== 2) { rapport.push(`?? ${i + 1}. TEXTE « aussi » INTROUVABLE : ${nom}`); console.log(rapport[rapport.length - 1]); mut = SOURCE; break; } mut = mut.replace(d2, () => v2); }
    if (mut === SOURCE) { rapport.push(`?? ${i + 1}. MUTATION SANS EFFET : ${nom}`); console.log(rapport[rapport.length - 1]); continue; }
    fs.writeFileSync(TMP, mut);
    let sortie = '';
    try { sortie = execFileSync('node', ['test-avis-envois.mjs'], { cwd: TESTS, env: { ...process.env, SQL31_TEST: TMP }, encoding: 'utf8', timeout: 240000, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { sortie = String(e.stdout || '') + String(e.stderr || ''); }
    const m = sortie.match(/RÉSULTAT : (\d+) réussis, (\d+) échoués/);
    const ko = m ? Number(m[2]) : -1;
    const vu = ko !== 0;
    if (vu) detectees++;
    rapport.push(`${vu ? 'OK  détectée' : 'RATÉE      '} ${i + 1}. ${nom}${m ? ' (' + ko + ' échec(s))' : ' (plantage)'}`);
    console.log(rapport[rapport.length - 1]);
  }
} finally {
  fs.rmSync(TMP, { force: true });
}
console.log(`\n${detectees} erreurs volontaires détectées sur ${essayees}`);
console.log(fs.readFileSync(FICHIER, 'utf8') === SOURCE ? 'Le vrai fichier (SQL 31) est intact.' : '⚠ LE VRAI FICHIER A CHANGÉ !');
