// Public GA4 configuration for the Perkusi.com Web stream.
export const measurementId = 'G-G9ETDLX4XP';

export function initAnalytics() {
  if (!import.meta.env.PROD || !['perkusi.com', 'www.perkusi.com'].includes(location.hostname) || !measurementId) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId, { allow_google_signals: false, allow_ad_personalization_signals: false });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.append(script);
}
