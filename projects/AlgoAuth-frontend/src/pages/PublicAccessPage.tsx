import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Shield, Download, FileText, Loader2, AlertCircle, CheckCircle2, User, Clock, Eye, FileImage } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { decryptFile } from '@/lib/encryption'

interface PublicFileInfo {
    name: string
    cid: string
    size: number
    mimeType: string
    owner: string
}

function formatBytes(bytes: number): string {
    if (!bytes) return '—'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function getMimeFromName(name: string): string {
    const ext = name.replace(/\.enc$/, '').split('.').pop()?.toLowerCase() || ''
    const mimeMap: Record<string, string> = {
        pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain',
        md: 'text/markdown', html: 'text/html', css: 'text/css', js: 'application/javascript',
        json: 'application/json', csv: 'text/csv', xml: 'application/xml',
    }
    return mimeMap[ext] || 'application/octet-stream'
}

// Fetch encryption key and decrypt file data
async function fetchAndDecrypt(linkId: string, cid: string): Promise<{ blob: Blob; keyUsed: boolean }> {
    const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'

    // 1. Fetch encryption key
    let keyHex: string | null = null
    try {
        const keyRes = await fetch(`${apiBase}/public/${linkId}/key`)
        if (keyRes.ok) {
            const keyData = await keyRes.json()
            keyHex = keyData.encryptionKey
        }
    } catch { }

    // 2. Download encrypted file
    const res = await fetch(`${apiBase.replace('/api', '')}/api/files/${cid}/download`)
    if (!res.ok) throw new Error('Download failed')
    const encryptedData = await res.arrayBuffer()

    // 3. Decrypt if key available
    if (keyHex) {
        const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(h => parseInt(h, 16)))
        const decrypted = await decryptFile(new Uint8Array(encryptedData), keyBytes)
        const buf = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength) as ArrayBuffer
        return { blob: new Blob([buf]), keyUsed: true }
    }
    return { blob: new Blob([encryptedData]), keyUsed: false }
}

