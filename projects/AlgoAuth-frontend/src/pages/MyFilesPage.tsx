import React, { useState, useCallback, useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import {
    Upload,
    FileText,
    Trash2,
    Share2,
    Eye,
    Search,
    Plus,
    File,
    Loader2,
    Download,
    Link2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import CreatePublicLinkDialog from '@/components/CreatePublicLinkDialog'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog'
import { encryptFile } from '@/lib/encryption'
import { splitSecret, shareToHex } from '@/lib/shamirSecretSharing'
import { apiCall } from '@/lib/contractClient'

interface FileItem {
    id: string
    name: string
    cid: string
    owner: string
    size: number
    mimeType: string
    createdAt: number
    isDeleted: boolean
}

function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const MyFilesPage: React.FC = () => {
    const { activeAddress } = useWallet()
    const navigate = useNavigate()
    const [files, setFiles] = useState<FileItem[]>([])
    const [isUploading, setIsUploading] = useState(false)
    const [uploadDialogOpen, setUploadDialogOpen] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')
    const [dragOver, setDragOver] = useState(false)
    const [loading, setLoading] = useState(true)
    const [publicLinkFile, setPublicLinkFile] = useState<FileItem | null>(null)

    // Fetch files from server on mount
    useEffect(() => {
        const loadFiles = async () => {
            try {
                const res = await apiCall('/files')
                if (res.ok) {
                    const data = await res.json()
                    setFiles(data.files || [])
                }
            } catch {
                // ignore — server might be down
            } finally {
                setLoading(false)
            }
        }
        loadFiles()
    }, [])

    const handleFileUpload = useCallback(async (file: File) => {
        if (!activeAddress) return
        setIsUploading(true)

        try {
            // 1. Read the file
            const fileData = await file.arrayBuffer()

            // 2. Encrypt the file with AES-256-GCM
            const { encrypted, keyBytes } = await encryptFile(fileData)

            // 3. Split the AES key using Shamir (2-of-3)
            const shares = splitSecret(keyBytes, 3, 2)
            const shareHexes = shares.map(shareToHex)

            // 4. Convert key to hex for storage
            const keyHex = Array.from(keyBytes).map(b => b.toString(16).padStart(2, '0')).join('')

            // 5. Upload encrypted file to IPFS via API
            const formData = new FormData()
            formData.append('file', new Blob([encrypted.buffer as ArrayBuffer]), file.name + '.enc')
            formData.append('filename', file.name)
            formData.append('encryptionKey', keyHex)
            formData.append('shares', JSON.stringify(shareHexes))

            const uploadRes = await apiCall('/files/upload', {
                method: 'POST',
                body: formData,
                // Don't set Content-Type — browser sets it with boundary for FormData
                headers: undefined,
            })

            if (!uploadRes.ok) {
                const errData = await uploadRes.json()
                throw new Error(errData.error || 'Upload failed')
            }

            const newFile = await uploadRes.json()

            // 6. Store the encryption key locally for preview/download
            sessionStorage.setItem(`key_${newFile.cid}`, keyHex)
            sessionStorage.setItem(`key_${newFile.id}`, keyHex)

            setFiles((prev) => [newFile, ...prev])
            setUploadDialogOpen(false)
        } catch (err: any) {
            console.error('Upload failed:', err)
            alert('Upload failed: ' + err.message)
        } finally {
            setIsUploading(false)
        }
    }, [activeAddress])

    const handleDelete = async (fileId: string) => {
        try {
            const res = await apiCall(`/files/${fileId}`, { method: 'DELETE' })
            if (res.ok) {
                setFiles((prev) => prev.filter((f) => f.id !== fileId))
            }
        } catch (err) {
            console.error('Delete failed:', err)
        }
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setDragOver(false)
        const file = e.dataTransfer.files[0]
        if (file) handleFileUpload(file)
    }

    const filteredFiles = files.filter((f) =>
        f.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
                        My Files
                    </h2>
                    <p className="text-muted-foreground text-sm mt-1">
                        Manage your encrypted files
                    </p>
                </div>
                <Button
                    className="bg-gradient-to-r from-primary to-indigo-600 shadow-lg shadow-primary/20"
                    onClick={() => setUploadDialogOpen(true)}
                >
                    <Plus size={16} />
                    Upload File
                </Button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    placeholder="Search files..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-secondary/30 border-border/50 focus:border-primary/50"
                />
            </div>

            {/* Upload Dialog */}
            <Dialog open={uploadDialogOpen} onOpenChange={(open) => !isUploading && setUploadDialogOpen(open)}>
                <DialogContent className="bg-card border-border/50">
                    <DialogHeader>
                        <DialogTitle>Upload File</DialogTitle>
                    </DialogHeader>
                    <div
                        className={`relative flex flex-col items-center justify-center p-10 border-2 border-dashed rounded-xl text-center transition-all cursor-pointer
                            ${dragOver ? 'border-primary bg-primary/5' : 'border-border/50 hover:border-primary/40'}`}
                        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={handleDrop}
                    >
                        {isUploading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 size={40} className="text-primary animate-spin" />
                                <p className="text-sm text-muted-foreground">Encrypting & uploading...</p>
                            </div>
                        ) : (
                            <>
                                <Upload size={40} className="text-muted-foreground mb-3" />
                                <p className="text-sm">Drag & drop a file here</p>
                                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                                <input
                                    type="file"
                                    className="absolute inset-0 opacity-0 cursor-pointer"
                                    onChange={(e) => {
                                        const f = e.target.files?.[0]
                                        if (f) handleFileUpload(f)
                                    }}
                                />
                            </>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Files list */}
            <div className="space-y-2">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
                        <Loader2 size={28} className="animate-spin" />
                        <p className="text-sm">Loading files...</p>
                    </div>
                ) : filteredFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <File size={48} className="opacity-30 mb-4" />
                        <h3 className="font-semibold text-foreground">No files yet</h3>
                        <p className="text-sm">Upload your first encrypted file to get started</p>
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
                                    <div className="w-11 h-11 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                        <FileText size={20} className="text-primary" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="text-sm font-semibold truncate">{file.name}</h4>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-xs text-muted-foreground font-mono">
                                                {file.cid?.substring(0, 12)}...
                                            </span>
                                            {file.size && (
                                                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                    {formatBytes(file.size)}
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:text-primary"
                                            onClick={() => navigate(`/files/${file.id}`)}
                                            title="View"
                                        >
                                            <Eye size={16} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:text-cyan-400"
                                            onClick={() => navigate(`/files/${file.id}`)}
                                            title="Share"
                                        >
                                            <Share2 size={16} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:text-emerald-400"
                                            onClick={() => setPublicLinkFile(file)}
                                            title="Public Link"
                                        >
                                            <Link2 size={16} />
                                        </Button>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 hover:text-destructive"
                                            onClick={() => handleDelete(file.id)}
                                            title="Delete"
                                        >
                                            <Trash2 size={16} />
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </motion.div>
                    ))
                )}
            </div>

            {/* Public Link Dialog */}
            {publicLinkFile && (
                <CreatePublicLinkDialog
                    isOpen={!!publicLinkFile}
                    onClose={() => setPublicLinkFile(null)}
                    fileId={publicLinkFile.id}
                    fileName={publicLinkFile.name}
                />
            )}
        </div>
    )
}

export default MyFilesPage
