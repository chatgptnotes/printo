import { AuthProvider } from '@/contexts/auth-context'
import { ToastProvider } from '@/contexts/toast-context'
import { ThemeProvider } from '@/contexts/theme-context'

// Auth pages (login/register) need the context providers to sign in, but none
// of the heavy app chrome (sidebar, search palette, realtime listener).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <ToastProvider>{children}</ToastProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}
