import { WalletManager, WalletId } from '@txnlab/use-wallet-react'
import { WalletProvider } from '@txnlab/use-wallet-react'
import { SnackbarProvider } from 'notistack'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { getAlgodConfigFromViteEnvironment, getKmdConfigFromViteEnvironment } from './utils/network/getAlgoClientConfigs'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import MyFilesPage from './pages/MyFilesPage'
import SharedWithMePage from './pages/SharedWithMePage'
import OrganizationsPage from './pages/OrganizationsPage'
import FileDetailPage from './pages/FileDetailPage'
import PublicAccessPage from './pages/PublicAccessPage'
import AuthGuard from './components/AuthGuard'
import AppLayout from './components/AppLayout'

import './styles/App.css'

export default function App() {
  const algodConfig = getAlgodConfigFromViteEnvironment()

  const walletConnectProjectId = import.meta.env.VITE_WALLET_CONNECT_PROJECT_ID ?? ''

  const walletManager = new WalletManager({
    wallets: [
      WalletId.DEFLY,
      WalletId.PERA,
      ...(import.meta.env.VITE_KMD_SERVER
        ? [
          {
            id: WalletId.KMD,
            options: {
              host: getKmdConfigFromViteEnvironment().server,
              token: String(getKmdConfigFromViteEnvironment().token),
              port: String(getKmdConfigFromViteEnvironment().port),
            },
          },
        ]
        : []),
      ...(walletConnectProjectId
        ? [
          {
            id: WalletId.WALLETCONNECT,
            options: { projectId: walletConnectProjectId },
          },
        ]
        : []),
    ],
    network: algodConfig.network,
    algod: {
      baseServer: algodConfig.server,
      port: algodConfig.port,
      token: algodConfig.token ?? '',
    },
  } as any)

  return (
    <SnackbarProvider maxSnack={3}>
      <WalletProvider manager={walletManager}>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LoginPage />} />
            <Route path="/public/:linkId" element={<PublicAccessPage />} />

            {/* Protected routes */}
            <Route
              element={
                <AuthGuard>
                  <AppLayout />
                </AuthGuard>
              }
            >
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/files" element={<MyFilesPage />} />
              <Route path="/files/:fileId" element={<FileDetailPage />} />
              <Route path="/shared" element={<SharedWithMePage />} />
              <Route path="/organizations" element={<OrganizationsPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </WalletProvider>
    </SnackbarProvider>
  )
}
