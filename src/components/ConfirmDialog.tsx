import { useCallback, useRef, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useT } from '@/i18n'

type ConfirmOptions = { title: string; description?: string; confirmLabel?: string }

// Usage:
//   const [confirm, confirmDialog] = useConfirm()
//   if (await confirm({ title: 'Excluir cliente?' })) { ... }
//   return <>{...}{confirmDialog}</>
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, React.ReactNode] {
  const t = useT('layout')
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    setOpts(o)
    return new Promise<boolean>((resolve) => { resolver.current = resolve })
  }, [])

  const close = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOpts(null)
  }

  const dialog = (
    <AlertDialog open={!!opts} onOpenChange={(open) => { if (!open) close(false) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          {opts?.description && <AlertDialogDescription>{opts.description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => close(false)}>{t('confirmCancel')}</AlertDialogCancel>
          <AlertDialogAction className="bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90" onClick={() => close(true)}>
            {opts?.confirmLabel || t('confirmDelete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )

  return [confirm, dialog]
}
