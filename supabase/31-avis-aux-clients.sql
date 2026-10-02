-- =====================================================================
-- DEMANDE 5 DE JOÉ — CHANTIER C (1ᵉʳ OCTOBRE 2026) : AVERTIR LES CLIENTS « NOUS PASSONS CHEZ VOUS DANS ENVIRON X HEURES » : les MODÈLES DE MESSAGES approuvés, le JOURNAL DES AVIS
-- (la preuve en cas de bris) et les règles d'envoi (qui, quand, une seule fois par jour)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 30. Ne modifie AUCUNE donnée existante, AUCUNE règle d'accès existante et AUCUNE fonction existante : elle ajoute des tables (vides au départ, sauf les
-- modèles de messages), des fonctions et rien d'autre. Peut être exécuté plusieurs fois sans problème (le journal n'est jamais effacé ; les modèles ne sont jamais modifiés).
--
-- CE QUE FAIT CE FICHIER (l'envoi lui-même — le courriel par Resend, le texto par Twilio — est fait par des fonctions serveur qui appellent celles-ci : fichier à part) :
--   • avis_modeles : les textes des messages, par version (avis-2026-10-v1 : texto, courriel ; « dans environ X heures » ou « demain »). Une version n'est jamais modifiée ni effacée (seul
--     « en_vigueur » peut changer) : un nouveau texte est une NOUVELLE version. Textes approuvés par Joé le 1ᵉʳ octobre 2026 (signature : « Entretien Lapointe » seulement).
--   • avis_envois : le JOURNAL. Une ligne par client, par canal (courriel ou texto) et par tentative : quand, qui l'a demandé, à quelle adresse, le message EXACT, le délai annoncé, la version du
--     modèle, le résultat (en attente, envoyé, échec, REFUSÉ avec le motif : pas activé, pas de coordonnée, désabonné, hors des heures permises, déjà averti aujourd'hui). On ne peut ni modifier
--     ni effacer une ligne (sauf le résultat d'une ligne « en attente », une seule fois) : même l'administrateur, même le propriétaire de la base. Lisible par l'ADMINISTRATEUR seulement.
--   • avis_preparer(…) : pour la fonction d'envoi SEULEMENT (rôle service_role). Reçoit les clients choisis (avec le service et l'adresse du passage) et le délai (« 1h » à « 72h », ou « demain »),
--     décide pour chaque client et chaque canal, écrit les lignes du journal (« en attente » ou « refusé ») et rend le message à envoyer. Règles : jamais à une fiche archivée ; le COURRIEL seulement
--     si « avertir par courriel » est coché, qu'il y a un courriel et que le client ne s'est pas désabonné ; le TEXTO seulement si la fiche est inscrite aux textos, a un cellulaire et n'est pas
--     désabonnée, ET jamais de 21 h à 6 h (heure du Québec) ; UN SEUL avis par client, par canal et par jour (un jour = un jour du calendrier du Québec) ; le message est fabriqué ICI, à partir du modèle
--     en vigueur (jamais par l'application).
--   • avis_marquer(…) : pour la fonction d'envoi seulement : note le résultat d'une ligne « en attente » (envoyé avec l'identifiant du fournisseur, ou échec avec la raison).
--   • avis_jeton(…) et avis_desabonner_par_jeton(…) : le LIEN DE DÉSABONNEMENT de chaque courriel (loi anti-pourriel) : un jeton secret (jamais devinable) propre à chaque client ; le visiteur qui
--     touche le lien (page publique, sans compte) se désabonne des courriels d'avis (inscrit au registre des consentements : retrait, source « lien_desabonnement »).
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller TOUT ce fichier > Run (ou : Claude l'exécute lui-même avec l'accord de Joé). Le résultat « verification » du bas est à contrôler.
-- =====================================================================

do $$
begin
  if to_regclass('public.clients') is null or to_regclass('public.avis_sel') is null or to_regclass('public.consentements') is null then
    raise exception 'le fichier 30 (répertoire des clients) n''a pas été exécuté. Rien n''a été modifié.';
  end if;
  if to_regprocedure('public.desabonner_contact(text, text, text)') is null or to_regclass('public.clients_avis') is null then
    raise exception 'le fichier 30 est incomplet (desabonner_contact, clients_avis). Rien n''a été modifié.';
  end if;
end $$;

begin;

-- Les modèles de messages
create table if not exists public.avis_modeles (
  version    text not null,
  canal      text not null,
  variante   text not null,
  objet      text,
  texte      text not null,
  en_vigueur boolean not null default true,
  cree_le    timestamptz not null default now(),
  primary key (version, canal, variante),
  constraint avis_modeles_canal_liste check (canal in ('courriel', 'texto')),
  constraint avis_modeles_variante_liste check (variante in ('heures', 'demain')),
  constraint avis_modeles_objet_coherent check ((canal = 'courriel' and objet is not null and char_length(btrim(objet)) >= 5) or (canal = 'texto' and objet is null)),
  constraint avis_modeles_texte_present check (char_length(btrim(texte)) >= 20)
);

comment on table public.avis_modeles is
  'Les textes des avis « nous passons chez vous » (demande 5, chantier C), par version. Marqueurs : {delai} (« 3 h »), {delai_long} (« 3 heures »), {service}, {adresse}, {lien} (le lien de désabonnement du courriel). Une version n''est jamais modifiée ni effacée : un nouveau texte est une NOUVELLE version. Le message envoyé est copié mot pour mot dans le journal (avis_envois).';

-- Version 1 : approuvée par Joé le 1ᵉʳ octobre 2026 (signature : « Entretien Lapointe » seulement)
insert into public.avis_modeles (version, canal, variante, objet, texte) values
  ('avis-2026-10-v1', 'texto', 'heures', null,
   $t$Entretien Lapointe : nous passerons chez vous dans environ {delai} pour le service « {service} ». Merci de ramasser les objets sur le terrain pour éviter les bris. Questions : textez le 819 268-8069. ARRET pour ne plus recevoir ces avis.$t$),
  ('avis-2026-10-v1', 'texto', 'demain', null,
   $t$Entretien Lapointe : nous passerons chez vous demain pour le service « {service} ». Merci de ramasser les objets sur le terrain pour éviter les bris. Questions : textez le 819 268-8069. ARRET pour ne plus recevoir ces avis.$t$),
  ('avis-2026-10-v1', 'courriel', 'heures', $t$Entretien Lapointe : nous passons chez vous d'ici environ {delai_long}$t$,
   $t$Bonjour,

Nous passerons chez vous d'ici environ {delai_long} pour le service « {service} » (adresse : {adresse}).

Merci de ramasser d'ici là les objets qui se trouvent sur le terrain (jouets, boyaux, décorations, etc.) afin d'éviter tout bris.

Une question ? Textez-nous au 819 268-8069.

Entretien Lapointe · 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0 · info@entretienlapointe.ca
Vous recevez cet avis parce que vous êtes client d'Entretien Lapointe. Ne plus recevoir ces avis : {lien}$t$),
  ('avis-2026-10-v1', 'courriel', 'demain', $t$Entretien Lapointe : nous passons chez vous demain$t$,
   $t$Bonjour,

Nous passerons chez vous demain pour le service « {service} » (adresse : {adresse}).

Merci de ramasser d'ici là les objets qui se trouvent sur le terrain (jouets, boyaux, décorations, etc.) afin d'éviter tout bris.

Une question ? Textez-nous au 819 268-8069.

Entretien Lapointe · 331, Le Petit Bellechasse N, Charette (Québec) G0X 1E0 · info@entretienlapointe.ca
Vous recevez cet avis parce que vous êtes client d'Entretien Lapointe. Ne plus recevoir ces avis : {lien}$t$)
on conflict (version, canal, variante) do nothing;

create or replace function public._avis_modeles_immuables()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'modele_immuable';
  end if;
  if (new.version, new.canal, new.variante, new.objet, new.texte, new.cree_le) is distinct from (old.version, old.canal, old.variante, old.objet, old.texte, old.cree_le) then
    raise exception 'modele_immuable';
  end if;
  return new;
end;
$$;

drop trigger if exists avis_modeles_immuables on public.avis_modeles;
create trigger avis_modeles_immuables before update or delete on public.avis_modeles
  for each row execute function public._avis_modeles_immuables();

-- Le journal des avis
create table if not exists public.avis_envois (
  id             uuid primary key default gen_random_uuid(),
  lot_id         uuid not null,
  cree_le        timestamptz not null default now(),
  jour           date not null,
  envoye_par     uuid not null references public.utilisateurs(id),
  client_id      uuid not null references public.clients(id),
  canal          text not null,
  destinataire   text,
  delai          text not null,
  service        text not null,
  adresse        text not null,
  version_modele text not null,
  objet          text,
  message        text not null,
  statut         text not null,
  motif          text,
  fournisseur_id text,
  envoye_le      timestamptz,
  erreur         text,
  constraint avis_envois_canal_liste check (canal in ('courriel', 'texto')),
  constraint avis_envois_statut_liste check (statut in ('en_attente', 'envoye', 'echec', 'refuse')),
  constraint avis_envois_delai_format check (delai = 'demain' or delai ~ '^[1-9][0-9]?h$'),
  constraint avis_envois_service_plage check (char_length(service) between 1 and 100),
  constraint avis_envois_adresse_plage check (char_length(adresse) between 1 and 200),
  constraint avis_envois_refus_motif check ((statut = 'refuse') = (motif is not null) or statut = 'echec'),
  constraint avis_envois_envoye_coherent check (statut <> 'envoye' or (envoye_le is not null and fournisseur_id is not null))
);

comment on table public.avis_envois is
  'Le JOURNAL des avis aux clients (demande 5, chantier C) : la preuve de ce qui a été envoyé, à qui, quand et avec quel message exact (ou pourquoi ce n''a PAS été envoyé). Écrit par les fonctions avis_preparer et avis_marquer seulement ; ni modifiable ni effaçable (sauf le résultat d''une ligne « en attente », une fois) ; lisible par l''ADMINISTRATEUR seulement. Un seul avis « en attente » ou « envoyé » par client, par canal et par jour (jour du calendrier du Québec).';

create index if not exists avis_envois_client_idx on public.avis_envois (client_id, cree_le desc);
create index if not exists avis_envois_lot_idx on public.avis_envois (lot_id);
create unique index if not exists avis_envois_un_par_jour on public.avis_envois (client_id, canal, jour) where statut in ('en_attente', 'envoye');

create or replace function public._avis_envois_immuables()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'journal_immuable';
  end if;
  if (new.id, new.lot_id, new.cree_le, new.jour, new.envoye_par, new.client_id, new.canal, new.destinataire, new.delai, new.service, new.adresse, new.version_modele, new.objet, new.message)
     is distinct from
     (old.id, old.lot_id, old.cree_le, old.jour, old.envoye_par, old.client_id, old.canal, old.destinataire, old.delai, old.service, old.adresse, old.version_modele, old.objet, old.message) then
    raise exception 'journal_immuable';
  end if;
  if old.statut <> 'en_attente' then
    raise exception 'journal_immuable';
  end if;
  return new;
end;
$$;

create or replace function public._avis_envois_pas_de_vidage()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  raise exception 'journal_immuable';
end;
$$;

drop trigger if exists avis_envois_immuables on public.avis_envois;
create trigger avis_envois_immuables before update or delete on public.avis_envois
  for each row execute function public._avis_envois_immuables();
drop trigger if exists avis_envois_pas_de_vidage on public.avis_envois;
create trigger avis_envois_pas_de_vidage before truncate on public.avis_envois
  for each statement execute function public._avis_envois_pas_de_vidage();

alter table public.avis_modeles enable row level security;
alter table public.avis_envois enable row level security;
revoke all on public.avis_modeles, public.avis_envois from public, anon, authenticated;
grant select on public.avis_modeles, public.avis_envois to authenticated;

drop policy if exists avis_modeles_admin_lecture on public.avis_modeles;
create policy avis_modeles_admin_lecture on public.avis_modeles for select to authenticated using ((select public.est_admin()));
drop policy if exists avis_envois_admin_lecture on public.avis_envois;
create policy avis_envois_admin_lecture on public.avis_envois for select to authenticated using ((select public.est_admin()));

-- Fabrique un message à partir d'un modèle (le lien de désabonnement est remplacé par un repère : la fonction d'envoi y met le vrai lien)
create or replace function public._avis_rendre(p_modele text, p_delai text, p_delai_long text, p_service text, p_adresse text)
returns text
language sql immutable set search_path = ''
as $$
  select replace(replace(replace(replace(replace(p_modele, '{delai_long}', p_delai_long), '{delai}', p_delai), '{lien}', '[lien de désabonnement]'), '{service}', p_service), '{adresse}', p_adresse)
$$;

-- Le texte d'une valeur reçue : sans caractères de contrôle ni accolades (un service ou une adresse ne peut pas glisser un repère dans le message), espaces multiples réduits à un seul
create or replace function public._avis_texte_propre(p_brut text)
returns text
language sql immutable set search_path = ''
as $$
  select btrim(regexp_replace(translate(coalesce(p_brut, ''), '{}', '()'), '[\x01-\x1f\x7f ]+', ' ', 'g'))
$$;

-- Prépare un lot d'avis : décide, écrit le journal, rend les messages à envoyer. Pour la fonction d'envoi seulement.
-- p_par : l'administrateur qui demande (la fonction d'envoi a vérifié son jeton) ; p_delai : « 1h » à « 72h » ou « demain » ;
-- p_lignes : [{"client_id": "…", "service": "Coupe de gazon", "adresse": "10 rue des Pins, Louiseville"}, …] (300 au plus) ;
-- p_maintenant : l'heure de la demande (celle du serveur ; un autre moment seulement pour les essais).
create or replace function public.avis_preparer(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_heures   integer;
  v_variante text;
  v_court    text;
  v_long     text;
  v_lot      uuid := gen_random_uuid();
  v_local    timestamp;
  v_jour     date;
  v_heure_ok boolean;
  v_ligne    jsonb;
  v_c        public.clients%rowtype;
  v_service  text;
  v_adresse  text;
  v_canal    text;
  v_modele   record;
  v_motif    text;
  v_dest     text;
  v_message  text;
  v_objet    text;
  v_id       uuid;
  v_statut   text;
  v_res      jsonb := '[]'::jsonb;
begin
  if p_par is null or not exists (select 1 from public.utilisateurs u where u.id = p_par and u.role = 'admin' and u.actif) then
    raise exception 'non_autorise';
  end if;
  if p_delai is null or not (p_delai = 'demain' or p_delai ~ '^[1-9][0-9]?h$') then
    raise exception 'delai_invalide';
  end if;
  if p_delai <> 'demain' then
    v_heures := substring(p_delai from '^([0-9]+)h$')::integer;
    if v_heures > 72 then
      raise exception 'delai_invalide';
    end if;
    v_variante := 'heures';
    v_court := v_heures || ' h';
    v_long := v_heures || ' heure' || case when v_heures > 1 then 's' else '' end;
  else
    v_variante := 'demain';
    v_court := 'demain';
    v_long := 'demain';
  end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 or jsonb_array_length(p_lignes) > 300 then
    raise exception 'lignes_invalides';
  end if;

  v_local := p_maintenant at time zone 'America/Toronto';
  v_jour := v_local::date;
  v_heure_ok := v_local::time >= time '06:00' and v_local::time < time '21:00';

  for v_ligne in select * from jsonb_array_elements(p_lignes) loop
    v_service := public._avis_texte_propre(v_ligne ->> 'service');
    v_adresse := public._avis_texte_propre(v_ligne ->> 'adresse');
    if jsonb_typeof(v_ligne) <> 'object'
       or coalesce(v_ligne ->> 'client_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or char_length(v_service) not between 1 and 100 or char_length(v_adresse) not between 1 and 200 then
      v_res := v_res || jsonb_build_object('client_id', v_ligne ->> 'client_id', 'statut', 'refuse', 'motif', 'ligne_invalide');
      continue;
    end if;
    select * into v_c from public.clients where id = (v_ligne ->> 'client_id')::uuid;
    if not found or not v_c.actif then
      v_res := v_res || jsonb_build_object('client_id', v_ligne ->> 'client_id', 'statut', 'refuse', 'motif', 'client_introuvable');
      continue;
    end if;

    foreach v_canal in array array['courriel', 'texto'] loop
      select m.version, m.objet, m.texte into v_modele
        from public.avis_modeles m where m.canal = v_canal and m.variante = v_variante and m.en_vigueur order by m.cree_le desc, m.version desc limit 1;
      if not found then
        raise exception 'modele_introuvable';
      end if;
      v_message := public._avis_rendre(v_modele.texte, v_court, v_long, v_service, v_adresse);
      v_objet := case when v_modele.objet is null then null else public._avis_rendre(v_modele.objet, v_court, v_long, v_service, v_adresse) end;
      v_motif := null;
      if v_canal = 'courriel' then
        v_dest := v_c.courriel;
        if v_c.desabonne_courriel_le is not null then v_motif := 'desabonne';
        elsif not v_c.avis_courriel then v_motif := 'pas_active';
        elsif v_c.courriel is null then v_motif := 'pas_de_coordonnee';
        end if;
      else
        v_dest := v_c.cellulaire;
        if v_c.desabonne_texto_le is not null then v_motif := 'desabonne';
        elsif not v_c.avis_texto then v_motif := 'pas_active';
        elsif v_c.cellulaire is null then v_motif := 'pas_de_coordonnee';
        elsif not v_heure_ok then v_motif := 'hors_heures';
        end if;
      end if;
      if v_motif is null and exists (select 1 from public.avis_envois e where e.client_id = v_c.id and e.canal = v_canal and e.jour = v_jour and e.statut in ('en_attente', 'envoye')) then
        v_motif := 'deja_averti_aujourdhui';
      end if;
      v_statut := case when v_motif is null then 'en_attente' else 'refuse' end;
      begin
        insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, objet, message, statut, motif, cree_le)
        values (v_lot, v_jour, p_par, v_c.id, v_canal, v_dest, p_delai, v_service, v_adresse, v_modele.version, v_objet, v_message, v_statut, v_motif, p_maintenant)
        returning id into v_id;
      exception when unique_violation then
        -- deux demandes en même temps pour le même client : la seconde est refusée (jamais deux avis)
        v_statut := 'refuse';
        v_motif := 'deja_averti_aujourdhui';
        insert into public.avis_envois (lot_id, jour, envoye_par, client_id, canal, destinataire, delai, service, adresse, version_modele, objet, message, statut, motif, cree_le)
        values (v_lot, v_jour, p_par, v_c.id, v_canal, v_dest, p_delai, v_service, v_adresse, v_modele.version, v_objet, v_message, 'refuse', v_motif, p_maintenant)
        returning id into v_id;
      end;
      v_res := v_res || jsonb_build_object('id', v_id, 'client_id', v_c.id, 'canal', v_canal, 'statut', v_statut, 'motif', v_motif,
                                           'destinataire', v_dest, 'objet', v_objet, 'message', v_message);
    end loop;
  end loop;

  return jsonb_build_object('lot_id', v_lot, 'jour', v_jour, 'heure_permise_texto', v_heure_ok, 'lignes', v_res);
end;
$$;

-- Note le résultat d'une ligne « en attente » (une seule fois). Pour la fonction d'envoi seulement.
create or replace function public.avis_marquer(p_id uuid, p_statut text, p_fournisseur_id text default null, p_erreur text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_e public.avis_envois%rowtype;
begin
  if p_statut is null or p_statut not in ('envoye', 'echec') then
    raise exception 'statut_invalide';
  end if;
  select * into v_e from public.avis_envois where id = p_id for update;
  if not found then
    raise exception 'avis_introuvable';
  end if;
  if v_e.statut <> 'en_attente' then
    raise exception 'avis_deja_marque';
  end if;
  if p_statut = 'envoye' then
    if coalesce(btrim(p_fournisseur_id), '') = '' then
      raise exception 'fournisseur_requis';
    end if;
    update public.avis_envois set statut = 'envoye', fournisseur_id = left(btrim(p_fournisseur_id), 200), envoye_le = now() where id = p_id;
  else
    update public.avis_envois set statut = 'echec', erreur = left(coalesce(nullif(btrim(p_erreur), ''), 'erreur inconnue'), 500), motif = 'echec_fournisseur' where id = p_id;
  end if;
  return jsonb_build_object('statut', p_statut);
end;
$$;

-- Le jeton secret du lien de désabonnement d'un client (32 caractères ; dérivé d'un secret propre à cette base : impossible à deviner). Pour la fonction d'envoi seulement.
create or replace function public.avis_jeton(p_client_id uuid, p_canal text default 'courriel')
returns text
language sql stable security definer set search_path = ''
as $$
  select substr(encode(sha256(convert_to(p_client_id::text || '|' || coalesce(p_canal, '') || '|' || (select s.sel from public.avis_sel s limit 1), 'utf8')), 'hex'), 1, 32)
$$;

-- Le lien de désabonnement d'un courriel (page publique, sans compte) : le client se désabonne des courriels d'avis (registre : retrait, source « lien_desabonnement »).
-- Un lien faux, périmé ou un client inconnu donne TOUJOURS la même réponse (« lien_invalide ») : rien ne se découvre en essayant.
create or replace function public.avis_desabonner_par_jeton(p_client_id uuid, p_jeton text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_c public.clients%rowtype;
begin
  if p_client_id is null or p_jeton is null or p_jeton <> public.avis_jeton(p_client_id, 'courriel') then
    raise exception 'lien_invalide';
  end if;
  select * into v_c from public.clients where id = p_client_id;
  if not found or v_c.courriel is null then
    raise exception 'lien_invalide';
  end if;
  perform public.desabonner_contact('courriel', v_c.courriel, 'lien_desabonnement');
  return jsonb_build_object('statut', 'desabonne');
end;
$$;

revoke all on function public._avis_modeles_immuables()                          from public, anon, authenticated;
revoke all on function public._avis_envois_immuables()                           from public, anon, authenticated;
revoke all on function public._avis_envois_pas_de_vidage()                       from public, anon, authenticated;
revoke all on function public._avis_rendre(text, text, text, text, text)         from public, anon, authenticated;
revoke all on function public._avis_texte_propre(text)                           from public, anon, authenticated;
revoke all on function public.avis_preparer(uuid, text, jsonb, timestamptz)      from public, anon, authenticated;
grant execute on function public.avis_preparer(uuid, text, jsonb, timestamptz)   to service_role;
revoke all on function public.avis_marquer(uuid, text, text, text)               from public, anon, authenticated;
grant execute on function public.avis_marquer(uuid, text, text, text)            to service_role;
revoke all on function public.avis_jeton(uuid, text)                             from public, anon, authenticated;
grant execute on function public.avis_jeton(uuid, text)                          to service_role;
revoke all on function public.avis_desabonner_par_jeton(uuid, text)              from public;
grant execute on function public.avis_desabonner_par_jeton(uuid, text)           to anon, authenticated, service_role;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à contrôler.
-- =====================================================================
select jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(t order by t), '[]'::jsonb) from unnest(array['avis_modeles', 'avis_envois']) t where to_regclass('public.' || t) is not null),
  'regles_actives', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c where c.oid in ('public.avis_modeles'::regclass, 'public.avis_envois'::regclass) and c.relrowsecurity),
  'regles', (select coalesce(jsonb_agg(tablename || '.' || policyname || ' (' || cmd || ')' order by tablename, policyname), '[]'::jsonb) from pg_policies where schemaname = 'public' and tablename in ('avis_modeles', 'avis_envois')),
  'visiteur_peut_lire_ou_ecrire', (has_table_privilege('anon', 'public.avis_envois', 'select') or has_table_privilege('anon', 'public.avis_modeles', 'select') or has_table_privilege('anon', 'public.avis_envois', 'insert')),
  'connecte_peut_ecrire_le_journal', (has_table_privilege('authenticated', 'public.avis_envois', 'insert') or has_table_privilege('authenticated', 'public.avis_envois', 'update') or has_table_privilege('authenticated', 'public.avis_envois', 'delete')),
  'visiteur_peut_appeler', (select coalesce(jsonb_agg(p.proname order by p.proname), '[]'::jsonb) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('avis_preparer', 'avis_marquer', 'avis_jeton', 'avis_desabonner_par_jeton') and has_function_privilege('anon', p.oid, 'execute')),
  'envoi_reserve_au_service', (has_function_privilege('service_role', 'public.avis_preparer(uuid, text, jsonb, timestamptz)', 'execute') and not has_function_privilege('authenticated', 'public.avis_preparer(uuid, text, jsonb, timestamptz)', 'execute') and not has_function_privilege('authenticated', 'public.avis_marquer(uuid, text, text, text)', 'execute') and not has_function_privilege('authenticated', 'public.avis_jeton(uuid, text)', 'execute')),
  'modeles', (select coalesce(jsonb_agg(version || ':' || canal || ':' || variante order by version, canal, variante), '[]'::jsonb) from public.avis_modeles),
  'journal', (select count(*) from public.avis_envois)
) as verification;
