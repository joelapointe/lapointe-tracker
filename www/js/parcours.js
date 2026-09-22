// js/parcours.js — Étape 18b : le TRACÉ QUI SUIT LES RUES, d'un client au suivant (décision de Joé, 21 septembre 2026)
//
// Le trajet d'un client A à un client B (un « tronçon ») est calculé par la fonction serveur « calculer-parcours » (service d'itinéraire Geoapify, données
// OpenStreetMap) et gardé dans la table parcours_segments (SQL 22) : les téléphones n'ont qu'à LIRE ces tronçons, et en gardent une copie pour le hors réseau.
// Ce que l'employé voit : PENDANT UNE PASSE (au volant ou passager), la ligne des clients qu'il RESTE à faire, dans l'ordre choisi (ordre.js), posée PAR-DESSUS la
// carte : les deux fonds (satellite et plan) restent tels quels. Le trajet « camion → prochain client » n'est pas tracé (Google Maps le guide).
// Un bouton rond (🛣) enlève et remet les lignes ; le choix est gardé sur le téléphone.
// L'ADMINISTRATEUR : quand l'ordre change, ou qu'un arrêt est ajouté ou déplacé, son application demande à la fonction de calculer ce qui MANQUE (chaque tronçon
// n'est calculé qu'une fois : 1 crédit chez Geoapify) ; le bouton « 🛣 Mettre à jour le tracé » de la liste le fait à la demande et dit ce qui s'est passé.
// Sans SQL 22, sans fonction, sans clé ou sans réseau : l'application marche comme avant, simplement sans lignes (jamais de plantage, jamais de message inutile).
const CLE_TRACE_VISIBLE='lp_trace_visible';
const COULEUR_TRACE='#22d3ee';           // cyan vif : se lit sur le satellite comme sur le plan
const COULEUR_CONTOUR_TRACE='#0b1220';   // contour sombre : la ligne ne se perd ni sur le plan clair, ni sur le satellite
const ATTRIBUTION_TRACE='Itinéraires © <a href="https://www.geoapify.com/" target="_blank" rel="noopener">Geoapify</a> · Données © contributeurs <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const PARCOURS_ATTENTE_ADMIN_MS=2500;      // l'administrateur touche souvent ▲ ▼ plusieurs fois de suite : on attend qu'il ait fini
const PARCOURS_ATTENTE_RELECTURE_MS=1500;  // des tronçons qui arrivent en rafale (temps réel) : UNE seule relecture
const PARCOURS_RELECTURE_MS=300000;        // les tronçons ne changent presque jamais : au plus une relecture toutes les 5 minutes (sauf temps réel ou mise à jour)
const PARCOURS_TOURS_MAX=6;                // au plus 6 appels de la fonction de suite (40 tronçons chacun) pour une mise à jour
const PARCOURS_DELAI_FONCTION_MS=120000;
const PARCOURS_EPSILON=1e-7;               // deux positions égales à 1e-7 degré près (≈ 1 cm) : le même endroit (comme la fonction serveur)

let segmentsParcours=[];       // les lignes de parcours_segments : {de_arret_id, vers_arret_id, de_lat, de_lon, vers_lat, vers_lon, statut, trace:[[lat,lon],…]}
let _indexSegments=new Map();  // « départ|arrivée » -> tronçon
let _segmentsLusLe=0;
let traceVisible=lireMemo(CLE_TRACE_VISIBLE)!=='0';   // affiché tant que l'employé ne l'a pas caché (choix gardé sur ce téléphone)
let _traceCouche=null;         // les deux lignes dessinées (contour + ligne)
let _traceSignature='';        // ce qui est dessiné : on ne redessine que si ça change
let _attributionPosee=false;
let _canalParcours=null;
let _tRechargeParcours=null;
let _tMajParcours=null;
let _majParcoursEnCours=false;
let _dernierEssaiAuto='';      // les tronçons manquants déjà demandés SANS progrès : pas de boucle qui martèlerait le service

