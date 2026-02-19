import React, { useState } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Shield, Lock, Users, Loader2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { apiCall } from '@/lib/contractClient'

const LoginPage: React.FC = () => {
    const { wallets, activeAddress } = useWallet()
    const navigate = useNavigate()
    const [isAuthenticating, setIsAuthenticating] = useState(false)
    const [error, setError] = useState('')

    const handleAuthenticate = async () => {
        if (!activeAddress) return
        setIsAuthenticating(true)
        setError('')

        try {
            // Step 1: Request a nonce from the server (GET /auth/nonce/:address)
            const nonceRes = await apiCall(`/auth/nonce/${activeAddress}`, {
                method: 'GET',
            })
            const { nonce, message } = await nonceRes.json()

            // Step 2: Verify with the server (POST /auth/verify)
            const verifyRes = await apiCall('/auth/verify', {
                method: 'POST',
                body: JSON.stringify({ address: activeAddress, nonce, message }),
            })

            if (!verifyRes.ok) throw new Error('Authentication failed')
            const { token } = await verifyRes.json()
            localStorage.setItem('blocksafe_jwt', token)
            navigate('/dashboard')
        } catch (err: any) {
            console.error('Auth error:', err)
            // Dev fallback: skip if API isn't available
            if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
                localStorage.setItem('blocksafe_jwt', 'dev-mode-token')
                navigate('/dashboard')
            } else {
                setError(err.message || 'Authentication failed')
            }
        } finally {
            setIsAuthenticating(false)
        }
    }

    const features = [
        { icon: Lock, text: 'End-to-end AES-256 Encryption' },
        { icon: Shield, text: 'Shamir Secret Sharing (2-of-3)' },
        { icon: Users, text: 'Algorand On-Chain Access Control' },
    ]

    return (
        <div className="min-h-screen flex items-center justify-center relative overflow-hidden p-5">
            {/* Background gradient */}
            <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_20%_50%,rgba(99,102,241,0.15),transparent_50%),radial-gradient(ellipse_at_80%_20%,rgba(6,182,212,0.1),transparent_50%),radial-gradient(ellipse_at_50%_80%,rgba(139,92,246,0.08),transparent_50%)]" />

            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
                className="relative z-10 w-full max-w-md"
            >
                <Card className="bg-card/60 backdrop-blur-2xl border-border/50 shadow-2xl shadow-primary/10">
                    <CardHeader className="text-center pb-2 space-y-4">
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ delay: 0.2 }}
                            className="mx-auto w-20 h-20 rounded-full bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center shadow-lg shadow-primary/30"
                        >
                            <Shield size={36} className="text-white" />
                        </motion.div>
                        <div>
                            <h1 className="text-3xl font-extrabold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
                                BlockSafe
                            </h1>
                            <p className="text-muted-foreground text-sm mt-1">
                                Decentralized File Vault on Algorand
                            </p>
                        </div>
                    </CardHeader>

                    <CardContent className="space-y-6">
                        {/* Features */}
                        <div className="space-y-2">
                            {features.map((f, i) => (
                                <motion.div
                                    key={i}
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 0.3 + i * 0.1 }}
                                    className="flex items-center gap-3 p-2.5 rounded-lg bg-secondary/50 border border-border/30 text-sm text-muted-foreground"
                                >
                                    <f.icon size={16} className="text-cyan-400 shrink-0" />
                                    <span>{f.text}</span>
                                </motion.div>
                            ))}
                        </div>

                        {!activeAddress ? (
                            /* Wallet connection buttons */
                            <div className="space-y-3">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                    Connect Wallet
                                </p>
                                {wallets.map((wallet) => (
                                    <Button
                                        key={wallet.id}
                                        variant="outline"
                                        className="w-full justify-between h-12 bg-secondary/40 hover:bg-secondary hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 transition-all"
                                        onClick={() => wallet.connect()}
                                    >
                                        <div className="flex items-center gap-3">
                                            {wallet.metadata.icon && (
                                                <img src={wallet.metadata.icon} alt="" className="w-6 h-6 rounded" />
                                            )}
                                            <span className="font-medium">{wallet.metadata.name}</span>
                                        </div>
                                        <ChevronRight size={16} className="text-muted-foreground" />
                                    </Button>
                                ))}
                            </div>
                        ) : (
                            /* Authenticated state */
                            <div className="space-y-4">
                                <div className="text-center space-y-2">
                                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30">
                                        ● Connected
                                    </Badge>
                                    <p className="text-xs text-muted-foreground font-mono break-all px-4">
                                        {activeAddress}
                                    </p>
                                </div>

                                <Button
                                    className="w-full h-12 bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/90 hover:to-indigo-600/90 shadow-lg shadow-primary/25 font-semibold text-base"
                                    onClick={handleAuthenticate}
                                    disabled={isAuthenticating}
                                >
                                    {isAuthenticating ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            Authenticating...
                                        </>
                                    ) : (
                                        <>
                                            <Shield size={18} />
                                            Sign In with Algorand
                                        </>
                                    )}
                                </Button>
                            </div>
                        )}

                        {error && (
                            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm text-center">
                                {error}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </motion.div>
        </div>
    )
}

export default LoginPage
