// js/presence.js — Demande 6 de Joé (29 sept. 2026) : LE CAMION DANS LA ZONE D'UN CLIENT — la zone bleue, le chronomètre, le « Complété » automatique et le TEMPS PASSÉ chez chaque client
//
// Ce que Joé a demandé : « pendant que le véhicule est dans une zone, la zone devient bleue et le chrono commence à calculer ; après 1 minute dans une zone, la zone pourrait devenir « complété »
// directement » (pour calculer lui-même la rentabilité : le temps passé et le nombre de visites de chaque client ; aucun prix dans l'application). L'application ne garde AUCUNE trace GPS (seulement la dernière
// position de chaque camion) : c'est donc le téléphone du CHAUFFEUR — celui qui envoie déjà la position toutes les 3 secondes, même écran éteint — qui repère lui-même l'entrée dans la zone d'un client de SA
// passe et la sortie. Il ne garde que DEUX heures par visite : l'arrivée et le départ (fonction arret_presence, SQL 29 ; le Suivi les additionne).
//
// • La ZONE : le polygone dessiné du client (zone-terrain.js), élargi d'une petite MARGE selon la précision du GPS (4 à 12 m : un camion garé devant le terrain compte) ; sans zone dessinée, le cercle de
//   RAYON_EN_COURS_M (20 m) autour de son point, sans marge, comme avant. La zone est bleue (tours.js : estEnCours) tant que le camion y est ; « ⏱ 3 min 12 s » s'affiche dans la fiche du client (chez le chauffeur).
// • UN SEUL client « présent » à la fois : celui dont la zone contient le téléphone, le plus à l'intérieur ; on ne change pas tant qu'on est encore dans la zone actuelle (deux terrains voisins). On sort après
//   PRESENCE_SORTIE_S secondes dehors (les sautes du GPS ne coupent pas la visite). Un client déjà fait n'ouvre plus de visite ; celle qui est commencée continue jusqu'à la sortie.
// • Le « COMPLÉTÉ AUTOMATIQUE » : après presence_complete_auto_s secondes (réglage, 60 au départ, 0 = jamais) PASSÉES DANS la zone, si le client est de MA passe (même route, même service), n'est pas déjà fait,
//   A UNE ZONE DESSINÉE, que le GPS est assez précis (≤ 20 m) et que je suis le chauffeur : « Complété » en mode « auto » par la file des gestes (marche sans réseau ; « Annuler » reste possible 10 minutes,
//   et un arrêt annulé, ou complété tout seul, n'est JAMAIS refait tout seul dans la même passe).
// • À la SORTIE (ou à la fin de la passe, ou au redémarrage de l'application : l'état est gardé sur le téléphone) : un geste « arret_presence » (arrivée + départ) part par la file des gestes. Une mesure : si le
//   serveur la refuse pour de bon, personne n'en est dérangé (file-attente.js).
// Fonctions pures (testées seules) : la géométrie. Le reste est alimenté par chaque lecture du GPS (position.js : noterPosition, avant-plan ET service d'arrière-plan).
const PRESENCE_SORTIE_S=45;              // dehors depuis plus longtemps que ça : la visite est finie (les sautes du GPS ne comptent pas)
const PRESENCE_MIN_S=20;                 // une présence plus courte n'est pas notée (un camion qui passe), sauf si l'arrêt a été complété automatiquement
const PRESENCE_PRECISION_AUTO_M=20;      // le « Complété » automatique exige un GPS plus précis que ça
const PRESENCE_MARGE_MIN_M=4;            // la marge autour d'une zone dessinée : la précision du GPS, entre 4 et 12 m
const PRESENCE_MARGE_MAX_M=12;
const PRESENCE_PAS_MAX_S=15;             // un trou de plus de 15 s entre deux lectures ne compte que pour 15 s dans le « temps dedans »
const PRESENCE_DELAI_AUTO_DEFAUT_S=60;   // le réglage presence_complete_auto_s tant qu'il n'est pas lu (Joé : « après 1 minute »)
const PRESENCE_DELAI_AUTO_MAX_S=3600;    // au plus une heure
const PRESENCE_MEMO='lp_presence:';      // + le numéro de l'employé : la visite en cours, gardée sur le téléphone (une fermeture de l'application ne la perd pas)
const PRESENCE_CLE_REGLAGE='presence_complete_auto_s';

