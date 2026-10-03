// Captures d'écran de la page de DÉMONSTRATION (serveur-demo-pc.mjs) avec Edge ou Chrome SANS fenêtre — le navigateur du volet n'est pas nécessaire.
//   node capturer-demo.mjs "sortie.png|étapes|largeur|hauteur" ["sortie2.png|étapes|largeur|hauteur" …]
// Exemple : node capturer-demo.mjs "clients.png|admin;onglet:clients|1440|900" "avis.png|admin;onglet:clients;clic:Avis aux clients|1920|1080"
// Les « étapes » sont celles de demo-pc-fausse-base.js (admin ; onglet:<id> ; clic:<texte> ; attente:<ms> ; js:<code>). Le serveur doit déjà tourner
// (preview_start « demo-pc », port 8126 ; l'adresse de base se change avec la variable d'environnement DEMO_URL).
// Le navigateur est piloté par le protocole DevTools (WebSocket de Node) : on attend que la page ait fini ses étapes (titre « demo-pret »), puis on photographie.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.DEMO_URL || 'http://localhost:8126/';
const CANDIDATS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const exe = CANDIDATS.find((c) => fs.existsSync(c));
if (!exe) { console.error('Ni Edge ni Chrome trouvé.'); process.exit(2); }

const jobs = process.argv.slice(2).map((a) => {
  const [sortie, etapes = '', l = '1440', h = '900'] = a.split('|');
  return { sortie: path.resolve(sortie), etapes, largeur: Number(l) || 1440, hauteur: Number(h) || 900 };
});
if (!jobs.length) { console.error('Usage : node capturer-demo.mjs "sortie.png|étapes|largeur|hauteur" …'); process.exit(2); }

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9300 + Math.floor(Math.random() * 500);
const profil = fs.mkdtempSync(path.join(os.tmpdir(), 'capturer-demo-'));
const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${profil}`, 'about:blank'], { stdio: 'ignore' });

async function cible() {
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json`);
      const l = await r.json();
      const p = l.find((x) => x.type === 'page');
      if (p) return p.webSocketDebuggerUrl;
    } catch { /* le navigateur démarre */ }
    await attendre(150);
  }
  throw new Error('Le navigateur ne répond pas.');
}

let code = 0;
try {
  const ws = new WebSocket(await cible());
  await new Promise((ok, ko) => { ws.onopen = ok; ws.onerror = () => ko(new Error('WebSocket refusé')); });
  let n = 0; const attente = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && attente.has(d.id)) { const { ok, ko } = attente.get(d.id); attente.delete(d.id); d.error ? ko(new Error(d.error.message)) : ok(d.result); } };
  const envoyer = (method, params = {}) => new Promise((ok, ko) => { const id = ++n; attente.set(id, { ok, ko }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluer = async (expression) => (await envoyer('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  await envoyer('Page.enable');

  for (const job of jobs) {
    const telephone = job.largeur <= 500;   // une largeur de téléphone : écran tactile, pixels doublés
    await envoyer('Emulation.setDeviceMetricsOverride', { width: job.largeur, height: job.hauteur, deviceScaleFactor: telephone ? 2 : 1, mobile: telephone });
    await envoyer('Page.navigate', { url: BASE + (job.etapes ? '?etapes=' + encodeURIComponent(job.etapes) : '') });
    let titre = '';
    const fin = Date.now() + 40000;
    while (Date.now() < fin) {
      await attendre(300);
      try { titre = await evaluer('document.title'); } catch { titre = ''; }
      if (!job.etapes || titre === 'demo-pret' || titre === 'demo-echec') break;
    }
    // Plus aucune animation en cours au moment de la photo
    await evaluer("(()=>{const s=document.createElement('style');s.textContent='*{animation:none!important;transition:none!important}';document.head.appendChild(s);return 1})()");
    await attendre(400);
    const img = await envoyer('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(job.sortie, Buffer.from(img.data, 'base64'));
    console.log(`${titre === 'demo-echec' ? 'ÉCHEC DES ÉTAPES' : 'ok'} : ${job.sortie} (${job.largeur}x${job.hauteur})`);
    if (titre !== 'demo-pret' && job.etapes) { console.log('  attention : la page n\'a pas fini ses étapes (titre = « ' + titre + ' »)'); code = 1; }
  }
  ws.close();
} catch (e) {
  console.error('Erreur : ' + e.message);
  code = 1;
} finally {
  proc.kill();
  await attendre(500);
  try { fs.rmSync(profil, { recursive: true, force: true }); } catch { /* Windows garde parfois un fichier ouvert */ }
}
process.exit(code);
