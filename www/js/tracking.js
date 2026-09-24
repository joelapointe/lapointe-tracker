// js/tracking.js — Étape 18 : la position du camion, envoyée au serveur par le téléphone du CHAUFFEUR
//
// Décisions de Joé (21 septembre 2026, revu le 23 septembre après un essai réel) : la position part toutes les 3 secondes,
// SEULEMENT pendant sa passe en cours (assez souvent pour que le camion bouge sur la carte comme un vrai GPS de navigation,
// même à 90 km/h ; avant l'étape 20 c'était 10 s, trop grossier). Le serveur n'accepte la position que du chauffeur d'une
// passe en cours (envoyer_position, SQL 05) : un passager n'envoie rien, et la position n'est jamais envoyée en dehors d'une
// passe. Les autres téléphones lisent la table « positions » (tours.js : chargerPositionsVehicules), en tirent les camions à
// l'écran et les clients « en cours » (zone bleue), et FONT GLISSER le point d'une lecture à l'autre plutôt que de sauter
// d'un coup (vehicules.js, étape 20).
// Jamais de position inventée : sans lecture récente du GPS (moins de 20 secondes), on n'envoie rien. Sans réseau, on n'envoie rien non plus et rien n'est gardé :
// seule la DERNIÈRE position compte (une position de plus de 3 minutes ne compte plus : config.js). Une position n'est jamais mise dans la file des gestes.
// Partie 2 (Android) : pendant MA passe, un suivi de premier plan du téléphone (plugin @capacitor-community/background-geolocation, notification permanente
// « Lapointe Tracker — Passe en cours : la position du camion est partagée ») continue de lire le GPS quand l'application est en arrière-plan ou l'écran éteint.
// Retour de Joé après un essai réel écran éteint (23 sept. 2026) : « le point saute d'un coup où je suis rendu quand je rallume l'écran ». Cause probable :
// Android peut mettre en pause la MINUTERIE JavaScript ci-dessous pendant que l'écran est éteint, même si le service de localisation (natif, premier plan) continue
// bien de lire le GPS — rien n'est alors envoyé pendant tout ce temps. Chaque lecture reçue du service (lectureArrierePlan, plus bas) TENTE maintenant aussi
// d'envoyer (tenterEnvoiPosition), sans dépendre SEULEMENT de la minuterie : tant que le service natif tourne, l'envoi suit, écran allumé ou non.
// L'ancien suivi (une ligne par employé, upsert direct dans « positions ») est retiré.
let POSITION_ENVOI_S=3;                // décision de Joé, revue le 23 sept. : toutes les 3 secondes (effet d'un vrai GPS de navigation)
const POSITION_ENVOI_FRAICHE_S=20;     // on n'envoie qu'une lecture du GPS de moins de 20 secondes
let POSITION_ENVOI_DELAI_MS=2500;      // un envoi sans réponse au bout de 2,5 secondes est abandonné (le suivant part 3 secondes après le début du précédent)
let _minuterieEnvoiPosition=null;
let _envoiPositionEnCours=false;
let _dernierEnvoiTenteLe=0;            // pour ne pas tenter un envoi plus souvent que POSITION_ENVOI_S, que la tentative vienne de la minuterie ou d'une lecture en arrière-plan

// Tente un envoi si ça fait au moins POSITION_ENVOI_S secondes depuis la dernière tentative (minuterie OU lecture en arrière-plan confondues) : appelée par
// les deux, pour que l'envoi suive le service natif même si la minuterie JavaScript est mise en pause (écran éteint).
function tenterEnvoiPosition(){
  const maintenant=Date.now();
  if(maintenant-_dernierEnvoiTenteLe<POSITION_ENVOI_S*1000-250) return;   // (marge de 250 ms) déjà tenté récemment : la prochaine lecture ou le prochain tour s'en chargera
  _dernierEnvoiTenteLe=maintenant;
  envoyerPositionDuCamion();
}

