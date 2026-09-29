// js/admin-suivi.js — Panneau administrateur, onglet « Suivi » : le SUIVI DES PASSAGES par client (demande 4 de Joé, 29 sept. 2026)
//
// Joé tient aujourd'hui un tableau imprimé, « SUIVI DES PASSAGES PAR CLIENT » (une section par ville, une ligne par client, les dates écrites au stylo dans la dernière colonne). Cet onglet le remplace :
// les dates viennent TOUTES SEULES des « Complété » du camion (table passe_arrets, déjà là) ; on peut aussi en noter à la main (table passages_manuels, fichier SQL 28).
// Décisions de Joé (29 sept. 2026) : (1) réservé à l'ADMINISTRATEUR ; (2) un client = une ADRESSE (les copies d'un client dans des routes temporaires sont regroupées) ; (3) un choix de SERVICE (coupe de gazon,
// désherbage, déneigement, sel : chacun a sa liste, comme ses feuilles) ; (4) il repart de ZÉRO (l'historique du papier reste sur le papier) mais veut pouvoir AJOUTER des passages à la main ; (5) il veut savoir « quel client doit
// être fait » et compter les passages ; (6) un PDF à imprimer au besoin (à venir : suivi-pdf.js). Il créera lui-même ses clients dans l'application : aucun import.
//
// Lecture seulement pour les passages de l'application (les règles d'accès laissent l'administrateur tout lire sur passe_arrets) ; écriture directe sur passages_manuels (règle passages_manuels_admin) et sur
// types_service.frequence_jours (le RYTHME du service : « tous les 7 jours » ; règle types_service_admin) : AUCUNE fonction serveur.
// Une ligne = une ADRESSE pour le service choisi. Sa SECTION = la route de son arrêt le plus ANCIEN (les copies dans les routes temporaires sont plus récentes) : les routes de Joé portent déjà les noms de ses villes.
// Un « passage » = un JOUR (deux « Complété » le même jour pour la même adresse, par exemple dans une route et sa copie, comptent pour un).
const SUIVI_MOIS=['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
const SUIVI_PAGE=1000;       // lignes lues par requête (le service de données n'en rend pas plus de 1000)
const SUIVI_PAGES_MAX=60;    // garde-fou : jamais plus de 60 000 lignes lues

let suiviService=null;       // le service affiché (« Coupe de gazon »…)
let suiviFiltre='tous';      // 'tous' | 'afaire' | 'aucun'
let suiviRecherche='';
let suiviDonnees=null;       // {depuis, passages:[{stop_id,complete_le}], manuels:[{id,stop_id,jour,note}], manuelsDispo, rythmes:{nom:jours|null}, rythmeDispo, services:[nom]}
let _suiviOccupe=false;      // une écriture est en cours (pas de double envoi)
let _suiviLecture=0;         // le numéro de la dernière lecture demandée (une réponse plus vieille est ignorée)

// ── Dates et clés (fonctions pures, testées seules) ─────────────────
function suiviPad(n){return String(n).padStart(2,'0');}
// Le jour LOCAL (« 2026-05-12 ») d'une heure du serveur ; null si elle est illisible
function suiviJourLocal(quand){
  const d=new Date(quand);
  if(isNaN(d.getTime())) return null;
  return d.getFullYear()+'-'+suiviPad(d.getMonth()+1)+'-'+suiviPad(d.getDate());
}
// « 12 mai », « 1er mai », « 12 mai 2025 » (l'année seulement si ce n'est pas l'année courante)
function suiviDateCourte(jour,annee){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(jour||'');
  if(!m) return '';
  const j=Number(m[3]);
  return (j===1?'1er':String(j))+' '+SUIVI_MOIS[Number(m[2])-1]+(Number(m[1])!==annee?' '+m[1]:'');
}
// Le nombre de jours de a à b (deux jours « AAAA-MM-JJ »)
function suiviJoursEntre(a,b){
  const pa=a.split('-').map(Number),pb=b.split('-').map(Number);
  return Math.round((Date.UTC(pb[0],pb[1]-1,pb[2])-Date.UTC(pa[0],pa[1]-1,pa[2]))/86400000);
}
// La clé d'une adresse : sans accents, sans majuscules, sans ponctuation (« 10 Rue de l'Église, Charette » = « 10 rue de l eglise charette »)
function suiviCle(adresse){
  return String(adresse||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
// L'état d'un client : 'aucun' (aucun passage depuis la date choisie) ; puis, SI le service a un rythme : 'ok' (à jour), 'afaire' (le rythme est atteint), 'retard' (1,5 fois le rythme ou plus) ; sans rythme : 'neutre'
function suiviEtat(total,jours,rythme){
  if(!total) return 'aucun';
  if(!rythme) return 'neutre';
  if(jours<rythme) return 'ok';
  return jours>=rythme*1.5?'retard':'afaire';
}
const SUIVI_A_FAIRE=['aucun','afaire','retard'];   // les états qui demandent un passage

// Construit les lignes du service choisi.
// o : {arrets (les arrêts actifs), routes, completions [{stop_id, complete_le}], manuels [{id, stop_id, jour, note}], service, depuis ('AAAA-MM-JJ'), aujourdhui ('AAAA-MM-JJ'), rythme (jours ou null)}
function suiviConstruire(o){
  const nomRoute=id=>{const r=(o.routes||[]).find(x=>x.id===id);return r?r.nom:null;};
  const groupes=new Map();
  (o.arrets||[]).filter(s=>s&&s.actif!==false&&s.service===o.service).forEach(s=>{
    const cle=suiviCle(s.adresse)||('id:'+s.id);
    if(!groupes.has(cle)) groupes.set(cle,[]);
    groupes.get(cle).push(s);
  });
  const parArret=new Map();   // id de l'arrêt → {app:Set(jours), manuel:Map(jour → {id, note})}
  const fiche=id=>{if(!parArret.has(id)) parArret.set(id,{app:new Set(),manuel:new Map()});return parArret.get(id);};
  (o.completions||[]).forEach(c=>{const j=suiviJourLocal(c.complete_le);if(j&&j>=o.depuis) fiche(c.stop_id).app.add(j);});
  (o.manuels||[]).forEach(m=>{const j=String(m.jour||'').slice(0,10);if(/^\d{4}-\d{2}-\d{2}$/.test(j)&&j>=o.depuis) fiche(m.stop_id).manuel.set(j,{id:m.id,note:m.note||''});});
  const lignes=[];
  groupes.forEach((liste,cle)=>{
    // le plus ANCIEN arrêt de l'adresse (date de création, puis place dans la route, puis identifiant) est la référence : sa route donne la section
    const tries=[...liste].sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||(Number(a.ordre)||0)-(Number(b.ordre)||0)||String(a.id).localeCompare(String(b.id)));
    const ref=tries[0];
    const jours=new Map();   // jour → {jour, app, manuel}
    tries.forEach(s=>{
      const f=parArret.get(s.id);
      if(!f) return;
      f.app.forEach(j=>{const e=jours.get(j)||{jour:j,app:false,manuel:null};e.app=true;jours.set(j,e);});
      f.manuel.forEach((m,j)=>{const e=jours.get(j)||{jour:j,app:false,manuel:null};e.manuel=m;jours.set(j,e);});
    });
    const dates=[...jours.values()].sort((a,b)=>a.jour.localeCompare(b.jour));
    const dernier=dates.length?dates[dates.length-1].jour:null;
    const nbJours=dernier?suiviJoursEntre(dernier,o.aujourdhui):null;
    lignes.push({
      cle,arretRef:ref.id,arretIds:tries.map(s=>s.id),adresse:ref.adresse||'',client:(tries.map(s=>(s.client||'').trim()).find(x=>x))||'',
      section:nomRoute(ref.route_id)||'Sans route',ordre:Number(ref.ordre)||0,
      dates,total:dates.length,dernier,jours:nbJours,etat:suiviEtat(dates.length,nbJours,o.rythme),
    });
  });
  return lignes;
}
// Les lignes qui passent le filtre (« à faire », « aucun passage ») et la recherche : CHAQUE mot tapé doit se trouver dans l'adresse ou le nom du client, dans n'importe quel ordre (« tremblay pins »)
function suiviFiltrer(lignes,filtre,recherche){
  const mots=suiviCle(recherche).split(' ').filter(Boolean);
  return lignes.filter(l=>{
    if(filtre==='aucun'&&l.etat!=='aucun') return false;
    if(filtre==='afaire'&&!SUIVI_A_FAIRE.includes(l.etat)) return false;
    if(mots.length){const cle=suiviCle(l.adresse+' '+l.client);if(!mots.every(m=>cle.includes(m))) return false;}
    return true;
  });
}
// Les sections (une par route), dans l'ordre des noms (« Sans route » à la fin), chacune avec ses lignes dans l'ordre de la route
function suiviGrouper(lignes){
  const sections=new Map();
  lignes.forEach(l=>{if(!sections.has(l.section)) sections.set(l.section,[]);sections.get(l.section).push(l);});
  return [...sections.entries()]
    .sort((a,b)=>(a[0]==='Sans route')-(b[0]==='Sans route')||a[0].localeCompare(b[0],'fr',{sensitivity:'base'}))
    .map(([nom,l])=>({nom,lignes:l.sort((x,y)=>x.ordre-y.ordre||x.adresse.localeCompare(y.adresse,'fr',{sensitivity:'base'}))}));
}
function suiviResume(lignes){
  return {clients:lignes.length,aFaire:lignes.filter(l=>SUIVI_A_FAIRE.includes(l.etat)).length,aucun:lignes.filter(l=>l.etat==='aucun').length,passages:lignes.reduce((s,l)=>s+l.total,0)};
}
// La ligne d'un client, comme sur la feuille : « Client : Adresse » (l'adresse seule s'il n'a pas de nom)
function suiviLibelle(l){return l.client?l.client+' : '+l.adresse:l.adresse;}

// ── Ce qui est retenu d'une fois à l'autre ──────────────────
function suiviLire(cle){try{return localStorage.getItem(cle);}catch(e){return null;}}
function suiviEcrire(cle,v){try{localStorage.setItem(cle,v);}catch(e){}}
function suiviDepuisParDefaut(){return new Date().getFullYear()+'-01-01';}
// La date de départ retenue pour un service (sinon le 1er janvier de cette année)
function suiviDepuisDe(service){
  const v=suiviLire('lp_suivi_depuis_'+service);
  return /^\d{4}-\d{2}-\d{2}$/.test(v||'')?v:suiviDepuisParDefaut();
}
function suiviAujourdhui(){return suiviJourLocal(Date.now());}

// ── Lecture ─────────────────────────────────────────
// Lit TOUTES les lignes d'une requête, par pages de 1000 (dans un ordre stable : la colonne d'ordre, puis l'identifiant)
async function suiviLireTout(table,colonnes,filtre,ordre){
  const lignes=[];
  for(let p=0;p<SUIVI_PAGES_MAX;p++){
    const r=await filtre(db.from(table).select(colonnes)).order(ordre).order('id').range(p*SUIVI_PAGE,p*SUIVI_PAGE+SUIVI_PAGE-1);
    if(r.error) throw r.error;
    const page=Array.isArray(r.data)?r.data:[];
    lignes.push(...page);
    if(page.length<SUIVI_PAGE) break;
  }
  return lignes;
}
function suiviTableAbsente(e){
  const m=String((e&&(e.message||e.details))||'');
  return !!e&&(e.code==='42P01'||e.code==='PGRST205'||e.code==='42703'||/does not exist|schema cache|could not find/i.test(m));
}
// Les services proposés : les types de service (actifs) et tout service qu'un arrêt actif porte encore
function suiviServices(types){
  const noms=new Set();
  (types||[]).filter(t=>t.actif!==false).forEach(t=>noms.add(t.nom));
  (stops||[]).filter(s=>s.actif!==false&&s.service).forEach(s=>noms.add(s.service));
  return [...noms].sort((a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'}));
}
// Lit tout ce que l'écran montre pour une date de départ : les « Complété », les dates à la main, les rythmes. Un fichier SQL 28 pas encore exécuté ne bloque rien.
async function suiviCharger(depuis){
  const numero=++_suiviLecture;
  const debutIso=new Date(Number(depuis.slice(0,4)),Number(depuis.slice(5,7))-1,Number(depuis.slice(8,10))).toISOString();
  const passages=await suiviLireTout('passe_arrets','stop_id, complete_le',q=>q.gte('complete_le',debutIso),'complete_le');
  let manuels=[],manuelsDispo=true;
  try{manuels=await suiviLireTout('passages_manuels','id, stop_id, jour, note',q=>q.gte('jour',depuis),'jour');}
  catch(e){if(suiviTableAbsente(e)) manuelsDispo=false; else throw e;}
  let types=[],rythmeDispo=true;
  let r=await db.from('types_service').select('nom, actif, frequence_jours').order('nom');
  if(r.error&&suiviTableAbsente(r.error)){rythmeDispo=false;r=await db.from('types_service').select('nom, actif').order('nom');}
  if(r.error) throw r.error;
  types=Array.isArray(r.data)?r.data:[];
  if(numero!==_suiviLecture) return null;   // une lecture plus récente a été demandée entre-temps
  const rythmes={};
  types.forEach(t=>{rythmes[t.nom]=(typeof t.frequence_jours==='number')?t.frequence_jours:null;});
  return {depuis,passages,manuels,manuelsDispo,rythmes,rythmeDispo,services:suiviServices(types)};
}

function chargerSuiviAdmin(){
  return suiviOuvrir();
}
async function suiviOuvrir(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  if(!reseau.enLigne){
    body.appendChild(suiviMessage('📴 Pas de réseau : le suivi se lit avec du signal.'));
    return;
  }
  body.appendChild(suiviMessage('Chargement…'));
  // la date de départ du service qui sera affiché (celui d'avant, sinon celui retenu, sinon la coupe de gazon) : la 1ʳᵉ lecture est déjà la bonne dans le cas courant
  const depuisRetenu=suiviDepuisDe(suiviService||suiviLire('lp_suivi_service')||'Coupe de gazon');
  let d=null;
  try{
    d=await suiviCharger(depuisRetenu);
  }catch(e){
    if(!document.getElementById('admin-body')||_adminOnglet!=='suivi') return;
    body.innerHTML='';
    body.appendChild(suiviMessage('❌ Impossible de charger le suivi. Vérifie la connexion, puis réessaie.'));
    if(typeof signalerEchecReseau==='function') signalerEchecReseau(e);
    return;
  }
  if(!d||_adminOnglet!=='suivi') return;   // (remplacée par une lecture plus récente, ou l'onglet a changé)
  suiviDonnees=d;
  if(!suiviService||!d.services.includes(suiviService)){
    const retenu=suiviLire('lp_suivi_service');
    suiviService=d.services.includes(retenu)?retenu:(d.services.includes('Coupe de gazon')?'Coupe de gazon':(d.services[0]||null));
    if(suiviService&&suiviDepuisDe(suiviService)!==d.depuis){
      // le service retenu a sa propre date de départ : on relit avec elle
      try{const d2=await suiviCharger(suiviDepuisDe(suiviService));if(d2) suiviDonnees=d2;}catch(e){}
    }
  }
  renderSuiviAdmin();
}

// ── L'écran ─────────────────────────────────────────
function suiviEl(balise,classe,texte){
  const e=document.createElement(balise);
  if(classe) e.className=classe;
  if(texte!==undefined) e.textContent=texte;
  return e;
}
function suiviMessage(texte){
  const d=suiviEl('div','su-message',texte);
  return d;
}
function suiviRythmeDe(service){
  const r=suiviDonnees&&suiviDonnees.rythmes?suiviDonnees.rythmes[service]:null;
  return (typeof r==='number'&&r>0)?r:null;
}
// Toutes les lignes du service affiché (avant le filtre et la recherche)
function suiviLignes(){
  if(!suiviDonnees||!suiviService) return [];
  return suiviConstruire({arrets:stops,routes,completions:suiviDonnees.passages,manuels:suiviDonnees.manuels,service:suiviService,depuis:suiviDonnees.depuis,aujourdhui:suiviAujourdhui(),rythme:suiviRythmeDe(suiviService)});
}

function renderSuiviAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  const d=suiviDonnees;
  if(!d||!d.services.length){
    body.appendChild(suiviMessage('Aucun service : ajoute d\'abord des clients (＋ Stop) ou un type de service (onglet Services).'));
    return;
  }
  const barre=suiviEl('div','su-barre');
  // 1. le service
  const puces=suiviEl('div','su-puces');
  d.services.forEach(nom=>{
    const b=suiviEl('button','su-puce'+(nom===suiviService?' on':''),nom);
    b.type='button';
    b.setAttribute('aria-pressed',nom===suiviService?'true':'false');
    b.onclick=()=>suiviChoisirService(nom);
    puces.appendChild(b);
  });
  barre.appendChild(puces);
  // 2. la date de départ et le rythme
  const reglages=suiviEl('div','su-reglages');
  const cDepuis=suiviEl('div','su-champ');
  cDepuis.appendChild(suiviEl('label','','Depuis le'));
  const iDepuis=suiviEl('input','');
  iDepuis.type='date';iDepuis.id='su-depuis';iDepuis.value=d.depuis;
  iDepuis.onchange=()=>suiviChangerDepuis(iDepuis.value);
  cDepuis.appendChild(iDepuis);
  reglages.appendChild(cDepuis);
  const cRythme=suiviEl('div','su-champ');
  cRythme.appendChild(suiviEl('label','','Rythme (jours)'));
  const iRythme=suiviEl('input','');
  iRythme.type='number';iRythme.id='su-rythme';iRythme.min='1';iRythme.max='365';iRythme.placeholder='aucun';
  const rythme=suiviRythmeDe(suiviService);
  iRythme.value=rythme===null?'':String(rythme);
  iRythme.onchange=()=>suiviChoisirRythme(iRythme.value,iRythme);
  cRythme.appendChild(iRythme);
  reglages.appendChild(cRythme);
  barre.appendChild(reglages);
  // 3. le filtre et la recherche
  const filtres=suiviEl('div','su-filtres');
  [['tous','Tous'],['afaire','À faire'],['aucun','Aucun passage']].forEach(([id,texte])=>{
    const b=suiviEl('button','su-puce'+(suiviFiltre===id?' on':''),texte);
    b.type='button';
    b.dataset.filtre=id;
    b.onclick=()=>{suiviFiltre=id;Array.from(filtres.children).forEach(x=>{if(x.dataset&&x.dataset.filtre) x.className='su-puce'+(x.dataset.filtre===suiviFiltre?' on':'');});renderSuiviListe();};
    filtres.appendChild(b);
  });
  const iRech=suiviEl('input','su-recherche');
  iRech.type='text';iRech.id='su-recherche';iRech.placeholder='Chercher un client…';iRech.value=suiviRecherche;
  iRech.oninput=()=>{suiviRecherche=iRech.value;renderSuiviListe();};
  filtres.appendChild(iRech);
  barre.appendChild(filtres);
  body.appendChild(barre);
  if(!d.manuelsDispo) body.appendChild(suiviMessage('Les dates à la main ne sont pas encore activées dans ta base (fichier SQL 28).'));
  const liste=suiviEl('div','');
  liste.id='su-liste';
  body.appendChild(liste);
  renderSuiviListe();
}

// La liste (sections, clients, dates) : refaite à chaque filtre ou recherche, sans refaire la barre (le champ de recherche garde le clavier)
function renderSuiviListe(){
  const zone=document.getElementById('su-liste');
  if(!zone) return;
  zone.innerHTML='';
  const toutes=suiviLignes();
  const resume=suiviResume(toutes);
  const rythme=suiviRythmeDe(suiviService);
  zone.appendChild(suiviEl('div','su-resume',
    resume.clients+' client'+(resume.clients>1?'s':'')+(rythme?' · '+resume.aFaire+' à faire':' · '+resume.aucun+' sans passage')+' · '+resume.passages+' passage'+(resume.passages>1?'s':'')));
  const lignes=suiviFiltrer(toutes,suiviFiltre,suiviRecherche);
  if(!lignes.length){
    zone.appendChild(suiviMessage(toutes.length?'Aucun client ne correspond.':'Aucun client pour ce service.'));
  }
  const annee=new Date().getFullYear();
  suiviGrouper(lignes).forEach(sec=>{
    const tete=suiviEl('div','su-section');
    tete.appendChild(suiviEl('span','',sec.nom));
    tete.appendChild(suiviEl('span','su-section-n',sec.lignes.length+' client'+(sec.lignes.length>1?'s':'')));
    zone.appendChild(tete);
    sec.lignes.forEach((l,i)=>zone.appendChild(suiviLigne(l,i+1,annee)));
  });
  const actions=suiviEl('div','su-actions');
  const bLot=suiviEl('button','lf-btn nouveau','＋ Une date pour plusieurs clients');
  bLot.type='button';
  bLot.onclick=()=>suiviDialogueLot();
  actions.appendChild(bLot);
  const bMaj=suiviEl('button','lf-btn','↻ Actualiser');
  bMaj.type='button';
  bMaj.onclick=()=>suiviOuvrir();
  actions.appendChild(bMaj);
  zone.appendChild(actions);
}

const SUIVI_TEXTE_ETAT={aucun:'Aucun passage',afaire:'À faire',retard:'En retard',ok:'À jour',neutre:''};
function suiviLigne(l,numero,annee){
  const div=suiviEl('div','su-ligne');
  const haut=suiviEl('div','su-haut');
  const nom=suiviEl('button','su-nom',numero+' · '+(l.client||l.adresse));
  nom.type='button';
  nom.onclick=()=>suiviDialogueDetail(l);
  haut.appendChild(nom);
  const droite=suiviEl('div','su-droite');
  if(l.etat!=='neutre'){
    const texte=(l.etat==='aucun')?SUIVI_TEXTE_ETAT.aucun:(SUIVI_TEXTE_ETAT[l.etat]+' · '+l.jours+' j');
    droite.appendChild(suiviEl('span','su-badge '+l.etat,texte));
  }
  droite.appendChild(suiviEl('span','su-n',l.total+' passage'+(l.total>1?'s':'')));
  haut.appendChild(droite);
  div.appendChild(haut);
  if(l.client) div.appendChild(suiviEl('div','su-adresse',l.adresse));
  const dates=suiviEl('div','su-dates');
  l.dates.forEach(x=>{
    const p=suiviEl(x.manuel&&!x.app?'button':'span','su-date'+(x.manuel&&!x.app?' manuel':''),suiviDateCourte(x.jour,annee));
    if(x.manuel&&!x.app){
      p.type='button';
      p.title=x.manuel.note?('Noté à la main : '+x.manuel.note):'Noté à la main : toucher pour le retirer';
      p.setAttribute('aria-label','Date notée à la main, '+suiviDateCourte(x.jour,annee)+' : toucher pour la retirer');
      p.onclick=()=>suiviRetirerManuel(l,x);
    }
    dates.appendChild(p);
  });
  const plus=suiviEl('button','su-date su-plus','＋ date');
  plus.type='button';
  plus.setAttribute('aria-label','Ajouter une date pour '+suiviLibelle(l));
  plus.onclick=()=>suiviDialogueDate(l);
  dates.appendChild(plus);
  div.appendChild(dates);
  return div;
}

// ── Les choix de l'écran ────────────────────────────
async function suiviChoisirService(nom){
  if(nom===suiviService) return;
  suiviService=nom;
  suiviEcrire('lp_suivi_service',nom);
  const depuis=suiviDepuisDe(nom);
  if(suiviDonnees&&depuis!==suiviDonnees.depuis){
    // ce service a sa propre date de départ : on relit
    try{
      const d=await suiviCharger(depuis);
      if(d) suiviDonnees=d;
    }catch(e){toast('❌ Impossible de charger le suivi');}
  }
  renderSuiviAdmin();
}
async function suiviChangerDepuis(valeur){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(valeur||'')||valeur<'2000-01-01'){toast('⚠ Choisis une date de départ');renderSuiviAdmin();return;}
  suiviEcrire('lp_suivi_depuis_'+suiviService,valeur);
  try{
    const d=await suiviCharger(valeur);
    if(d) suiviDonnees=d;
  }catch(e){toast('❌ Impossible de charger le suivi');}
  renderSuiviAdmin();
}

// Le rythme du service : « tous les N jours » (1 à 365), ou vide (aucun)
async function suiviChoisirRythme(saisie,champ){
  const texte=String(saisie||'').trim();
  const v=texte===''?null:Number(texte);
  if(v!==null&&(!Number.isInteger(v)||v<1||v>365)){
    toast('⚠ Le rythme est un nombre de jours entre 1 et 365');
    const avant=suiviRythmeDe(suiviService);
    champ.value=avant===null?'':String(avant);
    return;
  }
  if(_suiviOccupe) return;
  if(!reseau.enLigne){toast('📴 Pas de réseau : le rythme ne peut pas être enregistré maintenant.');return;}
  _suiviOccupe=true;
  showSync(true);
  try{
    const r=await db.from('types_service').update({frequence_jours:v}).eq('nom',suiviService).select('nom');
    if(r&&r.error){
      toast(estErreurReseau(r.error)?'📴 Le signal a disparu : le rythme n’a pas été enregistré.':(suiviTableAbsente(r.error)?'❌ Le rythme n’est pas encore activé dans ta base (fichier SQL 28).':'❌ Le rythme n’a pas pu être enregistré.'));
      if(estErreurReseau(r.error)) signalerEchecReseau(r.error);
      const avant=suiviRythmeDe(suiviService);
      champ.value=avant===null?'':String(avant);
      return;
    }
    if(!r||!Array.isArray(r.data)||!r.data.length){
      toast('❌ Ce service n’est pas dans l’onglet Services : ajoute-le d’abord.');
      const avant=suiviRythmeDe(suiviService);
      champ.value=avant===null?'':String(avant);
      return;
    }
    suiviDonnees.rythmes[suiviService]=v;
    toast(v===null?'✔ Aucun rythme pour ce service':'✔ Rythme : tous les '+v+' jours');
    renderSuiviListe();
  }catch(e){
    toast('📴 Le signal a disparu : le rythme n’a pas été enregistré.');
    signalerEchecReseau(e);
  }finally{
    _suiviOccupe=false;
    showSync(false);
  }
}

// ── Les fenêtres (une seule feuille qui monte du bas, remplie selon le besoin) ──
function suiviOuvrirFeuille(titre){
  document.getElementById('suivi-feuille-titre').textContent=titre;
  const corps=document.getElementById('suivi-feuille-corps');
  corps.innerHTML='';
  document.getElementById('suivi-feuille-overlay').classList.add('open');
  return corps;
}
function suiviFermerFeuille(){
  document.getElementById('suivi-feuille-overlay').classList.remove('open');
}
function suiviBgFeuille(e){
  if(e.target===document.getElementById('suivi-feuille-overlay')) suiviFermerFeuille();
}
function suiviBoutons(corps,texteOk,onOk){
  const rang=suiviEl('div','su-boutons');
  const bNon=suiviEl('button','mb s','Annuler');
  bNon.type='button';
  bNon.onclick=suiviFermerFeuille;
  const bOk=suiviEl('button','mb p',texteOk);
  bOk.type='button';
  bOk.onclick=onOk;
  rang.appendChild(bNon);rang.appendChild(bOk);
  corps.appendChild(rang);
  return bOk;
}
function suiviChampDate(corps,libelle){
  const c=suiviEl('div','f');
  c.appendChild(suiviEl('label','',libelle));
  const i=suiviEl('input','');
  i.type='date';
  i.value=suiviAujourdhui();
  i.max=suiviAujourdhui();
  i.min='2000-01-01';
  c.appendChild(i);
  corps.appendChild(c);
  return i;
}
// Le jour saisi est-il bon ? (rempli, pas dans le futur, pas avant 2000) ; renvoie le texte du problème, ou null
function suiviProblemeDate(jour){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(jour||'')) return 'Choisis la date du passage.';
  if(jour>suiviAujourdhui()) return 'Cette date est dans le futur.';
  if(jour<'2000-01-01') return 'Cette date est trop ancienne.';
  return null;
}

// « ＋ date » : noter un passage à la main pour UN client
function suiviDialogueDate(l){
  const corps=suiviOuvrirFeuille('Ajouter un passage');
  corps.appendChild(suiviEl('div','su-cible',suiviLibelle(l)));
  const iDate=suiviChampDate(corps,'Date du passage');
  const cNote=suiviEl('div','f');
  cNote.appendChild(suiviEl('label','','Note (facultatif)'));
  const iNote=suiviEl('input','');
  iNote.type='text';iNote.maxLength=200;iNote.placeholder='ex : fait par un remplaçant';
  cNote.appendChild(iNote);
  corps.appendChild(cNote);
  suiviBoutons(corps,'Enregistrer',async()=>{
    const p=suiviProblemeDate(iDate.value);
    if(p){toast('⚠ '+p);return;}
    const nouveaux=await suiviEcrireDates([{stop_id:l.arretRef,jour:iDate.value,note:(iNote.value||'').trim()||null}]);
    if(nouveaux===null) return;
    if(nouveaux===0){toast('Cette date est déjà notée pour ce client.');return;}
    suiviFermerFeuille();
    toast('✔ Passage noté : '+suiviDateCourte(iDate.value,new Date().getFullYear()));
  });
}
// « ＋ Une date pour plusieurs clients » : le même jour pour tous les clients cochés (la liste montrée, filtre et recherche compris)
function suiviDialogueLot(){
  const lignes=suiviGrouper(suiviFiltrer(suiviLignes(),suiviFiltre,suiviRecherche)).flatMap(s=>s.lignes);
  if(!lignes.length){toast('Aucun client à cocher.');return;}
  const corps=suiviOuvrirFeuille('Une date pour plusieurs clients');
  const iDate=suiviChampDate(corps,'Date du passage');
  const cases=[];
  const rang=suiviEl('div','su-outils');
  const bTout=suiviEl('button','emp-btn','☑ Tout cocher');
  bTout.type='button';
  bTout.onclick=()=>{cases.forEach(c=>{c.input.checked=true;});majBoutonLot();};
  const bRien=suiviEl('button','emp-btn','☐ Tout décocher');
  bRien.type='button';
  bRien.onclick=()=>{cases.forEach(c=>{c.input.checked=false;});majBoutonLot();};
  rang.appendChild(bTout);rang.appendChild(bRien);
  corps.appendChild(rang);
  const liste=suiviEl('div','su-cases');
  let section=null;
  lignes.forEach(l=>{
    if(l.section!==section){section=l.section;liste.appendChild(suiviEl('div','su-cases-section',section));}
    const lab=suiviEl('label','su-case');
    const input=suiviEl('input','');
    input.type='checkbox';
    input.onchange=()=>majBoutonLot();
    lab.appendChild(input);
    lab.appendChild(suiviEl('span','',suiviLibelle(l)));
    liste.appendChild(lab);
    cases.push({l,input});
  });
  corps.appendChild(liste);
  const bOk=suiviBoutons(corps,'Enregistrer',async()=>{
    const p=suiviProblemeDate(iDate.value);
    if(p){toast('⚠ '+p);return;}
    const choisis=cases.filter(c=>c.input.checked).map(c=>c.l);
    if(!choisis.length){toast('⚠ Coche au moins un client.');return;}
    const nouveaux=await suiviEcrireDates(choisis.map(l=>({stop_id:l.arretRef,jour:iDate.value,note:null})));
    if(nouveaux===null) return;
    suiviFermerFeuille();
    const deja=choisis.length-nouveaux;
    toast('✔ '+nouveaux+' passage'+(nouveaux>1?'s':'')+' noté'+(nouveaux>1?'s':'')+(deja?' ('+deja+' déjà noté'+(deja>1?'s':'')+')':''));
  });
  function majBoutonLot(){
    const n=cases.filter(c=>c.input.checked).length;
    bOk.textContent=n?'Enregistrer ('+n+')':'Enregistrer';
  }
}

// Écrit des passages à la main. Renvoie le nombre de NOUVELLES dates (0 : toutes existaient déjà), ou null si rien n'a été enregistré (le message est déjà montré).
async function suiviEcrireDates(rows){
  if(_suiviOccupe) return null;
  if(!reseau.enLigne){toast('📴 Pas de réseau : les dates ne peuvent pas être enregistrées maintenant.');return null;}
  if(suiviDonnees&&suiviDonnees.manuelsDispo===false){toast('❌ Les dates à la main ne sont pas encore activées dans ta base (fichier SQL 28).');return null;}
  _suiviOccupe=true;
  showSync(true);
  try{
    // « ignorer ce qui existe déjà » : une date déjà notée pour ce client n'est ni doublée ni refusée
    const r=await db.from('passages_manuels').upsert(rows,{onConflict:'stop_id,jour',ignoreDuplicates:true}).select('id, stop_id, jour, note');
    if(r&&r.error){
      toast(estErreurReseau(r.error)?'📴 Le signal a disparu : rien n’a été enregistré.':(suiviTableAbsente(r.error)?'❌ Les dates à la main ne sont pas encore activées dans ta base (fichier SQL 28).':(r.error.code==='42501'?'❌ Accès refusé : réservé à l’administrateur.':'❌ Les dates n’ont pas pu être enregistrées.')));
      if(estErreurReseau(r.error)) signalerEchecReseau(r.error);
      return null;
    }
    const ajoutees=(r&&Array.isArray(r.data))?r.data:[];
    ajoutees.forEach(a=>{if(suiviDonnees&&a.jour>=suiviDonnees.depuis) suiviDonnees.manuels.push({id:a.id,stop_id:a.stop_id,jour:String(a.jour).slice(0,10),note:a.note||null});});
    renderSuiviListe();
    return ajoutees.length;
  }catch(e){
    toast('📴 Le signal a disparu : rien n’a été enregistré.');
    signalerEchecReseau(e);
    return null;
  }finally{
    _suiviOccupe=false;
    showSync(false);
  }
}

// Toucher une date notée à la main : la retirer (les dates des « Complété » ne se retirent pas ici)
async function suiviRetirerManuel(l,x){
  if(!x||!x.manuel) return;
  const quand=suiviDateCourte(x.jour,new Date().getFullYear());
  if(!(await confirmer('Retirer cette date ?',suiviLibelle(l)+' : le passage du '+quand+', noté à la main'+(x.manuel.note?' (« '+x.manuel.note+' »)':'')+', sera retiré.','Retirer','Garder'))) return;
  if(_suiviOccupe) return;
  if(!reseau.enLigne){toast('📴 Pas de réseau : la date ne peut pas être retirée maintenant.');return;}
  _suiviOccupe=true;
  showSync(true);
  try{
    const r=await db.from('passages_manuels').delete().eq('id',x.manuel.id).select('id');
    if(r&&r.error){
      toast(estErreurReseau(r.error)?'📴 Le signal a disparu : la date n’a pas été retirée.':'❌ La date n’a pas pu être retirée.');
      if(estErreurReseau(r.error)) signalerEchecReseau(r.error);
      return;
    }
    if(!r||!Array.isArray(r.data)||!r.data.length){toast('❌ La date n’a pas pu être retirée (déjà retirée, ou accès refusé).');return;}
    suiviDonnees.manuels=suiviDonnees.manuels.filter(m=>m.id!==x.manuel.id);
    renderSuiviListe();
    toast('🗑 Date retirée');
  }catch(e){
    toast('📴 Le signal a disparu : la date n’a pas été retirée.');
    signalerEchecReseau(e);
  }finally{
    _suiviOccupe=false;
    showSync(false);
  }
}

// Toucher le nom d'un client : toutes ses dates, avec qui et quel camion (lu à la demande)
async function suiviDialogueDetail(l){
  const corps=suiviOuvrirFeuille(l.client||l.adresse);
  if(l.client) corps.appendChild(suiviEl('div','su-cible',l.adresse));
  const chargement=suiviEl('div','su-message','Chargement…');
  corps.appendChild(chargement);
  const debutIso=new Date(Number(suiviDonnees.depuis.slice(0,4)),Number(suiviDonnees.depuis.slice(5,7))-1,Number(suiviDonnees.depuis.slice(8,10))).toISOString();
  let lignes=null;
  try{
    // les personnes et les camions viennent des tables liées ; si ce lien n'existe pas, on relit les dates seules
    let r=await db.from('passe_arrets').select('complete_le, utilisateurs!complete_par(nom), passes(equipes(nom))').in('stop_id',l.arretIds).gte('complete_le',debutIso).order('complete_le',{ascending:false});
    if(r.error) r=await db.from('passe_arrets').select('complete_le').in('stop_id',l.arretIds).gte('complete_le',debutIso).order('complete_le',{ascending:false});
    if(r.error) throw r.error;
    lignes=Array.isArray(r.data)?r.data:[];
  }catch(e){
    chargement.textContent='❌ Impossible de charger le détail.';
    return;
  }
  chargement.remove();
  const annee=new Date().getFullYear();
  const tout=[];
  lignes.forEach(x=>{
    const jour=suiviJourLocal(x.complete_le);
    const d=new Date(x.complete_le);
    const heure=suiviPad(d.getHours())+' h '+suiviPad(d.getMinutes());
    const qui=(x.utilisateurs&&x.utilisateurs.nom)||'';
    const camion=(x.passes&&x.passes.equipes&&x.passes.equipes.nom)||'';
    tout.push({jour,texte:suiviDateCourte(jour,annee)+', '+heure,detail:[qui,camion].filter(Boolean).join(' · ')||'Complété avec l’application'});
  });
  l.dates.filter(x=>x.manuel&&!x.app).forEach(x=>tout.push({jour:x.jour,texte:suiviDateCourte(x.jour,annee),detail:'Noté à la main'+(x.manuel.note?' : '+x.manuel.note:'')}));
  tout.sort((a,b)=>b.jour.localeCompare(a.jour));
  if(!tout.length){
    const depuis=suiviDateCourte(suiviDonnees.depuis,annee);
    corps.appendChild(suiviMessage('Aucun passage depuis le '+depuis+(depuis.endsWith('.')?'':'.')));   // (« janv. » finit déjà par un point)
  }
  tout.forEach(t=>{
    const rang=suiviEl('div','su-detail');
    rang.appendChild(suiviEl('span','',t.texte));
    rang.appendChild(suiviEl('span','su-detail-qui',t.detail));
    corps.appendChild(rang);
  });
  const rang=suiviEl('div','su-boutons');
  const bOk=suiviEl('button','mb s','Fermer');
  bOk.type='button';
  bOk.onclick=suiviFermerFeuille;
  rang.appendChild(bOk);
  corps.appendChild(rang);
}
