import React, { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Download, ZoomIn, ZoomOut, FileText, Loader2, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiCall } from '@/lib/contractClient'
import { decryptFile } from '@/lib/encryption'
import { reconstructSecret, hexToShare } from '@/lib/shamirSecretSharing'

interface DocumentViewerProps {
    /** Whether the viewer is open */
    isOpen: boolean
    /** Callback to close the viewer */
    onClose: () => void
    /** File CID for downloading from IPFS gateway */
    cid: string
    /** File ID for retrieving encryption key from server */
    fileId: string
    /** Original filename (used to determine MIME type) */
    filename: string
    /** Share ID for shared file key retrieval (optional) */
    shareId?: string
    /** Group ID for group file key retrieval (optional) */
    groupId?: string
}

function getMimeFromName(name: string): string {
    const ext = name.replace(/\.enc$/, '').split('.').pop()?.toLowerCase() || ''
    const mimeMap: Record<string, string> = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        svg: 'image/svg+xml',
        txt: 'text/plain',
        md: 'text/markdown',
        html: 'text/html',
        css: 'text/css',
        js: 'application/javascript',
        json: 'application/json',
        xml: 'application/xml',
        csv: 'text/csv',
    }
    return mimeMap[ext] || 'application/octet-stream'
}

async function getEncryptionKey(fileId: string, cid: string, shareId?: string, groupId?: string): Promise<Uint8Array | null> {
    // 1. Try sessionStorage first
    let keyHex = sessionStorage.getItem(`key_${fileId}`) || sessionStorage.getItem(`key_${cid}`)

    if (!keyHex) {
        // 2. Try owner endpoint
        try {
            const res = await apiCall(`/files/${fileId}/key`)
            if (res.ok) {
                const data = await res.json()
                keyHex = data.encryptionKey
                if (keyHex) {
                    console.log(`🔑 Owner key retrieved for file ${fileId}`)
                    sessionStorage.setItem(`key_${fileId}`, keyHex)
                    sessionStorage.setItem(`key_${cid}`, keyHex)
                }
            }
        } catch { }
    }

    if (!keyHex && groupId) {
        // 3. Try group file key endpoint — Shamir Trustless Trio for org files
        try {
            console.log(`\n🔐 ===== Group File Key Retrieval =====`)
            console.log(`📦 Group ID: ${groupId}`)
            console.log(`📁 File ID: ${fileId}`)

            const res = await apiCall(`/groups/${groupId}/files/${fileId}/key`)
            if (res.ok) {
                const data = await res.json()
                keyHex = data.encryptionKey
                if (keyHex) {
                    console.log(`✅ Group file key retrieved via Trustless Trio`)
                    if (data.releasedNodes) {
                        console.log(`🌐 Shares released by: [${data.releasedNodes.join(', ')}]`)
                    }
                    sessionStorage.setItem(`key_${fileId}`, keyHex)
                    sessionStorage.setItem(`key_${cid}`, keyHex)
                }
            }
        } catch { }
    }

    if (!keyHex && shareId) {
        // 3. Try shared file key endpoint — Shamir Trustless Trio flow
        try {
            console.log(`\n🔐 ===== Shamir Trustless Trio — Key Reconstruction =====`)
            console.log(`📋 Share ID: ${shareId}`)
            console.log(`📁 File ID: ${fileId}`)

            const res = await apiCall(`/files/shared/${shareId}/key`)
            if (res.ok) {
                const data = await res.json()

                // If Shamir shares are available, reconstruct the key
                if (data.shares && data.shares.length >= 2) {
                    console.log(`\n📦 Received ${data.shares.length} of ${data.totalShares} Shamir shares (threshold: ${data.threshold})`)
                    console.log(`🌐 Released by Trustless Trio nodes: [${(data.releasedNodes || []).join(', ')}]`)
                    console.log(`📊 Share data sizes: ${data.shares.map((s: string) => `${s.length / 2} bytes`).join(', ')}`)

                    // Convert hex shares back to Uint8Array for reconstruction
                    const shareArrays = data.shares.map((hex: string) => hexToShare(hex))

                    console.log(`\n🔑 Lagrange interpolation: reconstructing 32-byte AES-256 key...`)
                    console.log(`   Using GF(256) arithmetic with irreducible polynomial x^8+x^4+x^3+x+1`)

                    const reconstructedKey = reconstructSecret(shareArrays)
                    keyHex = Array.from(reconstructedKey).map(b => b.toString(16).padStart(2, '0')).join('')

                    console.log(`✅ Key reconstructed successfully!`)
                    console.log(`   Shares used: ${data.shares.length} (threshold: ${data.threshold})`)
                    console.log(`   Key length: ${reconstructedKey.length} bytes (${reconstructedKey.length * 8}-bit AES)`)
                    console.log(`   Key fingerprint: ${keyHex.substring(0, 8)}...${keyHex.substring(keyHex.length - 8)}`)
                    console.log(`🔐 ===== Reconstruction Complete =====\n`)

                    sessionStorage.setItem(`key_${fileId}`, keyHex)
                    sessionStorage.setItem(`key_${cid}`, keyHex)
                } else if (data.encryptionKey) {
                    // Direct key (no Shamir shares available)
                    keyHex = data.encryptionKey
                    console.log(`🔑 Direct encryption key received for shared file ${fileId}`)
                    sessionStorage.setItem(`key_${fileId}`, keyHex!)
                    sessionStorage.setItem(`key_${cid}`, keyHex!)
                }
            }
        } catch (err) {
            console.error('Failed to retrieve shared file key:', err)
        }
    }

    if (!keyHex) return null
    return new Uint8Array(keyHex.match(/.{1,2}/g)!.map((h: string) => parseInt(h, 16)))
}

