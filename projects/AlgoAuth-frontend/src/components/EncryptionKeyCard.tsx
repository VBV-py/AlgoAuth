import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Key, Copy, Check, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { loadKeyPair } from '@/lib/publicKeyRegistry'

interface EncryptionKeyCardProps {
    walletAddress: string
}

/**
 * Dashboard card showing the user's X25519 public key with copy functionality.
 */
const EncryptionKeyCard: React.FC<EncryptionKeyCardProps> = ({ walletAddress }) => {
    const [publicKey, setPublicKey] = useState<string | null>(null)
    const [copied, setCopied] = useState(false)

    useEffect(() => {
        const kp = loadKeyPair(walletAddress)
        if (kp) setPublicKey(kp.publicKey)
    }, [walletAddress])

    const handleCopy = () => {
        if (!publicKey) return
        navigator.clipboard.writeText(publicKey)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }

    if (!publicKey) return null

    return (
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="bg-card/60 backdrop-blur-xl border-border/50">
                <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                        <Key size={14} className="text-primary" />
                        Encryption Key
                        <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                            Active
                        </Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono text-muted-foreground bg-secondary/50 rounded px-2 py-1.5 truncate">
                            {publicKey}
                        </code>
                        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={handleCopy}>
                            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                        </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                        X25519 public key — share with others to receive encrypted files.
                    </p>
                </CardContent>
            </Card>
        </motion.div>
    )
}

export default EncryptionKeyCard
