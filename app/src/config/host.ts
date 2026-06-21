/** Host AA + options infra base URL (public, baked into client bundle). */
export const HOST_BASE_URL =
  (import.meta.env.VITE_HOST_BASE_URL as string | undefined) ?? 'http://127.0.0.1:8787'

export const LOCAL_CHAIN_ID = 31337
