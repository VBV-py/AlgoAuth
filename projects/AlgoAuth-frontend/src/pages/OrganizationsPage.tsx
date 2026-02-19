import React, { useState, useEffect, useRef } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { motion } from 'framer-motion'
import {
    Users,
    Plus,
    Search,
    UserPlus,
    Crown,
    Building2,
    Loader2,
    Settings,
    CheckCircle2,
    XCircle,
    Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog'
import { encryptFile } from '@/lib/encryption'
import { splitSecret, shareToHex } from '@/lib/shamirSecretSharing'
import { apiCall } from '@/lib/contractClient'
import ManageMembersSheet from '@/components/ManageMembersSheet'

interface Group {
    id: string
    name: string
    creator: string
    members: { address: string; role: string; status: string }[]
    createdAt: number
}

const OrganizationsPage: React.FC = () => {
    const { activeAddress } = useWallet()
    const [searchQuery, setSearchQuery] = useState('')
    const [createOpen, setCreateOpen] = useState(false)
    const [newGroupName, setNewGroupName] = useState('')
    const [groups, setGroups] = useState<Group[]>([])
    const [loading, setLoading] = useState(true)
    const [creating, setCreating] = useState(false)
    const [managingGroup, setManagingGroup] = useState<Group | null>(null)
    const [uploadingGroupId, setUploadingGroupId] = useState<string | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        loadGroups()
    }, [])

    const loadGroups = async () => {
        try {
            const res = await apiCall('/groups')
            if (res.ok) {
                const data = await res.json()
                setGroups(data.groups || [])
            }
        } catch { }
        setLoading(false)
    }

    const handleCreateGroup = async () => {
        if (!newGroupName.trim()) return
        setCreating(true)
        try {
            const res = await apiCall('/groups', {
                method: 'POST',
                body: JSON.stringify({ name: newGroupName.trim() }),
            })
            if (res.ok) {
                const newGroup = await res.json()
                setGroups((prev) => [newGroup, ...prev])
                setNewGroupName('')
                setCreateOpen(false)
            } else {
                const err = await res.json()
                alert(err.error || 'Create failed')
            }
        } catch (err: any) {
            alert('Create failed: ' + err.message)
        } finally {
            setCreating(false)
        }
    }

    const handleAcceptInvite = async (groupId: string) => {
        try {
            const res = await apiCall(`/groups/${groupId}/accept`, { method: 'POST' })
            if (res.ok) {
                await loadGroups()
            } else {
                const err = await res.json()
                alert(err.error || 'Accept failed')
            }
        } catch (err: any) {
            alert('Accept failed: ' + err.message)
        }
    }

    const handleDeclineInvite = async (groupId: string) => {
        if (!activeAddress) return
        try {
            const res = await apiCall(`/groups/${groupId}/members/${activeAddress}`, { method: 'DELETE' })
            if (res.ok) {
                setGroups(prev => prev.filter(g => g.id !== groupId))
            } else {
                const err = await res.json()
                alert(err.error || 'Decline failed')
            }
        } catch (err: any) {
            alert('Decline failed: ' + err.message)
        }
    }

    const handleGroupFileUpload = async (file: File, groupId: string) => {
        if (!activeAddress) return
        setUploadingGroupId(groupId)
        try {
            // 1. Read & encrypt
            const fileData = await file.arrayBuffer()
            const { encrypted, keyBytes } = await encryptFile(fileData)

            // 2. Split key via Shamir (2-of-3)
            const shares = splitSecret(keyBytes, 3, 2)
            const shareHexes = shares.map(shareToHex)
            const keyHex = Array.from(keyBytes).map((b: number) => b.toString(16).padStart(2, '0')).join('')

            // 3. Upload with groupId
            const formData = new FormData()
            formData.append('file', new Blob([encrypted.buffer as ArrayBuffer]), file.name + '.enc')
            formData.append('filename', file.name)
            formData.append('encryptionKey', keyHex)
            formData.append('shares', JSON.stringify(shareHexes))
            formData.append('groupId', groupId)

            const uploadRes = await apiCall('/files/upload', {
                method: 'POST',
                body: formData,
                headers: undefined,
            })

            if (!uploadRes.ok) {
                const errData = await uploadRes.json()
                throw new Error(errData.error || 'Upload failed')
            }

            const newFile = await uploadRes.json()
            sessionStorage.setItem(`key_${newFile.cid}`, keyHex)
            sessionStorage.setItem(`key_${newFile.id}`, keyHex)

            console.log(`📁 File uploaded to group ${groupId}: ${file.name}`)
            alert(`File "${file.name}" uploaded to group successfully!`)
        } catch (err: any) {
            console.error('Group upload failed:', err)
            alert('Upload failed: ' + err.message)
        } finally {
            setUploadingGroupId(null)
        }
    }

    const filteredGroups = groups.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <div className="max-w-5xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h2 className="text-2xl font-bold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
                        Organizations
                    </h2>
                    <p className="text-muted-foreground text-sm mt-1">
                        Manage your groups and members
                    </p>
                </div>
                <Button
                    className="bg-gradient-to-r from-primary to-indigo-600 shadow-lg shadow-primary/20"
                    onClick={() => setCreateOpen(true)}
                >
                    <Plus size={16} />
                    Create Group
                </Button>
            </div>

            {/* Search */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                    placeholder="Search groups..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 bg-secondary/30 border-border/50 focus:border-primary/50"
                />
            </div>

            {/* Create Group Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
                <DialogContent className="bg-card border-border/50">
                    <DialogHeader>
                        <DialogTitle>Create Organization</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Group Name
                            </label>
                            <Input
                                placeholder="e.g. Research Team"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                className="bg-secondary/30 border-border/50"
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                        <Button
                            className="bg-gradient-to-r from-primary to-indigo-600"
                            onClick={handleCreateGroup}
                            disabled={!newGroupName.trim() || creating}
                        >
                            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                            Create
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Groups List */}
            <div className="space-y-2">
                {loading ? (
                    <div className="flex items-center justify-center py-16">
                        <Loader2 size={24} className="animate-spin text-muted-foreground" />
                    </div>
                ) : filteredGroups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                        <Building2 size={48} className="opacity-30 mb-4" />
                        <h3 className="font-semibold text-foreground">No organizations yet</h3>
                        <p className="text-sm">Create your first group to start collaborating</p>
                    </div>
                ) : (
                    filteredGroups.map((group, i) => {
                        const isAdmin = group.members?.some(
                            (m) => m.address === activeAddress && m.role === 'admin'
                        )
                        const myMembership = group.members?.find(m => m.address === activeAddress)
                        const isInvited = myMembership?.status === 'invited'
                        return (
                            <motion.div
                                key={group.id}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: i * 0.04 }}
                            >
                                <Card className={`bg-card/60 backdrop-blur-sm border-border/50 hover:border-border hover:bg-card/80 transition-all group ${isInvited ? 'border-amber-500/30' : ''}`}>
                                    <CardContent className="flex items-center gap-4 p-4">
                                        <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${isInvited ? 'bg-amber-500/20' : 'bg-amber-500/10'}`}>
                                            <Users size={20} className="text-amber-400" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <h4 className="text-sm font-semibold truncate">{group.name}</h4>
                                                {isAdmin && (
                                                    <Crown size={12} className="text-amber-400 shrink-0" />
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                    <Users size={10} />
                                                    {group.members?.length || 0} member{(group.members?.length || 0) !== 1 ? 's' : ''}
                                                </span>
                                                {isInvited ? (
                                                    <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30 bg-amber-500/10 animate-pulse">
                                                        Pending Invitation
                                                    </Badge>
                                                ) : (
                                                    <Badge variant="outline" className="text-[10px]">
                                                        {isAdmin ? 'Admin' : 'Member'}
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex gap-1">
                                            {isInvited ? (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 hover:bg-emerald-500/10 hover:text-emerald-400 text-emerald-400"
                                                        onClick={() => handleAcceptInvite(group.id)}
                                                    >
                                                        <CheckCircle2 size={14} />
                                                        Accept
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 hover:bg-destructive/10 hover:text-destructive text-muted-foreground"
                                                        onClick={() => handleDeclineInvite(group.id)}
                                                    >
                                                        <XCircle size={14} />
                                                        Decline
                                                    </Button>
                                                </>
                                            ) : (
                                                <>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => {
                                                            // Trigger a hidden file input for this group
                                                            const input = document.createElement('input')
                                                            input.type = 'file'
                                                            input.onchange = (e: any) => {
                                                                const f = e.target.files?.[0]
                                                                if (f) handleGroupFileUpload(f, group.id)
                                                            }
                                                            input.click()
                                                        }}
                                                        disabled={uploadingGroupId === group.id}
                                                        title="Upload File to Group"
                                                    >
                                                        {uploadingGroupId === group.id ? (
                                                            <Loader2 size={16} className="animate-spin" />
                                                        ) : (
                                                            <Upload size={16} />
                                                        )}
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-8 w-8 hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity"
                                                        onClick={() => setManagingGroup(group)}
                                                        title="Manage Group"
                                                    >
                                                        <Settings size={16} />
                                                    </Button>
                                                </>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        )
                    })
                )}
            </div>

            {/* Manage Members Sheet */}
            {managingGroup && (
                <ManageMembersSheet
                    isOpen={!!managingGroup}
                    onClose={() => { setManagingGroup(null); loadGroups() }}
                    groupId={managingGroup.id}
                    groupName={managingGroup.name}
                    currentAddress={activeAddress || ''}
                />
            )}
        </div>
    )
}

export default OrganizationsPage
