"use strict";

const CACHE_NAME = "akademi-static-v212";
const STATIC_ASSETS = [
  "./assets/styles.css",
  "./assets/fontawesome/css/fontawesome.min.css",
  "./assets/fontawesome/css/solid.min.css",
  "./assets/fontawesome/webfonts/fa-solid-900.woff2",
  "./assets/app.js",
  "./assets/assessment-export.js",
  "./assets/presentation-follow.js",
  "./assets/presentation-follow.css",
  "./assets/assessment-rendering.js",
  "./assets/assessment-take.js",
  "./assets/assessment-take.css",
  "./assets/admin-settings.css",
  "./assets/icons.svg",
  "./assets/appearance.css",
  "./assets/theme.js",
  "./assets/notifications.css",
  "./assets/notifications.js",
  "./assets/icon.svg",
  "./manifest.webmanifest",
  "./assets/auth.css",
  "./assets/auth.js",
  "./assets/account-security.js",
  "./assets/admin-ai.js",
  "./assets/admin-shell.js",
  "./assets/admin-curriculum.js",
  "./assets/curriculum-resource-reader.js",
  "./assets/error-page.css",
  "./assets/error-page.js",
  "./assets/curriculum-resources.js",
  "./assets/admin-users.js",
  "./assets/ai-assistant.js",
  "./assets/ai-assistant.css",
  "./assets/data/ghana-admin-areas.json",
  "./assets/data/ghana-shs-subjects.json",
  "./assets/progress.js",
  "./assets/progress.css",
  "./assets/pdfjs/pdf.min.mjs",
  "./assets/pdfjs/pdf.worker.min.mjs"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  // Cache only public static assets; never cache HTML, authentication, or API responses.
  if (STATIC_ASSETS.some((asset) => new URL(asset, self.location.href).pathname === url.pathname)) {
    const response = caches.open(CACHE_NAME).then((cache) => cache.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((networkResponse) => {
        if (!networkResponse.ok) return networkResponse;
        return cache.put(request, networkResponse.clone()).then(() => networkResponse);
      });
    }));
    event.respondWith(response);
  }
});