// ── Les tronçons : lecture, copie, index ───────────────
function indexerSegments(){
  _indexSegments=new Map();
  segmentsParcours.forEach(s=>{if(s&&s.de_arret_id&&s.vers_arret_id) _indexSegments.set(s.de_arret_id+'|'+s.vers_arret_id,s);});
}
function installerSegments(lus){
  segmentsParcours=Array.isArray(lus)?lus:[];
  indexerSegments();
}
// Lit tous les tronçons (par tranches de 1000 : la limite du service de données). Sans réseau, ou sans la table (SQL 22 pas encore fait) : on GARDE ce qu'on savait,
// sans bruit. Renvoie true si la lecture a réussi.
async function chargerSegments(opt){
  const forcer=!!(opt&&opt.forcer);
  if(!forcer&&segmentsParcours.length&&Date.now()-_segmentsLusLe<PARCOURS_RELECTURE_MS) return true;
  try{
    const tout=[];
    for(let de=0;;de+=1000){
      const{data,error}=await db.from('parcours_segments').select('de_arret_id,vers_arret_id,de_lat,de_lon,vers_lat,vers_lon,statut,trace').order('de_arret_id').order('vers_arret_id').range(de,de+999);
      if(error) throw error;
      tout.push(...(data||[]));
      if(!data||data.length<1000) break;
    }
    installerSegments(tout);
    _segmentsLusLe=Date.now();
    lectureReussie('parcours',tout);
    demarrerCanalParcours();   // le temps réel seulement une fois la table lisible (avant le SQL 22, s'abonner à une table absente ferait des erreurs en boucle)
    return true;
  }catch(e){
    signalerEchecReseau(e);
    return false;
  }
}
// Démarrer sans signal : la dernière copie (elle ne compte pas dans « données de … » : elle change rarement)
async function restaurerParcours(){
  try{
    const c=await cacheLire('parcours');
    if(c&&Array.isArray(c.data)) installerSegments(c.data);
  }catch(e){}
}
function demarrerCanalParcours(){
  if(_canalParcours||!db||typeof db.channel!=='function') return;
  try{
    _canalParcours=db.channel('parcours-changes')
      .on('postgres_changes',{event:'*',schema:'public',table:'parcours_segments'},()=>planifierRechargementParcours())
      .subscribe();
  }catch(e){_canalParcours=null;}
}
// Des tronçons arrivent (souvent 40 d'un coup, après un calcul) : UNE seule relecture
function planifierRechargementParcours(){
  clearTimeout(_tRechargeParcours);
  _tRechargeParcours=setTimeout(async()=>{
    await chargerSegments({forcer:true});
    majParcours();
  },PARCOURS_ATTENTE_RELECTURE_MS);
}

// ── Quels tronçons montrer ─────────────────────────────
function memePosition(a,b){return Math.abs(Number(a)-Number(b))<PARCOURS_EPSILON;}
// Un tronçon gardé vaut encore s'il a été calculé pour les positions ACTUELLES des deux arrêts (sinon un arrêt a bougé : périmé)
function segmentValide(s,a,b){
  return !!s&&memePosition(s.de_lat,a.lat)&&memePosition(s.de_lon,a.lon)&&memePosition(s.vers_lat,b.lat)&&memePosition(s.vers_lon,b.lon);
}
// La suite des clients d'une route pour un type de service, dans l'ordre (la même règle que la fonction serveur : route, service, ordre)
function sequenceParcours(routeId,service){
  return enOrdre(stops.filter(s=>s.route_id===routeId&&s.actif!==false&&s.service===service&&s.lat&&s.lon));
}
// Les tronçons à dessiner : de MON prochain client jusqu'au dernier, dans l'ordre. Rien sans passe (au volant ou à bord).
function tronconsAffiches(){
  if(!currentUser) return [];
  const t=(typeof monTourEnCours==='function')?monTourEnCours():null;
  if(!t||!tourEnCours(t)) return [];
  const suite=sequenceParcours(t.route_id,t.tache);
  const k=suite.findIndex(s=>!estFait(s));   // le prochain client (le même que prochainArret() d'ordre.js)
  if(k<0) return [];
  const sortie=[];
  for(let i=k;i+1<suite.length;i++){
    const s=_indexSegments.get(suite[i].id+'|'+suite[i+1].id);
    if(s&&s.statut==='ok'&&Array.isArray(s.trace)&&s.trace.length>=2&&segmentValide(s,suite[i],suite[i+1])) sortie.push(s);
  }
  return sortie;
}

