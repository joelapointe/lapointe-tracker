// js/resume-passe.js — Le résumé de fin de passe (étape 14c)
//
// Quand MA passe se ferme sans que je l'aie demandé (100 % atteint, fermeture automatique après 12 h, autre camion qui complète le tour,
// administrateur), une carte le dit : le résultat, la durée et la raison. Après un « Terminer » de ma part : pas de résumé (la boîte de
// confirmation et le message suffisent). Le tour terminé, lui, reste affiché en vert sur la carte jusqu'à la prochaine passe (tours.js).
let _passeVue=null;           // la passe dont je suis chauffeur, telle que vue au dernier dessin (pour repérer sa fermeture)
let _resumeDemarrageFait=false;
const CLE_RESUME_VU='lp_resume_vu';   // passe + fin du dernier résumé lu (pour ne pas le remontrer au rechargement)
const COLONNES_PASSE='id, numero, tache, route_id, equipe_id, debut, fin, fin_type, fin_estimee, statut, nb_arrets_total, nb_arrets_faits, pourcentage';

// Appelé à chaque dessin du bandeau : si j'avais une passe et que je n'en ai plus, elle vient de se fermer
function suivreMaPasse(m){
  if(m){
    _passeVue={passeId:m.passe.passe_id,numero:m.tour.numero,tache:m.tour.tache,route_id:m.tour.route_id,equipe_id:m.passe.equipe_id,
      faits:m.tour.faits,total:m.tour.total,pourcentage:m.tour.pourcentage};
    return;
  }
  if(_passeVue){
    const v=_passeVue;
    _passeVue=null;
    afficherResume(v);
  }
}

// Lit la passe (les miennes sont lisibles) : sa fin, sa raison, sa durée. En cas d'échec de lecture, on montre ce qu'on savait.
async function afficherResume(v){
  let p=null;
  if(reseau.enLigne){   // sans signal la lecture ne répondrait pas : on montre ce que l'écran sait déjà
    try{
      const r=await db.from('passes').select(COLONNES_PASSE).eq('id',v.passeId).maybeSingle();
      if(!r.error) p=r.data||null;
    }catch(e){}
  }
  if(p&&p.statut==='en_cours') return;   // rouverte entre-temps (un arrêt annulé)
  // Pas de lecture du serveur : les chiffres sont ceux du tour affiché maintenant (il a pu changer depuis le dernier dessin : un arrêt complété sans réseau, par exemple)
  let typeLocal=null;
  if(!p){
    const t=tours.find(x=>x.route_id===v.route_id&&x.tache===v.tache&&!tourEnCours(x));
    if(t){
      v={...v,faits:t.faits,total:t.total,pourcentage:t.pourcentage};
      if(t.total>0&&t.faits>=t.total) typeLocal='complete';
    }
  }
  ouvrirResume(v,p,typeLocal);
}

// « 2 h 14 », « 35 min »
function dureeTexte(debut,fin){
  const a=Date.parse(debut),b=Date.parse(fin);
  if(!(a>0)||!(b>=a)) return '';
  const min=Math.round((b-a)/60000);
  if(min<60) return min+' min';
  return Math.floor(min/60)+' h '+String(min%60).padStart(2,'0');
}

function ouvrirResume(v,p,typeLocal){
  const pct=p?p.pourcentage:v.pourcentage;
  const faits=p?p.nb_arrets_faits:v.faits,total=p?p.nb_arrets_total:v.total;
  const type=p?p.fin_type:(typeLocal||null);
  const titres={complete:'🎉 Passe complétée : 100 %',manuelle:'■ Passe terminée',delai_max:'⏱ Passe fermée automatiquement',
    admin:'■ Passe terminée par l’administrateur',fin_quart:'■ Passe fermée avec ton quart',remplacee:'■ Passe remplacée par une nouvelle passe'};
  document.getElementById('resume-titre').textContent=titres[type]||'■ Passe terminée';
  document.getElementById('resume-pct').textContent=pourcentageDe({pourcentage:pct})+' %';
  const nom=nomVehiculeDe(p?p.equipe_id:v.equipe_id);
  const duree=p&&p.fin?dureeTexte(p.debut,p.fin):'';
  let h='<div>Passe n° '+esc(p?p.numero:v.numero)+' · '+esc(nomRoute(p?p.route_id:v.route_id))+'</div>'+
    '<div>'+esc(p?p.tache:v.tache)+' · '+esc(faits)+'/'+esc(total)+' arrêts</div>'+
    (duree?'<div>Durée : '+esc(duree)+(nom?' · 🚜 '+esc(nom):'')+'</div>':(nom?'<div>🚜 '+esc(nom)+'</div>':''));
  if(type==='delai_max') h+='<div class="resume-note">Aucune activité depuis longtemps : la fin est estimée. Joé pourra la corriger.</div>';
  if(type==='complete') h+='<div class="resume-note">Un arrêt complété par erreur ? Touche-le sur la carte : « Annuler » est offert pendant 10 minutes.</div>';
  h+='<div class="resume-note">Les arrêts faits restent verts sur la carte jusqu’à la prochaine passe.</div>';
  document.getElementById('resume-details').innerHTML=h;
  const o=document.getElementById('resume-overlay');
  o.setAttribute('data-cle',p?String(p.id)+'|'+String(p.fin):'');
  o.classList.add('open');
}

function fermerResume(){
  const o=document.getElementById('resume-overlay');
  const cle=o.getAttribute?o.getAttribute('data-cle'):'';
  if(cle) ecrireMemo(CLE_RESUME_VU,cle);
  o.classList.remove('open');
}

// Au démarrage de l'application : ma dernière passe s'est terminée il y a peu et je n'ai pas lu son résumé (rechargement, batterie…)
async function resumeAuDemarrage(){
  if(_resumeDemarrageFait||!currentUser) return;
  _resumeDemarrageFait=true;   // une seule fois par ouverture de l'application (loadStops est rappelée à chaque changement d'arrêt)
  try{
    if(maPasse()) return;
    const r=await db.from('passes').select(COLONNES_PASSE).eq('chauffeur_id',currentUser.id).order('debut',{ascending:false}).limit(1);
    const p=!r.error&&Array.isArray(r.data)?r.data[0]:null;
    if(!p||p.statut!=='terminee'||!p.fin) return;
    if(Date.now()-Date.parse(p.fin)>20*60000) return;                         // plus de 20 minutes : ce n'est plus une nouvelle
    if(lireMemo(CLE_RESUME_VU)===String(p.id)+'|'+String(p.fin)) return;      // déjà lu
    ouvrirResume({passeId:p.id,numero:p.numero,tache:p.tache,route_id:p.route_id,equipe_id:p.equipe_id,faits:p.nb_arrets_faits,total:p.nb_arrets_total,pourcentage:p.pourcentage},p);
  }catch(e){}
}