let presenceDelaiAutoS=PRESENCE_DELAI_AUTO_DEFAUT_S;   // le délai du complété automatique, en secondes (0 = jamais)
let _presence=null;                  // la visite en cours : {stopId, passeId, arrivee, derniereVue, derniereLecture (ms), dedansMs, autoTente}
let _presenceExclus=new Set();       // les arrêts qui ne seront plus complétés tout seuls dans une passe (annulés, ou déjà complétés tout seuls) : « passe|arrêt »
let _presencePasseId=null;           // la passe de la dernière lecture (une autre passe : la visite d'avant est finie)
let _presenceSauveLe=0;
let _presenceMinuterie=null;

// ── La géométrie (fonctions pures) ─────────────────────
// Un point (lat, lon) en mètres autour d'un point de référence (une projection plate : très juste à cette échelle)
function presenceProjeter(lat,lon,refLat,refLon){
  const k=Math.PI/180;
  return {x:(lon-refLon)*k*6371000*Math.cos(refLat*k),y:(lat-refLat)*k*6371000};
}
// Les coins de la zone dessinée d'un arrêt, en nombres [[lat, lon], …] ; null s'il n'y a pas de zone valable (moins de 3 coins, ou un coin illisible)
function presenceZoneDe(s){
  const z=s&&s.zone_points;
  if(!Array.isArray(z)||z.length<3) return null;
  // (des nombres, comme zone-terrain.js : un coin « null » ou en texte ne devient jamais 0)
  return z.every(p=>Array.isArray(p)&&typeof p[0]==='number'&&typeof p[1]==='number'&&isFinite(p[0])&&isFinite(p[1]))?z.map(p=>[p[0],p[1]]):null;
}
function presenceZoneDessinee(s){return !!presenceZoneDe(s);}
// La distance de l'origine au segment [a, b] (en mètres)
function presenceDistanceSegment(a,b){
  const dx=b.x-a.x,dy=b.y-a.y;
  const l2=dx*dx+dy*dy;
  let t=l2>0?-(a.x*dx+a.y*dy)/l2:0;
  t=Math.max(0,Math.min(1,t));
  return Math.hypot(a.x+t*dx,a.y+t*dy);
}
// 0 si le point est DANS le polygone ; sinon la distance (en mètres) au bord le plus proche
function presenceDistanceZoneM(lat,lon,pts){
  const P=pts.map(p=>presenceProjeter(p[0],p[1],lat,lon));   // le point est à l'origine
  let dedans=false;
  for(let i=0,j=P.length-1;i<P.length;j=i++){
    const a=P[i],b=P[j];
    if((a.y>0)!==(b.y>0)&&(b.x-a.x)*(0-a.y)/(b.y-a.y)+a.x>0) dedans=!dedans;   // un rayon vers la droite : un nombre impair de bords croisés = dedans
  }
  if(dedans) return 0;
  let min=Infinity;
  for(let i=0,j=P.length-1;i<P.length;j=i++) min=Math.min(min,presenceDistanceSegment(P[j],P[i]));
  return min;
}
// À quelle distance ce point est-il de la zone d'un arrêt ? (0 = dedans ; pour classer deux zones) : son polygone dessiné, sinon le cercle de RAYON_EN_COURS_M autour de son point
function presenceDistanceArret(s,lat,lon){
  const pts=presenceZoneDe(s);
  if(pts) return presenceDistanceZoneM(lat,lon,pts);
  return Math.max(0,distanceMetres(lat,lon,s.lat,s.lon)-RAYON_EN_COURS_M);
}
// La marge accordée à un GPS autour d'une zone dessinée : sa précision, entre 4 et 12 m (précision inconnue : 10 m)
function presenceMarge(precision){
  const p=(typeof precision==='number'&&precision>=0)?precision:10;
  return Math.max(PRESENCE_MARGE_MIN_M,Math.min(p,PRESENCE_MARGE_MAX_M));
}
// Ce point (avec la précision de son GPS) est-il dans la zone de cet arrêt ? Zone dessinée : son polygone, à la marge de précision près. Sans zone dessinée : le cercle de RAYON_EN_COURS_M
// autour de son point, SANS marge (la règle d'avant, qui n'a pas changé). C'est LA règle de la zone bleue (tours.js : estEnCours) ET des visites de ce fichier.
function presenceDansArret(s,lat,lon,precision){
  if(!s||!s.lat||!s.lon) return false;
  const pts=presenceZoneDe(s);
  if(pts) return presenceDistanceZoneM(lat,lon,pts)<=presenceMarge(precision);
  return distanceMetres(lat,lon,s.lat,s.lon)<=RAYON_EN_COURS_M;
}

