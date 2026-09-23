// js/admin-export.js — Panneau administrateur, onglet « Export » (étape 19, morceau 5, partie B)
//
// L'export de paie (admin_export_paie, étape 9b) existe déjà côté serveur : heures par employé pour une période choisie,
// réparties par véhicule et par route. Rien à écrire ici (une lecture calculée seulement) : le principe « jamais d'écriture
// directe sur quarts/equipage_periodes/equipage_journal » (voir admin-quarts.js) ne s'applique pas, il n'y a pas d'écriture.
// L'export REFUSE de répondre tant qu'un quart de la période est « à valider » ou encore ouvert (le calcul serait faux) :
// d'où l'ordre dans le panneau — régler l'onglet Quarts avant de générer un export.
//
// Les champs de date et la zone de résultat sont créés PAR renderExportAdmin() et gardés par FERMETURE (comme le champ de
// chaque réglage, admin-reglages.js) plutôt que retrouvés par document.getElementById : ils n'existent que le temps de cet
// onglet, jamais dans le HTML figé de la page.
let exportPaieAdmin=null;      // la dernière réponse « ok » du serveur (pour le bouton « Télécharger »), remise à null si refusée
let _periodeExportAdmin=null;  // {debut, fin} (texte des champs, pour le nom du fichier téléchargé)

function chargerExportAdmin(){
  renderExportAdmin();
}

// Par défaut : les 14 derniers jours (une paie aux deux semaines est courante) — Joé change les dates s'il veut autre chose.
function periodeExportParDefaut(){
  const p=n=>String(n).padStart(2,'0');
  const d=x=>x.getFullYear()+'-'+p(x.getMonth()+1)+'-'+p(x.getDate());
  const fin=new Date();
  const debut=new Date(fin);
  debut.setDate(debut.getDate()-14);
  return {debut:d(debut),fin:d(fin)};
}

function renderExportAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  const def=periodeExportParDefaut();

  const zone=document.createElement('div');
  zone.style.cssText='padding:12px 16px;';

  const champDebut=document.createElement('div');
  champDebut.className='f';
  const labelDebut=document.createElement('label');
  labelDebut.textContent='Du';
  const debutInput=document.createElement('input');
  debutInput.type='date';
  debutInput.value=def.debut;
  champDebut.appendChild(labelDebut);
  champDebut.appendChild(debutInput);
  zone.appendChild(champDebut);

  const champFin=document.createElement('div');
  champFin.className='f';
  const labelFin=document.createElement('label');
  labelFin.textContent='Au (inclus)';
  const finInput=document.createElement('input');
  finInput.type='date';
  finInput.value=def.fin;
  champFin.appendChild(labelFin);
  champFin.appendChild(finInput);
  zone.appendChild(champFin);

  body.appendChild(zone);

  const resultat=document.createElement('div');

  const btGen=document.createElement('button');
  btGen.type='button';
  btGen.className='lf-btn nouveau';
  btGen.style.cssText='width:calc(100% - 32px);margin:4px 16px 12px;';
  btGen.textContent='📊 Générer';
  btGen.onclick=()=>genererExportAdmin(debutInput,finInput,resultat);
  body.appendChild(btGen);

  body.appendChild(resultat);
}

function messageErreurExport(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : réessaie plus tard.';
  return '❌ '+((error&&error.message)||'Une erreur est survenue.');
}

async function genererExportAdmin(debutInput,finInput,resultat){
  const debutVal=debutInput.value;
  const finVal=finInput.value;
  if(!debutVal||!finVal){toast('⚠ Choisis une période');return;}
  const debut=new Date(debutVal+'T00:00:00');
  // « Au » est INCLUS à l'écran : la borne envoyée au serveur est le lendemain minuit (admin_export_paie compare avec <)
  const finExclusive=new Date(finVal+'T00:00:00');
  finExclusive.setDate(finExclusive.getDate()+1);
  if(!(finExclusive.getTime()>debut.getTime())){toast('⚠ La date de fin doit être après (ou égale à) la date de début');return;}
  _periodeExportAdmin={debut:debutVal,fin:finVal};
  showSync(true);
  let data=null,error=null;
  try{
    const r=await db.rpc('admin_export_paie',{p_debut:debut.toISOString(),p_fin:finExclusive.toISOString()});
    data=r.data;error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurExport(error));return;}
  if(!data||!data.statut){toast('❌ Réponse illisible du serveur');return;}
  if(data.statut==='refuse'){exportPaieAdmin=null;afficherRefusExport(data,resultat);return;}
  if(data.statut!=='ok'){toast('❌ Impossible de générer l’export');return;}
  exportPaieAdmin=data;
  afficherResultatExport(data,resultat);
}

