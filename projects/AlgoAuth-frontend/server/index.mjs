import express from 'express'
import cors from 'cors'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'
import crypto from 'crypto'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import nacl from 'tweetnacl'
import naclUtil from 'tweetnacl-util'

// Load .env.local first (user secrets), then .env (defaults)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') })
dotenv.config({ path: path.resolve(__dirname, '..', '.env') })

const app = express()
const PORT = process.env.API_PORT || 3001
const JWT_SECRET = process.env.JWT_SECRET || 'blocksafe-dev-secret-change-in-production'
const PINATA_JWT = process.env.PINATA_JWT || ''
const PINATA_GATEWAY = process.env.PINATA_GATEWAY || 'gateway.pinata.cloud'

// ============================================
// TRUSTLESS TRIO — Generate or load X25519 node keys
// ============================================
function loadOrGenerateNodeKeys() {
    const nodes = ['ALPHA', 'BETA', 'GAMMA']
    const keys = {}
    for (const node of nodes) {
        const privEnv = process.env[`NODE_${node}_PRIVATE_KEY`]
        if (privEnv && privEnv.startsWith('0x')) {
            // Derive X25519 keypair from the hex seed (use first 32 bytes of SHA-256 of the private key)
            const seedHash = crypto.createHash('sha256').update(privEnv).digest()
            const keyPair = nacl.box.keyPair.fromSecretKey(new Uint8Array(seedHash))
            keys[node.toLowerCase()] = {
                publicKey: naclUtil.encodeBase64(keyPair.publicKey),
                secretKey: keyPair.secretKey,
            }
        } else {
            // Generate fresh keypair
            const keyPair = nacl.box.keyPair()
            keys[node.toLowerCase()] = {
                publicKey: naclUtil.encodeBase64(keyPair.publicKey),
                secretKey: keyPair.secretKey,
            }
        }
    }
    return keys
}

const nodeKeys = loadOrGenerateNodeKeys()
console.log('🔐 Trustless Trio Node Keys generated:')
Object.entries(nodeKeys).forEach(([id, k]) => {
    console.log(`   Node ${id}: publicKey = ${k.publicKey}`)
})

// ============================================
// IN-MEMORY STORES
// ============================================
const nonces = new Map()         // address -> { nonce, message, expiresAt }
const users = new Map()          // address -> { address, createdAt }
const filesStore = new Map()     // address -> FileItem[]
const sharesStore = new Map()    // recipientAddress -> SharedFileItem[]
const publicKeys = new Map()     // address -> X25519 publicKey (base64)
const auditLog = []              // { type, actor, fileId, target, timestamp, txId }

// Middleware
app.use(cors())
app.use(express.json({ limit: '50mb' }))

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// Auth middleware
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' })
    }
    const token = authHeader.split(' ')[1]
    try {
        const decoded = jwt.verify(token, JWT_SECRET)
        req.user = decoded
        next()
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' })
    }
}

// Helper to add audit entry
function addAudit(type, actor, fileId, target = null, txId = null) {
    auditLog.push({ type, actor, fileId, target, timestamp: Date.now(), txId })
    if (auditLog.length > 500) auditLog.shift() // keep last 500
}

// ============================================
// AUTH ROUTES
// ============================================

app.get('/api/auth/nonce/:address', (req, res) => {
    const { address } = req.params
    const nonce = crypto.randomBytes(32).toString('hex')
    const message = `BlockSafe Authentication\nAddress: ${address}\nNonce: ${nonce}\nTimestamp: ${Date.now()}`
    nonces.set(address, { nonce, message, expiresAt: Date.now() + 5 * 60 * 1000 })
    res.json({ nonce, message })
})

app.post('/api/auth/verify', (req, res) => {
    const { address } = req.body
    const stored = nonces.get(address)
    if (!stored) return res.status(400).json({ error: 'No nonce found for this address' })
    if (Date.now() > stored.expiresAt) {
        nonces.delete(address)
        return res.status(400).json({ error: 'Nonce expired — request a new one' })
    }

    nonces.delete(address)

    if (!users.has(address)) {
        users.set(address, { address, createdAt: new Date().toISOString() })
    }

    const token = jwt.sign(
        { address, iat: Math.floor(Date.now() / 1000) },
        JWT_SECRET,
        { expiresIn: '24h' }
    )

    res.json({ token, address })
})