// ── Le réglage du complété automatique ─────────────────
// Un nombre de secondes de 0 (jamais) à 3600 ; illisible (vide, texte, négatif) : la valeur de départ
function presenceDelaiDe(valeur){
  const n=typeof valeur==='number'?valeur:(typeof valeur==='string'&&valeur.trim()!==''?Number(valeur):NaN);
  return (isFinite(n)&&n>=0)?Math.min(n,PRESENCE_DELAI_AUTO_MAX_S):PRESENCE_DELAI_AUTO_DEFAUT_S;
}
function installerReglagesPresence(lignes){
  const l=(Array.isArray(lignes)?lignes:[]).find(x=>x&&x.cle===PRESENCE_CLE_REGLAGE);
  presenceDelaiAutoS=l?presenceDelaiDe(l.valeur):PRESENCE_DELAI_AUTO_DEFAUT_S;
}
// Lu à chaque chargement complet ; sans réseau, la DERNIÈRE valeur connue (copie « reglagesPresence »), sinon 60 secondes
async function chargerReglagesPresence(){
  if(!currentUser) return false;
  try{
    const{data,error}=await db.from('reglages').select('cle, valeur').in('cle',[PRESENCE_CLE_REGLAGE]);
    if(error) throw error;
    const lignes=Array.isArray(data)?data:[];
    installerReglagesPresence(lignes);
    lectureReussie('reglagesPresence',lignes);
    return true;
  }catch(e){
    signalerEchecReseau(e);
    await restaurerReglagesPresence();
    return false;
  }
}
async function restaurerReglagesPresence(){
  const c=await cacheLire('reglagesPresence');
  if(c&&Array.isArray(c.data)) installerReglagesPresence(c.data);
}

// ── Ce que voit l'écran ────────────────────────────────
// « 3 min 12 s », « 45 s », « 1 h 05 min »
function presenceFormaterDuree(ms){
  const s=Math.max(0,Math.floor(ms/1000));
  if(s<60) return s+' s';
  const m=Math.floor(s/60);
  if(m<60) return m+' min '+String(s%60).padStart(2,'0')+' s';
  return Math.floor(m/60)+' h '+String(m%60).padStart(2,'0')+' min';
}
// Mon camion est dans la zone de ce client en ce moment ?
function presenceEstIci(s){return !!(_presence&&s&&_presence.stopId===s.id);}
// Ajouté à la phrase de la fiche du client (tours.js : texteTour) : chez le chauffeur seulement
function presenceTexteFiche(s){
  return presenceEstIci(s)?' · ⏱ '+presenceFormaterDuree(Date.now()-_presence.arrivee):'';
}
// La fiche ouverte sur ce client montre le chrono qui avance (seulement sa phrase : rien d'autre n'est redessiné)
function presenceMajFiche(){
  try{
    if(!_presence||typeof activeIdx==='undefined'||activeIdx===null) return;
    const s=stops[activeIdx];
    if(!s||s.id!==_presence.stopId) return;
    const el=document.getElementById('sc-tour');
    if(el) el.textContent=texteTour(s);
  }catch(e){}
}
// La zone bleue et la fiche suivent tout de suite un changement (entrée, sortie)
function presenceChangement(){
  try{
    if(signatureEnCours()!==_sigEnCours) renderAll();   // (les zones : seulement si un client entre ou sort de l'état « en cours »)
    majCarte();   // la fiche ouverte gagne ou perd « camion sur place » et le chrono
  }catch(e){}
}

