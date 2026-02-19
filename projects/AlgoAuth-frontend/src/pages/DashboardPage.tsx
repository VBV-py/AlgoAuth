import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { motion } from 'framer-motion'
import {
    FileText,
    Share2,
    Users,
    Upload,
    Plus,
    Search,
    Activity,
    Loader2,
    Clock,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { apiCall } from '@/lib/contractClient'
import EncryptionKeyPrompt from '@/components/EncryptionKeyPrompt'
import EncryptionKeyCard from '@/components/EncryptionKeyCard'

interface StatItem {
    label: string
    value: number
    icon: React.ElementType
    color: string
    bgColor: string
}

interface AuditEvent {
    type: string
    actor: string
    fileId: string
    target: string | null
    timestamp: number
    txId: string | null
}

const DashboardPage: React.FC = () => {
    const { activeAddress } = useWallet()
    const navigate = useNavigate()
    const [fileCount, setFileCount] = useState(0)
    const [sharedCount, setSharedCount] = useState(0)
    const [groupCount, setGroupCount] = useState(0)
    const [loading, setLoading] = useState(true)
    const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([])

    useEffect(() => {
        const loadStats = async () => {
            try {
                const [filesRes, sharedRes, groupsRes, auditRes] = await Promise.all([
                    apiCall('/files'),
                    apiCall('/files/shared'),
                    apiCall('/groups'),
                    apiCall('/audit'),
                ])
                if (filesRes.ok) {
                    const data = await filesRes.json()
                    setFileCount(data.files?.length || 0)
                }
                if (sharedRes.ok) {
                    const data = await sharedRes.json()
                    setSharedCount(data.files?.length || 0)
                }
                if (groupsRes.ok) {
                    const data = await groupsRes.json()
                    setGroupCount(data.groups?.length || 0)
                }
                if (auditRes.ok) {
                    const data = await auditRes.json()
                    setAuditEvents((data.events || []).slice(0, 8))
                }
            } catch {
                // ignore
            } finally {
                setLoading(false)
            }
        }
        loadStats()
    }, [])

    const stats: StatItem[] = [
        { label: 'My Files', value: fileCount, icon: FileText, color: 'text-indigo-400', bgColor: 'bg-indigo-500/10' },
        { label: 'Shared Files', value: sharedCount, icon: Share2, color: 'text-cyan-400', bgColor: 'bg-cyan-500/10' },
        { label: 'Organizations', value: groupCount, icon: Users, color: 'text-amber-400', bgColor: 'bg-amber-500/10' },
    ]

    const quickActions = [
        { label: 'Upload File', icon: Upload, action: () => navigate('/files') },
        { label: 'Create Org', icon: Plus, action: () => navigate('/organizations') },
        { label: 'Browse Shared', icon: Search, action: () => navigate('/shared') },
    ]

    const auditTypeLabel: Record<string, string> = {
        FILE_UPLOAD: 'Uploaded',
        FILE_DELETE: 'Deleted',
        FILE_SHARE: 'Shared',
        PUBLIC_LINK_CREATED: 'Public Link',
        KEY_REGISTERED: 'Key Registered',
        GROUP_CREATED: 'Group Created',
        MEMBER_INVITED: 'Invited',
        MEMBER_REMOVED: 'Removed',
    }

    return (
        <div className="max-w-5xl mx-auto space-y-8">
            {/* Header */}
            <div>
                <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
                    Dashboard
                </h2>
                <p className="text-muted-foreground text-sm mt-1">
                    Welcome back{activeAddress ? `, ${activeAddress.slice(0, 6)}...` : ''}
                </p>
            </div>

            {/* Encryption Key Prompt (first-login) */}
            {activeAddress && (
                <EncryptionKeyPrompt walletAddress={activeAddress} />
            )}

            {/* Stats */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {stats.map((stat, i) => (
                    <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, y: 15 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: i * 0.1 }}
                    >
                        <Card className="bg-card/60 backdrop-blur-lg border-border/50 hover:border-border hover:shadow-lg transition-all cursor-default group">
                            <CardContent className="flex items-center gap-4 p-5">
                                <div className={`w-12 h-12 rounded-xl ${stat.bgColor} flex items-center justify-center group-hover:scale-110 transition-transform`}>
                                    <stat.icon size={22} className={stat.color} />
                                </div>
                                <div>
                                    <span className="text-2xl font-bold block">
                                        {loading ? <Loader2 size={20} className="animate-spin" /> : stat.value}
                                    </span>
                                    <span className="text-xs text-muted-foreground">{stat.label}</span>
                                </div>
                            </CardContent>
                        </Card>
                    </motion.div>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left Column */}
                <div className="space-y-6">
                    {/* Quick Actions */}
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                            <Activity size={16} className="text-primary" />
                            Quick Actions
                        </div>
                        <div className="space-y-2">
                            {quickActions.map((action, i) => (
                                <motion.div
                                    key={action.label}
                                    initial={{ opacity: 0, y: 10 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: 0.3 + i * 0.08 }}
                                >
                                    <Button
                                        variant="outline"
                                        className="w-full h-auto py-4 justify-start gap-3 bg-secondary/30 hover:bg-secondary/60 hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 transition-all"
                                        onClick={action.action}
                                    >
                                        <action.icon size={18} className="text-primary" />
                                        <span>{action.label}</span>
                                    </Button>
                                </motion.div>
                            ))}
                        </div>
                    </div>

                    {/* Encryption Key Card */}
                    {activeAddress && (
                        <EncryptionKeyCard walletAddress={activeAddress} />
                    )}
                </div>

                {/* Right Column — Audit Trail */}
                <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.4 }}
                >
                    <Card className="bg-card/60 backdrop-blur-xl border-border/50">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm flex items-center gap-2">
                                <Activity size={14} className="text-primary" />
                                Recent Activity
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            {auditEvents.length === 0 && !loading && (
                                <p className="text-xs text-muted-foreground py-4 text-center">
                                    No activity yet. Upload a file to get started.
                                </p>
                            )}
                            {auditEvents.map((event, i) => (
                                <div
                                    key={i}
                                    className="flex items-center gap-2.5 py-2 border-b border-border/20 last:border-0 text-xs"
                                >
                                    <Clock size={10} className="text-muted-foreground shrink-0" />
                                    <span className="text-muted-foreground shrink-0">
                                        {new Date(event.timestamp).toLocaleString(undefined, {
                                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                                        })}
                                    </span>
                                    <Badge variant="outline" className="text-[9px]">
                                        {auditTypeLabel[event.type] || event.type}
                                    </Badge>
                                </div>
                            ))}
                        </CardContent>
                    </Card>
                </motion.div>
            </div>
        </div>
    )
}

export default DashboardPage
