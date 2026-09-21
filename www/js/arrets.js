// js/arrets.js — Arrêts (stops) : lecture/écriture Supabase, marqueurs, fiche
// (extrait de l'ancien index.html)
// Étape 13 : « fait » n'est plus une colonne de l'arrêt ; il vient du tour en cours (voir tours.js).
// ── SUPABASE CRUD ──────────────────────────────────────
async function loadStops(){
  setStatus('Chargement des stops…');
  await initialiserFile();   // les gestes gardés sur ce téléphone (étape 16b) : relus, envoyés s'il y a du signal
  if(typeof demarrerSuiviGps==='function') demarrerSuiviGps();   // le GPS (et sa permission, une seule fois) : après la connexion (carte.js, étape 17)
  try{
    // Seulement les arrêts actifs : un arrêt archivé (il a de l'historique) ne s'affiche plus, même pour l'administrateur
    const{data,error}=await db.from('stops').select('*').eq('actif',true).order('ordre');
    if(error) throw error;
 stops=data||[];
    lectureReussie('stops',stops);
    await loadRoutes();
    await chargerTours();
    await chargerPositionsVehicules();   // camions sur place → clients « en cours » (étape 13c)
    await chargerVehiculesEtEquipages(); // noms des camions et équipages à bord (étape 13f)
    if(typeof chargerReglagesQuart==='function') await chargerReglagesQuart();   // rappel, pause, durée maximale d'un quart (étape 17, quart.js) : AVANT le quart, pour que le premier contrôle les connaisse
    if(typeof chargerMonQuart==='function') await chargerMonQuart();   // suis-je en service ? (étape 17, quart.js)
    demarrerRelecturePositions();
    await chargerProblemes();   // plusieurs problèmes possibles par arrêt (problemes.js) : plus de « un seul par arrêt »
    if(!reseau.enLigne) await restaurerDepuisCache();   // le signal a disparu pendant le chargement : on prend les copies pour ce qui manque
    renderAll();
    hideLoading();
    updateBar();
	  checkProblemes();
    resumeAuDemarrage();   // une passe terminée à l'instant (avant un rechargement) : son résumé (passe.js)
    prechargerPourDebuter();   // de quoi débuter une passe sans réseau (passe.js), gardé en copie en arrière-plan
  }catch(e){
    // Pas de signal : on s'ouvre avec ce qu'on savait à la dernière connexion (étape 16a). Un refus du serveur, lui, reste une erreur.
    if(estErreurReseau(e)){
      if(await restaurerDepuisCache()){
        renderAll();
        hideLoading();
        updateBar();
        checkProblemes();
        demarrerRelecturePositions();
        return;
      }
      showErr('Pas de réseau, et rien n’est encore gardé sur ce téléphone.<br>Ouvre l’application une première fois avec du signal : elle gardera alors de quoi travailler sans réseau.');
      return;
    }
    showErr('Impossible de charger les données.<br>Vérifie que les politiques RLS sont activées dans Supabase.<br><br><small>'+esc(e.message)+'</small>');
  }
}

async function dbSave(s){
  showSync(true);
  const{data,error}=await db.from('stops').insert([s]).select().single();
  showSync(false);
  if(error){toast('❌ '+error.message);return null;}
  return data;
}

// Supprime un arrêt ; s'il a de l'historique (passe, problème) la base le refuse : il est alors ARCHIVÉ, jamais perdu.
// Renvoie 'supprime', 'archive' ou 'erreur'.
async function dbDel(id){
  showSync(true);
  const r=await db.from('stops').delete().eq('id',id);
  if(!r.error){showSync(false);return 'supprime';}
  const a=await db.from('stops').update({actif:false}).eq('id',id);
  showSync(false);
  return a.error?'erreur':'archive';
}

// ── MARQUEURS ──────────────────────────────────────────
function mkIcon(done,hasProb,onSite){
  const c=couleurEtat(done,hasProb,onSite);   // règle de couleur unique (tours.js), la même que pour les zones
  const s=done&&!hasProb?14:18;
  return L.divIcon({className:'',html:`<div style="width:${s}px;height:${s}px;background:${c};border:2px solid rgba(0,0,0,.5);transform:rotate(45deg);box-shadow:0 2px 6px rgba(0,0,0,.6)"></div>`,iconSize:[s,s],iconAnchor:[s/2,s/2]});
}

