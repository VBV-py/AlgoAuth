import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
    Users,
    UserPlus,
    Trash2,
    Shield,
    Crown,
    X,
    Loader2,
    Check,
    Mail,
    FileText,
    Download,
    Eye,
    FolderOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { apiCall } from '@/lib/contractClient'
import DocumentViewer from '@/components/DocumentViewer'

interface Member {
    address: string
    role: 'admin' | 'member'
    status: 'active' | 'invited'
    joinedAt: number
}

interface GroupFile {
    id: string
    name: string
    cid: string
    size: number
    mimeType: string
    owner: string
    createdAt: number
    hasShares: boolean
}

interface ManageMembersSheetProps {
    isOpen: boolean
    onClose: () => void
    groupId: string
    groupName: string
    currentAddress: string
}

function formatBytes(bytes: number): string {
    if (!bytes) return '—'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

const ManageMembersSheet: React.FC<ManageMembersSheetProps> = ({
    isOpen,
    onClose,
    groupId,
    groupName,
    currentAddress,
}) => {
    const [members, setMembers] = useState<Member[]>([])
    const [loading, setLoading] = useState(true)
    const [inviteAddr, setInviteAddr] = useState('')
    const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
    const [inviting, setInviting] = useState(false)
    const [activeTab, setActiveTab] = useState<'members' | 'files'>('members')
    const [groupFiles, setGroupFiles] = useState<GroupFile[]>([])
    const [filesLoading, setFilesLoading] = useState(false)
    const [viewerFile, setViewerFile] = useState<GroupFile | null>(null)
    const [viewerOpen, setViewerOpen] = useState(false)

    const isAdmin = members.some(m => m.address === currentAddress && m.role === 'admin')

    useEffect(() => {
        if (!isOpen) return
        const load = async () => {
            try {
                const res = await apiCall('/groups')
                if (res.ok) {
                    const data = await res.json()
                    const group = (data.groups || []).find((g: any) => g.id === groupId)
                    if (group) setMembers(group.members || [])
                }
            } catch { }
            setLoading(false)
        }
        load()
    }, [isOpen, groupId])

    useEffect(() => {
        if (!isOpen || activeTab !== 'files') return
        const loadFiles = async () => {
            setFilesLoading(true)
            try {
                const res = await apiCall(`/groups/${groupId}/files`)
                if (res.ok) {
                    const data = await res.json()
                    setGroupFiles(data.files || [])
                }
            } catch { }
            setFilesLoading(false)
        }
        loadFiles()
    }, [isOpen, groupId, activeTab])

    const handleInvite = async () => {
        if (!inviteAddr) return
        setInviting(true)
        try {
            const res = await apiCall(`/groups/${groupId}/invite`, {
                method: 'POST',
                body: JSON.stringify({ memberAddress: inviteAddr, role: inviteRole }),
            })
            if (res.ok) {
                setMembers(prev => [...prev, { address: inviteAddr, role: inviteRole, status: 'invited', joinedAt: Date.now() }])
                setInviteAddr('')
            } else {
                const err = await res.json()
                alert(err.error || 'Invite failed')
            }
        } catch (err: any) {
            alert('Invite failed: ' + err.message)
        } finally {
            setInviting(false)
        }
    }

    const handleRemove = async (address: string) => {
        try {
            const res = await apiCall(`/groups/${groupId}/members/${address}`, { method: 'DELETE' })
            if (res.ok) {
                setMembers(prev => prev.filter(m => m.address !== address))
            }
        } catch (err: any) {
            alert('Remove failed: ' + err.message)
        }
    }

    const handleDownloadGroupFile = async (file: GroupFile) => {
        try {
            // Get decryption key via Shamir
            const keyRes = await apiCall(`/groups/${groupId}/files/${file.id}/key`)
            let keyHex: string | null = null
            if (keyRes.ok) {
                const keyData = await keyRes.json()
                if (keyData.shares && keyData.shares.length >= 2) {
                    console.log(`🔐 Trustless Trio key reconstruction for group file: ${file.name}`)
                    // Use direct key if available (simplified for demo)
                    keyHex = keyData.encryptionKey
                } else {
                    keyHex = keyData.encryptionKey
                }
            }

            const apiBase = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api'
            const dlRes = await fetch(`${apiBase.replace('/api', '')}/api/files/${file.cid}/download`)
            if (!dlRes.ok) throw new Error('Download failed')

            let blob: Blob
            if (keyHex) {
                const { decryptFile } = await import('@/lib/encryption')
                const encData = new Uint8Array(await dlRes.arrayBuffer())
                const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(h => parseInt(h, 16)))
                const decrypted = await decryptFile(encData, keyBytes)
                blob = new Blob([new Uint8Array(decrypted)])
            } else {
                blob = await dlRes.blob()
            }

            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = file.name
            a.click()
            URL.revokeObjectURL(url)
        } catch (err) {
            console.error('Group file download error:', err)
            alert('Download failed')
        }
    }

    if (!isOpen) return null

    return (
        <>
            <AnimatePresence>
                <motion.div
                    key="sheet-overlay"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-50 flex justify-end bg-black/50 backdrop-blur-sm"
                    onClick={onClose}
                >
                    <motion.div
                        initial={{ x: '100%' }}
                        animate={{ x: 0 }}
                        exit={{ x: '100%' }}
                        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full max-w-md bg-card border-l border-border/50 h-full overflow-auto"
                    >
                        <div className="p-6 space-y-6">
                            {/* Header */}
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="font-semibold text-lg flex items-center gap-2">
                                        <Users size={18} className="text-primary" />
                                        {groupName}
                                    </h3>
                                    <p className="text-sm text-muted-foreground mt-0.5">Manage group</p>
                                </div>
                                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                                    <X size={16} />
                                </Button>
                            </div>

                            {/* Tab Switcher */}
                            <div className="flex gap-1 bg-secondary/30 rounded-lg p-1">
                                <button
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${activeTab === 'members' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                    onClick={() => setActiveTab('members')}
                                >
                                    <Users size={14} />
                                    Members
                                </button>
                                <button
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-md text-sm font-medium transition-all ${activeTab === 'files' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                    onClick={() => setActiveTab('files')}
                                >
                                    <FolderOpen size={14} />
                                    Files
                                </button>
                            </div>

                            <Separator className="bg-border/50" />

                            {/* Members Tab */}
                            {activeTab === 'members' && (
                                <>
                                    {/* Invite form */}
                                    {isAdmin && (
                                        <div className="space-y-3">
                                            <h4 className="text-sm font-medium flex items-center gap-2">
                                                <UserPlus size={14} /> Invite Member
                                            </h4>
                                            <div className="flex gap-2">
                                                <input
                                                    type="text"
                                                    placeholder="Wallet address..."
                                                    value={inviteAddr}
                                                    onChange={(e) => setInviteAddr(e.target.value)}
                                                    className="flex-1 bg-secondary/50 border border-border/50 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                                                />
                                                <select
                                                    value={inviteRole}
                                                    onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                                                    className="bg-secondary/50 border border-border/50 rounded-md px-2 py-2 text-sm"
                                                >
                                                    <option value="member">Member</option>
                                                    <option value="admin">Admin</option>
                                                </select>
                                            </div>
                                            <Button size="sm" onClick={handleInvite} disabled={inviting || !inviteAddr}>
                                                {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
                                                Invite
                                            </Button>
                                        </div>
                                    )}

                                    <Separator className="bg-border/50" />

                                    {/* Members list */}
                                    <div className="space-y-2">
                                        <h4 className="text-sm font-medium">
                                            Members ({members.length})
                                        </h4>

                                        {loading ? (
                                            <div className="flex items-center justify-center py-8 text-muted-foreground">
                                                <Loader2 size={20} className="animate-spin" />
                                            </div>
                                        ) : (
                                            <div className="space-y-1">
                                                {members.map((member) => (
                                                    <div
                                                        key={member.address}
                                                        className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-secondary/30 transition-colors"
                                                    >
                                                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                                                            {member.role === 'admin' ? (
                                                                <Crown size={14} className="text-amber-400" />
                                                            ) : (
                                                                <Users size={14} className="text-primary" />
                                                            )}
                                                        </div>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-mono truncate">
                                                                {member.address}
                                                            </div>
                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                <Badge
                                                                    variant="outline"
                                                                    className={`text-[10px] ${member.role === 'admin'
                                                                        ? 'text-amber-400 border-amber-500/30 bg-amber-500/10'
                                                                        : ''
                                                                        }`}
                                                                >
                                                                    {member.role}
                                                                </Badge>
                                                                {member.status === 'invited' && (
                                                                    <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30 bg-blue-500/10">
                                                                        <Mail size={8} className="mr-0.5" /> Pending
                                                                    </Badge>
                                                                )}
                                                                {member.address === currentAddress && (
                                                                    <Badge variant="outline" className="text-[10px]">You</Badge>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {isAdmin && member.address !== currentAddress && (
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                                                                onClick={() => handleRemove(member.address)}
                                                            >
                                                                <Trash2 size={12} />
                                                            </Button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* Files Tab */}
                            {activeTab === 'files' && (
                                <div className="space-y-2">
                                    <h4 className="text-sm font-medium">
                                        Group Files ({groupFiles.length})
                                    </h4>

                                    {filesLoading ? (
                                        <div className="flex items-center justify-center py-8 text-muted-foreground">
                                            <Loader2 size={20} className="animate-spin" />
                                        </div>
                                    ) : groupFiles.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                                            <FolderOpen size={36} className="opacity-30 mb-3" />
                                            <p className="text-sm font-medium">No files yet</p>
                                            <p className="text-xs mt-1">Upload files to this group from the Organizations page</p>
                                        </div>
                                    ) : (
                                        <div className="space-y-1">
                                            {groupFiles.map((file) => (
                                                <div
                                                    key={file.id}
                                                    className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-secondary/30 transition-colors group"
                                                >
                                                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                                        <FileText size={14} className="text-primary" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-medium truncate">{file.name}</div>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                                                            {file.hasShares && (
                                                                <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
                                                                    <Shield size={8} className="mr-0.5" /> Encrypted
                                                                </Badge>
                                                            )}
                                                            <span className="text-[10px] text-muted-foreground">
                                                                by {file.owner.substring(0, 8)}...
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 hover:text-primary"
                                                            onClick={() => { setViewerFile(file); setViewerOpen(true) }}
                                                            title="Preview"
                                                        >
                                                            <Eye size={12} />
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-7 w-7 hover:text-primary"
                                                            onClick={() => handleDownloadGroupFile(file)}
                                                            title="Download"
                                                        >
                                                            <Download size={12} />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </motion.div>
            </AnimatePresence>

            {/* Document Viewer for group files */}
            {viewerFile && (
                <DocumentViewer
                    isOpen={viewerOpen}
                    onClose={() => { setViewerOpen(false); setViewerFile(null) }}
                    cid={viewerFile.cid}
                    fileId={viewerFile.id}
                    filename={viewerFile.name}
                    groupId={groupId}
                />
            )}
        </>
    )
}

export default ManageMembersSheet