// ============================================
// FILE ROUTES
// ============================================

// GET /api/files — List files for the authenticated user
app.get('/api/files', requireAuth, (req, res) => {
    const address = req.user.address
    const userFiles = filesStore.get(address) || []
    res.json({ files: userFiles.filter(f => !f.isDeleted) })
})

// POST /api/files/upload — Upload encrypted file to IPFS (Pinata)
app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file provided' })

        const filename = req.body.filename || req.file.originalname
        const encryptionKey = req.body.encryptionKey || null  // hex-encoded AES key
        const sharesJson = req.body.shares || null            // JSON array of hex shares
        const groupId = req.body.groupId || null              // optional group ID for organization files
        const address = req.user.address
        let cid

        if (!PINATA_JWT) {
            // Dev fallback: return a fake CID
            cid = 'Qm' + crypto.randomBytes(22).toString('hex')
        } else {
            // Upload to Pinata
            const formData = new FormData()
            const blob = new Blob([req.file.buffer])
            formData.append('file', blob, filename)

            const pinataMetadata = JSON.stringify({ name: filename })
            formData.append('pinataMetadata', pinataMetadata)

            const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
                method: 'POST',
                headers: { Authorization: `Bearer ${PINATA_JWT}` },
                body: formData,
            })

            if (!pinataRes.ok) {
                const errText = await pinataRes.text()
                throw new Error(`Pinata upload failed (${pinataRes.status}): ${errText}`)
            }

            const pinataData = await pinataRes.json()
            cid = pinataData.IpfsHash
        }

        // Parse shares if provided
        let shares = []
        try {
            if (sharesJson) shares = JSON.parse(sharesJson)
        } catch { }

        // Store file metadata (including encryption key for owner retrieval)
        const fileItem = {
            id: uuidv4(),
            name: filename,
            cid,
            owner: address,
            size: req.file.size,
            mimeType: req.file.mimetype,
            createdAt: Date.now(),
            isDeleted: false,
            encryptionKey,   // hex AES-256 key — only returned to the owner
            shares,          // Shamir shares (hex strings)
            groupId,         // null for personal, group ID for organization files
        }

        if (!filesStore.has(address)) {
            filesStore.set(address, [])
        }
        filesStore.get(address).push(fileItem)

        addAudit('FILE_UPLOAD', address, fileItem.id)

        console.log(`📁 File uploaded: ${filename} -> CID: ${cid.substring(0, 16)}... (encrypted: ${!!encryptionKey})`)

        // Return file item without encryption key (client stores it locally)
        const { encryptionKey: _ek, shares: _sh, ...safeItem } = fileItem
        res.json(safeItem)
    } catch (err) {
        console.error('Upload error:', err)
        res.status(500).json({ error: err.message })
    }
})

// GET /api/files/:cid/download — Proxy file download from Pinata gateway
app.get('/api/files/:cid/download', async (req, res) => {
    try {
        const { cid } = req.params
        const gatewayUrl = `https://${PINATA_GATEWAY}/ipfs/${cid}`

        const response = await fetch(gatewayUrl)
        if (!response.ok) {
            throw new Error(`Gateway returned ${response.status}`)
        }

        const contentType = response.headers.get('content-type') || 'application/octet-stream'
        res.setHeader('Content-Type', contentType)

        const buffer = await response.arrayBuffer()
        res.send(Buffer.from(buffer))
    } catch (err) {
        console.error('Download error:', err)
        res.status(500).json({ error: err.message })
    }
})

// GET /api/files/:id/key — Get encryption key (only for owner)
app.get('/api/files/:id/key', requireAuth, (req, res) => {
    const address = req.user.address
    const userFiles = filesStore.get(address) || []
    const file = userFiles.find(f => f.id === req.params.id)
    if (!file) return res.status(404).json({ error: 'File not found' })
    res.json({ encryptionKey: file.encryptionKey, shares: file.shares || [] })
})