// La passe dont MON téléphone envoie la position : celle que je conduis, et que le serveur connaît déjà (un départ gardé sans réseau et pas encore envoyé
// n'existe pas encore pour lui : la position partira dès son retour). Sinon null.
function passeDontJEnvoieLaPosition(){
  const m=(typeof maPasse==='function')?maPasse():null;
  if(!m||!m.passe||!m.passe.passe_id) return null;
  const id=m.passe.passe_id;
  const attente=(typeof gestesEnAttente==='function')?gestesEnAttente():[];
  if(attente.some(g=>g.type==='debuter_passe'&&g.args&&g.args.passeId===id)) return null;
  return id;
}

// Envoie UNE position. Ne lève jamais d'erreur. Renvoie ce qui s'est passé : 'envoyee', 'pas_chauffeur' (aucune passe à moi en cours), 'hors_reseau',
// 'sans_position' (pas de lecture récente du GPS), 'en_cours' (l'envoi précédent n'a pas fini), 'passe_terminee' (le serveur dit qu'elle est finie),
// 'perdue' (pas de réponse : la suivante partira dans 10 s), 'refusee' (le serveur refuse : ce n'est pas grave, la suivante réessaiera)
async function envoyerPositionDuCamion(){
  let verrou=false;   // (seul l'envoi qui a pris la place la rend : un appel refusé « en cours » ne doit pas libérer l'envoi qui court)
  try{
    if(!currentUser) return 'pas_chauffeur';
    if(_envoiPositionEnCours) return 'en_cours';
    const passeId=passeDontJEnvoieLaPosition();
    if(!passeId) return 'pas_chauffeur';
    if(typeof reseau!=='undefined'&&!reseau.enLigne) return 'hors_reseau';
    const p=(typeof positionConnue==='function')?positionConnue(POSITION_ENVOI_FRAICHE_S):null;
    if(!p) return 'sans_position';
    _envoiPositionEnCours=true;verrou=true;
    let r;
    try{
      // (sans heure : c'est celle du serveur ; la lecture a moins de 20 secondes)
      r=await avecDelai(db.rpc('envoyer_position',{p_passe_id:passeId,p_lat:p.lat,p_lon:p.lon,p_precision:p.precision}),POSITION_ENVOI_DELAI_MS);
    }catch(err){
      r={data:null,error:err};
    }
    if(r.error){
      if(estErreurReseau(r.error)){signalerEchecReseau(r.error);return 'perdue';}
      return 'refusee';
    }
    const d=r.data||{};
    if(d.statut==='passe_terminee'){
      if(typeof planifierRechargementTours==='function') planifierRechargementTours();   // (ma passe est finie pour le serveur : l'écran se met à jour)
      return 'passe_terminee';
    }
    return 'envoyee';
  }catch(e){
    return 'refusee';
  }finally{
    if(verrou) _envoiPositionEnCours=false;
  }
}

// Démarre l'envoi régulier (une seule minuterie) : appelé au chargement de l'application (arrets.js : loadStops). Sans passe à moi en cours, chaque tour ne fait rien.
function tourEnvoiPosition(){
  tenterEnvoiPosition();   // (ne lève jamais d'erreur)
  majSuiviArrierePlan();   // le suivi du téléphone (Android) suit ma passe : il démarre avec elle, s'arrête avec elle
}
function demarrerEnvoiPosition(){
  if(_minuterieEnvoiPosition) return;
  _minuterieEnvoiPosition=setInterval(tourEnvoiPosition,POSITION_ENVOI_S*1000);
  tourEnvoiPosition();   // (le camion apparaît tout de suite s'il roule déjà)
}

// À la déconnexion : l'envoi et le suivi du téléphone s'arrêtent (auth.js ; la notification permanente disparaît). Le serveur n'a rien à effacer : une position de
// plus de 3 minutes ne compte plus.
async function arreterTracking(){
  if(_minuterieEnvoiPosition){
    clearInterval(_minuterieEnvoiPosition);
    _minuterieEnvoiPosition=null;
  }
  await arreterSuiviArrierePlan();
}

