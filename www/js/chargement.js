// js/chargement.js — Chargement des librairies, écran de chargement et erreurs
// (extrait de l'ancien index.html, aucun changement de code)
// ── Chargement séquentiel des scripts ──────────────────
function loadScript(src){
  return new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=src; s.onload=res; s.onerror=()=>rej(new Error('Impossible de charger: '+src));
    document.head.appendChild(s);
  });
}
function setStatus(t){ document.getElementById('load-status').textContent=t; }

function showErr(msg){
  document.getElementById('loading').classList.add('gone');
  document.getElementById('err-msg').innerHTML=msg;
  document.getElementById('err-screen').classList.add('show');
}

function hideLoading(){ document.getElementById('loading').classList.add('gone'); }
