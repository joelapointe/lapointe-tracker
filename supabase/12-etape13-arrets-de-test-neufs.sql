-- =====================================================================
-- ÉTAPE 13 — ARRÊTS DE TEST NEUFS ET PROPRES (décision de Joé, 19 septembre 2026)
-- =====================================================================
-- CE QUE ÇA FAIT
--   1. Retire les 13 anciens arrêts de test (dont 7 sans route). Vérifié sur la vraie base le 19 septembre 2026 :
--      aucun n'a de passe ni de problème. Par sécurité, un arrêt qui aurait un historique serait ARCHIVÉ (actif = false),
--      jamais supprimé.
--   2. Crée 12 arrêts neufs : 6 sur la route « Charette », 6 sur la route « Saint-étienne-des-grès ».
--      Le nom du client est « TEST 1 » à « TEST 12 » (pour les retrouver et les effacer plus tard).
--
-- PROTECTIONS (il REFUSE et ne change RIEN si) :
--   • il existe déjà un arrêt « TEST … » (le fichier a déjà été exécuté) ;
--   • la base ne contient pas exactement 13 arrêts (situation différente de celle vérifiée) ;
--   • la route « Charette » ou « Saint-étienne-des-grès » n'existe pas, ou existe en double.
--   Tout se fait en un seul bloc : si quelque chose échoue, rien n'est modifié.
--
-- OÙ L'EXÉCUTER : Supabase > SQL Editor > New query > coller > Run. Le résultat « verification » du bas est à me coller.
-- Les coordonnées viennent de la carte OpenStreetMap ou de Joé (Google Maps) ; voir le cahier, étape 13.
-- =====================================================================

do $$
declare
  v_ch uuid;
  v_se uuid;
  n    integer;
begin
  -- Les deux routes doivent exister, une seule fois chacune.
  select count(*) into n from public.routes where nom = 'Charette';
  if n <> 1 then raise exception 'route « Charette » : % trouvée(s), 1 attendue. Rien n''a été modifié.', n; end if;
  select count(*) into n from public.routes where nom = 'Saint-étienne-des-grès';
  if n <> 1 then raise exception 'route « Saint-étienne-des-grès » : % trouvée(s), 1 attendue. Rien n''a été modifié.', n; end if;
  select id into v_ch from public.routes where nom = 'Charette';
  select id into v_se from public.routes where nom = 'Saint-étienne-des-grès';

  -- Déjà exécuté ?
  select count(*) into n from public.stops where client like 'TEST %';
  if n > 0 then raise exception 'il existe déjà % arrêt(s) « TEST … » : ce fichier a déjà été exécuté. Rien n''a été modifié.', n; end if;

  -- La base doit être dans l'état vérifié : 13 arrêts.
  select count(*) into n from public.stops;
  if n <> 13 then raise exception 'la base contient % arrêts, 13 attendus (état vérifié le 19 septembre 2026). Rien n''a été modifié.', n; end if;

  -- 1) Anciens arrêts : suppression si aucun historique, sinon archivage.
  update public.stops s set actif = false
   where exists (select 1 from public.passe_arrets pa where pa.stop_id = s.id)
      or exists (select 1 from public.problemes    pb where pb.stop_id = s.id);
  delete from public.stops s
   where not exists (select 1 from public.passe_arrets pa where pa.stop_id = s.id)
     and not exists (select 1 from public.problemes    pb where pb.stop_id = s.id);

  -- 2) Arrêts neufs. « ordre » suit la numérotation de l'application (0, 1, 2, …).
  insert into public.stops (adresse, client, service, lat, lon, ordre, route_id) values
    ('304 rue de l''Église, Charette, QC',                     'TEST 1',  'Déneigement mécanique', 46.4427849, -72.9216181,  0, v_ch),
    ('310 rue de l''Église, Charette, QC',                     'TEST 2',  'Déneigement manuel',    46.4428741, -72.9214885,  1, v_ch),
    ('220 rue du Moulin, Charette, QC',                        'TEST 3',  'Déneigement mécanique', 46.4437603, -72.9221525,  2, v_ch),
    ('215 rue Bellerive, Charette, QC',                        'TEST 4',  'Épandage de sel',       46.4447685, -72.9190751,  3, v_ch),
    ('50 rue Notre-Dame, Charette, QC',                        'TEST 5',  'Déneigement mécanique', 46.4391971, -72.9262635,  4, v_ch),
    ('301 Petit Bellechasse S, Charette, QC',                  'TEST 6',  'Déneigement manuel',    46.431078,  -72.954398,   5, v_ch),
    ('110 rue des Gouverneurs, Saint-Étienne-des-Grès, QC',    'TEST 7',  'Déneigement mécanique', 46.4451137, -72.7807375,  6, v_se),
    ('10 rue de la Terrasse, Saint-Étienne-des-Grès, QC',      'TEST 8',  'Déneigement manuel',    46.442077,  -72.765319,   7, v_se),
    ('120 rue Jonette, Saint-Étienne-des-Grès, QC',            'TEST 9',  'Épandage de sel',       46.4437799, -72.760508,   8, v_se),
    ('190 rue Jonette, Saint-Étienne-des-Grès, QC',            'TEST 10', 'Déneigement mécanique', 46.4463175, -72.7567292,  9, v_se),
    ('147 route des Pins, Saint-Étienne-des-Grès, QC',         'TEST 11', 'Déneigement mécanique', 46.431652,  -72.767572,  10, v_se),
    ('875 chemin du Lac-Bourassa, Saint-Étienne-des-Grès, QC', 'TEST 12', 'Épandage de sel',       46.42094,   -72.807354,  11, v_se);
end $$;

-- =====================================================================
-- VÉRIFICATION : le résultat de cette dernière requête, à me coller.
-- =====================================================================
select jsonb_build_object(
  'arrets_total',          (select count(*) from public.stops),
  'arrets_actifs',         (select count(*) from public.stops where actif),
  'arrets_test',           (select count(*) from public.stops where client like 'TEST %'),
  'arrets_sans_route',     (select count(*) from public.stops where route_id is null),
  'par_route',             (select jsonb_object_agg(r.nom, n) from (select r2.nom, count(s.id) n from public.routes r2
                                                                       left join public.stops s on s.route_id = r2.id and s.actif
                                                                      group by r2.nom) r),
  'passes', (select count(*) from public.passes),
  'problemes', (select count(*) from public.problemes)
) as verification;
