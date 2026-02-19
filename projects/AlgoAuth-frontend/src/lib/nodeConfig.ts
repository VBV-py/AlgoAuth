/**
 * Trustless Trio Node Configuration
 * X25519 public keys for encrypting Shamir shares to each node
 */

export interface NodeConfig {
    id: string
    name: string
    publicKey: string  // X25519 public key in base64
}

/**
 * Default Trustless Trio node configuration
 * In production, these public keys should be generated for each node
 * and the corresponding secret keys should be stored securely on each node's server
 */
export const TRUSTLESS_TRIO_NODES: NodeConfig[] = [
    {
        id: 'alpha',
        name: 'Node Alpha',
        publicKey: import.meta.env.VITE_NODE_ALPHA_PUBLIC_KEY || '',
    },
    {
        id: 'beta',
        name: 'Node Beta',
        publicKey: import.meta.env.VITE_NODE_BETA_PUBLIC_KEY || '',
    },
    {
        id: 'gamma',
        name: 'Node Gamma',
        publicKey: import.meta.env.VITE_NODE_GAMMA_PUBLIC_KEY || '',
    },
]

/**
 * Get a node config by ID
 */
export function getNodeConfig(nodeId: string): NodeConfig | undefined {
    return TRUSTLESS_TRIO_NODES.find((n) => n.id === nodeId)
}

/**
 * Get all node configs
 */
export function getAllNodeConfigs(): NodeConfig[] {
    return TRUSTLESS_TRIO_NODES
}