// ── Le dessin ──────────────────────────────────────────
function poserAttribution(){
  if(_attributionPosee) return;
  try{map.attributionControl.addAttribution(ATTRIBUTION_TRACE);_attributionPosee=true;}catch(e){}
}
function retirerAttribution(){
  if(!_attributionPosee) return;
  try{map.attributionControl.removeAttribution(ATTRIBUTION_TRACE);}catch(e){}
  _attributionPosee=false;
}
function effacerTrace(){
  if(_traceCouche){try{map.removeLayer(_traceCouche);}catch(e){}_traceCouche=null;}
  retirerAttribution();
}
function enPasse(){
  return !!(currentUser&&typeof monTourEnCours==='function'&&monTourEnCours());
}
// Appelé à chaque redessin de la carte (arrets.js : renderAll) : le bouton, puis la ligne si elle a changé
function majParcours(){
  const bouton=document.getElementById('btn-trace');
  if(bouton){
    bouton.classList.toggle('on',traceVisible);           // allumé = les lignes sont affichées
    bouton.classList.toggle('inactif',!enPasse());        // grisé = pas de passe : rien à montrer pour l'instant (le bouton marche quand même)
    bouton.setAttribute('aria-pressed',traceVisible?'true':'false');
  }
  if(typeof map==='undefined'||!map) return;
  const troncons=traceVisible?tronconsAffiches():[];
  const signature=troncons.map(s=>[s.de_arret_id,s.vers_arret_id,s.de_lat,s.de_lon,s.vers_lat,s.vers_lon,s.trace.length].join(',')).join(';');
  if(signature===_traceSignature) return;
  _traceSignature=signature;
  effacerTrace();
  if(!troncons.length) return;
  try{
    const lignes=troncons.map(s=>s.trace);   // une ligne par tronçon ([[lat, lon], …]) ; elles se touchent chez chaque client
    _traceCouche=L.layerGroup([
      L.polyline(lignes,{color:COULEUR_CONTOUR_TRACE,weight:8,opacity:.6,lineCap:'round',lineJoin:'round',interactive:false}),
      L.polyline(lignes,{color:COULEUR_TRACE,weight:4,opacity:.95,lineCap:'round',lineJoin:'round',interactive:false}),
    ]).addTo(map);
    poserAttribution();
  }catch(e){_traceCouche=null;}
}
// Le bouton rond 🛣 : enlever / remettre les lignes
function basculerTrace(){
  traceVisible=!traceVisible;
  ecrireMemo(CLE_TRACE_VISIBLE,traceVisible?'1':'0');
  majParcours();
  let suite='';
  if(traceVisible){
    if(!enPasse()) suite=' · il apparaît pendant une passe';
    else if(!tronconsAffiches().length) suite=' · rien à tracer pour l’instant';
  }
  toast(traceVisible?'🛣 Tracé affiché'+suite:'🛣 Tracé caché');
}

