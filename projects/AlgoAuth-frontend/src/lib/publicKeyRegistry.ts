/**
 * X25519 Key Management using tweetnacl
 * Replaces Ethereum's eth_getEncryptionPublicKey / eth_decrypt
 */

import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'

const KEY_STORAGE_PREFIX = 'blocksafe_x25519_'

export interface X25519KeyPair {
    publicKey: string  // base64
    secretKey: string  // base64
}

/**
 * Generate a new X25519 keypair
 */
export function generateX25519KeyPair(): X25519KeyPair {
    const keyPair = nacl.box.keyPair()
    return {
        publicKey: naclUtil.encodeBase64(keyPair.publicKey),
        secretKey: naclUtil.encodeBase64(keyPair.secretKey),
    }
}

/**
 * Save X25519 keypair to localStorage for a specific wallet address
 */
export function saveKeyPair(walletAddress: string, keyPair: X25519KeyPair): void {
    localStorage.setItem(
        `${KEY_STORAGE_PREFIX}${walletAddress}`,
        JSON.stringify(keyPair)
    )
}

/**
 * Load X25519 keypair from localStorage for a wallet address
 */
export function loadKeyPair(walletAddress: string): X25519KeyPair | null {
    const stored = localStorage.getItem(`${KEY_STORAGE_PREFIX}${walletAddress}`)
    if (!stored) return null
    return JSON.parse(stored) as X25519KeyPair
}

/**
 * Check if a keypair exists for a wallet address
 */
export function hasKeyPair(walletAddress: string): boolean {
    return localStorage.getItem(`${KEY_STORAGE_PREFIX}${walletAddress}`) !== null
}

/**
 * Encrypt data for a recipient using NaCl box (X25519 + XSalsa20-Poly1305)
 */
export function encryptForRecipient(
    data: Uint8Array,
    recipientPublicKeyBase64: string,
    senderSecretKeyBase64: string
): { nonce: string; encrypted: string } {
    const recipientPublicKey = naclUtil.decodeBase64(recipientPublicKeyBase64)
    const senderSecretKey = naclUtil.decodeBase64(senderSecretKeyBase64)
    const nonce = nacl.randomBytes(nacl.box.nonceLength)

    const encrypted = nacl.box(data, nonce, recipientPublicKey, senderSecretKey)
    if (!encrypted) throw new Error('Encryption failed')

    return {
        nonce: naclUtil.encodeBase64(nonce),
        encrypted: naclUtil.encodeBase64(encrypted),
    }
}

/**
 * Decrypt data using NaCl box (X25519 + XSalsa20-Poly1305)
 */
export function decryptFromSender(
    encryptedBase64: string,
    nonceBase64: string,
    senderPublicKeyBase64: string,
    recipientSecretKeyBase64: string
): Uint8Array {
    const encrypted = naclUtil.decodeBase64(encryptedBase64)
    const nonce = naclUtil.decodeBase64(nonceBase64)
    const senderPublicKey = naclUtil.decodeBase64(senderPublicKeyBase64)
    const recipientSecretKey = naclUtil.decodeBase64(recipientSecretKeyBase64)

    const decrypted = nacl.box.open(encrypted, nonce, senderPublicKey, recipientSecretKey)
    if (!decrypted) throw new Error('Decryption failed')

    return decrypted
}

/**
 * Encrypt data with a shared secret (secretbox) — used for encrypting shares for nodes
 */
export function encryptWithSharedSecret(
    data: Uint8Array,
    secretKey: Uint8Array
): { nonce: string; encrypted: string } {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength)
    const encrypted = nacl.secretbox(data, nonce, secretKey)
    if (!encrypted) throw new Error('Secretbox encryption failed')

    return {
        nonce: naclUtil.encodeBase64(nonce),
        encrypted: naclUtil.encodeBase64(encrypted),
    }
}

/**
 * Decrypt data from secretbox
 */
export function decryptWithSharedSecret(
    encryptedBase64: string,
    nonceBase64: string,
    secretKey: Uint8Array
): Uint8Array {
    const encrypted = naclUtil.decodeBase64(encryptedBase64)
    const nonce = naclUtil.decodeBase64(nonceBase64)

    const decrypted = nacl.secretbox.open(encrypted, nonce, secretKey)
    if (!decrypted) throw new Error('Secretbox decryption failed')

    return decrypted
}
