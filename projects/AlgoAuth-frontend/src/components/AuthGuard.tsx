import React from 'react'
import { Navigate } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import { Loader2 } from 'lucide-react'

const AuthGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { activeAddress } = useWallet()
    const token = localStorage.getItem('blocksafe_jwt')

    if (!activeAddress) {
        return <Navigate to="/" replace />
    }

    if (!token) {
        return <Navigate to="/" replace />
    }

    return <>{children}</>
}

export default AuthGuard