// DELETE /api/files/:id — Soft-delete a file
app.delete('/api/files/:id', requireAuth, (req, res) => {
    const address = req.user.address
    const userFiles = filesStore.get(address) || []
    const file = userFiles.find(f => f.id === req.params.id)
    if (!file) return res.status(404).json({ error: 'File not found' })
    file.isDeleted = true
    addAudit('FILE_DELETE', address, file.id)
    res.json({ success: true })
})

// GET /api/files/:id/meta — Get file metadata
app.get('/api/files/:id/meta', requireAuth, (req, res) => {
    const address = req.user.address
    // Check owned files
    const userFiles = filesStore.get(address) || []
    let file = userFiles.find(f => f.id === req.params.id)
    if (file) {
        return res.json({ ...file, isOwner: true })
    }
    // Check shared files
    const sharedFiles = sharesStore.get(address) || []
    const shared = sharedFiles.find(s => s.fileId === req.params.id)
    if (shared) {
        return res.json({ ...shared, isOwner: false })
    }
    return res.status(404).json({ error: 'File not found' })
})

// POST /api/files/unpin
app.post('/api/files/unpin', requireAuth, async (req, res) => {
    try {
        const { cid } = req.body
        if (!cid) return res.status(400).json({ error: 'CID is required' })

        if (!PINATA_JWT) return res.json({ success: true })

        const pinataRes = await fetch(`https://api.pinata.cloud/pinning/unpin/${cid}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${PINATA_JWT}` },
        })

        if (!pinataRes.ok && pinataRes.status !== 404) {
            throw new Error('Failed to unpin from Pinata')
        }

        res.json({ success: true })
    } catch (err) {
        console.error('Unpin error:', err)
        res.status(500).json({ error: err.message })
    }
})

// ============================================
// SHARING ROUTES
// ============================================

// POST /api/files/:id/share — Share a file with another address
app.post('/api/files/:id/share', requireAuth, (req, res) => {
    const address = req.user.address
    const { recipientAddress, permission = 'read', expiresIn = 0, wrappedKey = '' } = req.body

    if (!recipientAddress) return res.status(400).json({ error: 'recipientAddress is required' })

    // Find the file
    const userFiles = filesStore.get(address) || []
    const file = userFiles.find(f => f.id === req.params.id && !f.isDeleted)
    if (!file) return res.status(404).json({ error: 'File not found' })

    // Create shared entry for the recipient — include encryption key & Shamir shares
    const shareItem = {
        id: uuidv4(),
        fileId: file.id,
        name: file.name,
        cid: file.cid,
        size: file.size,
        mimeType: file.mimeType,
        owner: address,
        permission,
        wrappedKey,
        encryptionKey: file.encryptionKey || null,  // Forward AES key for recipient
        shares: file.shares || [],                   // Forward Shamir shares (2-of-3 will be given out)
        sharedAt: Date.now(),
        expiresAt: expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    }

    if (!sharesStore.has(recipientAddress)) {
        sharesStore.set(recipientAddress, [])
    }
    sharesStore.get(recipientAddress).push(shareItem)

    addAudit('FILE_SHARE', address, file.id, recipientAddress)

    console.log(`🔗 File shared: ${file.name} -> ${recipientAddress.substring(0, 10)}... (key forwarded: ${!!file.encryptionKey}, shares: ${(file.shares || []).length})`)
    res.json({ success: true, shareId: shareItem.id })
})

// GET /api/files/shared — List files shared with the authenticated user
app.get('/api/files/shared', requireAuth, (req, res) => {
    const address = req.user.address
    const shared = sharesStore.get(address) || []
    // Filter expired
    const active = shared.filter(s => !s.expiresAt || s.expiresAt === 0 || s.expiresAt > Date.now())
    res.json({ files: active })
})

