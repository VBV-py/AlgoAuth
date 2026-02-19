import { AlgorandClient } from '@algorandfoundation/algokit-utils'
import { FileRegistryFactory } from '../artifacts/file_registry/FileRegistryClient'

export async function deploy() {
    console.log('=== Deploying FileRegistry ===')

    const algorand = AlgorandClient.fromEnvironment()
    const deployer = await algorand.account.fromEnvironment('DEPLOYER')

    // Get GroupRegistry App ID from environment or use 0 as placeholder
    const groupAppId = BigInt(process.env.GROUP_REGISTRY_APP_ID || '0')

    const factory = algorand.client.getTypedAppFactory(FileRegistryFactory, {
        defaultSender: deployer.addr,
    })

    const { appClient, result } = await factory.deploy({
        onUpdate: 'append',
        onSchemaBreak: 'append',
        createParams: {
            method: 'createApplication',
            args: { groupAppId },
        },
    })

    if (['create', 'replace'].includes(result.operationPerformed)) {
        await algorand.send.payment({
            amount: (2).algo(),
            sender: deployer.addr,
            receiver: appClient.appAddress,
        })
    }

    console.log(`FileRegistry deployed with App ID: ${appClient.appClient.appId}`)
    console.log(`FileRegistry App Address: ${appClient.appAddress}`)

    return appClient
}