// ══ LE SUIVI EN ARRIÈRE-PLAN (étape 18, partie 2 : Android) ══════════════════════════════════════════════════════════════════════════════════════════
// Sans lui, Android cesse de donner la position à une application qui n'est plus à l'écran. Pendant MA passe (je la conduis), le téléphone garde un suivi de
// PREMIER PLAN : le service Android « position » du plugin, avec une notification permanente que la personne voit (décision de Joé, 21 sept. : titre
// « Lapointe Tracker », texte « Passe en cours : la position du camion est partagée »). Il démarre quand ma passe commence (application ouverte : Android
// l'exige), même si le départ attend encore le signal ; il s'arrête quand elle se termine, ou à la déconnexion. La permission de localisation « pendant
// l'utilisation » suffit (pas de « Toujours autoriser »). Si la personne ferme l'application (la glisse hors de la liste), Android arrête le suivi : le camion
// disparaît de la carte au bout de 3 minutes. Dans un navigateur, ou sur un téléphone sans le plugin, tout ceci ne fait rien.
const NOTIFICATION_TITRE='Lapointe Tracker';
const NOTIFICATION_MESSAGE='Passe en cours : la position du camion est partagée';
let ARRIERE_PLAN_REESSAI_MS=60000;   // après un refus de localisation : on regarde toutes les minutes si elle a été accordée (sans redemander à l'écran)
let ARRIERE_PLAN_ARRET_DELAI_MS=2500;   // arrêter le suivi (déconnexion) n'attend jamais plus de 2,5 secondes
let _suiviArrierePlan=null;          // {id} : le suivi tourne (la notification est affichée)
let _suiviArrierePlanOccupe=false;   // un démarrage ou un arrêt est en cours : pas deux à la fois
let _arrierePlanRefus=null;          // {passeId, le} : la localisation est refusée pour cette passe
let _arrierePlanAvertie=null;        // le numéro de la passe pour laquelle la personne a déjà été avertie (une seule fois par passe)
let _notificationsDemandees=false;   // la permission « notifications » (Android 13+) : demandée une seule fois par ouverture de l'application

// Un plugin natif injecté dans la page par Capacitor (Capacitor.Plugins.<Nom>), sinon null (navigateur, ou plugin absent)
function pluginNatif(nom){
  try{
    const C=(typeof Capacitor!=='undefined')?Capacitor:null;
    if(C&&C.Plugins&&C.Plugins[nom]&&(typeof C.isPluginAvailable!=='function'||C.isPluginAvailable(nom))) return C.Plugins[nom];
  }catch(e){}
  return null;
}

// Android 13 et plus : sans la permission « notifications », la notification permanente resterait cachée. Une seule demande, au début de la passe ;
// un refus n'empêche pas le suivi (seule la notification reste cachée).
async function demanderPermissionNotifications(){
  if(_notificationsDemandees) return;
  _notificationsDemandees=true;
  const n=pluginNatif('NotificationPermission');
  if(!n) return;
  try{
    const e=await avecDelai(Promise.resolve(n.check()),3000);
    if(e&&(e.notifications==='prompt'||e.notifications==='prompt-with-rationale')) await Promise.resolve(n.request());
  }catch(err){}
}

