# Deploying AlgoAuth Smart Contracts to Algorand Testnet

## Prerequisites

| Requirement | How to get it |
|---|---|
| **AlgoKit CLI ≥ v2.6** | `pip install algokit` or [install guide](https://github.com/algorandfoundation/algokit-cli#install) |
| **Node.js ≥ 22** | [nodejs.org](https://nodejs.org) |
| **Funded Testnet Account** | Use the [Algorand Testnet Faucet](https://bank.testnet.algorand.network/) to get test ALGO |
| **npm dependencies installed** | Run `npm install` inside `projects/AlgoAuth-contracts` |

---

## Step 1 — Create the `.env` File for Contracts

Create `projects/AlgoAuth-contracts/.env` with the following:

```env
# Algorand Testnet Node — use Nodely free public endpoint
ALGOD_SERVER=https://testnet-api.4160.nodely.dev
ALGOD_PORT=443
ALGOD_TOKEN=
ALGOD_NETWORK=testnet

INDEXER_SERVER=https://testnet-idx.4160.nodely.dev
INDEXER_PORT=443
INDEXER_TOKEN=

# Your deployer account's 25-word mnemonic (KEEP THIS SECRET)
DEPLOYER_MNEMONIC=word1 word2 word3 ... word25

# Leave blank initially — set after GroupRegistry is deployed
GROUP_REGISTRY_APP_ID=0
```

> [!CAUTION]
> **Never commit your `.env` file.** It contains your deployer mnemonic. The `.gitignore` already excludes `.env` files.

### How to get a mnemonic

1. Open an Algorand wallet (e.g. Pera Wallet, Lute, or programmatically via `algosdk`).
2. Create or export a testnet account.
3. Copy the 25-word mnemonic phrase.
4. Fund the account with at least **5 ALGO** from the [Testnet Faucet](https://bank.testnet.algorand.network/).

---

## Step 2 — Build the Contracts (if not already built)

```powershell
cd d:\Algo_Prj\AlgoAuth\projects\AlgoAuth-contracts
npm run build
```

This compiles the Algorand-TypeScript contracts to TEAL and generates the typed client files (`FileRegistryClient.ts`, `GroupRegistryClient.ts`) inside `smart_contracts/artifacts/`.

> [!NOTE]
> The artifacts are already pre-built in the repo. Only re-run this step if you've modified the contract source files.

---

## Step 3 — Deploy GroupRegistry First

GroupRegistry has **no dependencies**, so it must be deployed first.

```powershell
cd d:\Algo_Prj\AlgoAuth\projects\AlgoAuth-contracts
npm run deploy -- group_registry
```

This calls `smart_contracts/group_registry/deploy-config.ts`, which:
1. Connects to testnet using `.env` credentials
2. Deploys the `GroupRegistry` contract
3. Funds the app account with **1 ALGO** for box storage MBR
4. Prints the **App ID** and **App Address** to the console

**Save the App ID** from the output — you'll need it for the next step.

Example output:
```
=== Deploying GroupRegistry ===
GroupRegistry deployed with App ID: 123456789
GroupRegistry App Address: AAAAAAA...
```

---

## Step 4 — Set GroupRegistry App ID, then Deploy FileRegistry

Update `projects/AlgoAuth-contracts/.env`:

```env
GROUP_REGISTRY_APP_ID=123456789   # ← paste the App ID from Step 3
```

Then deploy FileRegistry:

```powershell
npm run deploy -- file_registry
```

This calls `smart_contracts/file_registry/deploy-config.ts`, which:
1. Reads `GROUP_REGISTRY_APP_ID` from `.env`
2. Deploys `FileRegistry`, passing the group app ID during creation
3. Funds the app account with **2 ALGO** for box storage MBR
4. Prints the **App ID** and **App Address**

**Save this App ID as well.**

---

## Step 5 — Configure the Frontend `.env`

Create `projects/AlgoAuth-frontend/.env`:

```env
# Algorand Testnet
VITE_ALGOD_SERVER=https://testnet-api.4160.nodely.dev
VITE_ALGOD_PORT=443
VITE_ALGOD_TOKEN=
VITE_ALGOD_NETWORK=testnet

VITE_INDEXER_SERVER=https://testnet-idx.4160.nodely.dev
VITE_INDEXER_PORT=443
VITE_INDEXER_TOKEN=

# Paste your deployed App IDs here
VITE_FILE_REGISTRY_APP_ID=987654321
VITE_GROUP_REGISTRY_APP_ID=123456789

# Backend API URL
VITE_API_BASE_URL=http://localhost:3000/api
```

Replace `987654321` and `123456789` with your actual deployed App IDs from Steps 3 and 4.

---

## Step 6 — Verify the Deployment

### On-chain verification

Visit [Algorand Testnet Explorer](https://testnet.explorer.perawallet.app/) and search for your App IDs. You should see:
- The contract code (approval + clear TEAL)
- The creator address matches your deployer account
- Global state initialized (`fileCount = 0`, `groupCount = 0`)

### Frontend verification

```powershell
cd d:\Algo_Prj\AlgoAuth\projects\AlgoAuth-frontend
npm run dev
```

The frontend's `contractClient.ts` reads the App IDs from the `VITE_*` env vars and initializes the Algorand client to interact with your deployed contracts.

---

## Quick Reference

| What | Where |
|---|---|
| Contract source — FileRegistry | `projects/AlgoAuth-contracts/smart_contracts/file_registry/contract.algo.ts` |
| Contract source — GroupRegistry | `projects/AlgoAuth-contracts/smart_contracts/group_registry/contract.algo.ts` |
| Deploy configs | `smart_contracts/file_registry/deploy-config.ts`, `smart_contracts/group_registry/deploy-config.ts` |
| Deploy entry point | `smart_contracts/index.ts` |
| Compiled TEAL + ARC56 | `smart_contracts/artifacts/file_registry/`, `smart_contracts/artifacts/group_registry/` |
| Typed clients | `FileRegistryClient.ts`, `GroupRegistryClient.ts` (in artifacts dirs) |
| Frontend contract client | `projects/AlgoAuth-frontend/src/lib/contractClient.ts` |
| Contracts `.env` | `projects/AlgoAuth-contracts/.env` |
| Frontend `.env` | `projects/AlgoAuth-frontend/.env` |

---

## Troubleshooting

| Problem | Solution |
|---|---|
| `Account not found` | Fund your deployer account via the [testnet faucet](https://bank.testnet.algorand.network/) |
| `Insufficient balance` | Send at least **5 ALGO** to your deployer to cover contract creation + MBR funding |
| `No deployer found for contract name` | Ensure the contract directory name matches exactly (`file_registry` or `group_registry`) |
| `DEPLOYER_MNEMONIC` errors | Verify the mnemonic is a single line of 25 space-separated words |
| Frontend shows App ID `0` | Restart the dev server after updating `.env` — Vite only reads env vars at startup |





node server/index.mjs
 npm run dev