function afficherRefusExport(data,resultat){
  resultat.innerHTML='';
  const noms=(data.quarts||[]).map(x=>x.employe).filter((v,i,a)=>a.indexOf(v)===i).join(', ');
  const div=document.createElement('div');
  div.style.cssText='padding:12px;color:#fb923c;font-size:13px;background:rgba(251,146,60,.08);border-radius:8px;margin:0 16px;';
  if(data.raison==='quarts_a_valider'){
    div.textContent='⚠ Export refusé : '+(data.quarts||[]).length+' quart(s) à valider dans cette période ('+noms+'). Règle-les dans l’onglet « Quarts » avant de générer l’export.';
  }else if(data.raison==='quarts_ouverts'){
    div.textContent='⚠ Export refusé : '+(data.quarts||[]).length+' quart(s) encore ouverts (pas terminés) dans cette période ('+noms+'). Attends qu’ils soient fermés.';
  }else{
    div.textContent='⚠ Export refusé.';
  }
  resultat.appendChild(div);
  if(data.raison==='quarts_a_valider'){
    const btAller=document.createElement('button');
    btAller.type='button';
    btAller.className='emp-btn';
    btAller.style.cssText='margin:8px 16px 0;';
    btAller.textContent='Aller à l’onglet Quarts';
    btAller.onclick=()=>changerOngletAdmin('quarts');
    resultat.appendChild(btAller);
  }
}

function afficherResultatExport(data,resultat){
  resultat.innerHTML='';
  const employes=data.employes||[];

  const av=data.avertissements&&data.avertissements.periodes_equipage_a_verifier;
  if(av>0){
    const warn=document.createElement('div');
    warn.style.cssText='padding:6px 16px;color:#fb923c;font-size:12px;';
    warn.textContent='⚠ '+av+' période(s) d’équipage à vérifier — voir l’onglet Quarts.';
    resultat.appendChild(warn);
  }

  if(!employes.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucune heure pour cette période.';
    resultat.appendChild(vide);
    return;
  }

  employes.forEach(e=>{
    const div=document.createElement('div');
    div.className='emp-item';
    const info=document.createElement('div');
    info.className='emp-info';
    const nom=document.createElement('div');
    nom.className='emp-nom';
    nom.textContent=e.nom;
    const detail=document.createElement('div');
    detail.className='emp-detail';
    detail.style.whiteSpace='pre-line';
    let texte=e.heures+' h · '+e.quarts+' quart'+(e.quarts>1?'s':'');
    (e.repartition||[]).forEach(r=>{texte+='\n· '+r.vehicule+' / '+r.route+' : '+r.heures+' h';});
    if(e.hors_equipage>0) texte+='\n· Hors équipage : '+e.hors_equipage+' h';
    detail.textContent=texte;
    info.appendChild(nom);
    info.appendChild(detail);
    div.appendChild(info);
    resultat.appendChild(div);
  });

  const btDl=document.createElement('button');
  btDl.type='button';
  btDl.className='lf-btn';
  btDl.style.cssText='width:calc(100% - 32px);margin:12px 16px;';
  btDl.textContent='⬇ Télécharger (CSV)';
  btDl.onclick=telechargerExportPaieCsv;
  resultat.appendChild(btDl);
}

// ── Le CSV : une fonction PURE (testable) qui construit le texte, séparée du déclenchement du téléchargement (navigateur) ──
function csvChamp(v){
  const s=String(v==null?'':v);
  return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}
function csvExportPaie(data){
  const lignes=[['Employé','Total heures','Quarts','Véhicule','Route','Heures']];
  (data.employes||[]).forEach(e=>{
    const rep=e.repartition||[];
    rep.forEach(r=>{lignes.push([e.nom,e.heures,e.quarts,r.vehicule,r.route,r.heures]);});
    if(e.hors_equipage>0) lignes.push([e.nom,e.heures,e.quarts,'','Hors équipage',e.hors_equipage]);
    if(!rep.length&&!(e.hors_equipage>0)) lignes.push([e.nom,e.heures,e.quarts,'','','']);
  });
  return lignes.map(l=>l.map(csvChamp).join(',')).join('\r\n');
}
function telechargerExportPaieCsv(){
  if(!exportPaieAdmin||!_periodeExportAdmin) return;
  const csv='﻿'+csvExportPaie(exportPaieAdmin);   // le BOM : Excel ouvre les accents correctement
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download='paie_'+_periodeExportAdmin.debut+'_au_'+_periodeExportAdmin.fin+'.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