// ── La mémoire du téléphone (une fermeture de l'application ne perd pas la visite en cours) ──
function presenceCleMemo(){return PRESENCE_MEMO+(currentUser?currentUser.id:'?');}
function presenceLireMemo(){try{return localStorage.getItem(presenceCleMemo());}catch(e){return null;}}
function presenceEcrireMemo(v){try{localStorage.setItem(presenceCleMemo(),v);}catch(e){}}
function presenceEffacerMemo(){try{localStorage.removeItem(presenceCleMemo());}catch(e){}}
function presenceSauver(forcer){
  if(!_presence||!currentUser) return;
  const maintenant=Date.now();
  if(!forcer&&maintenant-_presenceSauveLe<10000) return;   // (au plus une écriture toutes les 10 s)
  _presenceSauveLe=maintenant;
  presenceEcrireMemo(JSON.stringify(_presence));
}

// ── La visite : ouvrir, fermer, noter ──────────────────
function presenceOuvrir(s,passeId,t){
  _presence={stopId:s.id,passeId,arrivee:t,derniereVue:t,derniereLecture:t,dedansMs:0,autoTente:false};
  presenceSauver(true);
  presenceDemarrerMinuterie();
  presenceChangement();
}
// La visite est finie : le départ est la dernière lecture faite DANS la zone. Notée (arrivée + départ) si elle a duré au moins PRESENCE_MIN_S (ou si l'arrêt a été complété tout seul).
// (sansChangement : une autre visite s'ouvre tout de suite après, c'est elle qui redessine)
function presenceFermer(sansChangement){
  const cur=_presence;
  if(!cur) return;
  _presence=null;
  presenceEffacerMemo();
  presenceArreterMinuterie();
  presenceNoter(cur,cur.derniereVue);
  if(!sansChangement) presenceChangement();
}
function presenceNoter(cur,depart){
  try{
    if(depart-cur.arrivee<PRESENCE_MIN_S*1000&&!cur.autoTente) return;
    const s=stops.find(x=>x.id===cur.stopId);
    Promise.resolve(enfiler('arret_presence',{passeId:cur.passeId,stopId:cur.stopId,arrivee:new Date(cur.arrivee).toISOString(),depart:new Date(depart).toISOString()},
      {libelle:'⏱ Temps passé'+(s?' : '+s.adresse:''),moment:new Date(depart).toISOString()})).catch(()=>{});
  }catch(e){}
}
// Une personne a annulé cet arrêt : il ne sera plus jamais complété tout seul dans cette passe (la passe de l'annulation, sinon la mienne ; même si aucune lecture du GPS n'est encore venue : l'exclusion est liée à la passe)
function presenceCleExclus(passeId,stopId){return passeId+'|'+stopId;}
function presenceExclure(stopId,passeId){
  const m=presenceMaPasse();
  const p=passeId||(m?m.passe.passe_id:null);
  if(p) _presenceExclus.add(presenceCleExclus(p,stopId));
}
// À la déconnexion (tracking.js : arreterTracking) : la visite en cours est notée, puis tout est remis à zéro
function presenceArreter(){
  presenceFermer(true);
  _presenceExclus=new Set();
  _presencePasseId=null;
}

