import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
    ArrowLeft,
    FileText,
    Download,
    Share2,
    Trash2,
    Shield,
    Lock,
    Calendar,
    Hash,
    User,
    Eye,
    Loader2,
    FileImage,
    FileCode,
    Film,
    Clock,
    Activity,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { apiCall } from '@/lib/contractClient'
import { decryptFile } from '@/lib/encryption'

interface FileMeta {
    id: string
    name: string
    cid: string
    owner: string
    size: number
    mimeType: string
    createdAt: number
    isDeleted: boolean
    isOwner?: boolean
}

interface AuditEvent {
    type: string
    actor: string
    fileId: string
    target: string | null
    timestamp: number
    txId: string | null
}

function formatBytes(bytes: number): string {
    if (!bytes) return '—'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function getFileIcon(mimeType: string) {
    if (mimeType?.startsWith('image/')) return FileImage
    if (mimeType?.startsWith('video/')) return Film
    if (mimeType?.includes('json') || mimeType?.includes('javascript') || mimeType?.includes('html'))
        return FileCode
    return FileText
}

// Get the original MIME type from the filename (since stored file has .enc extension)
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
        ts: 'application/typescript',
        json: 'application/json',
        xml: 'application/xml',
        csv: 'text/csv',
        mp4: 'video/mp4',
        mp3: 'audio/mpeg',
    }
    return mimeMap[ext] || 'application/octet-stream'
}

// Retrieve AES key from sessionStorage or from server
async function getEncryptionKey(fileId: string, cid: string): Promise<Uint8Array | null> {
    // Try sessionStorage first
    let keyHex = sessionStorage.getItem(`key_${fileId}`) || sessionStorage.getItem(`key_${cid}`)
    if (!keyHex) {
        // Fetch from server (owner only)
        try {
            const res = await apiCall(`/files/${fileId}/key`)
            if (res.ok) {
                const data = await res.json()
                keyHex = data.encryptionKey
                if (keyHex) {
                    sessionStorage.setItem(`key_${fileId}`, keyHex)
                    sessionStorage.setItem(`key_${cid}`, keyHex)
                }
            }
        } catch { }
    }
    if (!keyHex) return null
    return new Uint8Array(keyHex.match(/.{1,2}/g)!.map((h: string) => parseInt(h, 16)))
}

