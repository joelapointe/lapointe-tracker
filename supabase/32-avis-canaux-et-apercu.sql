-- =====================================================================
-- DEMANDE 5 DE JOÉ — CHANTIER C (1ᵉʳ OCTOBRE 2026), SUITE DU FICHIER 31 : CHOISIR LES CANAUX (« COURRIEL SEULEMENT », « TEXTO SEULEMENT ») ET VOIR LES MESSAGES AVANT L'ENVOI (APERÇU)
-- =====================================================================
-- À EXÉCUTER APRÈS LE FICHIER 31. Ne modifie AUCUNE donnée existante, AUCUNE table, AUCUNE règle d'accès existante : il REMPLACE la fonction avis_preparer (du fichier 31) par une version
-- qui accepte en plus la liste des canaux demandés, et ajoute avis_apercu. Peut être exécuté plusieurs fois sans problème.
--
-- POURQUOI : les textos attendent l'approbation de Twilio ; on doit pouvoir envoyer par courriel SEULEMENT sans laisser des lignes « texto en attente » dans le journal (le journal ne se
-- corrige jamais). Et Joé veut lire le message exact, et savoir qui le recevra ou pourquoi quelqu'un ne le recevra pas, AVANT de confirmer.
--
-- CE QUE FAIT CE FICHIER :
--   • avis_preparer(p_par, p_delai, p_lignes, p_maintenant, p_canaux) : comme avant (mêmes règles, mêmes messages, même journal), mais seuls les canaux demandés sont traités : un canal NON demandé
--     n'écrit RIEN au journal. p_canaux : ['courriel'], ['texto'] ou les deux (par défaut). Une liste vide, inconnue ou absente : refusée (« canaux_invalides »).
--   • avis_apercu(…) : EXACTEMENT les mêmes décisions et les mêmes messages, mais SANS RIEN écrire : pour chaque client et chaque canal, « a_envoyer » (avec le message) ou « refuse » (avec le motif).
--     Un aperçu ne réserve rien : un avis envoyé entre-temps par une autre demande sera refusé au vrai envoi (un seul avis par client, par canal et par jour).
--   Les deux ne s'appellent que par la fonction d'envoi (rôle service_role).
-- =====================================================================

do $$
begin
  if to_regprocedure('public.avis_preparer(uuid, text, jsonb, timestamptz)') is null and to_regprocedure('public.avis_preparer(uuid, text, jsonb, timestamptz, text[])') is null then
    raise exception 'le fichier 31 (avis aux clients) n''a pas été exécuté. Rien n''a été modifié.';
  end if;
  if to_regclass('public.avis_envois') is null or to_regclass('public.avis_modeles') is null then
    raise exception 'le fichier 31 est incomplet. Rien n''a été modifié.';
  end if;
end $$;

begin;

drop function if exists public.avis_preparer(uuid, text, jsonb, timestamptz);

-- Le cœur : décide pour chaque client et chaque canal ; écrit le journal SEULEMENT si p_ecrire est vrai (sinon, c'est un aperçu)
create or replace function public._avis_decider(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz, p_canaux text[], p_ecrire boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_heures   integer;
  v_variante text;
  v_court    text;
  v_long     text;
  v_lot      uuid := case when p_ecrire then gen_random_uuid() else null end;
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
  if p_canaux is null or cardinality(p_canaux) = 0 or exists (select 1 from unnest(p_canaux) c where c is null or c not in ('courriel', 'texto')) then
    raise exception 'canaux_invalides';
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
      if not (v_canal = any (p_canaux)) then
        continue;
      end if;
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
      v_id := null;
      if p_ecrire then
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
      else
        v_statut := case when v_motif is null then 'a_envoyer' else 'refuse' end;
      end if;
      v_res := v_res || jsonb_build_object('id', v_id, 'client_id', v_c.id, 'canal', v_canal, 'statut', v_statut, 'motif', v_motif,
                                           'destinataire', v_dest, 'objet', v_objet, 'message', v_message);
    end loop;
  end loop;

  return jsonb_build_object('lot_id', v_lot, 'jour', v_jour, 'heure_permise_texto', v_heure_ok, 'apercu', not p_ecrire, 'lignes', v_res);
end;
$$;

-- Prépare un lot d'avis ET l'écrit au journal (pour la fonction d'envoi seulement)
create or replace function public.avis_preparer(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz default now(), p_canaux text[] default array['courriel', 'texto'])
returns jsonb
language sql security definer set search_path = ''
as $$
  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, true)
$$;

-- Les mêmes décisions et les mêmes messages, SANS RIEN ÉCRIRE (pour montrer à Joé ce qui partira avant qu'il confirme)
create or replace function public.avis_apercu(p_par uuid, p_delai text, p_lignes jsonb, p_maintenant timestamptz default now(), p_canaux text[] default array['courriel', 'texto'])
returns jsonb
language sql security definer set search_path = ''
as $$
  select public._avis_decider(p_par, p_delai, p_lignes, p_maintenant, p_canaux, false)
$$;

revoke all on function public._avis_decider(uuid, text, jsonb, timestamptz, text[], boolean) from public, anon, authenticated;
revoke all on function public.avis_preparer(uuid, text, jsonb, timestamptz, text[])           from public, anon, authenticated;
grant execute on function public.avis_preparer(uuid, text, jsonb, timestamptz, text[])        to service_role;
revoke all on function public.avis_apercu(uuid, text, jsonb, timestamptz, text[])             from public, anon, authenticated;
grant execute on function public.avis_apercu(uuid, text, jsonb, timestamptz, text[])          to service_role;

commit;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à contrôler.
-- =====================================================================
select jsonb_build_object(
  'preparer', (select coalesce(jsonb_agg(pg_get_function_identity_arguments(p.oid) order by p.oid), '[]'::jsonb) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'avis_preparer'),
  'apercu', (select coalesce(jsonb_agg(pg_get_function_identity_arguments(p.oid) order by p.oid), '[]'::jsonb) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'avis_apercu'),
  'reserve_au_service', (has_function_privilege('service_role', 'public.avis_preparer(uuid, text, jsonb, timestamptz, text[])', 'execute') and has_function_privilege('service_role', 'public.avis_apercu(uuid, text, jsonb, timestamptz, text[])', 'execute')
    and not has_function_privilege('anon', 'public.avis_preparer(uuid, text, jsonb, timestamptz, text[])', 'execute') and not has_function_privilege('authenticated', 'public.avis_preparer(uuid, text, jsonb, timestamptz, text[])', 'execute')
    and not has_function_privilege('anon', 'public.avis_apercu(uuid, text, jsonb, timestamptz, text[])', 'execute') and not has_function_privilege('authenticated', 'public.avis_apercu(uuid, text, jsonb, timestamptz, text[])', 'execute')
    and not has_function_privilege('anon', 'public._avis_decider(uuid, text, jsonb, timestamptz, text[], boolean)', 'execute') and not has_function_privilege('authenticated', 'public._avis_decider(uuid, text, jsonb, timestamptz, text[], boolean)', 'execute')),
  'journal', (select count(*) from public.avis_envois),
  'modeles', (select count(*) from public.avis_modeles)
) as verification;
