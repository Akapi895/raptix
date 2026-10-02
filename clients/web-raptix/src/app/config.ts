export const dataMode = import.meta.env.VITE_DATA_MODE === 'real' ? 'real' : 'mock'
export const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || '/api'