// ── La minuterie : la sortie sans nouvelle lecture (le GPS s'est tu, la passe est finie) ──
function presenceDemarrerMinuterie(){
  if(!_presenceMinuterie) _presenceMinuterie=setInterval(presenceTic,1000);
}
function presenceArreterMinuterie(){
  if(_presenceMinuterie){clearInterval(_presenceMinuterie);_presenceMinuterie=null;}
}
// Ma passe : {tour, passe} tant que je conduis une passe EN COURS (c'est la seule qui compte), sinon null
function presenceMaPasse(){
  const m=(typeof maPasse==='function')?maPasse():null;
  return (m&&m.passe&&m.tour&&tourEnCours(m.tour))?m:null;
}
function presenceTic(){
  try{
    const cur=_presence;
    if(!cur) return;
    const m=presenceMaPasse();
    const encore=!!m&&m.passe.passe_id===cur.passeId;
    if(!encore||Date.now()-cur.derniereVue>=PRESENCE_SORTIE_S*1000){presenceFermer();return;}
    presenceMajFiche();
  }catch(e){}
}

// Au démarrage de l'application : une visite qui était en cours. Toujours ma passe et vue il y a moins de PRESENCE_SORTIE_S secondes : elle continue ; sinon elle est notée telle qu'on la savait.
function presenceRestaurer(){
  try{
    if(!currentUser||_presence) return;
    const brut=presenceLireMemo();
    if(!brut) return;
    presenceEffacerMemo();
    let o=null;
    try{o=JSON.parse(brut);}catch(e){return;}
    if(!o||!o.stopId||!o.passeId||!isFinite(o.arrivee)||!isFinite(o.derniereVue)||o.derniereVue<o.arrivee) return;
    const m=presenceMaPasse();
    const encore=!!m&&m.passe.passe_id===o.passeId;
    if(encore&&Date.now()-o.derniereVue<PRESENCE_SORTIE_S*1000){
      _presence={stopId:o.stopId,passeId:o.passeId,arrivee:o.arrivee,derniereVue:o.derniereVue,derniereLecture:isFinite(o.derniereLecture)?o.derniereLecture:o.derniereVue,dedansMs:isFinite(o.dedansMs)?o.dedansMs:0,autoTente:!!o.autoTente};
      _presencePasseId=o.passeId;
      if(o.autoTente) _presenceExclus.add(presenceCleExclus(o.passeId,o.stopId));
      presenceDemarrerMinuterie();
      return;
    }
    presenceNoter({stopId:o.stopId,passeId:o.passeId,arrivee:o.arrivee,autoTente:!!o.autoTente},o.derniereVue);
  }catch(e){}
}

