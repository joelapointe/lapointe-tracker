// js/utilitaires.js — Petits outils : indicateur de synchro et messages (toast)
// (extrait de l'ancien index.html)
	function showSync(on){document.getElementById('sync').classList.toggle('show',on);}
let _tT;
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(_tT);_tT=setTimeout(()=>el.classList.remove('show'),2500);
}

// ── SÉCURITÉ : insertion de texte dans du HTML ─────────
// À utiliser sur TOUT texte venant de la base de données ou d'un utilisateur
// avant de le mettre dans innerHTML, un popup Leaflet ou un divIcon.
// Sans ça, un nom comme <img src=x onerror=...> exécuterait du code.
function esc(v){
  return String(v==null?'':v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
// N'accepte qu'une couleur de type #c8e63c (sinon la couleur par défaut).
function couleurSure(c){
  return /^#[0-9a-fA-F]{3,8}$/.test(String(c||''))?c:'#c8e63c';
}

// ── CONFIRMATION (remplace la fenêtre native « confirm() ») ──
// La fenêtre native est refusée d'office par certains navigateurs intégrés et WebView (elle répond « non » sans rien afficher) :
// le bouton ne « marchait » alors pas. Cette boîte fait partie de l'application, avec de gros boutons pour un doigt.
// Utilisation :  if(!(await confirmer('Se déconnecter ?','Tu devras retaper ton NIP.','Se déconnecter','Annuler')))return;
// Le bouton par défaut (Entrée) est « Annuler » : un geste involontaire ne confirme jamais rien.
let _fermerConfirmation=null;   // ferme la boîte ouverte (réponse « non ») si une autre s'ouvre par-dessus
function confirmer(titre,texte,libelleOui,libelleNon){
  return new Promise(resolve=>{
    if(_fermerConfirmation) _fermerConfirmation(false);
    const ancienne=document.getElementById('confirm-overlay');
    if(ancienne) ancienne.remove();
    const fond=document.createElement('div');
    fond.id='confirm-overlay';
    fond.setAttribute('role','dialog');
    fond.setAttribute('aria-modal','true');
    const boite=document.createElement('div');
    boite.id='confirm-boite';
    const t=document.createElement('div');
    t.id='confirm-titre'; t.textContent=titre||'Confirmer ?';
    boite.appendChild(t);
    if(texte){
      const p=document.createElement('div');
      p.id='confirm-texte'; p.textContent=texte;
      boite.appendChild(p);
    }
    const zone=document.createElement('div');
    zone.id='confirm-boutons';
    const oui=document.createElement('button');
    oui.type='button'; oui.className='confirm-btn oui'; oui.textContent=libelleOui||'Confirmer';
    const non=document.createElement('button');
    non.type='button'; non.className='confirm-btn non'; non.textContent=libelleNon||'Annuler';
    zone.appendChild(oui); zone.appendChild(non);
    boite.appendChild(zone);
    fond.appendChild(boite);
    let fini=false;
    function fermer(reponse){
      if(fini) return;
      fini=true;
      if(_fermerConfirmation===fermer) _fermerConfirmation=null;
      document.removeEventListener('keydown',surTouche);
      fond.remove();
      resolve(reponse);
    }
    _fermerConfirmation=fermer;
    function surTouche(e){ if(e.key==='Escape') fermer(false); }
    oui.addEventListener('click',()=>fermer(true));
    non.addEventListener('click',()=>fermer(false));
    fond.addEventListener('click',e=>{ if(e.target===fond) fermer(false); });   // toucher en dehors = annuler
    document.addEventListener('keydown',surTouche);
    document.body.appendChild(fond);
    non.focus();
  });
}
