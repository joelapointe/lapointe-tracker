// Petit serveur local pour essayer les pages d'inscription aux textos (dossier site-consentement/) dans un navigateur :  node serveur-page-avis.mjs [port]
// Les pages sont cherchées d'abord dans site-consentement/, puis (styles, images, polices, scripts du thème) dans une COPIE du site de Joé :
//   variable SITE_WEB, sinon « Bureau\site web ». Les fichiers .php ne sont jamais servis. Sur localhost seulement.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const PAGES = path.resolve(fileURLToPath(new URL('../../site-consentement/', import.meta.url)));
const SITE = path.resolve(process.env.SITE_WEB || 'C:/Users/joebl/OneDrive/Bureau/site web');
const PORT = Number(process.argv[2]) || 8124;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject', '.gif': 'image/gif' };

function trouver(racine, url) {
  const fichier = path.resolve(racine, '.' + url);
  if (!fichier.startsWith(racine + path.sep)) return null;
  try { return fs.statSync(fichier).isFile() ? fichier : null; } catch { return null; }
}

http.createServer((req, rep) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const demande = url === '/' ? '/avis.html' : url;
  const fichier = path.extname(demande) in TYPES ? (trouver(PAGES, demande) || trouver(SITE, demande)) : null;
  if (!fichier) { rep.writeHead(404); return rep.end('Introuvable'); }
  rep.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)], 'Cache-Control': 'no-store' });
  fs.createReadStream(fichier).pipe(rep);
}).listen(PORT, '127.0.0.1', () => console.log(`Pages sur http://localhost:${PORT}/ (site-consentement/ puis ${SITE})`));
