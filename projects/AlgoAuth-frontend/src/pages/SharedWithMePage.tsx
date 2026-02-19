import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Share2, Search, Eye, Download, Inbox, Loader2, User, Clock } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { apiCall } from '@/lib/contractClient'
import { decryptFile } from '@/lib/encryption'
import { reconstructSecret, hexToShare } from '@/lib/shamirSecretSharing'
import DocumentViewer from '@/components/DocumentViewer'

interface SharedFile {
    id: string
    fileId: string
    name: string
    cid: string
    size: number
    mimeType: string
    owner: string
    permission: 'read' | 'write'
    sharedAt: number
    expiresAt?: number
}

function formatBytes(bytes: number): string {
    if (!bytes) return '—'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const SharedWithMePage: React.FC = () => {
    const navigate = useNavigate()
    const [searchQuery, setSearchQuery] = useState('')
    const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([])
    const [loading, setLoading] = useState(true)
    const [viewerOpen, setViewerOpen] = useState(false)
    const [viewerFile, setViewerFile] = useState<SharedFile | null>(null)

    useEffect(() => {
        const loadShared = async () => {
            try {
                const res = await apiCall('/files/shared')
                if (res.ok) {
                    const data = await res.json()
                    setSharedFiles(data.files || [])
                }
            } catch { }
            setLoading(false)
        }
        loadShared()
    }, [])

    const filteredFiles = sharedFiles.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const handleView = (file: SharedFile) => {
        setViewerFile(file)
        setViewerOpen(true)
    }

    // Retrieve key for shared file (Shamir or direct) and decrypt + download
    const handleDownload = async (file: SharedFile) => {
        try {
            // 1. Try getting key via shared endpoint
            let keyHex: string | null = sessionStorage.getItem(`key_${file.fileId}`) || sessionStorage.getItem(`key_${file.cid}`)
            if (!keyHex) {
                const res = await apiCall(`/files/shared/${file.id}/key`)
                if (res.ok) {
                    const data = await res.json()
                    if (data.shares && data.shares.length >= 2) {
                        console.log(`🔐 Shamir reconstruction for download: ${file.name}`)
                        const shareArrays = data.shares.map((hex: string) => hexToShare(hex))
                        const reconstructedKey = reconstructSecret(shareArrays)
                        keyHex = Array.from(reconstructedKey).map((b: number) => b.toString(16).padStart(2, '0')).join('')
                        console.log(`✅ Key reconstructed (${data.shares.length}/${data.totalShares} shares used)`)
                    } else if (data.encryptionKey) {
                        keyHex = data.encryptionKey
                    }
                    if (keyHex) {
                        sessionStorage.setItem(`key_${file.fileId}`, keyHex)
                        sessionStorage.setItem(`key_${file.cid}`, keyHex)
                    }
                }
            }

            // 2. Download the encrypted file
            const apiBase = import.meta.env.VITE_API_BASE_URL || '/api'
            const downloadRes = await fetch(`${apiBase.replace('/api', '')}/api/files/${file.cid}/download`)
            if (!downloadRes.ok) throw new Error('Download failed')
            const encryptedData = await downloadRes.arrayBuffer()

            // 3. Decrypt if we have the key
            let blob: Blob
            if (keyHex) {
                const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(h => parseInt(h, 16)))
                const decrypted = await decryptFile(new Uint8Array(encryptedData), keyBytes)
                const buf = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength) as ArrayBuffer
                blob = new Blob([buf])
            } else {
                blob = new Blob([encryptedData])
            }

            // 4. Trigger download
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = file.name
            a.click()
            URL.revokeObjectURL(url)
        } catch (err: any) {
            console.error('Download error:', err)
            alert('Download failed: ' + err.message)
        }
    }

    // Format expiry as relative time
    const formatExpiry = (expiresAt?: number) => {
        if (!expiresAt || expiresAt === 0) return 'Permanent'
        const diff = expiresAt - Date.now()
        if (diff <= 0) return 'Expired'
        const hours = Math.floor(diff / 3600000)
        const days = Math.floor(hours / 24)
        if (days > 0) return `${days}d left`
        if (hours > 0) return `${hours}h left`
        return `${Math.floor(diff / 60000)}m left`
    }

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            <div>
                <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
                    Shared With Me
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                    Files others have shared with you
                </p>
            </div>

            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    placeholder="Search shared files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-secondary/30 border-border/50 focus:border-primary/50"
                />
            </div>

            <div className="space-y-2">
                {loading ? (
                    <div className="flex items-center justify-center py-16 text-muted-foreground">
                        <Loader2 size={24} className="animate-spin" />
                    </div>
                ) : filteredFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <Inbox size={48} className="opacity-30 mb-4" />
                        <h3 className="font-semibold text-foreground">No shared files yet</h3>
                        <p className="text-sm">Files shared with you will appear here</p>
                    </div>
                ) : (
                    filteredFiles.map((file, i) => (
                        <motion.div
                            key={file.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.04 }}
                        >
                            <Card className="bg-card/60 backdrop-blur-sm border-border/50 hover:border-border hover:bg-card/80 transition-all group">
                                <CardContent className="flex items-center gap-4 p-4">
                                    <div className="w-11 h-11 rounded-lg bg-cyan-500/10 flex items-center justify-center shrink-0">
                                        <Share2 size={20} className="text-cyan-400" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-semibold truncate">{file.name}</h4>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <User size={10} />
                                                {file.owner.slice(0, 8)}...
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {formatBytes(file.size)}
                                            </span>
                                            <Badge
                                                variant="outline"
                                                className={
                                                    file.permission === 'write'
                                                        ? 'text-amber-400 border-amber-500/30 bg-amber-500/10 text-[10px] px-1.5 py-0'
                                                        : 'text-cyan-400 border-cyan-500/30 bg-cyan-500/10 text-[10px] px-1.5 py-0'
                                                }
                                            >
                                                {file.permission}
                                            </Badge>
                                            {file.expiresAt && file.expiresAt > 0 ? (
                                                <Badge
                                                    variant="outline"
                                                    className={`text-[10px] px-1.5 py-0 flex items-center gap-0.5 ${file.expiresAt < Date.now()
                                                        ? 'text-destructive border-destructive/30 bg-destructive/10'
                                                        : 'text-muted-foreground'
                                                        }`}
                                                >
                                                    <Clock size={8} />
                                                    {formatExpiry(file.expiresAt)}
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                                                    Permanent
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:text-primary"
                                            title="View"
                                            onClick={() => handleView(file)}
                                        >
                                            <Eye size={16} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:text-emerald-400"
                                            title="Download"
                                            onClick={() => handleDownload(file)}
                                        >
                                            <Download size={16} />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    ))
                )}
            </div>

            {/* Document Viewer Modal */}
            {viewerFile && (
                <DocumentViewer
                    isOpen={viewerOpen}
                    onClose={() => { setViewerOpen(false); setViewerFile(null) }}
                    cid={viewerFile.cid}
                    fileId={viewerFile.fileId}
                    filename={viewerFile.name}
                    shareId={viewerFile.id}
                />
            )}
        </div>
    )
}

export default SharedWithMePage
