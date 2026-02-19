import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link2, Clock, Copy, Check, Loader2, ExternalLink, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiCall } from '@/lib/contractClient'

interface CreatePublicLinkDialogProps {
    isOpen: boolean
    onClose: () => void
    fileId: string
    fileName: string
}

const EXPIRY_OPTIONS = [
    { label: '1 Hour', seconds: 3600 },
    { label: '6 Hours', seconds: 21600 },
    { label: '24 Hours', seconds: 86400 },
    { label: '7 Days', seconds: 604800 },
    { label: '30 Days', seconds: 2592000 },
]

const CreatePublicLinkDialog: React.FC<CreatePublicLinkDialogProps> = ({
    isOpen,
    onClose,
    fileId,
    fileName,
}) => {
    const [selectedExpiry, setSelectedExpiry] = useState(86400)
    const [creating, setCreating] = useState(false)
    const [linkToken, setLinkToken] = useState<string | null>(null)
    const [expiresAt, setExpiresAt] = useState<number>(0)
    const [copied, setCopied] = useState(false)

    const handleCreate = async () => {
        setCreating(true)
        try {
            const res = await apiCall(`/files/${fileId}/public-link`, {
                method: 'POST',
                body: JSON.stringify({ expiresIn: selectedExpiry }),
            })
            if (res.ok) {
                const data = await res.json()
                setLinkToken(data.linkToken)
                setExpiresAt(data.expiresAt)
            } else {
                const err = await res.json()
                alert(err.error || 'Failed to create link')
            }
        } catch (err: any) {
            alert('Failed: ' + err.message)
        } finally {
            setCreating(false)
        }
    }

    const publicUrl = linkToken
        ? `${window.location.origin}/public/${linkToken}`
        : ''

    const handleCopy = () => {
        navigator.clipboard.writeText(publicUrl)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    const handleClose = () => {
        setLinkToken(null)
        setCopied(false)
        onClose()
    }

    if (!isOpen) return null

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                onClick={handleClose}
            >
                <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full max-w-md"
                >
                    <Card className="bg-card border-border/50">
                        <CardHeader className="flex flex-row items-center justify-between pb-3">
                            <CardTitle className="text-base flex items-center gap-2">
                                <Link2 size={16} className="text-primary" />
                                Create Public Link
                            </CardTitle>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
                                <X size={14} />
                            </Button>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <p className="text-sm text-muted-foreground">
                                Generate a time-limited public access link for <strong>{fileName}</strong>.
                                Anyone with the link can view the file.
                            </p>

                            {!linkToken ? (
                                <>
                                    {/* Expiry selection */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium flex items-center gap-2">
                                            <Clock size={14} /> Link Expiry
                                        </label>
                                        <div className="flex flex-wrap gap-2">
                                            {EXPIRY_OPTIONS.map((opt) => (
                                                <Badge
                                                    key={opt.seconds}
                                                    variant={selectedExpiry === opt.seconds ? 'default' : 'outline'}
                                                    className="cursor-pointer"
                                                    onClick={() => setSelectedExpiry(opt.seconds)}
                                                >
                                                    {opt.label}
                                                </Badge>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="flex gap-2 pt-2">
                                        <Button onClick={handleCreate} disabled={creating} className="flex-1">
                                            {creating ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                                            Generate Link
                                        </Button>
                                        <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                                    </div>
                                </>
                            ) : (
                                /* Generated link display */
                                <div className="space-y-3">
                                    <div className="bg-secondary/50 rounded-lg p-3 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <input
                                                readOnly
                                                value={publicUrl}
                                                className="flex-1 bg-transparent text-xs font-mono text-foreground/80 outline-none"
                                            />
                                            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleCopy}>
                                                {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                            </Button>
                                        </div>
                                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                            <Clock size={10} />
                                            Expires: {new Date(expiresAt).toLocaleString()}
                                        </div>
                                    </div>
                                    <Button variant="outline" size="sm" className="w-full" onClick={handleClose}>
                                        Done
                                    </Button>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </motion.div>
            </motion.div>
        </AnimatePresence>
    )
}

export default CreatePublicLinkDialog