const DocumentViewer: React.FC<DocumentViewerProps> = ({
    isOpen,
    onClose,
    cid,
    fileId,
    filename,
    shareId,
    groupId,
}) => {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [blobUrl, setBlobUrl] = useState<string | null>(null)
    const [textContent, setTextContent] = useState<string | null>(null)
    const [displayType, setDisplayType] = useState<'pdf' | 'image' | 'text' | 'unsupported'>('unsupported')
    const [zoom, setZoom] = useState(1)

    const loadAndDecrypt = useCallback(async () => {
        setLoading(true)
        setError(null)
        setBlobUrl(null)
        setTextContent(null)

        try {
            const keyBytes = await getEncryptionKey(fileId, cid, shareId, groupId)
            const apiBase = import.meta.env.VITE_API_BASE_URL || '/api'
            const res = await fetch(`${apiBase.replace('/api', '')}/api/files/${cid}/download`)
            if (!res.ok) throw new Error('Download failed')
            const encryptedData = await res.arrayBuffer()

            let blob: Blob
            if (keyBytes) {
                const decrypted = await decryptFile(new Uint8Array(encryptedData), keyBytes)
                blob = new Blob([decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength) as ArrayBuffer], { type: getMimeFromName(filename) })
            } else {
                blob = new Blob([encryptedData])
            }

            const mime = getMimeFromName(filename)

            if (mime === 'application/pdf') {
                setBlobUrl(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })))
                setDisplayType('pdf')
            } else if (mime.startsWith('image/')) {
                setBlobUrl(URL.createObjectURL(blob))
                setDisplayType('image')
            } else if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('xml') || mime.includes('csv') || mime.includes('markdown')) {
                const text = await blob.text()
                setTextContent(text)
                setDisplayType('text')
            } else {
                setDisplayType('unsupported')
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load document')
        } finally {
            setLoading(false)
        }
    }, [cid, fileId, filename, shareId])

    useEffect(() => {
        if (isOpen) {
            loadAndDecrypt()
        }
        return () => {
            if (blobUrl) URL.revokeObjectURL(blobUrl)
        }
    }, [isOpen, loadAndDecrypt])

    const handleDownload = () => {
        if (!blobUrl) return
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = filename
        a.click()
    }

    if (!isOpen) return null

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col"
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-3 bg-card/80 border-b border-border/30">
                    <div className="flex items-center gap-3">
                        <Eye size={18} className="text-primary" />
                        <span className="font-medium text-sm truncate max-w-sm">{filename}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {displayType === 'image' && (
                            <>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.min(z + 0.25, 3))}>
                                    <ZoomIn size={16} />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))}>
                                    <ZoomOut size={16} />
                                </Button>
                            </>
                        )}
                        {blobUrl && (
                            <Button variant="ghost" size="sm" onClick={handleDownload}>
                                <Download size={14} /> Download
                            </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                            <X size={18} />
                        </Button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto flex items-center justify-center p-6">
                    {loading && (
                        <div className="flex flex-col items-center gap-3 text-muted-foreground">
                            <Loader2 size={32} className="animate-spin" />
                            <p className="text-sm">Decrypting document...</p>
                        </div>
                    )}

                    {error && (
                        <div className="text-center text-destructive space-y-2">
                            <FileText size={48} className="mx-auto opacity-40" />
                            <p className="text-sm font-medium">Failed to load document</p>
                            <p className="text-xs text-muted-foreground">{error}</p>
                        </div>
                    )}

                    {!loading && !error && displayType === 'pdf' && blobUrl && (
                        <iframe
                            src={blobUrl}
                            className="w-full h-full rounded-lg border border-border/20"
                            title="Document Preview"
                        />
                    )}

                    {!loading && !error && displayType === 'image' && blobUrl && (
                        <img
                            src={blobUrl}
                            alt={filename}
                            style={{ transform: `scale(${zoom})`, transition: 'transform 0.2s' }}
                            className="max-w-full max-h-full object-contain rounded-lg"
                        />
                    )}

                    {!loading && !error && displayType === 'text' && textContent !== null && (
                        <pre className="w-full max-w-4xl bg-secondary/30 rounded-lg p-6 overflow-auto max-h-full text-sm font-mono text-foreground/90 whitespace-pre-wrap">
                            {textContent}
                        </pre>
                    )}

                    {!loading && !error && displayType === 'unsupported' && (
                        <div className="text-center text-muted-foreground space-y-2">
                            <FileText size={48} className="mx-auto opacity-40" />
                            <p className="text-sm">Preview not available for this file type</p>
                            {blobUrl && (
                                <Button variant="outline" size="sm" onClick={handleDownload}>
                                    <Download size={14} /> Download Instead
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            </motion.div>
        </AnimatePresence>
    )
}

export default DocumentViewer
