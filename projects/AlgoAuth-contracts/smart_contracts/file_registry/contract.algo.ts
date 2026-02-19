import type { uint64 } from '@algorandfoundation/algorand-typescript'
import { Contract, GlobalState, BoxMap, abimethod, Txn, Global, assert, Uint64 } from '@algorandfoundation/algorand-typescript'

export class FileRegistry extends Contract {
    fileCount = GlobalState<uint64>({ initialValue: Uint64(0) })
    groupRegistryAppId = GlobalState<uint64>({ initialValue: Uint64(0) })

    fileCids = BoxMap<uint64, string>({ keyPrefix: 'fc' })
    fileOwners = BoxMap<uint64, string>({ keyPrefix: 'fo' })
    fileNames = BoxMap<uint64, string>({ keyPrefix: 'fn' })
    fileGroupIds = BoxMap<uint64, uint64>({ keyPrefix: 'fg' })
    fileCreatedAt = BoxMap<uint64, uint64>({ keyPrefix: 'ft' })
    fileUpdatedAt = BoxMap<uint64, uint64>({ keyPrefix: 'fu' })
    fileIsDeleted = BoxMap<uint64, uint64>({ keyPrefix: 'fd' })

    fileShare1 = BoxMap<uint64, string>({ keyPrefix: 'a1' })
    fileShare2 = BoxMap<uint64, string>({ keyPrefix: 'a2' })
    fileShare3 = BoxMap<uint64, string>({ keyPrefix: 'a3' })

    accessHas = BoxMap<{ fileId: uint64; user: string }, uint64>({ keyPrefix: 'ah' })
    accessPermission = BoxMap<{ fileId: uint64; user: string }, string>({ keyPrefix: 'ap' })
    accessWrappedKey = BoxMap<{ fileId: uint64; user: string }, string>({ keyPrefix: 'ak' })
    accessGrantedAt = BoxMap<{ fileId: uint64; user: string }, uint64>({ keyPrefix: 'at' })
    accessExpiresAt = BoxMap<{ fileId: uint64; user: string }, uint64>({ keyPrefix: 'ae' })

    encryptionKeys = BoxMap<string, string>({ keyPrefix: 'ek' })

    @abimethod({ onCreate: 'require' })
    createApplication(groupAppId: uint64): void {
        this.fileCount.value = Uint64(0)
        this.groupRegistryAppId.value = groupAppId
    }

    @abimethod()
    registerFile(
        cid: string,
        filename: string,
        groupId: uint64,
        share1: string,
        share2: string,
        share3: string,
    ): uint64 {
        this.fileCount.value = this.fileCount.value + Uint64(1)
        const fileId: uint64 = this.fileCount.value

        this.fileCids(fileId).value = cid
        this.fileOwners(fileId).value = Txn.sender.bytes.toString()
        this.fileNames(fileId).value = filename
        this.fileGroupIds(fileId).value = groupId
        this.fileCreatedAt(fileId).value = Global.latestTimestamp
        this.fileUpdatedAt(fileId).value = Global.latestTimestamp
        this.fileIsDeleted(fileId).value = Uint64(0)

        this.fileShare1(fileId).value = share1
        this.fileShare2(fileId).value = share2
        this.fileShare3(fileId).value = share3

        return fileId
    }

    @abimethod()
    updateFile(fileId: uint64, newCid: string): void {
        assert(this.fileOwners(fileId).exists, 'File does not exist')
        assert(this.fileOwners(fileId).value === Txn.sender.bytes.toString(), 'Not the owner')
        assert(this.fileIsDeleted(fileId).value === Uint64(0), 'File is deleted')

        this.fileCids(fileId).value = newCid
        this.fileUpdatedAt(fileId).value = Global.latestTimestamp
    }

    @abimethod()
    deleteFile(fileId: uint64): void {
        assert(this.fileOwners(fileId).exists, 'File does not exist')
        assert(this.fileOwners(fileId).value === Txn.sender.bytes.toString(), 'Not the owner')
        this.fileIsDeleted(fileId).value = Uint64(1)
    }

    @abimethod()
    grantAccess(
        fileId: uint64,
        user: string,
        permission: string,
        wrappedKey: string,
        expiresAt: uint64,
    ): void {
        assert(this.fileOwners(fileId).exists, 'File does not exist')
        assert(this.fileOwners(fileId).value === Txn.sender.bytes.toString(), 'Not the owner')
        assert(this.fileIsDeleted(fileId).value === Uint64(0), 'File is deleted')

        const key = { fileId: fileId, user: user }
        this.accessHas(key).value = Uint64(1)
        this.accessPermission(key).value = permission
        this.accessWrappedKey(key).value = wrappedKey
        this.accessGrantedAt(key).value = Global.latestTimestamp
        this.accessExpiresAt(key).value = expiresAt
    }

