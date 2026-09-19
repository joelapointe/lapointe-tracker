// js/utilitaires.js — Petits outils : indicateur de synchro et messages (toast)
// (extrait de l'ancien index.html, aucun changement de code)
	function showSync(on){document.getElementById('sync').classList.toggle('show',on);}
let _tT;
function toast(msg){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  clearTimeout(_tT);_tT=setTimeout(()=>el.classList.remove('show'),2500);
}
