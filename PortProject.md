# BlockSafe → Algorand Migration Guide

> **Purpose**: This document provides a comprehensive, file-by-file specification of the BlockSafe project architecture so that another LLM can reproduce the full application on the Algorand blockchain, preserving all features.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Technology Stack (Current vs Algorand)](#2-technology-stack)
3. [Architecture Diagram](#3-architecture-diagram)
4. [Smart Contracts](#4-smart-contracts)
5. [Authentication Flow](#5-authentication-flow)
6. [Encryption & Shamir's Secret Sharing](#6-encryption--shamirs-secret-sharing)
7. [API Routes](#7-api-routes)
8. [Frontend Pages & Components](#8-frontend-pages--components)
9. [Library Modules](#9-library-modules)
10. [Database Schema](#10-database-schema)
11. [Environment Variables](#11-environment-variables)
12. [Migration Mapping](#12-migration-mapping)
13. [Algorand-Specific Implementation Notes](#13-algorand-specific-implementation-notes)

---

## 1. Project Overview

**BlockSafe** is a decentralized file storage and sharing platform with:

- **End-to-end encryption** using AES-256-GCM (client-side)
- **Shamir's Secret Sharing** (2-of-3 threshold) to split encryption keys for organization files
- **Proxy Re-Encryption** via a "Trustless Trio" of nodes (Alpha, Beta, Gamma) that hold encrypted key shares
- **IPFS storage** via Pinata for encrypted file content
- **Blockchain-based access control** via two Solidity smart contracts
- **Group/Organization management** on-chain
- **MetaMask wallet authentication** with signature-based login (no passwords)
- **Public link sharing** with time-locked burner wallets

### Core User Flows

1. **Login**: Connect MetaMask → request nonce → sign message → verify signature → receive JWT
2. **Upload Personal File**: Generate AES key → encrypt file → upload to IPFS → register CID on-chain → store key in `sessionStorage`
3. **Upload Organization File**: Generate AES key → Shamir split into 3 shares → encrypt each share for a Trustless Trio node → encrypt file → upload to IPFS → register CID + encrypted shares on-chain
4. **Share File (P2P)**: Fetch recipient's on-chain encryption public key → ECIES-encrypt the AES key → grant access on-chain with wrapped key
5. **Download Shared File**: Unwrap ECIES key via MetaMask `eth_decrypt` → decrypt file
6. **Download Organization File**: Request re-encrypted shares from 2+ Trio nodes → reconstruct key via Shamir → decrypt file
7. **Public Link**: Create burner wallet → ECIES-encrypt AES key for burner → grant on-chain access with expiry → share link containing burner private key

---

## 2. Technology Stack

| Layer | Current (Ethereum/Hardhat) | Algorand Equivalent |
|---|---|---|
| Smart Contracts | Solidity (`.sol`) | PyTeal / Beaker / ARC-4 (Python) |
| Contract Framework | Hardhat | AlgoKit + PyTest |
| Contract Interaction | ethers.js v6 | algosdk (JS) / py-algorand-sdk |
| Wallet Connection | MetaMask + `window.ethereum` | `@txnlab/use-wallet-react` + Pera/Defly |
| Encryption Key Exchange | MetaMask `eth_getEncryptionPublicKey` / `eth_decrypt` | Custom X25519 key management (see §13) |
| Blockchain Events | Solidity `events` + `queryFilter` | Algorand Indexer + transaction notes |
| Frontend | Next.js 15 + React 19 | Next.js 15 + React 19 (same) |
| UI Components | shadcn/ui (Radix) | shadcn/ui (same) |
| Animations | Framer Motion | Framer Motion (same) |
| File Storage | Pinata (IPFS) | Pinata (IPFS) (same) |
| Database | MongoDB (Mongoose) | MongoDB (Mongoose) (same) |
| Auth Tokens | JWT (jsonwebtoken) | JWT (same) |
| Encryption | Web Crypto API (AES-GCM) | Web Crypto API (same) |
| Secret Sharing | Custom Shamir GF(256) | Custom Shamir (same, no changes) |
| Node Encryption | `@metamask/eth-sig-util` (x25519-xsalsa20-poly1305) | `tweetnacl` or `libsodium-wrappers` |

---

## 3. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js)                   │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  ┌───────────┐ │
│  │ Landing  │  │Dashboard │  │  My Files  │  │  Orgs     │ │
│  │ (Login)  │  │  Page    │  │   Page     │  │  Page     │ │
│  └────┬─────┘  └────┬─────┘  └─────┬──────┘  └─────┬─────┘ │
│       │              │              │               │       │
│  ┌────▼──────────────▼──────────────▼───────────────▼─────┐ │
│  │              Web3Provider / WalletProvider              │ │
│  │         (MetaMask → @txnlab/use-wallet-react)          │ │
│  └────────────────────────┬───────────────────────────────┘ │
└───────────────────────────┼─────────────────────────────────┘
                            │
              ┌─────────────▼──────────────┐
              │     Next.js API Routes     │
              │  /api/auth/*               │
              │  /api/files/*              │
              │  /api/encrypt-shares       │
              │  /api/nodes/reencrypt      │
              └──┬──────────┬──────────┬───┘
                 │          │          │
    ┌────────────▼┐   ┌─────▼────┐  ┌─▼──────────────┐
    │  MongoDB    │   │  Pinata  │  │  Smart Contracts│
    │ (User/Nonce)│   │  (IPFS)  │  │  (Blockchain)   │
    └─────────────┘   └──────────┘  │                 │
                                    │  FileRegistry   │
                                    │  GroupRegistry   │
                                    └─────────────────┘
```

---

## 4. Smart Contracts

### 4.1 FileRegistry.sol

**File**: `contracts/FileRegistry.sol` (176 lines)

This contract manages file registration, updates, deletion, access control, and encryption key storage.

#### Data Structures

```solidity
struct File {
    uint256 fileId;
    string currentCid;       // IPFS CID of the encrypted file
    address owner;
    string filename;
    uint256 groupId;         // 0 = personal file, >0 = organization file
    string[3] encryptedShares; // 3 encrypted Shamir shares (for org files)
    uint256 createdAt;
    uint256 lastUpdatedAt;   // Updated on updateFile()
    bool isDeleted;
}

struct AccessPermission {
    bool hasAccess;
    string permissionLevel;  // "read_only", "editor", "viewer"
    bytes wrappedKey;        // ECIES-encrypted AES key
    uint256 grantedAt;       // Timestamp of grant
    uint256 expiresAt;       // Unix timestamp, 0 = permanent
}
```

#### State Variables

```solidity
uint256 public fileCount;                                          // Auto-incrementing file ID
mapping(uint256 => File) public files;                             // fileId → File
mapping(uint256 => mapping(address => AccessPermission)) public accessControl;  // fileId → user → AccessPermission
mapping(address => string) public encryptionKeys;                  // User's x25519 public key
GroupRegistry public groupRegistry;                                // Reference to GroupRegistry
```

#### Functions

| Function | Signature | Description |
|---|---|---|
| `registerFile` | `(string cid, string filename, uint256 groupId, string[] encryptedShares)` | Creates a new file. Increments `fileCount`. Emits `FileRegistered(fileId, owner, groupId, filename)`. |
| `updateFile` | `(uint256 fileId, string newCid)` | Updates the CID (new version). Only owner. Emits `FileUpdated(fileId, newCid)`. |
| `deleteFile` | `(uint256 fileId)` | Soft-deletes (sets `isDeleted = true`). Only owner. Emits `FileDeleted(fileId)`. |
| `grantAccess` | `(uint256 fileId, address user, string permission, bytes wrappedKey, uint256 expiresAt)` | Grants access to a user with a wrapped AES key. Only owner. Emits `AccessGranted(fileId, owner, user, permission, expiresAt)`. |
| `revokeAccess` | `(uint256 fileId, address user)` | Revokes access. Only owner. Emits `AccessRevoked(fileId, user)`. |
| `getFileDetails` | `(uint256 fileId) → File` | Returns full file struct including `encryptedShares`. |
| `getAccessPermission` | `(uint256 fileId, address user) → AccessPermission` | Returns access details (hasAccess, permission, wrappedKey, grantedAt, expiresAt). |
| `hasValidAccess` | `(uint256 fileId, address user) → bool` | Checks if user has valid (non-expired) access. Also checks group membership via `groupRegistry`. Returns false for deleted files. |
| `getFileShares` | `(uint256 fileId) → string[3]` | Returns the 3 encrypted Shamir shares for a file. Requires caller to have valid access. |
| `registerPublicKey` | `(string publicKey)` | Stores `msg.sender`'s encryption public key. Emits `EncryptionKeyRegistered(user, publicKey)`. |

#### Events

```solidity
event FileRegistered(uint256 indexed fileId, address indexed owner, uint256 indexed groupId, string cid, string filename);
event FileUpdated(uint256 indexed fileId, address indexed updatedBy, string newCid);
event FileDeleted(uint256 indexed fileId, address indexed owner);
event AccessGranted(uint256 indexed fileId, address indexed owner, address indexed recipient, string permissionLevel, uint256 expiresAt);
event AccessRevoked(uint256 indexed fileId, address indexed owner, address indexed user);
event EncryptionKeyRegistered(address indexed user, string publicKey);
```

### 4.2 GroupRegistry.sol

**File**: `contracts/GroupRegistry.sol` (149 lines)

Manages organizations (groups), membership, roles, and invitations.

#### Data Structures

```solidity
enum MemberStatus { None, Invited, Joined }
enum Role { Member, Admin }

struct Group {
    uint256 groupId;
    string name;
    address createdBy;
}
```

#### State Variables

```solidity
uint256 public groupCount;
mapping(uint256 => Group) public groups;
mapping(uint256 => mapping(address => MemberStatus)) public memberStatus;
mapping(uint256 => mapping(address => Role)) public memberRole;
mapping(address => uint256[]) public userGroups;  // user → list of group IDs
```

#### Functions

| Function | Signature | Description |
|---|---|---|
| `createGroup` | `(string name)` | Creates group. Creator becomes Admin + Joined. Emits `GroupCreated`. |
| `inviteMember` | `(uint256 groupId, address user)` | Admin-only. Sets status=Invited. Adds group to user's list. Emits `UserInvited`. |
| `acceptInvite` | `(uint256 groupId)` | Invited user accepts. Status→Joined. Emits `UserJoined`. |
| `rejectInvite` | `(uint256 groupId)` | Invited user rejects. Status→None. Removes from userGroups. Emits `InviteRejected`. |
| `removeMember` | `(uint256 groupId, address user)` | Admin-only. Status→None. Removes from userGroups. Emits `MemberRemoved`. |
| `leaveGroup` | `(uint256 groupId)` | Member leaves. Status→None. Removes from userGroups. Emits `UserLeft`. |
| `getGroupDetails` | `(uint256 groupId) → Group` | Returns group details. |
| `getUserGroups` | `(address user) → uint256[]` | Returns all group IDs for user. |
| `getMemberStatus` | `(uint256 groupId, address user) → MemberStatus` | Returns 0=None, 1=Invited, 2=Joined. |
| `isMember` | `(uint256 groupId, address user) → bool` | Returns `status == Joined`. |
| `isAdmin` | `(uint256 groupId, address user) → bool` | Returns `role == Admin && status == Joined`. |

#### Events

```solidity
event GroupCreated(uint256 indexed groupId, string name, address createdBy);
event UserInvited(uint256 indexed groupId, address indexed invitedBy, address indexed user);
event UserJoined(uint256 indexed groupId, address indexed user);
event InviteRejected(uint256 indexed groupId, address indexed user);
event MemberRemoved(uint256 indexed groupId, address indexed removedBy, address indexed user);
event UserLeft(uint256 indexed groupId, address indexed user);
```

---

## 5. Authentication Flow

The auth flow uses wallet-based authentication (no username/password).

### Sequence

```
Client                          Server (/api/auth)                     MongoDB
  │                                    │                                  │
  │ 1. POST /request-message           │                                  │
  │    { address }                     │                                  │
  │ ──────────────────────────────────►│                                  │
  │                                    │  2. Generate nonce               │
  │                                    │     (crypto.randomBytes(32))      │
  │                                    │  3. Upsert User                  │
  │                                    │ ─────────────────────────────────►│
  │                                    │                                  │
  │ 4. Return { message, nonce }       │                                  │
  │ ◄──────────────────────────────────│                                  │
  │                                    │                                  │
  │ 5. MetaMask: signer.signMessage()  │                                  │
  │                                    │                                  │
  │ 6. POST /verify-signature          │                                  │
  │    { address, signature, nonce }   │                                  │
  │ ──────────────────────────────────►│                                  │
  │                                    │  7. Verify nonce matches DB      │
  │                                    │  8. ethers.verifyMessage()        │
  │                                    │  9. Generate JWT (1d expiry)     │
  │                                    │                                  │
  │ 10. Return { token }              │                                  │
  │ ◄──────────────────────────────────│                                  │
  │                                    │                                  │
  │ 11. Store token in localStorage    │                                  │
  │ 12. Redirect to /dashboard         │                                  │
```

### Message Format

```
Sign this message to log in to BlockSafe. Nonce: <64-char-hex-nonce>
```

### JWT Payload

```json
{
  "userId": "<MongoDB ObjectId>",
  "address": "<lowercase wallet address>",
  "iat": 1234567890,
  "exp": 1234654290
}
```

### Algorand Adaptation

Replace `ethers.verifyMessage` with Algorand transaction signing verification. The wallet address becomes the Algorand account address. The `@txnlab/use-wallet-react` library provides `signTransactions` which can be used for authentication.

---

## 6. Encryption & Shamir's Secret Sharing

### 6.1 Client-Side File Encryption (`src/lib/encryption.js`)

Uses the **Web Crypto API** with **AES-256-GCM**:

```javascript
// Key generation
generateKey() → CryptoKey (AES-GCM, 256-bit, encrypt/decrypt)

// Encryption: prepends 12-byte random IV to ciphertext
encryptFile(file, key) → Uint8Array([iv (12 bytes) | ciphertext])

// Decryption: splits IV and ciphertext
decryptFile(encryptedData, key) → ArrayBuffer

// Key serialization
exportKey(key) → ArrayBuffer (raw 32 bytes)
importKey(rawKey) → CryptoKey
```

**This module stays EXACTLY the same for Algorand.** No blockchain dependency.

### 6.2 Shamir's Secret Sharing (`src/lib/shamirSecretSharing.js`)

Custom implementation over **GF(256)** (Galois Field):

- **Threshold**: 2-of-3 (need any 2 shares to reconstruct)
- **Split**: Takes hex string → produces 3 shares, each prefixed with share ID (`01`, `02`, `03`)
- **Combine**: Takes 2+ shares → reconstructs original hex string via Lagrange interpolation

```javascript
// Helper: GF(256) multiplication using Russian Peasant algorithm
gfMul(a, b) → byte

// Helper: GF(256) division
gfDiv(a, b) → byte   // a * gfMul(b, inverse)

// Split a secret hex string into 3 shares
split(secretHex) → [share1, share2, share3]
// Each share: "0X" + hex(bytes)  where X ∈ {1,2,3}
// Polynomial: f(x) = secret[i] + a[i]*x  for random coeff a[i]

// Combine 2+ shares to reconstruct secret
combine(shareStrs) → secretHex
// Uses first 2 shares, Lagrange interpolation at x=0
```

**This module stays EXACTLY the same for Algorand.** No blockchain dependency.

### 6.3 Node Encryption (Trustless Trio)

Three nodes (Alpha, Beta, Gamma) each hold a **public key** (x25519, base64-encoded):

```javascript
// src/lib/nodeConfig.js
NODE_CONFIG = {
  alpha: { publicKey: 'YEbCKxfx76DTUDozKkVJXqXDn0G8OZWvdaF6jWfsuBk=' },
  beta:  { publicKey: 'D+GDXivUl5xEybE3zY2cwsWNnLdqQ3x2+mQ2Mnv5hBI=' },
  gamma: { publicKey: '0Cnt0tf/CAKmyVHvQoA91t67/CHU/cOFEiYRsd3zXQo=' }
}
```

**Encryption scheme**: `x25519-xsalsa20-poly1305` via `@metamask/eth-sig-util`:

```javascript
// Encrypt a share for a node (client-side, during upload)
encrypt({ publicKey, data: shareString, version: 'x25519-xsalsa20-poly1305' })
→ { version, nonce, ephemPublicKey, ciphertext }

// Decrypt a share (server-side, API route)
decrypt({ encryptedData, privateKey: nodePrivateKeyHex })
→ plaintext string
```

### 6.4 Key Flow Summary

#### Personal File Upload
```
AES key (32 bytes) → encryptFile(file) → upload encrypted to IPFS
                   → store key hex in sessionStorage[`key_${cid}`]
                   → registerFile(cid, name, groupId=0, shares=["","",""])
```

#### Organization File Upload
```
AES key (32 bytes) → split(keyHex) → [share1, share2, share3]
                   → encryptForNode(share1, alpha.pubkey) → encShare1
                   → encryptForNode(share2, beta.pubkey)  → encShare2
                   → encryptForNode(share3, gamma.pubkey) → encShare3
                   → encryptFile(file) → upload encrypted to IPFS
                   → registerFile(cid, name, groupId, [encShare1, encShare2, encShare3])
```

#### P2P File Sharing
```
Owner has key in sessionStorage → fetch recipient's encryptionKey from contract
→ ECIES encrypt key for recipient → grantAccess(fileId, recipient, perm, wrappedKey, expiry)
```

#### Trustless Trio Download (Organization Files)
```
User signs "Requesting access to file {id}"
→ POST /api/nodes/reencrypt for each node:
    Server: decrypt share with node private key → re-encrypt for user's public key
→ Client: MetaMask eth_decrypt each re-encrypted share
→ combine(2 shares) → importKey → decryptFile
```

---

## 7. API Routes

### 7.1 POST `/api/auth/request-message`

**File**: `src/app/api/auth/request-message/route.js`

**Purpose**: Generate a login nonce for wallet signature authentication.

**Request**: `{ address: string }`

**Logic**:
1. Connect to MongoDB
2. Generate 32 random bytes as hex nonce
3. Create message: `"Sign this message to log in to BlockSafe. Nonce: ${nonce}"`
4. Upsert user in MongoDB (by `walletAddress`) with new nonce

**Response**: `{ message: string, nonce: string }`

### 7.2 POST `/api/auth/verify-signature`

**File**: `src/app/api/auth/verify-signature/route.js`

**Purpose**: Verify signed message and issue JWT.

**Request**: `{ address: string, signature: string, nonce: string }`

**Logic**:
1. Connect to MongoDB
2. Find user by `walletAddress`
3. Verify nonce matches what was stored
4. Reconstruct expected message
5. `ethers.verifyMessage(message, signature)` → recovered address
6. Compare recovered address with provided address
7. Sign JWT with `{ userId, address }`, 1 day expiry

**Response**: `{ token: string }`

**Algorand change**: Replace `ethers.verifyMessage` with Algorand signature verification (`algosdk.verifyMultisigSignature` or equivalent).

### 7.3 POST `/api/encrypt-shares`

**File**: `src/app/api/encrypt-shares/route.js`

**Purpose**: Server-side encryption of Shamir shares for the three Trustless Trio nodes.

> **Note**: This route appears to be an older version. The current client-side code in `FileUploadDialog.jsx` encrypts shares directly using `@metamask/eth-sig-util`. This route may be deprecated.

**Request**: `{ shares: [string, string, string] }`

**Logic**:
1. For each share, uses ECDH (`secp256k1`) to derive shared secret with node public key
2. Encrypts with AES-256-GCM using derived key

**Response**: `{ encryptedShares: [string, string, string] }`

### 7.4 POST `/api/files/upload`

**File**: `src/app/api/files/upload/route.js`

**Purpose**: Upload an encrypted file to IPFS via Pinata.

**Auth**: Bearer JWT token (required)

**Request**: `FormData` with `file` field (the encrypted blob)

**Logic**:
1. Verify JWT from Authorization header
2. Parse multipart form data
3. Upload file to Pinata via SDK (`pinata.upload.file(file)`)
4. Return CID

**Response**: `{ cid: string }`

### 7.5 POST `/api/files/unpin`

**File**: `src/app/api/files/unpin/route.js`

**Purpose**: Remove a file from Pinata (called when deleting a file).

**Auth**: Bearer JWT token (required)

**Request**: `{ cid: string }`

**Logic**:
1. Verify JWT
2. Call `pinata.unpin(cid)`

**Response**: `{ success: true }`

### 7.6 POST `/api/nodes/reencrypt`

**File**: `src/app/api/nodes/reencrypt/route.js`

**Purpose**: Proxy re-encryption endpoint. A Trustless Trio node decrypts its share and re-encrypts it for the requesting user.

**Request**:
```json
{
  "nodeId": "alpha" | "beta" | "gamma",
  "fileId": number,
  "recipientPublicKey": "base64 x25519 public key",
  "signature": "signed 'Requesting access to file {fileId}'",
  "userAddress": "0x..."
}
```

**Logic**:
1. Validate inputs
2. Verify signature: `ethers.verifyMessage(message, signature)` must match `userAddress`
3. Connect to blockchain, get file details
4. Extract the correct encrypted share for this node
5. Decrypt the share using node's private key (from env: `NODE_{NAME}_PRIVATE_KEY`)
6. Re-encrypt the plaintext share for the recipient's public key
7. Return re-encrypted share

**Response**: `{ reEncryptedShare: string }` (JSON-stringified encrypted object)

**Algorand change**: Replace `ethers.verifyMessage` with Algorand signature verification. Replace `ethers.JsonRpcProvider` with Algorand Indexer/Algod client for reading file details from the smart contract.

---

## 8. Frontend Pages & Components

### 8.1 Pages

#### Landing Page — `src/app/page.jsx`

The home/login page. Features:
- **Connect Wallet** button triggers the full auth flow
- Calls `connectWallet()` from `Web3Provider`
- Sends request to `/api/auth/request-message` → signs message → sends to `/api/auth/verify-signature`
- Stores JWT in `localStorage.token`
- Redirects to `/dashboard` on success
- Beautiful gradient UI with Framer Motion animations, feature cards

#### App Layout — `src/app/(app)/layout.jsx`

Wraps all authenticated pages with:
- `<AuthGuard>` — redirects to login if no valid JWT
- `<EncryptionKeyPrompt>` — prompts user to register encryption key on-chain
- Sidebar navigation: Dashboard, My Files, Shared With Me, Organizations
- Connected wallet address display
- Logout button (clears JWT, redirects to `/`)

#### Dashboard — `src/app/(app)/dashboard/page.jsx`

Stats overview page:
- Queries `FileRegistered` events from blockchain for the current account
- Displays: Total Files, Shared in Groups, Group Access, Activity Score
- Bar chart of monthly activity
- Recent activity timeline
- Uses event `.args[3]` for filename, `.args[0]` for fileId

#### My Files — `src/app/(app)/my-files/page.jsx`

Personal file management:
- Queries `FileRegistered` events filtered by `owner == account`
- For each event, calls `contract.getFileDetails(fileId)` to get full details
- Filters out deleted files
- Table display: Name, CID (truncated), Size, Created date
- Actions: Share (links to `/file/{id}`), Delete
- Delete flow: `contract.deleteFile(fileId)` + `POST /api/files/unpin`
- Search/filter by filename
- `<FileUploadDialog>` component for upload

#### Shared With Me — `src/app/(app)/shared-with-me/page.jsx`

Files shared with the current user:
- Queries `AccessGranted` events where `recipient == account`
- For each, fetches file details
- Deduplicates by fileId (keeps latest expiration)
- Table display: Name, Owner (truncated address), Permission, Expiration status
- Expiration status computation: Permanent / Expired / Xd left / Xh left
- Click links to `/file/{id}` for viewing/downloading

#### Organizations — `src/app/(app)/organizations/page.jsx`

Group management:
- Calls `groupRegistry.getUserGroups(address)` → gets group IDs
- For each group: `getGroupDetails`, `getMemberStatus`, `isAdmin`
- Splits into Pending Invites (status=1) and Joined Groups (status=2)
- Pending: Accept/Decline buttons (`acceptInvite`/`rejectInvite`)
- Joined: Manage Members (sheet), Leave Group
- `<CreateGroupDialog>` for creating new groups
- `<FileUploadDialog requireGroup={true}>` for uploading to a group

#### File Details — `src/app/(app)/file/[id]/page.jsx`

Detailed view of a single file:
- Shows: filename, CID, owner, created date, access status
- **Access determination** (priority order):
  1. Owner? → full access
  2. Group member? → editor access (via `groupRegistry.isMember`)
  3. Individual share? → check `contract.getAccessPermission` (respects expiry)
- **Download/View** button behavior depends on file type:
  - Personal file owned by user: key from `sessionStorage`
  - Organization file: Trustless Trio flow (request shares from 2+ nodes)
  - Shared file: unwrap ECIES key via MetaMask `eth_decrypt`
- **Inline viewer** (DocumentViewer component) for images, PDFs, text
- **Share button** (ShareFileDialog) — only for owner
- **Public Link button** (CreatePublicLinkDialog) — only for owner
- **Audit Trail** tab: shows all blockchain events (Registered, Updated, Access Granted/Revoked)
- Download is disabled for `viewer`/`read_only` permission; only `editor` can download

#### Public Access Page — `src/app/public/[fileId]/page.jsx`

Standalone page for viewing files via public links (**no wallet required**):
- URL format: `/public/{fileId}?key={burnerPrivateKey}`
- Does **not** use `AuthGuard` or `Web3Provider` for wallet connection
- Creates an `ethers.Wallet` from the private key in the URL query param
- Connects to a read-only `ethers.JsonRpcProvider` (uses `NEXT_PUBLIC_RPC_URL` env var, defaults to `http://127.0.0.1:8545`)
- Fetches file details from the contract via the read-only provider
- Checks `hasValidAccess(fileId, burnerWalletAddress)` on-chain
- Handles expired/denied states with distinct error UIs
- Retrieves the `wrappedKey` from `getAccessPermission` and ECIES-decrypts it using the burner private key (via `@metamask/eth-sig-util.decrypt`)
- Imports the decrypted AES key, fetches encrypted file from IPFS, decrypts, and displays
- Uses `DocumentViewer` with `canDownload={false}` (view-only)
- Supports MIME type detection for images, PDFs, text, video, audio, office docs

**Algorand change**: Replace `ethers.Wallet`/`ethers.JsonRpcProvider` with Algorand account generation and Algod client. Replace ECIES decryption with `tweetnacl.box.open`. Need a read-only way to query contract state without a connected wallet.

### 8.2 Components

#### `Web3Provider.jsx`

React context providing wallet connection state:
- `provider`: `ethers.BrowserProvider(window.ethereum)`
- `signer`: MetaMask signer
- `account`: Connected wallet address
- `connectWallet()`: Requests accounts, gets signer, registers encryption public key
- Auto-reconnects on page load by checking `eth_accounts`
- Listens for `accountsChanged` events

**Algorand replacement**: Use `@txnlab/use-wallet-react`'s `WalletProvider` with Pera/Defly connectors. Expose `activeAddress`, `signTransactions`, `transactionSigner`.

#### `AuthGuard.jsx`

Protects authenticated routes:
- Reads JWT from `localStorage`
- Validates JWT format (3 parts) and expiration (base64-decode payload)
- Redirects to `/` if invalid
- Shows loading spinner while checking

**No blockchain dependency — stays the same for Algorand.**

#### `EncryptionKeyPrompt.jsx`

Modal dialog prompting first-time users to register their encryption public key:
- Checks `contract.encryptionKeys(account)` on mount
- If empty/null → shows dialog
- On register: calls `eth_getEncryptionPublicKey` → `contract.registerPublicKey(publicKey)`
- One-time operation per user

**Algorand change**: Encryption key registration must use Algorand smart contract calls. The `eth_getEncryptionPublicKey` method is MetaMask-specific and must be replaced with custom X25519 key generation (see §13).

#### `FileUploadDialog.jsx`

Upload dialog with two modes:
- **Personal mode** (`requireGroup=false`): encrypt + upload + register with `groupId=0`, empty shares
- **Organization mode** (`requireGroup=true`): shows group dropdown, Shamir splits key, encrypts shares for Trio nodes

Steps: `generateKey → [split + encryptForNode] → encryptFile → POST /api/files/upload → contract.registerFile`

#### `ShareFileDialog.jsx`

P2P file sharing dialog:
- Input: recipient address, permission (read_only/editor), expiration duration
- Retrieves AES key from `sessionStorage[key_{cid}]`
- Fetches recipient's `encryptionKeys` from contract
- ECIES-encrypts the AES key for recipient
- Calls `contract.grantAccess(fileId, recipient, permission, wrappedKey, duration)`

#### `CreatePublicLinkDialog.jsx`

Generates time-locked public links:
- Creates a random burner wallet (`ethers.Wallet.createRandom()`)
- Gets burner's x25519 public key via `getEncryptionPublicKey(privateKey)`
- ECIES-encrypts AES key for burner wallet
- Grants on-chain access to burner address with expiry
- Returns link: `/public/{fileId}?key={burnerPrivateKey}`
- Stores active link in `localStorage`

#### `GroupManagement.jsx`

Two exported components:

**`CreateGroupDialog`**: Simple form → calls `groupRegistry.createGroup(name)`

**`ManageMembersSheet`**: Side sheet with tabs:
- **Members tab**: Lists members from event reconstruction (GroupCreated, UserInvited, UserJoined, UserLeft, InviteRejected, MemberRemoved). Admin can invite (by address) and remove.
- **Files tab**: Lists group files by querying `FileRegistered` events filtered by `groupId`

#### `EncryptionKeyCard.jsx`

A card UI for managing encryption keys (used in the dashboard or settings):
- Displays the current user's x25519 encryption public key (fetched from `localStorage` via `publicKeyRegistry`)
- Copy-to-clipboard button for sharing the public key
- **Register Others' Keys** section: form to manually add another user's public key to `localStorage` by entering their address + public key
- Used for offline key exchange when recipients haven't registered their key on-chain

**No blockchain dependency for the card itself** — reads/writes `localStorage` only.

#### `DocumentViewer.jsx`

In-app file viewer modal:
- Supports: images (jpg/png/gif/svg/webp), PDF (iframe), text files (iframe)
- Others: download-only prompt
- Optional download button based on permissions

---

## 8.3 Root Layout

#### `src/app/layout.jsx`

The root layout wrapping the entire application:
- Imports `globals.css` (full theme)
- Uses **Geist** font family (`GeistSans` + `GeistMono` from `geist/font/sans` and `geist/font/mono`)
- Wraps all children in `<Web3Provider>`
- Sets `lang="en"` and applies `antialiased` class

#### `src/app/globals.css`

BlockSafe custom theme built with **Tailwind CSS v4** and `oklch` color space:
- Dual theme support: light (`:root`) and dark (`.dark`) modes
- Color palette based on **hue 290** (purple/violet) for primary/accent colors
- Custom CSS variables for: `--background`, `--foreground`, `--primary`, `--secondary`, `--accent`, `--muted`, `--destructive`, `--border`, `--ring`, `--card`, `--popover`, `--sidebar`, `--chart-1..5`
- Font stack: Inter (sans), Source Serif 4 (serif), JetBrains Mono (mono)
- Shadow system with configurable shadow variables
- Uses `@theme inline` directive for Tailwind v4 integration
- Uses `tw-animate-css` for animation utilities

**Preserve the theme system when migrating.** No blockchain dependency.

---

## 9. Library Modules

### `src/lib/contract.js`
```javascript
import contractConfig from './contract-config.json';
import FileRegistryABI from './FileRegistryABI.json';
import { ethers } from 'ethers';

export const getContract = (signer) => {
    return new ethers.Contract(
        contractConfig.fileRegistryAddress,
        FileRegistryABI.abi,
        signer
    );
};

// Also exports: getFileRegistryContract (identical)
```

**Algorand replacement**: Use `algosdk.ABIContract` or AlgoKit's `ApplicationClient` to interact with the deployed smart contract.

### `src/lib/groupRegistry.js`
```javascript
import GroupRegistryArtifact from '../../artifacts/contracts/GroupRegistry.sol/GroupRegistry.json';
import ContractConfig from './contract-config.json';

export const getGroupRegistryContract = (signerOrProvider) => {
    return new ethers.Contract(
        ContractConfig.groupRegistryAddress,
        GroupRegistryArtifact.abi,
        signerOrProvider
    );
};
```

### `src/lib/contract-config.json`
```json
{
  "fileRegistryAddress": "0x...",
  "groupRegistryAddress": "0x..."
}
```

**Algorand replacement**: Store Algorand application IDs instead of Ethereum addresses.

### `src/lib/encryption.js`
Web Crypto API AES-GCM — **no changes needed**

### `src/lib/shamirSecretSharing.js`
GF(256) Shamir — **no changes needed**

### `src/lib/nodeConfig.js`
Static node public keys — **no changes needed**

### `src/lib/publicKeyRegistry.js`
Client-side helper storing encryption keys in `localStorage`:
- `registerPublicKey(address)`: calls `eth_getEncryptionPublicKey`, saves to localStorage
- `getPublicKey(address)`: reads from localStorage
- `hasPublicKey(address)`: boolean check

**Algorand change**: Replace `eth_getEncryptionPublicKey` with custom X25519 key generation.

### `src/lib/db.js`
MongoDB connection with caching and `directConnection: true` workaround — **no changes needed**

### `src/lib/utils.js`
`cn()` — Tailwind class merger utility — **no changes needed**

### `src/lib/FileRegistryABI.json`
Hardhat-generated artifact containing the full ABI, bytecode, and deployed bytecode for `FileRegistry.sol`. This file is imported by `contract.js` — **must be regenerated from the new Algorand contract ABI (ARC-4 JSON)**.

---

## 10. Database Schema

### User Model (`src/models/User.js`)

```javascript
const UserSchema = new Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,       // Always stored lowercase
  },
  nonce: {
    type: String,          // Random 64-char hex string for auth
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});
```

**MongoDB is only used for authentication nonces.** All file metadata, access control, and group data lives on-chain.

**For Algorand**: The `walletAddress` field stores Algorand addresses (58-char base32) instead of Ethereum addresses (42-char hex).

---

## 11. Environment Variables

```env
# MongoDB
MONGODB_URI=mongodb://...?directConnection=true

# JWT Secret
JWT_SECRET=your_secret_key

# Pinata IPFS
PINATA_JWT=your_pinata_jwt
PINATA_GATEWAY=your_gateway.mypinata.cloud

# Trustless Trio Node Keys (x25519 private keys, hex)
NODE_ALPHA_PRIVATE_KEY=0x...
NODE_BETA_PRIVATE_KEY=0x...
NODE_GAMMA_PRIVATE_KEY=0x...

# Trustless Trio Node Public Keys (configured in nodeConfig.js, base64)
NODE_ALPHA_PUBLIC_KEY=YEbCKxfx76DTUDozKkVJXqXDn0G8OZWvdaF6jWfsuBk=
NODE_BETA_PUBLIC_KEY=D+GDXivUl5xEybE3zY2cwsWNnLdqQ3x2+mQ2Mnv5hBI=
NODE_GAMMA_PUBLIC_KEY=0Cnt0tf/CAKmyVHvQoA91t67/CHU/cOFEiYRsd3zXQo=

# Public (client-side)
NEXT_PUBLIC_IPFS_GATEWAY=https://gateway.pinata.cloud/ipfs/
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8545  # Used by public access page (no-wallet viewer)

# Algorand-specific (new)
NEXT_PUBLIC_ALGOD_SERVER=https://testnet-api.algonode.cloud
NEXT_PUBLIC_ALGOD_PORT=443
NEXT_PUBLIC_ALGOD_TOKEN=
NEXT_PUBLIC_INDEXER_SERVER=https://testnet-idx.algonode.cloud
NEXT_PUBLIC_INDEXER_PORT=443
NEXT_PUBLIC_FILE_REGISTRY_APP_ID=<deployed_app_id>
NEXT_PUBLIC_GROUP_REGISTRY_APP_ID=<deployed_app_id>
```

---

## 12. Migration Mapping

### File-by-File Guide

| Current File | Action | Algorand Equivalent |
|---|---|---|
| `contracts/FileRegistry.sol` | **REWRITE** | PyTeal/Beaker smart contract with ARC-4 methods |
| `contracts/GroupRegistry.sol` | **REWRITE** | PyTeal/Beaker smart contract with ARC-4 methods |
| `src/lib/contract.js` | **REWRITE** | Use `algosdk.ABIContract` + `ApplicationClient` |
| `src/lib/groupRegistry.js` | **REWRITE** | Use `algosdk.ABIContract` + `ApplicationClient` |
| `src/lib/contract-config.json` | **MODIFY** | Replace addresses with app IDs |
| `src/components/providers/Web3Provider.jsx` | **REWRITE** | Use `@txnlab/use-wallet-react` |
| `src/components/EncryptionKeyPrompt.jsx` | **MODIFY** | Replace `eth_getEncryptionPublicKey` with custom X25519 |
| `src/components/FileUploadDialog.jsx` | **MODIFY** | Replace `contract.registerFile` calls with Algorand txns |
| `src/components/ShareFileDialog.jsx` | **MODIFY** | Replace contract calls + `eth_getEncryptionPublicKey` |
| `src/components/CreatePublicLinkDialog.jsx` | **MODIFY** | Replace `ethers.Wallet.createRandom()` with Algorand account |
| `src/components/GroupManagement.jsx` | **MODIFY** | Replace `ethers.Contract` calls with Algorand calls |
| `src/app/page.jsx` | **MODIFY** | Replace MetaMask login with Pera/Defly wallet connect |
| `src/app/(app)/**/*.jsx` | **MODIFY** | Replace `contract.queryFilter` with Algorand Indexer queries |
| `src/app/public/[fileId]/page.jsx` | **MODIFY** | Replace `ethers.Wallet` + `ethers.JsonRpcProvider` with Algorand equivalents |
| `src/app/api/auth/verify-signature/route.js` | **MODIFY** | Replace `ethers.verifyMessage` with Algorand sig verification |
| `src/app/api/nodes/reencrypt/route.js` | **MODIFY** | Replace `ethers.verifyMessage` + `ethers.JsonRpcProvider` |
| `src/lib/encryption.js` | **NO CHANGE** | Web Crypto API — blockchain-independent |
| `src/lib/shamirSecretSharing.js` | **NO CHANGE** | Pure math — blockchain-independent |
| `src/lib/nodeConfig.js` | **NO CHANGE** | Static config — blockchain-independent |
| `src/lib/publicKeyRegistry.js` | **MODIFY** | Replace `eth_getEncryptionPublicKey` |
| `src/lib/FileRegistryABI.json` | **REPLACE** | Replace with Algorand ARC-4 ABI JSON |
| `src/lib/db.js` | **NO CHANGE** | MongoDB connection — blockchain-independent |
| `src/lib/utils.js` | **NO CHANGE** | Tailwind utility — blockchain-independent |
| `src/models/User.js` | **MINOR** | Wallet address format changes (58-char base32) |
| `src/components/AuthGuard.jsx` | **NO CHANGE** | JWT-only — blockchain-independent |
| `src/components/EncryptionKeyCard.jsx` | **MODIFY** | Replace `eth_getEncryptionPublicKey` references |
| `src/components/DocumentViewer.jsx` | **NO CHANGE** | UI-only — blockchain-independent |
| `src/app/layout.jsx` | **MODIFY** | Replace `<Web3Provider>` with Algorand `<WalletProvider>` |
| `src/app/globals.css` | **NO CHANGE** | Theme/styling — blockchain-independent |
| All `src/components/ui/*` | **NO CHANGE** | shadcn/ui — blockchain-independent |
| `scripts/deploy.js` | **REWRITE** | Replace Hardhat deploy with AlgoKit deploy script |
| `scripts/generate-node-keys.js` | **MODIFY** | Replace `EthCrypto.publicKeyByPrivateKey` |
| `scripts/derive_keys.js` | **MODIFY** | Replace `getEncryptionPublicKey` with `tweetnacl.box.keyPair` |
| `scripts/generate-env-keys.js` | **MODIFY** | Replace `EthCrypto.createIdentity` with `tweetnacl.box.keyPair` |
| `scripts/compile.js` | **DELETE** | Hardhat compile wrapper — not applicable |
| `hardhat.config.cjs` | **DELETE** | No longer needed (use AlgoKit) |
| `ignition/` | **DELETE** | Hardhat Ignition — not applicable |
| `contracts/Lock.sol` | **DELETE** | Hardhat boilerplate — not used |
| `test/Lock.js` | **DELETE** | Hardhat boilerplate test — not used |
| `node-keys.json` | **REGENERATE** | Regenerate with Algorand-compatible keys |
| `package.json` | **MODIFY** | Replace ethers/hardhat deps with algosdk/@txnlab/use-wallet-react |

---

## 13. Algorand-Specific Implementation Notes

### 13.1 Smart Contract State Management

Algorand smart contracts have limited state storage:
- **Global state**: 64 key-value pairs (max 128 bytes key, 128 bytes value)
- **Local state**: 16 key-value pairs per user per app
- **Box storage**: Arbitrary key-value storage (max 32KB per box)

**Recommendation**: Use **box storage** for file metadata and access permissions, as the data structures are too large for global/local state. Each file's data goes in a box keyed by `file_{fileId}`. Access permissions go in boxes keyed by `access_{fileId}_{userAddress}`.

### 13.2 Event Replacement

Algorand doesn't have Solidity-style events. Use:
- **Transaction notes** (up to 1KB): Encode event data in JSON in the transaction note field
- **Algorand Indexer**: Query transactions by note prefix, application ID, sender, etc.
- **Inner transaction logs**: For ARC-28 style event emissions (newer feature)

Example: Instead of `FileRegistered(fileId, owner, groupId, filename)`, encode:
```json
{"event": "FileRegistered", "fileId": 1, "owner": "ALGO...", "groupId": 0, "filename": "doc.pdf"}
```

### 13.3 Encryption Key Management (Critical)

MetaMask provides `eth_getEncryptionPublicKey` and `eth_decrypt` which use the account's x25519 Curve25519 key derived from the Ethereum private key. **Algorand wallets (Pera/Defly) do NOT support this.**

**Solution**: Generate and manage X25519 keys independently:

1. On first login, generate an X25519 keypair using `tweetnacl`:
   ```javascript
   import nacl from 'tweetnacl';
   const keyPair = nacl.box.keyPair();
   // publicKey: Uint8Array(32)
   // secretKey: Uint8Array(32)
   ```

2. Store the private key encrypted in the browser:
   - Derive an encryption key from the user signing a deterministic message (e.g., `"BlockSafe Encryption Key Derivation"`)
   - Use the signature hash as an AES key to encrypt the X25519 private key
   - Store encrypted private key in `localStorage`

3. Register the public key on-chain (same as current flow)

4. For encryption/decryption, use `tweetnacl-sealedbox` or `nacl.box`:
   ```javascript
   // Encrypt for recipient
   const nonce = nacl.randomBytes(24);
   const encrypted = nacl.box(message, nonce, recipientPublicKey, senderSecretKey);

   // Decrypt
   const decrypted = nacl.box.open(encrypted, nonce, senderPublicKey, recipientSecretKey);
   ```

### 13.4 Wallet Connection

Replace `Web3Provider` with `@txnlab/use-wallet-react`:

```javascript
import { WalletProvider, useWallet } from '@txnlab/use-wallet-react';
import { WalletId } from '@txnlab/use-wallet-react';

// In _app or layout:
<WalletProvider
  wallets={[
    { id: WalletId.PERA, options: { projectId: '...' } },
    { id: WalletId.DEFLY },
  ]}
>
  {children}
</WalletProvider>

// In components:
const { activeAddress, signTransactions, transactionSigner } = useWallet();
```

### 13.5 Contract Interaction Pattern

Replace ethers.js contract calls with Algorand SDK:

```javascript
import algosdk from 'algosdk';

const algodClient = new algosdk.Algodv2(token, server, port);
const appId = Number(process.env.NEXT_PUBLIC_FILE_REGISTRY_APP_ID);

// Call a method
const atc = new algosdk.AtomicTransactionComposer();
const contract = new algosdk.ABIContract(fileRegistryABIJson);
const method = contract.getMethodByName('register_file');

atc.addMethodCall({
  appID: appId,
  method,
  methodArgs: [cid, filename, groupId, encryptedShares],
  sender: activeAddress,
  signer: transactionSigner,
  suggestedParams: await algodClient.getTransactionParams().do(),
});

const result = await atc.execute(algodClient, 4);
```

### 13.6 Dependencies to Add

```json
{
  "algosdk": "^2.7.0",
  "@txnlab/use-wallet-react": "^3.0.0",
  "@perawallet/connect": "^1.3.0",
  "@blockshake/defly-connect": "^1.1.0",
  "tweetnacl": "^1.0.3",
  "tweetnacl-util": "^0.15.1"
}
```

### 13.7 Dependencies to Remove

```json
{
  "ethers": "remove",
  "@metamask/eth-sig-util": "remove",
  "eth-crypto": "remove",
  "hardhat": "remove",
  "@nomicfoundation/hardhat-*": "remove all"
}
```

---

## 14. Deployment Infrastructure

### `scripts/deploy.js`

Hardhat deployment script that:
1. Deploys `GroupRegistry` first
2. Deploys `FileRegistry` passing the `GroupRegistry` address as constructor arg
3. Writes both addresses to `src/lib/contract-config.json`

**Algorand equivalent**: Use AlgoKit CLI or a Python deploy script to deploy both smart contracts to TestNet/MainNet and save their Application IDs.

### `scripts/generate-node-keys.js`

Utility script that:
1. Reads `NODE_*_PRIVATE_KEY` values from `.env.local`
2. Derives public keys using `EthCrypto.publicKeyByPrivateKey()`
3. Writes public keys to `node-keys.json` (secp256k1 format, hex)

**Note**: The public keys in `node-keys.json` are secp256k1 keys, which are distinct from the x25519 keys in `nodeConfig.js`. The secp256k1 keys were used in the older ECDH-based encryption path (`/api/encrypt-shares`), while the x25519 keys are used in the current `@metamask/eth-sig-util` path.

### `scripts/derive_keys.js`

Utility script that derives **x25519 encryption public keys** from node Ethereum private keys:
1. Reads `NODE_*_PRIVATE_KEY` from `.env.local` via `dotenv`
2. Uses `@metamask/eth-sig-util.getEncryptionPublicKey()` to derive x25519 public keys
3. Outputs the keys to console (used to populate `nodeConfig.js`)

**Algorand change**: Replace with `tweetnacl.box.keyPair()` key generation.

### `scripts/generate-env-keys.js`

Utility script that generates fresh Ethereum identities for the 3 Trustless Trio nodes:
1. Uses `EthCrypto.createIdentity()` to create 3 new private/public key pairs
2. Outputs private keys (for `.env.local`) and public keys (for reference)

**Algorand change**: Replace with Algorand-compatible key generation (or just `tweetnacl.box.keyPair()`).

### `scripts/compile.js`

Simple Hardhat compile wrapper — runs `hre.run("compile")`. **Delete on migration.**

### `hardhat.config.cjs`

```javascript
require("@nomicfoundation/hardhat-toolbox");
module.exports = { solidity: "0.8.28" };
```

Minimal config with Solidity 0.8.28 compiler. Uses default Hardhat local network.

### `ignition/modules/FileRegistry.js`

Hardhat Ignition deployment module (alternative to `deploy.js`) — deploys `FileRegistry` contract.

### Boilerplate Files (Not Used by BlockSafe)

| File | Notes |
|------|-------|
| `contracts/Lock.sol` | Hardhat sample contract — ignore/delete |
| `ignition/modules/Lock.js` | Hardhat sample ignition module — ignore/delete |
| `test/Lock.js` | Hardhat sample test — ignore/delete |

---

## 15. Project Configuration Files

| File | Purpose | Migration |
|------|---------|----------|
| `components.json` | shadcn/ui config (style: `new-york`, icon library: `lucide`, path aliases) | **NO CHANGE** |
| `next.config.mjs` | Next.js config (currently empty/default) | **NO CHANGE** |
| `postcss.config.mjs` | PostCSS with `@tailwindcss/postcss` plugin | **NO CHANGE** |
| `eslint.config.mjs` | ESLint configuration | **NO CHANGE** |
| `jsconfig.json` | JavaScript path resolution (`@` alias) | **NO CHANGE** |
| `node-keys.json` | Generated file containing secp256k1 public keys for the 3 nodes | **REGENERATE** with Algorand-compatible keys |
| `public/*.svg` | Static assets (file.svg, globe.svg, next.svg, vercel.svg, window.svg) | **NO CHANGE** — default Next.js assets |
| `src/app/favicon.ico` | App favicon | **NO CHANGE** |

---

## Summary Checklist for Migration

- [ ] Write `FileRegistry` smart contract in PyTeal/Beaker with box storage
- [ ] Write `GroupRegistry` smart contract in PyTeal/Beaker with box storage
- [ ] Deploy contracts to Algorand TestNet
- [ ] Replace `Web3Provider` with `WalletProvider` (`@txnlab/use-wallet-react`)
- [ ] Update root `layout.jsx` to use Algorand `WalletProvider`
- [ ] Implement custom X25519 key management (replace MetaMask encryption APIs)
- [ ] Rewrite `contract.js` and `groupRegistry.js` for Algorand SDK
- [ ] Replace `FileRegistryABI.json` with Algorand ARC-4 ABI JSON
- [ ] Update `contract-config.json` with Algorand app IDs
- [ ] Update `EncryptionKeyPrompt` for Algorand key registration
- [ ] Update `EncryptionKeyCard` for custom X25519 keys
- [ ] Update `FileUploadDialog` for Algorand transactions
- [ ] Update `ShareFileDialog` for Algorand transactions
- [ ] Update `CreatePublicLinkDialog` (replace `ethers.Wallet` with Algorand account)
- [ ] Update `GroupManagement` for Algorand transactions
- [ ] Update landing page login for Pera/Defly wallet connect
- [ ] Replace all `queryFilter` calls with Algorand Indexer queries
- [ ] Update `verify-signature` API route for Algorand
- [ ] Update `nodes/reencrypt` API route for Algorand
- [ ] Update public access page (`public/[fileId]/page.jsx`) for Algorand
- [ ] Update `publicKeyRegistry.js` for custom X25519
- [ ] Update `User.js` model for Algorand address format
- [ ] Rewrite deploy script for AlgoKit
- [ ] Update `package.json` dependencies
- [ ] Remove Hardhat config, ignition, and Lock.sol
- [ ] Test all flows end-to-end on TestNet