const FileDetailPage: React.FC = () => {
    const { fileId } = useParams()
    const navigate = useNavigate()
    const [file, setFile] = useState<FileMeta | null>(null)
    const [loading, setLoading] = useState(true)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [previewType, setPreviewType] = useState<string>('')
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewText, setPreviewText] = useState<string | null>(null)
    const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])
    const [shareDialogOpen, setShareDialogOpen] = useState(false)
    const [shareAddr, setShareAddr] = useState('')
    const [sharePermission, setSharePermission] = useState('read')
    const [shareExpiry, setShareExpiry] = useState(0)  // 0 = no expiry
    const [sharing, setSharing] = useState(false)

    useEffect(() => {
        const loadFile = async () => {
            try {
                const res = await apiCall(`/files/${fileId}/meta`)
                if (res.ok) {
                    const data = await res.json()
                    setFile(data)
                }
            } catch { }
            // Load audit events
            try {
                const res = await apiCall(`/audit/${fileId}`)
                if (res.ok) {
                    const data = await res.json()
                    setAuditEvents(data.events || [])
                }
            } catch { }
            setLoading(false)
        }
        if (fileId) loadFile()
    }, [fileId])

    // Download encrypted file from IPFS, decrypt, and return as Blob
    const decryptAndGetBlob = async (): Promise<Blob | null> => {
        if (!file) return null
        const keyBytes = await getEncryptionKey(file.id, file.cid)
        const apiBase = import.meta.env.VITE_API_BASE_URL || '/api'
        const res = await fetch(`${apiBase.replace('/api', '')}/api/files/${file.cid}/download`)
        if (!res.ok) throw new Error('Download failed')
        const encryptedData = await res.arrayBuffer()

        if (keyBytes) {
            // Decrypt using AES-256-GCM
            const decrypted = await decryptFile(new Uint8Array(encryptedData), keyBytes)
            const mime = getMimeFromName(file.name)
            const buf = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength) as ArrayBuffer
            return new Blob([buf], { type: mime })
        } else {
            // No key available — return raw (will be garbled if encrypted)
            return new Blob([encryptedData])
        }
    }

    const handleDownload = async () => {
        if (!file) return
        try {
            const blob = await decryptAndGetBlob()
            if (!blob) return
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = file.name
            a.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('Download error:', err)
            alert('Download failed')
        }
    }

    const handlePreview = async () => {
        if (!file) return
        setPreviewLoading(true)
        try {
            const blob = await decryptAndGetBlob()
            if (!blob) throw new Error('Could not load file')

            const mime = getMimeFromName(file.name)

            if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('csv') || mime.includes('xml') || mime.includes('markdown') || mime.includes('typescript')) {
                const text = await blob.text()
                setPreviewText(text)
                setPreviewType('text')
            } else if (mime.startsWith('image/')) {
                setPreviewUrl(URL.createObjectURL(blob))
                setPreviewType('image')
            } else if (mime === 'application/pdf') {
                setPreviewUrl(URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })))
                setPreviewType('pdf')
            } else {
                setPreviewType('unsupported')
            }
        } catch (err) {
            console.error('Preview error:', err)
            setPreviewType('error')
        } finally {
            setPreviewLoading(false)
        }
    }

    const handleDelete = async () => {
        if (!file) return
        try {
            const res = await apiCall(`/files/${file.id}`, { method: 'DELETE' })
            if (res.ok) navigate('/files')
        } catch (err) {
            console.error('Delete failed:', err)
        }
    }

    const handleShare = async () => {
        if (!file || !shareAddr) return
        setSharing(true)
        try {
            // Get the encryption key so it can be forwarded to the recipient
            let encKey: string | null = null
            try {
                const keyRes = await apiCall(`/files/${file.id}/key`)
                if (keyRes.ok) {
                    const keyData = await keyRes.json()
                    encKey = keyData.encryptionKey
                }
            } catch { }

            const res = await apiCall(`/files/${file.id}/share`, {
                method: 'POST',
                body: JSON.stringify({
                    recipientAddress: shareAddr,
                    permission: sharePermission,
                    expiresIn: shareExpiry,
                }),
            })
            if (res.ok) {
                setShareDialogOpen(false)
                setShareAddr('')
                console.log(`✅ File shared with ${shareAddr.substring(0, 12)}... (key included: ${!!encKey}, expiry: ${shareExpiry ? shareExpiry + 's' : 'permanent'})`)
                alert('File shared successfully!')
            } else {
                const errData = await res.json()
                alert(errData.error || 'Share failed')
            }
        } catch (err: any) {
            alert('Share failed: ' + err.message)
        } finally {
            setSharing(false)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
                <Loader2 size={28} className="animate-spin" />
                <p className="text-sm">Loading file details...</p>
            </div>
        )
    }

    if (!file) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
                <FileText size={48} className="opacity-30" />
                <h3 className="font-semibold text-foreground">File not found</h3>
                <Button variant="outline" onClick={() => navigate('/files')}>
                    <ArrowLeft size={16} /> Back to Files
                </Button>
            </div>
        )
    }

    const FileIcon = getFileIcon(file.mimeType || getMimeFromName(file.name))

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Back button */}
            <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => navigate('/files')}
            >
                <ArrowLeft size={16} />
                Back to Files
            </Button>

            <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <Card className="bg-card/60 backdrop-blur-xl border-border/50">
                    <CardContent className="p-8 space-y-6">
                        {/* Header */}
                        <div className="flex items-center gap-5">
                            <div className="w-16 h-16 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                                <FileIcon size={28} className="text-primary" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-xl font-bold truncate">{file.name}</h2>
                                <div className="flex items-center gap-2 mt-1">
                                    <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10 text-[10px]">
                                        <Lock size={10} className="mr-1" /> Encrypted
                                    </Badge>
                                    <span className="text-xs text-muted-foreground">
                                        {formatBytes(file.size)}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <Separator className="bg-border/50" />

                        {/* Properties */}
                        <div className="space-y-3">
                            {[
                                { icon: Hash, label: 'IPFS CID', value: file.cid, mono: true },
                                { icon: User, label: 'Owner', value: file.owner, mono: true },
                                { icon: Calendar, label: 'Uploaded', value: new Date(file.createdAt).toLocaleString() },
                                { icon: FileText, label: 'MIME Type', value: getMimeFromName(file.name) },
                                { icon: Shield, label: 'Encryption', value: 'AES-256-GCM + Shamir (2-of-3)' },
                            ].map((row) => (
                                <div key={row.label} className="flex items-start gap-3">
                                    <div className="flex items-center gap-2 min-w-[120px] text-muted-foreground text-sm shrink-0">
                                        <row.icon size={14} />
                                        {row.label}
                                    </div>
                                    <span className={`text-sm break-all ${row.mono ? 'font-mono text-muted-foreground' : ''}`}>
                                        {row.value}
                                    </span>
                                </div>
                            ))}
                        </div>

                        <Separator className="bg-border/50" />

                        {/* Actions */}
                        <div className="flex flex-wrap gap-3">
                            <Button onClick={handleDownload}>
                                <Download size={16} /> Download
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handlePreview}
                                disabled={previewLoading}
                            >
                                {previewLoading ? <Loader2 size={16} className="animate-spin" /> : <Eye size={16} />}
                                Preview
                            </Button>
                            <Button variant="outline" onClick={() => setShareDialogOpen(!shareDialogOpen)}>
                                <Share2 size={16} /> Share
                            </Button>
                            <Button
                                variant="outline"
                                className="text-destructive hover:bg-destructive/10"
                                onClick={handleDelete}
                            >
                                <Trash2 size={16} /> Delete
                            </Button>
                        </div>

                        {/* Inline Share Form */}
                        {shareDialogOpen && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="space-y-3 pt-2"
                            >
                                <Separator className="bg-border/50" />
                                <h4 className="text-sm font-semibold flex items-center gap-2">
                                    <Share2 size={14} /> Share File
                                </h4>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Recipient wallet address..."
                                        value={shareAddr}
                                        onChange={(e) => setShareAddr(e.target.value)}
                                        className="flex-1 bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                    />
                                    <select
                                        value={sharePermission}
                                        onChange={(e) => setSharePermission(e.target.value)}
                                        className="bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm"
                                    >
                                        <option value="read">Read</option>
                                        <option value="write">Write</option>
                                    </select>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Clock size={14} className="text-muted-foreground shrink-0" />
                                    <span className="text-xs text-muted-foreground shrink-0">Expires in:</span>
                                    <select
                                        value={shareExpiry}
                                        onChange={(e) => setShareExpiry(Number(e.target.value))}
                                        className="bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm"
                                    >
                                        <option value={0}>No expiry</option>
                                        <option value={3600}>1 Hour</option>
                                        <option value={86400}>24 Hours</option>
                                        <option value={604800}>7 Days</option>
                                        <option value={2592000}>30 Days</option>
                                    </select>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="sm" onClick={handleShare} disabled={sharing || !shareAddr}>
                                        {sharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
                                        Share
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setShareDialogOpen(false)}>
                                        Cancel
                                    </Button>
                                </div>
                            </motion.div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>

            {/* Preview Area */}
            {previewType && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                >
                    <Card className="bg-card/60 backdrop-blur-xl border-border/50">
                        <CardHeader>
                            <CardTitle className="text-base">Document Preview</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {previewType === 'image' && previewUrl && (
                                <img
                                    src={previewUrl}
                                    alt={file.name}
                                    className="max-w-full max-h-[500px] rounded-lg mx-auto object-contain"
                                />
                            )}
                            {previewType === 'pdf' && previewUrl && (
                                <iframe
                                    src={previewUrl}
                                    className="w-full h-[600px] rounded-lg border border-border/30"
                                    title="PDF Preview"
                                />
                            )}
                            {previewType === 'text' && previewText && (
                                <pre className="bg-secondary/50 rounded-lg p-4 overflow-auto max-h-[500px] text-sm font-mono text-foreground/90 whitespace-pre-wrap">
                                    {previewText}
                                </pre>
                            )}
                            {previewType === 'unsupported' && (
                                <div className="text-center py-8 text-muted-foreground">
                                    <FileText size={32} className="mx-auto mb-2 opacity-40" />
                                    <p className="text-sm">Preview not available for this file type</p>
                                    <p className="text-xs mt-1">Use the Download button instead</p>
                                </div>
                            )}
                            {previewType === 'error' && (
                                <div className="text-center py-8 text-destructive">
                                    <p className="text-sm">Failed to load preview</p>
                                    <p className="text-xs mt-1 text-muted-foreground">Make sure you have the encryption key</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            )}

            {/* Audit Trail */}
            {auditEvents.length > 0 && (
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                >
                    <Card className="bg-card/60 backdrop-blur-xl border-border/50">
                        <CardHeader>
                            <CardTitle className="text-base flex items-center gap-2">
                                <Activity size={16} /> Activity Log
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            {auditEvents.map((event, i) => (
                                <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b border-border/20 last:border-0">
                                    <Clock size={12} className="text-muted-foreground shrink-0" />
                                    <span className="text-muted-foreground text-xs">
                                        {new Date(event.timestamp).toLocaleString()}
                                    </span>
                                    <Badge variant="outline" className="text-[10px]">
                                        {event.type.replace('_', ' ')}
                                    </Badge>
                                    <span className="text-xs font-mono text-muted-foreground truncate">
                                        {event.actor?.substring(0, 12)}...
                                    </span>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </motion.div>
            )}
        </div>
    )
}

export default FileDetailPage
