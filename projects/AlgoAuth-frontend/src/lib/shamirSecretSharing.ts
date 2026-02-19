/**
 * Shamir's Secret Sharing over GF(256)
 * Splits a secret into N shares with a threshold of K
 * Used for splitting the AES file encryption key
 */

// GF(256) arithmetic using irreducible polynomial x^8 + x^4 + x^3 + x + 1 (0x11B)
const EXP_TABLE = new Uint8Array(256)
const LOG_TABLE = new Uint8Array(256)

    // Initialize lookup tables
    ; (function initTables() {
        let x = 1
        for (let i = 0; i < 255; i++) {
            EXP_TABLE[i] = x
            LOG_TABLE[x] = i
            x = x ^ (x << 1)
            if (x >= 256) {
                x ^= 0x11b
            }
        }
        EXP_TABLE[255] = EXP_TABLE[0]
    })()

function gfMul(a: number, b: number): number {
    if (a === 0 || b === 0) return 0
    return EXP_TABLE[(LOG_TABLE[a] + LOG_TABLE[b]) % 255]
}

function gfDiv(a: number, b: number): number {
    if (b === 0) throw new Error('Division by zero in GF(256)')
    if (a === 0) return 0
    return EXP_TABLE[(LOG_TABLE[a] - LOG_TABLE[b] + 255) % 255]
}

/**
 * Evaluate polynomial at point x in GF(256)
 */
function evaluatePolynomial(coefficients: Uint8Array, x: number): number {
    let result = 0
    for (let i = coefficients.length - 1; i >= 0; i--) {
        result = gfMul(result, x) ^ coefficients[i]
    }
    return result
}

/**
 * Split a secret byte array into n shares with threshold k
 * Returns array of shares, each share is a Uint8Array with first byte = x coordinate
 */
export function splitSecret(
    secret: Uint8Array,
    n: number,
    k: number
): Uint8Array[] {
    if (k > n) throw new Error('Threshold must be <= number of shares')
    if (k < 2) throw new Error('Threshold must be >= 2')
    if (n > 255) throw new Error('Max 255 shares')

    const shares: Uint8Array[] = []
    for (let i = 0; i < n; i++) {
        shares.push(new Uint8Array(secret.length + 1))
        shares[i][0] = i + 1 // x coordinate (1-indexed)
    }

    for (let byteIdx = 0; byteIdx < secret.length; byteIdx++) {
        // Create random polynomial: coefficients[0] = secret byte, rest random
        const coefficients = new Uint8Array(k)
        coefficients[0] = secret[byteIdx]
        crypto.getRandomValues(coefficients.subarray(1))

        // Evaluate at each share's x coordinate
        for (let i = 0; i < n; i++) {
            shares[i][byteIdx + 1] = evaluatePolynomial(coefficients, i + 1)
        }
    }

    return shares
}

/**
 * Reconstruct secret from k or more shares using Lagrange interpolation
 */
export function reconstructSecret(shares: Uint8Array[]): Uint8Array {
    if (shares.length < 2) throw new Error('Need at least 2 shares')

    const secretLength = shares[0].length - 1
    const secret = new Uint8Array(secretLength)

    // Get x coordinates
    const xs = shares.map((s) => s[0])

    for (let byteIdx = 0; byteIdx < secretLength; byteIdx++) {
        // Lagrange interpolation at x=0
        let result = 0
        for (let i = 0; i < shares.length; i++) {
            let numerator = 1
            let denominator = 1
            for (let j = 0; j < shares.length; j++) {
                if (i !== j) {
                    // numerator *= (0 - xs[j]) = xs[j] in GF(256) since -x = x
                    numerator = gfMul(numerator, xs[j])
                    // denominator *= (xs[i] - xs[j]) = xs[i] ^ xs[j] in GF(256)
                    denominator = gfMul(denominator, xs[i] ^ xs[j])
                }
            }
            const lagrangeCoeff = gfDiv(numerator, denominator)
            result ^= gfMul(shares[i][byteIdx + 1], lagrangeCoeff)
        }
        secret[byteIdx] = result
    }

    return secret
}

/**
 * Convert a share to a hex string
 */
export function shareToHex(share: Uint8Array): string {
    return Array.from(share)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

/**
 * Convert a hex string back to a share
 */
export function hexToShare(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
    }
    return bytes
}