let polys=[];   // zones dessinées (à effacer avant de redessiner, sinon elles s'empilent)
function renderAll(){
  Object.values(mkrs).forEach(m=>map.removeLayer(m));
  Object.keys(mkrs).forEach(k=>delete mkrs[k]);
  polys.forEach(p=>map.removeLayer(p));
  polys=[];
  stops.forEach((s,i)=>{
    if(!s.lat) return;
  if(routeActive!==null && s.route_id!==routeActive) return;
  const m=L.marker([s.lat,s.lon],{icon:mkIcon(estFait(s),aProbleme(s),estEnCours(s))}).addTo(map);
    m.on('click',()=>openCard(i));
    mkrs[i]=m;
  });
  // Dessiner les zones polygonales
  stops.forEach(s=>{
    if(!s.zone_points||!Array.isArray(s.zone_points))return;
    if(routeActive!==null && s.route_id!==routeActive) return;
    const c=couleurEtat(estFait(s),aProbleme(s),estEnCours(s));
    polys.push(L.polygon(s.zone_points,{
      color:c,fillColor:c,fillOpacity:.15,weight:2
    }).addTo(map));
  });
	updateBar();
  _sigEnCours=signatureEnCours();   // ce qui est dessiné : on ne redessinera que si ça change
  majVehicules();                   // les camions (un point chacun) avec leur équipage
  majBandeauPasse();                // « Débuter la passe », ou le résumé de la passe en cours (passe.js)
  if(typeof majPastilleQuart==='function') majPastilleQuart();   // la pastille « En service » (étape 17, quart.js)
}

// Barre du bas : l'avancement de ce qui est affiché (une route, ou toutes les routes ensemble),
// calculé sur les arrêts qui font partie d'un tour en cours.
function updateBar(){
  const p=progression();
  document.getElementById('op-name').textContent=currentUser?currentUser.nom:operator||'—';
 document.getElementById('zone-val').textContent=zone||'Toutes les routes';
  document.getElementById('prog-txt').textContent=p.aucune?'Aucune passe':`${p.faits}/${p.total}`;
  document.getElementById('prog-pct').textContent=p.aucune?'—':`${p.pct}%`;
  document.getElementById('prog-fill').style.width=p.pct+'%';
}

// ── STOP CARD ──────────────────────────────────────────
function openCard(i){
  const s=stops[i];if(!s)return;
  activeIdx=i;
  majCarte();
  document.getElementById('stop-card').classList.add('open');
  map.flyTo([s.lat,s.lon],17,{duration:.7});
}

// Remplit la fiche de l'arrêt ouvert (appelée à l'ouverture, et de nouveau quand les tours changent)
function majCarte(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];if(!s)return;
  document.getElementById('sc-addr').textContent=s.adresse;
  document.getElementById('sc-svc').textContent=s.service||'';
  document.getElementById('sc-cli').textContent=s.client||'';
  document.getElementById('sc-tour').textContent=texteTour(s);
  document.getElementById('sc-prob').innerHTML=htmlProblemes(s);
  planifierResolutionPhotos();   // les liens des miniatures qui manquent sont demandés ensemble, puis la fiche est redessinée (photos.js)
  const e=etatComplete(s);
  const b=document.getElementById('btn-cmp');
  b.textContent=e.texte;
  b.className=e.classe;
  b.disabled=!e.actif;
}

function closeCard(){document.getElementById('stop-card').classList.remove('open');activeIdx=null;}

// « Complété » : seul le chauffeur de la passe peut le faire (le serveur le vérifie aussi).
// Sur un arrêt déjà fait, le même bouton devient « ↩ Annuler » pendant 10 minutes (étape 14c).
async function completeStop(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];if(!s)return;
  const e=etatComplete(s);
  if(!e.actif){toast(e.explication||e.texte);return;}
  if(e.action==='annuler') return annulerArret(s,e);
  if(!reseau.enLigne) return completerSansReseau(s,e);   // on sait déjà qu'il n'y a pas de signal : le geste est gardé sur le téléphone (étape 16c)
  showSync(true);
  let r;
  try{
    r=await avecDelai(db.rpc('completer_arret',{p_passe_id:e.passeId,p_stop_id:s.id,p_mode:'manuel',p_lat:lastPos?lastPos[0]:null,p_lon:lastPos?lastPos[1]:null}),FILE_DELAI_DIRECT_MS);
  }catch(err){
    r={data:null,error:err};
  }
  showSync(false);
  // Le signal a disparu (ou la réponse s'est perdue) : le MÊME geste est gardé sur le téléphone, avec les mêmes identifiants : aucun doublon possible
  if(r.error&&estErreurReseau(r.error)){signalerEchecReseau(r.error);return completerSansReseau(s,e);}
  if(r.error){toast('❌ '+messageErreurGeste(r.error));return;}
  await chargerTours();
  renderAll();majCarte();
  const st=r.data&&r.data.statut;
  if(st==='passe_terminee'){toast('⚠ Cette passe est déjà terminée');return;}
  closeCard();
  toast(r.data&&r.data.passe_fermee?'🎉 Passe terminée : 100 % !':(st==='deja_complete'?'✔ Déjà complété par un autre camion':'✔ Stop complété !'));
}