    @abimethod()
    revokeAccess(fileId: uint64, user: string): void {
        assert(this.fileOwners(fileId).exists, 'File does not exist')
        assert(this.fileOwners(fileId).value === Txn.sender.bytes.toString(), 'Not the owner')
        const key = { fileId: fileId, user: user }
        this.accessHas(key).value = Uint64(0)
    }

    @abimethod({ readonly: true })
    getFileCid(fileId: uint64): string {
        assert(this.fileCids(fileId).exists, 'File does not exist')
        return this.fileCids(fileId).value
    }

    @abimethod({ readonly: true })
    getFileOwner(fileId: uint64): string {
        assert(this.fileOwners(fileId).exists, 'File does not exist')
        return this.fileOwners(fileId).value
    }

    @abimethod({ readonly: true })
    getFileName(fileId: uint64): string {
        assert(this.fileNames(fileId).exists, 'File does not exist')
        return this.fileNames(fileId).value
    }

    @abimethod({ readonly: true })
    getFileGroupId(fileId: uint64): uint64 {
        assert(this.fileGroupIds(fileId).exists, 'File does not exist')
        return this.fileGroupIds(fileId).value
    }

    @abimethod({ readonly: true })
    getFileCreatedAt(fileId: uint64): uint64 {
        assert(this.fileCreatedAt(fileId).exists, 'File does not exist')
        return this.fileCreatedAt(fileId).value
    }

    @abimethod({ readonly: true })
    getFileUpdatedAt(fileId: uint64): uint64 {
        assert(this.fileUpdatedAt(fileId).exists, 'File does not exist')
        return this.fileUpdatedAt(fileId).value
    }

    @abimethod({ readonly: true })
    getFileIsDeleted(fileId: uint64): uint64 {
        assert(this.fileIsDeleted(fileId).exists, 'File does not exist')
        return this.fileIsDeleted(fileId).value
    }

    @abimethod({ readonly: true })
    getFileShare1(fileId: uint64): string {
        if (this.fileShare1(fileId).exists) {
            return this.fileShare1(fileId).value
        }
        return ''
    }

    @abimethod({ readonly: true })
    getFileShare2(fileId: uint64): string {
        if (this.fileShare2(fileId).exists) {
            return this.fileShare2(fileId).value
        }
        return ''
    }

    @abimethod({ readonly: true })
    getFileShare3(fileId: uint64): string {
        if (this.fileShare3(fileId).exists) {
            return this.fileShare3(fileId).value
        }
        return ''
    }

    @abimethod({ readonly: true })
    hasValidAccess(fileId: uint64, user: string): boolean {
        if (!this.fileOwners(fileId).exists) return false
        if (this.fileIsDeleted(fileId).value === Uint64(1)) return false
        if (this.fileOwners(fileId).value === user) return true

        const key = { fileId: fileId, user: user }
        if (this.accessHas(key).exists && this.accessHas(key).value === Uint64(1)) {
            const expires: uint64 = this.accessExpiresAt(key).value
            if (expires === Uint64(0) || expires > Global.latestTimestamp) {
                return true
            }
        }
        return false
    }

    @abimethod({ readonly: true })
    getAccessPermission(fileId: uint64, user: string): string {
        const key = { fileId: fileId, user: user }
        if (this.accessPermission(key).exists) {
            return this.accessPermission(key).value
        }
        return ''
    }

    @abimethod({ readonly: true })
    getAccessWrappedKey(fileId: uint64, user: string): string {
        const key = { fileId: fileId, user: user }
        if (this.accessWrappedKey(key).exists) {
            return this.accessWrappedKey(key).value
        }
        return ''
    }

    @abimethod({ readonly: true })
    getAccessExpiresAt(fileId: uint64, user: string): uint64 {
        const key = { fileId: fileId, user: user }
        if (this.accessExpiresAt(key).exists) {
            return this.accessExpiresAt(key).value
        }
        return Uint64(0)
    }

    @abimethod({ readonly: true })
    getAccessGrantedAt(fileId: uint64, user: string): uint64 {
        const key = { fileId: fileId, user: user }
        if (this.accessGrantedAt(key).exists) {
            return this.accessGrantedAt(key).value
        }
        return Uint64(0)
    }

    @abimethod()
    registerPublicKey(publicKey: string): void {
        this.encryptionKeys(Txn.sender.bytes.toString()).value = publicKey
    }

    @abimethod({ readonly: true })
    getEncryptionKey(user: string): string {
        if (this.encryptionKeys(user).exists) {
            return this.encryptionKeys(user).value
        }
        return ''
    }

    @abimethod({ readonly: true })
    getFileCount(): uint64 {
        return this.fileCount.value
    }
}