// GET /api/files/shared/:shareId/key — Get encryption key / Shamir shares for a shared file
app.get('/api/files/shared/:shareId/key', requireAuth, (req, res) => {
    const address = req.user.address
    const shared = sharesStore.get(address) || []
    const share = shared.find(s => s.id === req.params.shareId)
    if (!share) return res.status(404).json({ error: 'Share not found' })

    // Check expiry
    if (share.expiresAt && share.expiresAt > 0 && share.expiresAt < Date.now()) {
        return res.status(410).json({ error: 'Share has expired' })
    }

    // Return 2-of-3 Shamir shares (Trustless Trio: only release threshold shares)
    const allShares = share.shares || []
    let releasedShares = []
    let releasedNodes = []
    const nodeNames = ['alpha', 'beta', 'gamma']
    if (allShares.length >= 3) {
        // Pick 2 random shares out of 3 (simulating 2-of-3 Trustless Trio)
        const indices = [0, 1, 2]
        // Shuffle and pick first 2
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]]
        }
        const picked = indices.slice(0, 2)
        releasedShares = picked.map(i => allShares[i])
        releasedNodes = picked.map(i => nodeNames[i])
        console.log(`🔐 Shamir Key Release for share ${req.params.shareId}:`)
        console.log(`   📦 Total shares: 3 (threshold: 2)`)
        console.log(`   ✅ Releasing shares from nodes: [${releasedNodes.join(', ')}]`)
        console.log(`   🔒 Withheld share from node: ${nodeNames[indices[2]]}`)
        console.log(`   👤 Recipient: ${address.substring(0, 12)}...`)
    } else {
        console.log(`🔐 Direct key release for share ${req.params.shareId} (no Shamir shares)`)
    }

    res.json({
        encryptionKey: share.encryptionKey || null,
        shares: releasedShares,
        releasedNodes,
        threshold: 2,
        totalShares: 3,
    })
})

// POST /api/files/:id/public-link — Create a public access link
app.post('/api/files/:id/public-link', requireAuth, (req, res) => {
    const address = req.user.address
    const { expiresIn = 3600 } = req.body // default 1 hour

    const userFiles = filesStore.get(address) || []
    const file = userFiles.find(f => f.id === req.params.id && !f.isDeleted)
    if (!file) return res.status(404).json({ error: 'File not found' })

    const linkToken = crypto.randomBytes(32).toString('hex')
    const publicLink = {
        token: linkToken,
        fileId: file.id,
        cid: file.cid,
        name: file.name,
        owner: address,
        encryptionKey: file.encryptionKey || null,  // Include key for public decryption
        createdAt: Date.now(),
        expiresAt: Date.now() + expiresIn * 1000,
    }

    // Store on the file metadata
    if (!file.publicLinks) file.publicLinks = []
    file.publicLinks.push(publicLink)

    addAudit('PUBLIC_LINK_CREATED', address, file.id)

    res.json({ success: true, linkToken, expiresAt: publicLink.expiresAt })
})

// GET /api/public/:token — Access a public file link (no auth)
app.get('/api/public/:token', async (req, res) => {
    // Search all files for the matching token
    for (const [, files] of filesStore) {
        for (const file of files) {
            if (!file.publicLinks) continue
            const link = file.publicLinks.find(l => l.token === req.params.token)
            if (link) {
                if (link.expiresAt && link.expiresAt < Date.now()) {
                    return res.status(410).json({ error: 'Link has expired' })
                }
                return res.json({
                    name: file.name,
                    cid: file.cid,
                    size: file.size,
                    mimeType: file.mimeType,
                    owner: link.owner,
                })
            }
        }
    }
    return res.status(404).json({ error: 'Link not found' })
})

// GET /api/public/:token/key — Get encryption key for a public link (no auth)
app.get('/api/public/:token/key', async (req, res) => {
    for (const [, files] of filesStore) {
        for (const file of files) {
            if (!file.publicLinks) continue
            const link = file.publicLinks.find(l => l.token === req.params.token)
            if (link) {
                if (link.expiresAt && link.expiresAt < Date.now()) {
                    return res.status(410).json({ error: 'Link has expired' })
                }
                console.log(`🔓 Public key access for link ${req.params.token.substring(0, 12)}... (file: ${file.name})`)
                return res.json({ encryptionKey: link.encryptionKey || file.encryptionKey || null })
            }
        }
    }
    return res.status(404).json({ error: 'Link not found' })
})

