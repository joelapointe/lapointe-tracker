// js/icones-taches.js — La banque d'icônes des TÂCHES (demande 2 de Joé, 29 septembre 2026)
//
// Décisions de Joé : l'icône d'un camion sur la carte dépend de la TÂCHE qu'il fait (le type de service : coupe de gazon → tondeuse, déneigement → tracteur, engrais →
// épandeur, sel → camion…), PAS du véhicule conduit ; une BANQUE d'icônes, et l'ADMINISTRATEUR choisit laquelle est reliée à chaque tâche (onglet « Services »,
// admin-types-service.js) ; pendant MA passe, un seul marqueur : mon camion, à ma position (vehicules.js). La base ne garde que la CLÉ de l'icône choisie
// (types_service.icone, fichier SQL 27) ; tant que rien n'est choisi, l'icône est DÉDUITE DU NOM de la tâche (iconeParNom).
// Les icônes sont DESSINÉES ICI : il n'existe pas d'émoji de tondeuse, et un dessin a le même aspect sur tous les téléphones, hors réseau aussi (aucune licence à traîner).
// Du TRAIT de la couleur du texte (« currentColor » : celle de l'étiquette du camion) dans une boîte de 48 × 32 ; ico-f = un remplissage de la couleur du fond (une roue cache
// les lignes derrière elle) ; ico-p = un point plein. Le style est dans style.css (.ico). Une clé est en minuscules sans accent, chiffres et tirets (la base le vérifie aussi).
const ICONE_GENERIQUE='vus';
const ICONES_TACHES={
  'tracteur':{nom:'Tracteur',svg:
    '<circle class="ico-f" cx="14" cy="21" r="8.2"/><circle cx="14" cy="21" r="2.4"/><circle class="ico-f" cx="38" cy="24.5" r="4.2"/>'+
    '<path d="M8.5 14.5 L10.3 5 H21 L23 12"/><path d="M22 12 H40 L43.5 17 V21 H22"/><path d="M35 12 V6"/><path d="M25.5 21 H33.5"/>'},
  'pickup-lame':{nom:'Pick-up avec lame',svg:
    '<path d="M2 22 V14 H18 V9 H29 L34 14 H41 V22 Z"/><path d="M21 14 V10.5 H28 L31.5 14 Z"/><path d="M44 11 H47 L46 24 H43 Z"/>'+
    '<circle class="ico-f" cx="11" cy="23" r="4.6"/><circle class="ico-f" cx="33" cy="23" r="4.6"/>'},
  'camion-benne':{nom:'Camion (sel, benne)',svg:
    '<path d="M2 6 H26 V22 H2 Z"/><path d="M26 11 H36 L43 18 V22 H26"/><path d="M29 13.5 H35 L38.5 18 H29 Z"/>'+
    '<circle class="ico-f" cx="9" cy="24" r="4.2"/><circle class="ico-f" cx="19" cy="24" r="4.2"/><circle class="ico-f" cx="36" cy="24" r="4.2"/>'},
  'epandeur':{nom:'Épandeur',svg:
    '<path d="M12 6 H33 L27.5 17 H17.5 Z"/><path d="M15.5 17 H29.5"/><path d="M22.5 17 V21"/><circle class="ico-f" cx="22.5" cy="25" r="4.4"/><path d="M33 8 L43 4 V11"/>'+
    '<circle class="ico-p" cx="9" cy="22" r="1.5"/><circle class="ico-p" cx="5" cy="26" r="1.5"/><circle class="ico-p" cx="12" cy="27" r="1.5"/><circle class="ico-p" cx="6" cy="20" r="1.3"/>'},
  'zero-turn':{nom:'Tondeuse zéro-turn',svg:
    '<path d="M12 20 H43 Q45.5 20 45.5 22.5 V26 H12 Z"/><path d="M41 20 V16 H46.5"/><path d="M8.5 8 V15.5 H21.5 V20"/><path d="M25 20 L26.5 8.5 M30.5 20 L33.5 9.5"/>'+
    '<circle class="ico-p" cx="26.5" cy="7.2" r="1.9"/><circle class="ico-p" cx="33.7" cy="8.3" r="1.9"/>'+
    '<circle class="ico-f" cx="12" cy="22" r="8"/><circle cx="12" cy="22" r="2.3"/><circle class="ico-f" cx="41" cy="28" r="2.8"/>'},
  'tondeuse':{nom:'Tondeuse',svg:
    '<path d="M15 18 H39 L37 25 H15 Z"/><path d="M15 18 L6 5 H2"/><circle class="ico-f" cx="19" cy="26.5" r="3.2"/><circle class="ico-f" cx="34" cy="26.5" r="3.2"/>'+
    '<path d="M41 13 L44 8 M44 17 L47 13 M42 22 H47"/>'},
  'souffleuse':{nom:'Souffleuse à neige',svg:
    '<rect x="5" y="20" width="25" height="9.5" rx="4.75"/><circle cx="10.5" cy="24.75" r="1.7"/><circle cx="24.5" cy="24.75" r="1.7"/>'+
    '<path d="M8 20 V14 Q8 11.5 10.5 11.5 H29 V20"/><path d="M30 12.5 H43.5 V27.5 H30 Z"/><path d="M33.7 12.5 V27.5 M37.3 12.5 V27.5 M40.7 12.5 V27.5"/>'+
    '<path d="M37.5 12.5 V6 H44.5"/><path d="M8.5 13 L3.5 4 H1"/><circle class="ico-p" cx="46" cy="3.6" r="1.3"/><circle class="ico-p" cx="46.8" cy="9" r="1.2"/>'},
  'pelle':{nom:'Pelle à neige',svg:
    '<path d="M4 28 L24 17"/><path d="M2 24.5 L7 30"/><g transform="rotate(-32 34 16)"><rect x="24" y="8" width="21" height="16" rx="3.5"/><path d="M24 12.5 H45"/></g>'+
    '<circle class="ico-p" cx="30" cy="4.5" r="1.4"/><circle class="ico-p" cx="36" cy="2.6" r="1.2"/>'},
  'souffleur':{nom:'Souffleur à feuilles',svg:
    '<path d="M3 11 H18 V25 H3 Z"/><path d="M6 11 V5.5 H15 V11"/><path d="M18 14.5 H33 L44 21.5 L41 26 L31 20.5 H18"/><path d="M38 8 H46.5 M35 12 H44"/><path d="M8 18 H13"/>'},
  'feuille-erable':{nom:'Feuille d’érable',svg:
    '<path d="M24 2 L27.2 8.2 L30.6 6.4 L31.4 12.6 L37.5 8.6 L35.6 16.4 L41.5 17.6 L35.4 22.8 L36.6 26.6 L28.4 24.6 L25.6 26 H22.4 L19.6 24.6 L11.4 26.6 L12.6 22.8 L6.5 17.6 L12.4 16.4 L10.5 8.6 L16.6 12.6 L17.4 6.4 L20.8 8.2 Z"/>'+
    '<path d="M24 26 V30.5"/>'},
  'paysager':{nom:'Brouette et râteau',svg:
    '<path d="M16 10 H38 L33.5 19.5 H20.5 Z"/><path d="M18 10 C20 5.5 24 4.5 27 6.5 C30 4.5 34 5.5 36 10"/><path d="M28.5 6.5 L31 1.8"/><path d="M17.5 12.5 L12.5 16.5"/>'+
    '<path d="M21.5 19.5 L20 27.5 M17.5 27.5 H22.5"/><path d="M34.5 18.5 L41.5 22.5"/><circle class="ico-f" cx="41.5" cy="23" r="4.6"/>'+
    '<path d="M3.5 3.5 L8.5 24"/><path d="M4.5 25.5 H14.5 M6 25.5 V29.5 M9 25.5 V29.5 M12 25.5 V29.5"/>'},
  'camionnette':{nom:'Camionnette',svg:
    '<path d="M2 23.5 V8 H27 V23.5 Z"/><path d="M27 12 H36 L43.5 19 V23.5 H27"/><path d="M30 14.5 H35 L38 19 H30 Z"/>'+
    '<circle class="ico-f" cx="11" cy="24.5" r="4.2"/><circle class="ico-f" cx="36" cy="24.5" r="4.2"/>'},
  'vus':{nom:'Véhicule',svg:
    '<path d="M3 23 V16 L9.5 9.5 H30 L37 16 H44 V23 Z"/><path d="M12 12.5 H21 V16 H9 Z M24 12.5 H29 L33 16 H24 Z"/>'+
    '<circle class="ico-f" cx="12" cy="24" r="4.4"/><circle class="ico-f" cx="34" cy="24" r="4.4"/>'},
};

