import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { AuthProvider } from "@/contexts/AuthContext"
import { Toaster } from "@/components/ui/sonner"
import { I18nProvider } from "@/i18n"
import { captureAuthRedirect } from "@/lib/auth-nav"

// Password-recovery links must land on the reset screen even when already signed in.
captureAuthRedirect()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <AuthProvider>
          <App />
          <Toaster />
        </AuthProvider>
      </ThemeProvider>
    </I18nProvider>
  </StrictMode>
)
