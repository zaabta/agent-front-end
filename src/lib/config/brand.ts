export const appConfig = {
  name: import.meta.env.VITE_APP_NAME || 'SitePilot AI',
  // In dev, an empty value uses the Vite /api and /health proxy. Production must set a browser-reachable API URL.
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') || '',
  direction: 'ltr' as const,
}