// Ce que la personne lit quand la localisation ne peut pas être suivie
function messageRefusArrierePlan(erreur){
  const m=String((erreur&&erreur.message)||'');
  if(/services? disabled/i.test(m)) return '📍 La position du camion n’est pas partagée : le GPS du téléphone est désactivé.';
  return '📍 La position du camion n’est pas partagée : la localisation est refusée pour cette application. (Réglages du téléphone > Applications > Lapointe Tracker > Autorisations)';
}
// La personne est avertie UNE seule fois par passe
function avertirArrierePlan(passeId,erreur){
  if(_arrierePlanAvertie===passeId) return;
  _arrierePlanAvertie=passeId;
  if(typeof toast==='function') toast(messageRefusArrierePlan(erreur));
}
// La localisation est REFUSÉE à l'application : le suivi est abandonné (la notification disparaît) ; il sera retenté sans bruit, quand la permission aura été accordée
function refusSuiviArrierePlan(suivi,passeId,erreur){
  _arrierePlanRefus={passeId,le:Date.now()};
  if(_suiviArrierePlan===suivi) _suiviArrierePlan=null;
  const p=pluginNatif('BackgroundGeolocation');
  if(p&&suivi&&suivi.id){try{Promise.resolve(p.removeWatcher({id:suivi.id})).catch(()=>{});}catch(e){}}
  avertirArrierePlan(passeId,erreur);
}
// Une lecture (ou une erreur) reçue du service du téléphone
function lectureArrierePlan(suivi,passeId,lecture,erreur){
  if(erreur){
    if(erreur.code!=='NOT_AUTHORIZED') return;
    // GPS éteint : le suivi RESTE en place (il donnera la position dès que le GPS sera rallumé) ; localisation refusée : il est abandonné
    if(/services? disabled/i.test(String(erreur.message||''))) avertirArrierePlan(passeId,erreur);
    else refusSuiviArrierePlan(suivi,passeId,erreur);
    return;
  }
  if(lecture&&typeof lecture.latitude==='number'&&typeof lecture.longitude==='number'){
    noterPosition(lecture.latitude,lecture.longitude,lecture.accuracy,lecture.time);
    tenterEnvoiPosition();   // suit le service natif même si la minuterie ci-dessus est en pause (écran éteint)
  }
}
async function demarrerSuiviArrierePlan(p,passeId){
  await demanderPermissionNotifications();
  const suivi={id:null};
  // (la boîte de permission de localisation n'est montrée qu'à la première tentative de la passe : après un refus, plus jamais à chaque tour)
  const options={backgroundTitle:NOTIFICATION_TITRE,backgroundMessage:NOTIFICATION_MESSAGE,requestPermissions:!_arrierePlanRefus||_arrierePlanRefus.passeId!==passeId,stale:false,distanceFilter:0};
  try{
    suivi.id=await Promise.resolve(p.addWatcher(options,(lecture,erreur)=>lectureArrierePlan(suivi,passeId,lecture,erreur)));
  }catch(e){
    _arrierePlanRefus={passeId,le:Date.now()};   // le plugin lui-même a échoué : on réessaiera dans une minute (sans message : ce n'est pas la personne qui a refusé)
    return;
  }
  _suiviArrierePlan=suivi;
}
async function arreterSuiviArrierePlan(){
  const s=_suiviArrierePlan;
  _suiviArrierePlan=null;
  if(!s||!s.id) return;
  const p=pluginNatif('BackgroundGeolocation');
  if(!p) return;
  try{await avecDelai(Promise.resolve(p.removeWatcher({id:s.id})),ARRIERE_PLAN_ARRET_DELAI_MS);}catch(e){}   // (la déconnexion n'attend jamais plus de 2,5 s)
}
// À chaque tour de la minuterie : le suivi du téléphone suit MA passe (je la conduis, même si son départ attend encore le signal)
async function majSuiviArrierePlan(){
  try{
    if(_suiviArrierePlanOccupe||!currentUser) return;
    const p=pluginNatif('BackgroundGeolocation');
    if(!p) return;
    const m=(typeof maPasse==='function')?maPasse():null;
    const passeId=(m&&m.passe)?m.passe.passe_id:null;
    _suiviArrierePlanOccupe=true;
    try{
      if(!passeId){
        _arrierePlanRefus=null;_arrierePlanAvertie=null;
        if(_suiviArrierePlan) await arreterSuiviArrierePlan();
        return;
      }
      if(_suiviArrierePlan) return;
      if(_arrierePlanRefus&&_arrierePlanRefus.passeId===passeId){
        if(Date.now()-_arrierePlanRefus.le<ARRIERE_PLAN_REESSAI_MS) return;   // refus récent : on ne harcèle pas
        _arrierePlanRefus.le=Date.now();                                       // (prochain coup d'œil dans une minute)
        // Toujours refusée : rien à tenter (une tentative ferait clignoter la notification). Accordée depuis, dans les réglages du téléphone : on reprend.
        if(typeof etatPermissionPosition==='function'&&(await etatPermissionPosition())!=='accordee') return;
      }
      await demarrerSuiviArrierePlan(p,passeId);
    }finally{
      _suiviArrierePlanOccupe=false;
    }
  }catch(e){}
}
