// js/config.js — Configuration Supabase et variables globales
// (extrait de l'ancien index.html)
// ── APP ────────────────────────────────────────────────
const SUPA_URL='https://uxoxdauzcxjsefuoruwt.supabase.co';
const SUPA_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4b3hkYXV6Y3hqc2VmdW9ydXd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDgxOTksImV4cCI6MjA5MDQ4NDE5OX0.wkCtoY3_273C-XWx9c2hP2PIWOC1c1I_3sFjG9cN55A';

let db, map, stops=[], activeIdx=null, mkrs={};
let currentUser=null;   // {id, nom, role} de la personne connectée (Supabase Auth), sinon null

// Client « en cours » (étape 13c) : sa zone devient bleue quand un camion de son tour est sur place.
// Décision de Joé (19 septembre 2026) : 20 m. Les deux autres seuils évitent du bleu à cause d'un vieux point ou d'un GPS imprécis.
const RAYON_EN_COURS_M=20;         // le camion est à moins de 20 m de l'arrêt
const POSITION_PERIMEE_MIN=3;      // une position plus vieille que 3 minutes ne compte plus (le camion n'envoie plus)
const PRECISION_MAX_M=30;          // un GPS moins précis que 30 m ne peut pas dire « il est chez ce client »
const RELECTURE_POSITIONS_S=15;    // relecture de secours des positions (fait aussi expirer les positions périmées)
let operator=localStorage.getItem('lp_op')||'';
let zone=localStorage.getItem('lp_zone')||'';
let lastPos=null;
