import type { uint64 } from '@algorandfoundation/algorand-typescript'
import { Contract, GlobalState, BoxMap, abimethod, Txn, assert, Uint64 } from '@algorandfoundation/algorand-typescript'

export class GroupRegistry extends Contract {
    groupCount = GlobalState<uint64>({ initialValue: Uint64(0) })

    groupNames = BoxMap<uint64, string>({ keyPrefix: 'gn' })
    groupCreators = BoxMap<uint64, string>({ keyPrefix: 'gc' })

    memberStatuses = BoxMap<{ groupId: uint64; user: string }, uint64>({ keyPrefix: 'ms' })
    memberRoles = BoxMap<{ groupId: uint64; user: string }, uint64>({ keyPrefix: 'mr' })

    @abimethod({ onCreate: 'require' })
    createApplication(): void {
        this.groupCount.value = Uint64(0)
    }

    @abimethod()
    createGroup(name: string): uint64 {
        this.groupCount.value = this.groupCount.value + Uint64(1)
        const groupId: uint64 = this.groupCount.value

        this.groupNames(groupId).value = name
        this.groupCreators(groupId).value = Txn.sender.bytes.toString()

        const key = { groupId: groupId, user: Txn.sender.bytes.toString() }
        this.memberStatuses(key).value = Uint64(2)
        this.memberRoles(key).value = Uint64(1)

        return groupId
    }

    @abimethod()
    inviteMember(groupId: uint64, user: string): void {
        const callerKey = { groupId: groupId, user: Txn.sender.bytes.toString() }
        assert(this.memberStatuses(callerKey).exists, 'Caller is not a member')
        assert(this.memberStatuses(callerKey).value === Uint64(2), 'Caller has not joined')
        assert(this.memberRoles(callerKey).value === Uint64(1), 'Caller is not admin')

        const userKey = { groupId: groupId, user: user }
        this.memberStatuses(userKey).value = Uint64(1)
        this.memberRoles(userKey).value = Uint64(0)
    }

    @abimethod()
    acceptInvite(groupId: uint64): void {
        const key = { groupId: groupId, user: Txn.sender.bytes.toString() }
        assert(this.memberStatuses(key).exists, 'No invite found')
        assert(this.memberStatuses(key).value === Uint64(1), 'Not invited')
        this.memberStatuses(key).value = Uint64(2)
    }

    @abimethod()
    rejectInvite(groupId: uint64): void {
        const key = { groupId: groupId, user: Txn.sender.bytes.toString() }
        assert(this.memberStatuses(key).exists, 'No invite found')
        assert(this.memberStatuses(key).value === Uint64(1), 'Not invited')
        this.memberStatuses(key).value = Uint64(0)
    }

    @abimethod()
    removeMember(groupId: uint64, user: string): void {
        const callerKey = { groupId: groupId, user: Txn.sender.bytes.toString() }
        assert(this.memberStatuses(callerKey).exists, 'Caller is not a member')
        assert(this.memberStatuses(callerKey).value === Uint64(2), 'Caller has not joined')
        assert(this.memberRoles(callerKey).value === Uint64(1), 'Caller is not admin')

        const userKey = { groupId: groupId, user: user }
        this.memberStatuses(userKey).value = Uint64(0)
    }

    @abimethod()
    leaveGroup(groupId: uint64): void {
        const key = { groupId: groupId, user: Txn.sender.bytes.toString() }
        assert(this.memberStatuses(key).exists, 'Not a member')
        assert(this.memberStatuses(key).value === Uint64(2), 'Not joined')
        this.memberStatuses(key).value = Uint64(0)
    }

    @abimethod({ readonly: true })
    getGroupName(groupId: uint64): string {
        assert(this.groupNames(groupId).exists, 'Group does not exist')
        return this.groupNames(groupId).value
    }

    @abimethod({ readonly: true })
    getGroupCreator(groupId: uint64): string {
        assert(this.groupCreators(groupId).exists, 'Group does not exist')
        return this.groupCreators(groupId).value
    }

    @abimethod({ readonly: true })
    getMemberStatus(groupId: uint64, user: string): uint64 {
        const key = { groupId: groupId, user: user }
        if (this.memberStatuses(key).exists) {
            return this.memberStatuses(key).value
        }
        return Uint64(0)
    }

    @abimethod({ readonly: true })
    getMemberRole(groupId: uint64, user: string): uint64 {
        const key = { groupId: groupId, user: user }
        if (this.memberRoles(key).exists) {
            return this.memberRoles(key).value
        }
        return Uint64(0)
    }

    @abimethod({ readonly: true })
    isMember(groupId: uint64, user: string): boolean {
        const key = { groupId: groupId, user: user }
        if (this.memberStatuses(key).exists) {
            return this.memberStatuses(key).value === Uint64(2)
        }
        return false
    }

    @abimethod({ readonly: true })
    isAdmin(groupId: uint64, user: string): boolean {
        const key = { groupId: groupId, user: user }
        if (this.memberStatuses(key).exists && this.memberRoles(key).exists) {
            return this.memberStatuses(key).value === Uint64(2) && this.memberRoles(key).value === Uint64(1)
        }
        return false
    }

    @abimethod({ readonly: true })
    getGroupCount(): uint64 {
        return this.groupCount.value
    }
}
