import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { UserProfile } from '@/lib/supabase'

type AuthContextType = {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null; profile: UserProfile | null }>
  signUp: (email: string, password: string, studioName: string, userName: string) => Promise<{ error: string | null; needsEmailConfirmation?: boolean; profile: UserProfile | null }>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<{ error: string | null }>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

function mapProfile(data: Record<string, unknown> | null): UserProfile | null {
  if (!data) return null
  const studios = data.studios as { onboarding_completed?: boolean } | { onboarding_completed?: boolean }[] | null
  const onboarding = Array.isArray(studios) ? studios[0]?.onboarding_completed : studios?.onboarding_completed
  const { studios: _ignored, ...userFields } = data
  const studioId = (userFields.studio_id as string | null) ?? null
  const completed = studioId ? (onboarding ?? false) : false
  return { ...userFields, studio_id: studioId, professional_id: (userFields.professional_id as string | null) ?? null, onboarding_completed: completed } as UserProfile
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const signupInProgress = useRef(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (!session) setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      setUser(session?.user ?? null)
      if (!session) {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (user && !signupInProgress.current) void loadProfile(user.id)
  }, [user])

  const finishSignupFromMetadata = async (userId: string) => {
    const { data: authUser } = await supabase.auth.getUser()
    const meta = authUser.user?.user_metadata ?? {}
    if (typeof meta.studio_name !== 'string' || !meta.studio_name.trim()) return { message: 'missing metadata' }
    const userName = typeof meta.user_name === 'string' ? meta.user_name : (typeof meta.full_name === 'string' ? meta.full_name : 'Admin')
    const { error } = await supabase.rpc('complete_signup', {
      p_user_id: userId,
      p_studio_name: meta.studio_name,
      p_user_name: userName,
    })
    if (!error) {
      void supabase.functions.invoke('mailer', { body: { action: 'welcome', studio_name: meta.studio_name, user_name: userName } })
    }
    return error
  }

  const loadProfile = async (uid?: string): Promise<UserProfile | null> => {
    const userId = uid ?? user?.id
    if (!userId) return null
    const { data } = await supabase.from('users').select('*, studios(onboarding_completed)').eq('id', userId).maybeSingle()
    if (data) {
      const mapped = mapProfile(data as Record<string, unknown>)
      setProfile(mapped)
      setLoading(false)
      return mapped
    }
    const rpcError = await finishSignupFromMetadata(userId)
    if (!rpcError) {
      const { data: retry } = await supabase.from('users').select('*, studios(onboarding_completed)').eq('id', userId).maybeSingle()
      const mapped = mapProfile(retry as Record<string, unknown> | null)
      setProfile(mapped)
      setLoading(false)
      return mapped
    }
    setProfile(null)
    setLoading(false)
    return null
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message, profile: null }
    const next = data.user ? await loadProfile(data.user.id) : null
    return { error: null, profile: next }
  }

  const signUp = async (email: string, password: string, studioName: string, userName: string) => {
    signupInProgress.current = true
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { studio_name: studioName, user_name: userName, full_name: userName } },
      })
      if (error) return { error: error.message, profile: null }
      if (!data.user) return { error: 'Não foi possível criar a conta.', profile: null }

      if (!data.session) {
        return { error: null, needsEmailConfirmation: true, profile: null }
      }

      const { error: rpcError } = await supabase.rpc('complete_signup', {
        p_user_id: data.user.id,
        p_studio_name: studioName,
        p_user_name: userName,
      })
      if (rpcError) return { error: 'Falha ao configurar o estúdio: ' + rpcError.message, profile: null }

      void supabase.functions.invoke('mailer', { body: { action: 'welcome', studio_name: studioName, user_name: userName } })
      const next = await loadProfile(data.user.id)
      return { error: null, profile: next }
    } finally {
      signupInProgress.current = false
    }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/recuperar-senha`,
    })
    if (error) return { error: error.message }
    return { error: null }
  }

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, signIn, signUp, signOut, resetPassword, refreshProfile: loadProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