function estCleIcone(cle){return typeof cle==='string'&&Object.prototype.hasOwnProperty.call(ICONES_TACHES,cle);}
function clesIcones(){return Object.keys(ICONES_TACHES);}
function nomIcone(cle){return estCleIcone(cle)?ICONES_TACHES[cle].nom:ICONES_TACHES[ICONE_GENERIQUE].nom;}

// L'icône dessinée (du SVG en ligne : il prend la couleur du texte). Une clé inconnue donne l'icône générique. « classe » : une classe de style de l'appelant (jamais du texte de la base).
function svgIcone(cle,classe){
  const i=ICONES_TACHES[estCleIcone(cle)?cle:ICONE_GENERIQUE];
  return '<svg class="ico'+(classe?' '+classe:'')+'" viewBox="0 0 48 32" aria-hidden="true" focusable="false">'+i.svg+'</svg>';
}

// L'icône DÉDUITE du nom de la tâche, quand l'administrateur n'en a pas choisi : la PREMIÈRE règle qui correspond gagne (le nom est mis en minuscules, sans accents).
// « Épandage de sel » passe avant « épandage » (le sel se répand avec un camion, l'engrais avec un épandeur) ; « déneigement manuel » avant « déneigement ».
const ICONES_PAR_NOM=[
  [/\bsel\b|\bsable\b|abrasif|fondant|deglac/,'camion-benne'],
  [/engrais|fertilis|epandeur|epandage|semence|ensemenc|chaux/,'epandeur'],
  [/gazon|tonte|tondre|tondeuse|pelouse/,'zero-turn'],
  [/feuille|feuillage|automne/,'feuille-erable'],
  [/paysag|jardin|haie|plates?.?bandes?|elagage|desherb|paillis|terreau/,'paysager'],
  [/neige.*(manuel|main|pelle)|(manuel|main|pelle).*neige/,'souffleuse'],   // (« déneigement » contient « neige »)
  [/neige|souffl/,'tracteur'],
];
function iconeParNom(nom){
  const t=String(nom==null?'':nom).normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();   // NFD sépare la lettre de son accent ; \p{M} = les accents (marques combinantes)
  const r=ICONES_PAR_NOM.find(x=>x[0].test(t));
  return r?r[1]:ICONE_GENERIQUE;
}

// Les icônes CHOISIES par l'administrateur : « nom du type de service » -> clé (lues de types_service par chargerTypesService, liste-arrets.js ; gardées pour le hors réseau).
let iconesTachesChoisies={};
function installerIconesTaches(lignes){
  const m={};
  (Array.isArray(lignes)?lignes:[]).forEach(l=>{if(l&&typeof l.nom==='string'&&estCleIcone(l.icone)) m[l.nom]=l.icone;});
  iconesTachesChoisies=m;
}
async function restaurerIconesTaches(){
  const c=await cacheLire('iconesTaches');
  if(c&&Array.isArray(c.data)) installerIconesTaches(c.data);
}

// L'icône d'une tâche : celle que l'administrateur a choisie, sinon celle que le nom laisse deviner
function iconeDeTache(tache){
  const choisie=Object.prototype.hasOwnProperty.call(iconesTachesChoisies,tache)?iconesTachesChoisies[tache]:null;
  return estCleIcone(choisie)?choisie:iconeParNom(tache);
}