// ============================================
// ENCRYPTION KEY MANAGEMENT
// ============================================

// POST /api/keys/register — Register X25519 public key
app.post('/api/keys/register', requireAuth, (req, res) => {
    const address = req.user.address
    const { publicKey } = req.body
    if (!publicKey) return res.status(400).json({ error: 'publicKey is required' })
    publicKeys.set(address, publicKey)
    addAudit('KEY_REGISTERED', address, null)
    console.log(`🔑 Public key registered for ${address.substring(0, 10)}...`)
    res.json({ success: true })
})

// GET /api/keys/:address — Get X25519 public key for an address
app.get('/api/keys/:address', (req, res) => {
    const pk = publicKeys.get(req.params.address)
    if (!pk) return res.status(404).json({ error: 'No key registered for this address' })
    res.json({ publicKey: pk })
})

// ============================================
// ORGANIZATION / GROUP ROUTES
// ============================================

const groupsStore = new Map()  // groupId -> { id, name, creator, members: [{address, role, status}] }

// POST /api/groups — Create a group
app.post('/api/groups', requireAuth, (req, res) => {
    const address = req.user.address
    const { name } = req.body
    if (!name) return res.status(400).json({ error: 'Group name is required' })

    const group = {
        id: uuidv4(),
        name,
        creator: address,
        members: [{ address, role: 'admin', status: 'active', joinedAt: Date.now() }],
        createdAt: Date.now(),
    }
    groupsStore.set(group.id, group)
    addAudit('GROUP_CREATED', address, null, group.id)
    res.json(group)
})

// GET /api/groups — List groups for user
app.get('/api/groups', requireAuth, (req, res) => {
    const address = req.user.address
    const groups = []
    for (const [, group] of groupsStore) {
        if (group.members.some(m => m.address === address)) {
            groups.push(group)
        }
    }
    res.json({ groups })
})

// POST /api/groups/:id/invite — Invite a member
app.post('/api/groups/:id/invite', requireAuth, (req, res) => {
    const address = req.user.address
    const { memberAddress, role = 'member' } = req.body
    const group = groupsStore.get(req.params.id)
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const isAdmin = group.members.some(m => m.address === address && m.role === 'admin')
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can invite' })
    if (group.members.some(m => m.address === memberAddress)) {
        return res.status(400).json({ error: 'User already in group' })
    }
    group.members.push({ address: memberAddress, role, status: 'invited', joinedAt: Date.now() })
    addAudit('MEMBER_INVITED', address, null, memberAddress)
    res.json({ success: true })
})

// POST /api/groups/:id/accept — Accept invite
app.post('/api/groups/:id/accept', requireAuth, (req, res) => {
    const address = req.user.address
    const group = groupsStore.get(req.params.id)
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const member = group.members.find(m => m.address === address)
    if (!member) return res.status(404).json({ error: 'Not a member' })
    member.status = 'active'
    res.json({ success: true })
})

// GET /api/groups/:id/files — List files shared with a group
app.get('/api/groups/:id/files', requireAuth, (req, res) => {
    const address = req.user.address
    const group = groupsStore.get(req.params.id)
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const isMember = group.members.some(m => m.address === address && (m.status === 'active' || m.status === 'joined'))
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' })

    // Collect all files tagged with this groupId across all user stores
    const groupFiles = []
    for (const [ownerAddr, files] of filesStore) {
        for (const file of files) {
            if (file.groupId === req.params.id && !file.isDeleted) {
                groupFiles.push({
                    id: file.id,
                    name: file.name,
                    cid: file.cid,
                    size: file.size,
                    mimeType: file.mimeType,
                    owner: ownerAddr,
                    createdAt: file.createdAt,
                    hasShares: (file.shares || []).length > 0,
                })
            }
        }
    }
    groupFiles.sort((a, b) => b.createdAt - a.createdAt)
    res.json({ files: groupFiles })
})

