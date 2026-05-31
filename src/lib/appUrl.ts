// Central helper for resolving the app's public base URL.
//
// Magic-link auth redirects must point at the deployed site, not whatever
// origin happened to trigger the login flow (e.g. localhost during local
// development). We read an explicit env var for the production site URL and
// only fall back to `window.location.origin` when it is not configured.
//
//   VITE_APP_BASE_URL=https://bramptonpoc.netlify.app
export function getAppBaseUrl() {
  const configured = import.meta.env.VITE_APP_BASE_URL?.trim()
  if (configured) return configured.replace(/\/$/, '')
  return window.location.origin
}

export function getAuthRedirectUrl() {
  return `${getAppBaseUrl()}/app/dashboard`
}
