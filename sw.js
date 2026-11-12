'use strict';
const CACHE='student-timetable-shell-StdYG-daily-pair-v3.06';
const ASSETS=['./','./index.html','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('student-timetable-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 // 외부 API 응답은 서비스 워커에 저장하지 않습니다.
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>caches.match('./index.html')));
 else if(ASSETS.some(path=>new URL(path,self.registration.scope).href===url.href))event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));
});
