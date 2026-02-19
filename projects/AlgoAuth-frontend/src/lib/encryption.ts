/**
 * AES-256-GCM Encryption using Web Crypto API
 * Used for encrypting files before uploading to IPFS (Pinata)
 */

/**
 * Generate a random AES-256 key
 */
export async function generateAESKey(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    )
}

/**
 * Export AES key to raw bytes
 */
export async function exportAESKey(key: CryptoKey): Promise<Uint8Array> {
    const raw = await crypto.subtle.exportKey('raw', key)
    return new Uint8Array(raw)
}

/**
 * Import AES key from raw bytes
 */
export async function importAESKey(keyBytes: Uint8Array): Promise<CryptoKey> {
    return crypto.subtle.importKey(
        'raw',
        keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    )
}

/**
 * Encrypt data with AES-256-GCM
 * Returns: IV (12 bytes) + ciphertext
 */
export async function encryptAES(
    data: Uint8Array,
    key: CryptoKey
): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    )
    // Prepend IV to ciphertext
    const result = new Uint8Array(iv.length + ciphertext.byteLength)
    result.set(iv, 0)
    result.set(new Uint8Array(ciphertext), iv.length)
    return result
}

/**
 * Decrypt AES-256-GCM data
 * Input: IV (12 bytes) + ciphertext
 */
export async function decryptAES(
    data: Uint8Array,
    key: CryptoKey
): Promise<Uint8Array> {
    const iv = data.slice(0, 12)
    const ciphertext = data.slice(12)
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer
    )
    return new Uint8Array(plaintext)
}

/**
 * Encrypt a file (ArrayBuffer) with AES-256-GCM
 * Returns the encrypted bytes and the raw key bytes
 */
export async function encryptFile(
    fileData: ArrayBuffer
): Promise<{ encrypted: Uint8Array; keyBytes: Uint8Array }> {
    const key = await generateAESKey()
    const keyBytes = await exportAESKey(key)
    const encrypted = await encryptAES(new Uint8Array(fileData), key)
    return { encrypted, keyBytes }
}

/**
 * Decrypt a file with AES-256-GCM given raw key bytes
 */
export async function decryptFile(
    encryptedData: Uint8Array,
    keyBytes: Uint8Array
): Promise<Uint8Array> {
    const key = await importAESKey(keyBytes)
    return decryptAES(encryptedData, key)
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes
}

/**
 * Convert Uint8Array to base64 string
 */
export function bytesToBase64(bytes: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
}

/**
 * Convert base64 string to Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return bytes
}