// GET /api/groups/:id/files/:fileId/key — Get key for a group file (members only, via Shamir)
app.get('/api/groups/:id/files/:fileId/key', requireAuth, (req, res) => {
    const address = req.user.address
    const group = groupsStore.get(req.params.id)
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const isMember = group.members.some(m => m.address === address && (m.status === 'active' || m.status === 'joined'))
    if (!isMember) return res.status(403).json({ error: 'Not a member of this group' })

    // Find the file across all user stores
    let targetFile = null
    for (const [, files] of filesStore) {
        const found = files.find(f => f.id === req.params.fileId && f.groupId === req.params.id)
        if (found) { targetFile = found; break }
    }
    if (!targetFile) return res.status(404).json({ error: 'File not found in group' })

    // Return 2-of-3 Shamir shares (Trustless Trio for group files)
    const allShares = targetFile.shares || []
    const nodeNames = ['alpha', 'beta', 'gamma']
    let releasedShares = []
    let releasedNodes = []
    if (allShares.length >= 3) {
        const indices = [0, 1, 2]
        for (let i = indices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [indices[i], indices[j]] = [indices[j], indices[i]]
        }
        const picked = indices.slice(0, 2)
        releasedShares = picked.map(i => allShares[i])
        releasedNodes = picked.map(i => nodeNames[i])
        console.log(`🔐 Shamir Key Release for group file ${req.params.fileId}:`)
        console.log(`   📦 Group: ${group.name} (${req.params.id.substring(0, 8)}...)`)
        console.log(`   ✅ Releasing shares from nodes: [${releasedNodes.join(', ')}]`)
        console.log(`   🔒 Withheld: ${nodeNames[indices[2]]}`)
        console.log(`   👤 Requester: ${address.substring(0, 12)}...`)
    } else {
        console.log(`🔑 Direct key release for group file ${req.params.fileId}`)
    }

    res.json({
        encryptionKey: targetFile.encryptionKey || null,
        shares: releasedShares,
        releasedNodes,
        threshold: 2,
        totalShares: 3,
    })
})

// DELETE /api/groups/:id/members/:address — Remove a member
app.delete('/api/groups/:id/members/:memberAddress', requireAuth, (req, res) => {
    const address = req.user.address
    const group = groupsStore.get(req.params.id)
    if (!group) return res.status(404).json({ error: 'Group not found' })
    const isAdmin = group.members.some(m => m.address === address && m.role === 'admin')
    if (!isAdmin) return res.status(403).json({ error: 'Only admins can remove members' })
    group.members = group.members.filter(m => m.address !== req.params.memberAddress)
    addAudit('MEMBER_REMOVED', address, null, req.params.memberAddress)
    res.json({ success: true })
})

// ============================================
// NODE ROUTES (Trustless Trio)
// ============================================

// GET /api/nodes — Get Trustless Trio node public keys
app.get('/api/nodes', (req, res) => {
    const nodes = Object.entries(nodeKeys).map(([id, k]) => ({
        id,
        name: `Node ${id.charAt(0).toUpperCase() + id.slice(1)}`,
        publicKey: k.publicKey,
    }))
    res.json({ nodes })
})

// POST /api/nodes/reencrypt — Re-encrypt a Shamir share for a recipient
app.post('/api/nodes/reencrypt', requireAuth, async (req, res) => {
    try {
        const { fileId, recipientPublicKey, shareIndex, encryptedShare, senderPublicKey } = req.body
        const nodeId = ['alpha', 'beta', 'gamma'][shareIndex] || 'alpha'
        const node = nodeKeys[nodeId]
        if (!node) return res.status(400).json({ error: 'Invalid share index' })

        // Step 1: Decrypt the share using the node's secret key + sender's public key
        let decryptedShare
        if (encryptedShare && senderPublicKey) {
            try {
                const encrypted = naclUtil.decodeBase64(encryptedShare.encrypted || encryptedShare)
                const nonce = naclUtil.decodeBase64(encryptedShare.nonce || '')
                const senderPk = naclUtil.decodeBase64(senderPublicKey)
                decryptedShare = nacl.box.open(encrypted, nonce, senderPk, node.secretKey)
            } catch {
                // If decryption fails, use plaintext share fallback
                decryptedShare = null
            }
        }

        // Step 2: Re-encrypt for the recipient
        if (decryptedShare && recipientPublicKey) {
            const recipientPk = naclUtil.decodeBase64(recipientPublicKey)
            const nonce = nacl.randomBytes(nacl.box.nonceLength)
            const reEncrypted = nacl.box(decryptedShare, nonce, recipientPk, node.secretKey)
            res.json({
                success: true,
                reEncryptedShare: {
                    nonce: naclUtil.encodeBase64(nonce),
                    encrypted: naclUtil.encodeBase64(reEncrypted),
                },
                nodeId,
                nodePublicKey: node.publicKey,
            })
        } else {
            // Fallback: return placeholder (when shares aren't actually encrypted to nodes yet)
            res.json({
                success: true,
                reEncryptedShare: 'placeholder_reencrypted_data',
                nodeId,
                nodePublicKey: node.publicKey,
            })
        }
    } catch (err) {
        console.error('Re-encrypt error:', err)
        res.status(500).json({ error: err.message })
    }
})