const PublicAccessPage: React.FC = () => {
    const { linkId } = useParams()
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [fileInfo, setFileInfo] = useState<PublicFileInfo | null>(null)
    const [downloading, setDownloading] = useState(false)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [previewText, setPreviewText] = useState<string | null>(null)
    const [previewType, setPreviewType] = useState('')
    const [previewLoading, setPreviewLoading] = useState(false)

    useEffect(() => {
        const loadPublicFile = async () => {
            try {
                const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'
                const res = await fetch(`${apiBase}/public/${linkId}`)
                if (res.ok) {
                    const data = await res.json()
                    setFileInfo(data)
                } else if (res.status === 410) {
                    setError('This link has expired')
                } else {
                    setError('Public link not found')
                }
            } catch {
                setError('Could not connect to server')
            } finally {
                setLoading(false)
            }
        }
        if (linkId) loadPublicFile()
    }, [linkId])

    const handleDownload = async () => {
        if (!fileInfo || !linkId) return
        setDownloading(true)
        try {
            const { blob } = await fetchAndDecrypt(linkId, fileInfo.cid)
            const mime = getMimeFromName(fileInfo.name)
            const downloadBlob = new Blob([blob], { type: mime })
            const url = URL.createObjectURL(downloadBlob)
            const a = document.createElement('a')
            a.href = url
            a.download = fileInfo.name
            a.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('Download error:', err)
            alert('Download failed')
        } finally {
            setDownloading(false)
        }
    }

    const handlePreview = async () => {
        if (!fileInfo || !linkId) return
        setPreviewLoading(true)
        try {
            const { blob } = await fetchAndDecrypt(linkId, fileInfo.cid)
            const mime = getMimeFromName(fileInfo.name)

            if (mime.startsWith('text/') || mime.includes('json') || mime.includes('javascript') || mime.includes('csv') || mime.includes('xml') || mime.includes('markdown')) {
                const text = await blob.text()
                setPreviewText(text)
                setPreviewType('text')
            } else if (mime.startsWith('image/')) {
                setPreviewUrl(URL.createObjectURL(new Blob([blob], { type: mime })))
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

    return (
        <div className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_50%_50%,rgba(99,102,241,0.08),transparent_50%)] p-5">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="w-full max-w-md text-center space-y-6"
            >
                {/* Header */}
                <div className="space-y-2">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center mx-auto shadow-lg shadow-primary/20">
                        <Shield size={24} className="text-white" />
                    </div>
                    <h1 className="text-xl font-bold">BlockSafe</h1>
                    <p className="text-sm text-muted-foreground">Secure File Sharing</p>
                </div>

                <Card className="bg-card/60 backdrop-blur-xl border-border/50">
                    <CardContent className="p-8">
                        {loading ? (
                            <div className="flex flex-col items-center gap-3 py-4">
                                <Loader2 size={32} className="text-primary animate-spin" />
                                <p className="text-sm text-muted-foreground">Loading shared file...</p>
                            </div>
                        ) : error ? (
                            <div className="flex flex-col items-center gap-3 py-4">
                                <AlertCircle size={32} className="text-destructive" />
                                <p className="text-sm text-destructive">{error}</p>
                            </div>
                        ) : fileInfo ? (
                            <div className="space-y-6">
                                <FileText size={48} className="text-primary mx-auto" />
                                <div>
                                    <h2 className="text-lg font-bold">{fileInfo.name}</h2>
                                    <div className="flex items-center justify-center gap-3 mt-2">
                                        <Badge variant="outline" className="text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                                            <CheckCircle2 size={10} className="mr-1" /> Verified
                                        </Badge>
                                        <span className="text-xs text-muted-foreground">
                                            {formatBytes(fileInfo.size)}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-center gap-1 mt-2 text-xs text-muted-foreground">
                                        <User size={10} />
                                        Shared by {fileInfo.owner?.slice(0, 8)}...
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    <Button
                                        className="flex-1 bg-gradient-to-r from-primary to-indigo-600 shadow-lg shadow-primary/20"
                                        onClick={handleDownload}
                                        disabled={downloading}
                                    >
                                        {downloading ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Download size={16} />
                                        )}
                                        Download
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="flex-1"
                                        onClick={handlePreview}
                                        disabled={previewLoading}
                                    >
                                        {previewLoading ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Eye size={16} />
                                        )}
                                        Preview
                                    </Button>
                                </div>

                                {/* In-page Preview */}
                                {previewType && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: 'auto' }}
                                        className="border border-border/50 rounded-lg overflow-hidden"
                                    >
                                        {previewType === 'image' && previewUrl && (
                                            <img src={previewUrl} alt={fileInfo.name} className="max-w-full max-h-[400px] mx-auto object-contain p-2" />
                                        )}
                                        {previewType === 'pdf' && previewUrl && (
                                            <iframe src={previewUrl} className="w-full h-[500px]" title="PDF Preview" />
                                        )}
                                        {previewType === 'text' && previewText && (
                                            <pre className="bg-secondary/50 p-4 overflow-auto max-h-[400px] text-xs font-mono text-foreground/90 whitespace-pre-wrap">
                                                {previewText}
                                            </pre>
                                        )}
                                        {previewType === 'unsupported' && (
                                            <div className="text-center py-6 text-muted-foreground">
                                                <FileText size={24} className="mx-auto mb-2 opacity-40" />
                                                <p className="text-xs">Preview not available — use Download</p>
                                            </div>
                                        )}
                                        {previewType === 'error' && (
                                            <div className="text-center py-6 text-destructive">
                                                <AlertCircle size={24} className="mx-auto mb-2" />
                                                <p className="text-xs">Preview failed</p>
                                            </div>
                                        )}
                                    </motion.div>
                                )}
                            </div>
                        ) : null}
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    )
}

export default PublicAccessPage