// ── Chaque lecture du GPS (position.js : noterPosition) ─
// Ne lève jamais d'erreur : une panne ici ne doit jamais gêner le GPS.
function presenceLecture(lat,lon,precision,t){
  try{presenceTraiter(lat,lon,precision,t);}catch(e){}
}
function presenceTraiter(lat,lon,precision,t){
  const m=presenceMaPasse();
  if(!m){presenceFermer();return;}   // pas de passe à moi en cours : rien à repérer
  const passeId=m.passe.passe_id;
  if(_presencePasseId!==passeId){   // une autre passe que la dernière : la visite d'avant est finie
    presenceFermer(true);
    _presencePasseId=passeId;
  }
  if(typeof precision==='number'&&precision>PRECISION_MAX_M) return;   // un GPS trop imprécis ne dit ni « il est chez ce client » ni « il en est parti » (la minuterie ferme si le silence dure)
  const cur=_presence;
  if(cur&&t<cur.derniereVue) return;   // une lecture plus vieille que la dernière vue dans la zone : ignorée
  const dedans=!!cur&&presenceDansArret(stops.find(x=>x.id===cur.stopId),lat,lon,precision);
  if(dedans){
    // le temps DEDANS (pas le temps écoulé) : un trou de plus de 15 s ne compte que pour 15 s
    cur.dedansMs+=Math.min(Math.max(0,t-cur.derniereLecture),PRESENCE_PAS_MAX_S*1000);
    cur.derniereLecture=Math.max(cur.derniereLecture,t);
    cur.derniereVue=t;
    presenceSauver(false);
    presenceMajFiche();
    presenceVerifierAuto(cur,lat,lon,precision,t);   // (seulement une lecture DANS la zone : un camion qui en sort ne complète jamais l'arrêt en partant)
  }else{
    // pas (ou plus) dans la zone de la visite en cours : un autre client de MA passe ? (le plus à l'intérieur ; à égalité, le plus près de son point)
    let meilleur=null;
    stops.forEach(s=>{
      if(s.route_id!==m.tour.route_id||s.service!==m.tour.tache||s.actif===false) return;
      if(estFait(s)) return;   // (un client déjà fait n'ouvre plus de visite : seule la visite déjà commencée continue)
      if(!presenceDansArret(s,lat,lon,precision)) return;
      const d=presenceDistanceArret(s,lat,lon);
      const proche=distanceMetres(lat,lon,s.lat,s.lon);
      if(!meilleur||d<meilleur.d||(d===meilleur.d&&proche<meilleur.proche)) meilleur={s,d,proche};
    });
    if(meilleur){
      if(cur) presenceFermer(true);   // on est allé ailleurs : la visite d'avant finit à sa dernière lecture dedans
      presenceOuvrir(meilleur.s,passeId,t);
    }else if(cur){
      cur.derniereLecture=Math.max(cur.derniereLecture,t);   // (le temps dehors ne compte pas dans le temps dedans)
      if(t-cur.derniereVue>=PRESENCE_SORTIE_S*1000) presenceFermer();
    }
  }
}

// ── Le « Complété » automatique ────────────────────────
function presenceVerifierAuto(cur,lat,lon,precision,t){
  if(cur.autoTente) return;
  const delai=presenceDelaiAutoS;
  if(!(delai>0)||cur.dedansMs<delai*1000) return;
  if(typeof precision==='number'&&precision>PRESENCE_PRECISION_AUTO_M) return;   // (pas marqué « tenté » : la lecture suivante, plus précise, peut le faire)
  const s=stops.find(x=>x.id===cur.stopId);
  if(!s||_presenceExclus.has(presenceCleExclus(cur.passeId,s.id))||estFait(s)) return;
  if(!presenceZoneDessinee(s)) return;   // seulement les clients qui ont une zone dessinée : sans elle, le GPS n'est pas assez sûr pour dire « c'est fait »
  cur.autoTente=true;
  presenceSauver(true);
  presenceCompleterAuto(s,cur,lat,lon,t);
}
async function presenceCompleterAuto(s,cur,lat,lon,t){
  try{
    const r=await enfiler('completer_arret',{passeId:cur.passeId,stopId:s.id,mode:'auto',lat,lon},{libelle:'✔ Complété automatiquement : '+s.adresse,moment:new Date(t).toISOString()});
    if(!r||!r.ok){cur.autoTente=false;return;}   // le téléphone n'a pas pu garder le geste : on réessaiera à la lecture suivante (jamais « fait » sans trace)
    _presenceExclus.add(presenceCleExclus(cur.passeId,s.id));   // complété tout seul : jamais refait tout seul dans cette passe (même si quelqu'un l'annule ailleurs)
    renderAll();
    majCarte();
    const fermee=!tourEnCours(tourDe(s));
    toast((fermee?'🎉 Passe terminée : 100 % !':'✔ Complété automatiquement : '+s.adresse)+(reseau.enLigne?'':TEXTE_ATTENTE));
    try{navigator.vibrate(200);}catch(e){}   // (une petite secousse : le chauffeur, téléphone en poche, sait que c'est fait)
  }catch(e){cur.autoTente=false;}
}
