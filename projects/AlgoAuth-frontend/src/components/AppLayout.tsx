import React, { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useWallet } from '@txnlab/use-wallet-react'
import {
    LayoutDashboard,
    FileText,
    Share2,
    Users,
    LogOut,
    Menu,
    X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { ellipseAddress } from '@/utils/ellipseAddress'
import logoImg from '@/assets/removed_bg-removebg-preview.png'

const navItems = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/files', icon: FileText, label: 'My Files' },
    { to: '/shared', icon: Share2, label: 'Shared With Me' },
    { to: '/organizations', icon: Users, label: 'Organizations' },
]

const AppLayout: React.FC = () => {
    const { activeAddress } = useWallet()
    const navigate = useNavigate()
    const [mobileOpen, setMobileOpen] = useState(false)

    const handleLogout = () => {
        localStorage.removeItem('blocksafe_jwt')
        navigate('/')
    }

    return (
        <div className="flex min-h-screen">
            {mobileOpen && (
                <div
                    className="fixed inset-0 bg-black/50 z-40 md:hidden"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            <aside
                className={cn(
                    "fixed top-0 left-0 bottom-0 w-64 bg-card/60 backdrop-blur-2xl border-r border-border/50 flex flex-col z-50 transition-transform duration-300",
                    mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
                )}
            >
                <div className="flex items-center gap-3 px-5 py-5">
                    <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center">
                        <img src={logoImg} alt="AlgoAuth" className="w-6 h-6 object-contain" />
                    </div>
                    <span className="text-lg font-extrabold bg-gradient-to-r from-foreground to-primary bg-clip-text text-transparent">
                        AlgoAuth
                    </span>
                </div>

                <Separator className="bg-border/50" />

                <nav className="flex-1 p-3 space-y-1">
                    {navItems.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            onClick={() => setMobileOpen(false)}
                            className={({ isActive }) =>
                                cn(
                                    "flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-all",
                                    isActive
                                        ? "bg-primary/10 text-primary border border-primary/20"
                                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                )
                            }
                        >
                            <item.icon size={18} />
                            {item.label}
                        </NavLink>
                    ))}
                </nav>

                <Separator className="bg-border/50" />

                <div className="p-4 space-y-3">
                    {activeAddress && (
                        <p className="text-xs text-muted-foreground font-mono truncate">
                            {ellipseAddress(activeAddress, 8)}
                        </p>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="w-full justify-start text-muted-foreground hover:text-destructive"
                        onClick={handleLogout}
                    >
                        <LogOut size={16} />
                        Disconnect
                    </Button>
                </div>
            </aside>

            <Button
                variant="outline"
                size="icon"
                className="fixed top-4 left-4 z-50 md:hidden bg-card/80 backdrop-blur-lg"
                onClick={() => setMobileOpen(!mobileOpen)}
            >
                {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </Button>

            <main className="flex-1 md:ml-64 p-6 md:p-8 min-h-screen">
                <Outlet />
            </main>
        </div>
    )
}

export default AppLayout