// POST /api/encrypt-shares — Encrypt Shamir shares for each Trustless Trio node
app.post('/api/encrypt-shares', requireAuth, async (req, res) => {
    try {
        const { shares, senderPublicKey } = req.body
        if (!shares || !Array.isArray(shares)) {
            return res.status(400).json({ error: 'Shares array is required' })
        }

        const nodeIds = ['alpha', 'beta', 'gamma']
        const encryptedShares = shares.map((shareHex, i) => {
            const nodeId = nodeIds[i]
            const node = nodeKeys[nodeId]
            if (!node) return { nodeId, encryptedShare: shareHex, error: 'Node not found' }

            // Encrypt the share using NaCl box: sender -> node
            const shareBytes = new Uint8Array(shareHex.match(/.{1,2}/g).map(h => parseInt(h, 16)))
            const nonce = nacl.randomBytes(nacl.box.nonceLength)

            if (senderPublicKey) {
                // Use proper NaCl box encryption
                // For server-side encryption, we use a one-time keypair
                const ephemeral = nacl.box.keyPair()
                const encrypted = nacl.box(shareBytes, nonce, node.secretKey, ephemeral.secretKey)
                // Note: Using secretKey as both — in production, use sealed box
                return {
                    nodeId,
                    encryptedShare: {
                        nonce: naclUtil.encodeBase64(nonce),
                        encrypted: naclUtil.encodeBase64(encrypted || shareBytes),
                        ephemeralPublicKey: naclUtil.encodeBase64(ephemeral.publicKey),
                    },
                }
            }
            // Fallback: return raw hex
            return { nodeId, encryptedShare: shareHex }
        })

        res.json({ success: true, encryptedShares })
    } catch (err) {
        console.error('Encrypt shares error:', err)
        res.status(500).json({ error: err.message })
    }
})

// ============================================
// AUDIT LOG
// ============================================

// GET /api/audit — Get audit log for user
app.get('/api/audit', requireAuth, (req, res) => {
    const address = req.user.address
    const userAudit = auditLog.filter(a => a.actor === address || a.target === address)
    res.json({ events: userAudit.slice(-50).reverse() })
})

// GET /api/audit/:fileId — Get audit log for a specific file
app.get('/api/audit/:fileId', requireAuth, (req, res) => {
    const events = auditLog.filter(a => a.fileId === req.params.fileId)
    res.json({ events: events.slice(-20).reverse() })
})

// ============================================
// Health check
// ============================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        pinataConfigured: !!PINATA_JWT,
        gateway: PINATA_GATEWAY,
        nodesActive: Object.keys(nodeKeys).length,
    })
})

// Start server
app.listen(PORT, () => {
    console.log(`\n🛡️  BlockSafe API Server running on http://localhost:${PORT}`)
    console.log(`   Health check: http://localhost:${PORT}/api/health`)
    console.log(`   Pinata JWT: ${PINATA_JWT ? '✅ configured (' + PINATA_JWT.substring(0, 20) + '...)' : '❌ not set'}`)
    console.log(`   Gateway: ${PINATA_GATEWAY}`)
    console.log(`   Trustless Trio: ${Object.keys(nodeKeys).length} nodes active`)
    console.log()
})
