export function registerPWA() {
  if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const ready = await navigator.serviceWorker.ready;
      const urls = [
        location.href,
        ...performance.getEntriesByType("resource").map((entry) => entry.name),
      ];
      ready.active?.postMessage({ type: "CACHE_URLS", urls });
      registration.update();
    } catch (error) {
      console.warn("PWA indisponível", error);
    }
  }, { once: true });
}
