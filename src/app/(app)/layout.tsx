import { AuthProvider } from '@/contexts/auth-context'
import { ToastProvider } from '@/contexts/toast-context'
import { ThemeProvider } from '@/contexts/theme-context'
import Sidebar from '@/components/pipeline/sidebar'
import SearchPalette from '@/components/pipeline/search-palette'
import RealtimeErrorSwallow from '@/components/realtime-error-swallow'

// Authenticated application shell. Lives in the (app) route group so the heavy
// client providers + sidebar load only for signed-in app pages — not the public
// marketing (/landing) or auth pages.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <ThemeProvider>
        <ToastProvider>
          <Sidebar>{children}</Sidebar>
          <SearchPalette />
          <RealtimeErrorSwallow />
        </ToastProvider>
      </ThemeProvider>
    </AuthProvider>
  )
}
