import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { GroupRegistryFactory } from '../artifacts/group_registry/GroupRegistryClient'

export async function deploy() {
    console.log('=== Deploying GroupRegistry ===')

    const algorand = AlgorandClient.fromEnvironment()
    const deployer = await algorand.account.fromEnvironment('DEPLOYER')

    const factory = algorand.client.getTypedAppFactory(GroupRegistryFactory, {
        defaultSender: deployer.addr,
    })

    const { appClient, result } = await factory.deploy({
        onUpdate: 'append',
        onSchemaBreak: 'append',
        createParams: {
            method: 'createApplication',
            args: [],
        },
    })

    if (['create', 'replace'].includes(result.operationPerformed)) {
        await algorand.send.payment({
            amount: (1).algo(),
            sender: deployer.addr,
            receiver: appClient.appAddress,
        })
    }

    console.log(`GroupRegistry deployed with App ID: ${appClient.appClient.appId}`)
    console.log(`GroupRegistry App Address: ${appClient.appAddress}`)

    return appClient
}
