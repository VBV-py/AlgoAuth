import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Key, Shield, AlertTriangle, Check, Loader2, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
    generateX25519KeyPair,
    saveKeyPair,
    loadKeyPair,
} from '@/lib/publicKeyRegistry'
import { apiCall } from '@/lib/contractClient'

interface EncryptionKeyPromptProps {
    walletAddress: string
    onComplete?: () => void
}

/**
 * Shown on first login — generates an X25519 key pair for the user
 * and registers the public key with the server.
 */
const EncryptionKeyPrompt: React.FC<EncryptionKeyPromptProps> = ({
    walletAddress,
    onComplete,
}) => {
    const [step, setStep] = useState<'prompt' | 'generating' | 'done'>('prompt')
    const [publicKey, setPublicKey] = useState<string>('')
    const [error, setError] = useState<string | null>(null)

    // Check if key already exists
    useEffect(() => {
        const existing = loadKeyPair(walletAddress)
        if (existing) {
            setPublicKey(existing.publicKey)
            setStep('done')
        }
    }, [walletAddress])

    const handleGenerate = async () => {
        setStep('generating')
        setError(null)

        try {
            // Generate X25519 keypair
            const keyPair = generateX25519KeyPair()
            saveKeyPair(walletAddress, keyPair)
            setPublicKey(keyPair.publicKey)

            // Register public key with server
            const res = await apiCall('/keys/register', {
                method: 'POST',
                body: JSON.stringify({ publicKey: keyPair.publicKey }),
            })

            if (!res.ok) {
                console.warn('Failed to register public key on server')
            }

            setStep('done')
            onComplete?.()
        } catch (err: any) {
            setError(err.message || 'Failed to generate key pair')
            setStep('prompt')
        }
    }

    if (step === 'done') return null

    return (
        <AnimatePresence>
            <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
            >
                <Card className="bg-gradient-to-br from-primary/5 to-primary/10 border-primary/20">
                    <CardContent className="p-6">
                        <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                                <Key size={24} className="text-primary" />
                            </div>
                            <div className="flex-1 space-y-3">
                                <div>
                                    <h3 className="font-semibold text-lg">Set Up Encryption Keys</h3>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        Generate your X25519 encryption key pair. This is needed for secure file sharing
                                        and is stored locally in your browser.
                                    </p>
                                </div>

                                {error && (
                                    <div className="flex items-center gap-2 text-destructive text-sm">
                                        <AlertTriangle size={14} />
                                        {error}
                                    </div>
                                )}

                                {step === 'prompt' && (
                                    <div className="flex items-center gap-4">
                                        <Button onClick={handleGenerate}>
                                            <Shield size={16} />
                                            Generate Key Pair
                                        </Button>
                                        <span className="text-xs text-muted-foreground">
                                            Keys are derived locally — never sent to any server.
                                        </span>
                                    </div>
                                )}

                                {step === 'generating' && (
                                    <div className="flex items-center gap-2 text-primary text-sm">
                                        <Loader2 size={16} className="animate-spin" />
                                        Generating key pair...
                                    </div>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </motion.div>
        </AnimatePresence>
    )
}

export default EncryptionKeyPrompt