// ── L'administrateur : faire calculer ce qui manque ────
function estAdminApp(){return !!(currentUser&&currentUser.role==='admin');}
// Les tronçons voulus (un client vers le suivant, pour chaque route et chaque type de service) qui n'ont pas de tronçon à jour : la même règle que la fonction serveur
function manquantsDetail(){
  const groupes=new Map();
  stops.forEach(s=>{
    if(!s.route_id||!s.service||!s.lat||!s.lon||s.actif===false) return;
    const cle=s.route_id+'|'+s.service;
    if(!groupes.has(cle)) groupes.set(cle,[]);
    groupes.get(cle).push(s);
  });
  const manquants=[];
  groupes.forEach(g=>{
    const suite=enOrdre(g);
    for(let i=0;i+1<suite.length;i++){
      if(suite[i].id===suite[i+1].id) continue;
      const cle=suite[i].id+'|'+suite[i+1].id;
      if(!segmentValide(_indexSegments.get(cle),suite[i],suite[i+1])) manquants.push({cle,de:suite[i],vers:suite[i+1]});   // (« sans_route » à jour compte comme fait : on ne le redemande pas)
    }
  });
  return manquants;
}
function tronconsManquants(){return manquantsDetail().map(m=>m.cle);}
// La « situation » des tronçons manquants : les couples ET les positions des deux clients (un client déplacé, même dans un couple déjà refusé, change la situation)
function signatureManquants(){
  return manquantsDetail().map(m=>[m.cle,m.de.lat,m.de.lon,m.vers.lat,m.vers.lon].join(',')).sort().join(';');
}
// Lit l'erreur d'un appel de fonction : notre réponse JSON {erreur, message} est dans error.context (une vraie réponse du serveur)
async function lireErreurFonction(err){
  // « FunctionsFetchError » (supabase-js) : la demande n'a obtenu AUCUNE réponse (pas de signal) ; l'erreur d'origine est dans « context »
  if(err&&err.name==='FunctionsFetchError'){
    signalerEchecReseau(err.context||err);
    return {code:'reseau',message:''};
  }
  try{
    const c=err&&err.context;
    if(c&&typeof c.json==='function'){
      if(c.status===404) return {code:'fonction_absente',message:''};
      const j=await c.json();
      return {code:(j&&j.erreur)||'erreur',message:(j&&j.message)||''};
    }
  }catch(e){}
  return {code:estErreurReseau(err)?'reseau':'erreur',message:String((err&&err.message)||err||'')};
}
async function appelerCalculerParcours(corps){
  try{
    const r=await avecDelai(db.functions.invoke('calculer-parcours',{body:corps}),PARCOURS_DELAI_FONCTION_MS);
    if(r&&r.error) return {erreur:await lireErreurFonction(r.error)};
    const d=r&&r.data;
    if(!d||d.ok!==true) return {erreur:{code:(d&&d.erreur)||'reponse_illisible',message:(d&&d.message)||''}};
    return d;
  }catch(e){
    signalerEchecReseau(e);
    return {erreur:{code:estErreurReseau(e)?'reseau':'erreur',message:String((e&&e.message)||e||'')}};
  }
}
function messageErreurParcours(e){
  if(e.code==='reseau') return '📴 Pas de réseau : le tracé n’a pas pu être mis à jour.';
  if(e.code==='non_autorise') return '❌ Réservé à l’administrateur.';
  if(e.code==='fonction_absente') return '❌ La fonction « calculer-parcours » n’est pas encore installée sur Supabase.';
  if(e.code==='cle_absente'||e.code==='cle_refusee') return '❌ '+(e.message||'La clé Geoapify pose problème.');
  return '❌ Le tracé n’a pas pu être mis à jour.'+(e.message?' '+e.message:'');
}
// Demande à la fonction de calculer les tronçons qui manquent (jusqu'à 6 appels de 40). manuel : c'est l'administrateur qui l'a demandé (messages, et on redemande
// aussi les « sans route ») ; sinon, c'est automatique et SILENCIEUX (ordre changé, arrêt ajouté ou déplacé).
async function majParcoursServeur(opt){
  const manuel=!!(opt&&opt.manuel);
  if(!estAdminApp()||_majParcoursEnCours) return null;
  if(!reseau.enLigne){
    if(manuel) toast('📴 Pas de réseau : le tracé ne peut pas être mis à jour maintenant.');
    return null;
  }
  const manquants=tronconsManquants();
  const signature=signatureManquants();
  const aDesSansRoute=segmentsParcours.some(s=>s.statut==='sans_route');
  if(!manuel){
    if(!manquants.length||signature===_dernierEssaiAuto) return null;   // rien à faire, ou déjà essayé sans progrès (pas de boucle)
    _dernierEssaiAuto=signature;
  }else if(!manquants.length&&!aDesSansRoute){
    toast('✔ Le tracé est déjà à jour.');
    return {calcules:0};
  }
  _majParcoursEnCours=true;
  if(manuel) showSync(true);
  const bilan={calcules:0,sans_route:0,echecs:0,restants:0,limite:false};
  let erreur=null;
  try{
    for(let tour=0;tour<PARCOURS_TOURS_MAX;tour++){
      const r=await appelerCalculerParcours(manuel&&tour===0?{refaire_sans_route:true}:{});
      if(r.erreur){erreur=r.erreur;break;}
      bilan.calcules+=Number(r.calcules)||0;
      bilan.sans_route+=Number(r.sans_route)||0;
      bilan.echecs=Number(r.echecs)||0;
      bilan.restants=Number(r.restants)||0;
      bilan.limite=!!r.limite_atteinte;
      if(!(bilan.restants>0)||bilan.limite||((Number(r.calcules)||0)+(Number(r.sans_route)||0))===0) break;   // fini, limite du service, ou plus aucun progrès possible
    }
  }finally{
    _majParcoursEnCours=false;
    if(manuel) showSync(false);
  }
  await chargerSegments({forcer:true});   // les nouveaux tronçons (le temps réel les apporterait aussi, un peu plus tard)
  majParcours();
  if(typeof majBoutonTraceAdmin==='function') majBoutonTraceAdmin();
  if(manuel){
    if(erreur&&!bilan.calcules) toast(messageErreurParcours(erreur));
    else{
      let m=bilan.calcules?'✔ Tracé mis à jour : '+bilan.calcules+' tronçon'+(bilan.calcules>1?'s':'')+' calculé'+(bilan.calcules>1?'s':''):'✔ Le tracé est à jour';
      if(bilan.sans_route) m+=' · '+bilan.sans_route+' sans route trouvée';
      if(bilan.echecs) m+=' · '+bilan.echecs+' à refaire (service indisponible)';
      if(bilan.limite) m+=' · limite du service atteinte : réessaie plus tard';
      else if(bilan.restants>0&&!bilan.echecs) m+=' · il en reste '+bilan.restants;
      if(erreur) m+=' · '+messageErreurParcours(erreur).replace(/^❌ /,'');
      toast(m);
    }
  }
  return bilan;
}
function majParcoursManuel(){return majParcoursServeur({manuel:true});}
// L'ordre a changé, un arrêt a été ajouté ou déplacé : l'administrateur (SEULEMENT lui) fait calculer ce qui manque, un peu plus tard
function planifierMajParcours(){
  if(!estAdminApp()) return;
  clearTimeout(_tMajParcours);
  _tMajParcours=setTimeout(()=>{majParcoursServeur({manuel:false});},PARCOURS_ATTENTE_ADMIN_MS);
}
// Le bouton de la liste (administrateur seulement) : « 🛣 Mettre à jour le tracé · N à calculer »
function majBoutonTraceAdmin(){
  const z=document.getElementById('liste-trace-admin');
  if(!z) return;
  if(!estAdminApp()){z.innerHTML='';return;}
  const n=tronconsManquants().length;
  z.innerHTML='<button type="button" class="lf-btn parcours-maj" onclick="majParcoursManuel()">🛣 Mettre à jour le tracé'+(n?' · '+n+' à calculer':'')+'</button>';
}
