/**
 * Algorand contract client helpers
 * Wraps typed app clients for FileRegistry and GroupRegistry
 */

import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { getAlgodConfigFromViteEnvironment } from '../utils/network/getAlgoClientConfigs'

// We'll use the App IDs from environment variables
const FILE_REGISTRY_APP_ID = BigInt(import.meta.env.VITE_FILE_REGISTRY_APP_ID || '0')
const GROUP_REGISTRY_APP_ID = BigInt(import.meta.env.VITE_GROUP_REGISTRY_APP_ID || '0')

let algorandClient: AlgorandClient | null = null

/**
 * Get or create the AlgorandClient
 */
export function getAlgorandClient(): AlgorandClient {
    if (!algorandClient) {
        const algodConfig = getAlgodConfigFromViteEnvironment()
        algorandClient = AlgorandClient.fromConfig({
            algodConfig: {
                server: algodConfig.server,
                port: algodConfig.port,
                token: algodConfig.token ?? '',
            },
        })
    }
    return algorandClient
}

/**
 * Get the File Registry App ID
 */
export function getFileRegistryAppId(): bigint {
    return FILE_REGISTRY_APP_ID
}

/**
 * Get the Group Registry App ID
 */
export function getGroupRegistryAppId(): bigint {
    return GROUP_REGISTRY_APP_ID
}

/**
 * Get the API base URL
 */
export function getApiBaseUrl(): string {
    return import.meta.env.VITE_API_BASE_URL || '/api'
}

/**
 * Make an authenticated API call
 */
export async function apiCall(
    path: string,
    options: RequestInit = {}
): Promise<Response> {
    const token = localStorage.getItem('blocksafe_jwt')
    const headers: Record<string, string> = {
        ...((options.headers || {}) as Record<string, string>),
    }
    if (token) {
        headers['Authorization'] = `Bearer ${token}`
    }
    if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json'
    }

    const baseUrl = getApiBaseUrl()
    return fetch(`${baseUrl}${path}`, {
        ...options,
        headers,
    })
}

/**
 * Get authenticated user's JWT
 */
export function getAuthToken(): string | null {
    return localStorage.getItem('blocksafe_jwt')
}

/**
 * Set JWT after authentication
 */
export function setAuthToken(token: string): void {
    localStorage.setItem('blocksafe_jwt', token)
}

/**
 * Clear JWT on logout
 */
export function clearAuthToken(): void {
    localStorage.removeItem('blocksafe_jwt')
}

/**
 * Check if user is authenticated (has JWT)
 */
export function isAuthenticated(): boolean {
    return !!localStorage.getItem('blocksafe_jwt')
}