// ── SANS RÉSEAU (étape 16c) ────────────────────────────
// Le geste est gardé sur le téléphone (file-attente.js) puis l'écran montre TOUT DE SUITE son résultat : les tours affichés sont la copie du
// serveur avec les gestes en attente posés par-dessus (tours.js). Au retour du signal, le geste part et le serveur a le dernier mot.
let _gardeEnCours=false;
async function completerSansReseau(s,e){
  if(_gardeEnCours) return;
  _gardeEnCours=true;   // pas de double geste pendant que le téléphone écrit
  try{
    const r=await enfiler('completer_arret',{passeId:e.passeId,stopId:s.id,mode:'manuel',lat:lastPos?lastPos[0]:null,lon:lastPos?lastPos[1]:null},{libelle:'✔ Complété : '+s.adresse});
    if(!r.ok){toast(MESSAGE_GESTE_NON_GARDE);return;}
    renderAll();majCarte();
    const fermee=!tourEnCours(tourDe(s));   // 100 % atteint : la passe est fermée à l'écran, comme le ferait le serveur
    closeCard();
    toast((fermee?'🎉 Passe terminée : 100 % !':'✔ Stop complété !')+TEXTE_ATTENTE+texteGardeSeulementEnMemoire(r));
  }finally{
    _gardeEnCours=false;
  }
}
// « Annuler » sans réseau. Un « Complété » fait sans réseau et pas encore parti est simplement RETIRÉ de la file (rien à défaire sur le serveur,
// et pas de délai de 10 minutes à craindre) ; sinon un geste « annuler » est gardé.
async function annulerSansReseau(s,e){
  if(_gardeEnCours) return;
  _gardeEnCours=true;
  try{
    const enFile=gestesEnAttente().filter(g=>g.type==='completer_arret'&&g.args.passeId===e.passeId&&g.args.stopId===s.id);
    const dernier=enFile[enFile.length-1];
    if(dernier&&await retirerGesteSiPasParti(dernier.id)){
      renderAll();majCarte();
      if(!estFait(s)){toast('↩ Arrêt annulé : rien à envoyer');return;}
      // (le serveur a déjà cet arrêt : un « annuler » doit quand même partir, on continue plus bas)
    }
    const r=await enfiler('annuler_arret',{passeId:e.passeId,stopId:s.id},{libelle:'↩ Annulé : '+s.adresse});
    if(!r.ok){toast(MESSAGE_GESTE_NON_GARDE);return;}
    renderAll();majCarte();
    toast('↩ Arrêt annulé'+TEXTE_ATTENTE+texteGardeSeulementEnMemoire(r));
  }finally{
    _gardeEnCours=false;
  }
}

// Annule un arrêt complété par erreur (10 minutes). Si cet arrêt avait fermé la passe à 100 %, le serveur la rouvre.
let _envoiAnnulation=false;
async function annulerArret(s,e){
  if(_envoiAnnulation) return;
  _envoiAnnulation=true;   // pas de double geste
  try{
    if(!(await confirmer('Annuler ce « Complété » ?',s.adresse+' redeviendra à faire.'+(e.termine?' La passe terminée sera rouverte.':''),'Oui, annuler','Non'))) return;
    if(!reseau.enLigne) return await annulerSansReseau(s,e);
    showSync(true);
    let r;
    try{
      r=await avecDelai(db.rpc('annuler_arret',{p_passe_id:e.passeId,p_stop_id:s.id}),FILE_DELAI_DIRECT_MS);
    }catch(err){
      r={data:null,error:err};
    }
    showSync(false);
    if(r.error&&estErreurReseau(r.error)){signalerEchecReseau(r.error);return await annulerSansReseau(s,e);}
    await chargerTours();    // le serveur a le dernier mot : on relit toujours, réussite ou refus
    renderAll();majCarte();
    if(r.error){toast('❌ '+messageErreurGeste(r.error));return;}
    if(r.data&&r.data.statut==='pas_complete'){toast('Cet arrêt n’était pas complété.');return;}
    toast(r.data&&r.data.passe_rouverte?'↩ Arrêt annulé : la passe est rouverte':'↩ Arrêt annulé');
  }finally{
    _envoiAnnulation=false;
  }
}

async function deleteStop(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];if(!s)return;
  // Boîte de l'application (la fenêtre native confirm() est refusée d'office par certains navigateurs intégrés)
  if(!(await confirmer('Supprimer cet arrêt ?',s.adresse,'Supprimer','Annuler')))return;
  const r=await dbDel(s.id);
  if(r==='erreur'){toast('❌ Impossible de supprimer cet arrêt');return;}
  stops=stops.filter(x=>x.id!==s.id);   // par identifiant : la liste a pu être relue pendant la confirmation
  renderAll();closeCard();
  toast(r==='archive'?'📦 Archivé (il a un historique)':'🗑 Supprimé');
}
