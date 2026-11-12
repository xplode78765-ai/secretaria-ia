import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { AISettings, AIPattern, CustomMessage } from '@/lib/supabase'
import { matchPattern, defaultAiTemplates } from '@/lib/ai-engine'
import { Bot, Plus, Trash2, Save, Sparkles, Send, CheckCircle2, RotateCcw, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useAuth } from '@/contexts/AuthContext'
import { toast } from 'sonner'
import { useT } from '@/i18n'

export function SecretariaIAPage() {
  const tc = useT('common')
  const t = useT('settings')
  const { profile } = useAuth()
  const [settings, setSettings] = useState<AISettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testInput, setTestInput] = useState('')
  const [testResult, setTestResult] = useState<{ matched: boolean; pattern: AIPattern | null; response: string; trigger: string } | null>(null)

  useEffect(() => { if (profile?.studio_id) loadSettings() }, [profile?.studio_id])

  const loadSettings = async () => {
    const { data } = await supabase.from('ai_settings').select('*').maybeSingle()
    if (data) setSettings(data as AISettings)
    else setSettings({ id: '', studio_id: profile?.studio_id ?? '', personalidade: 'atenciosa', tom_voz: 'amigavel', ...defaultAiTemplates(profile?.studio_locale ?? 'pt'), created_at: '', updated_at: '' })
    setLoading(false)
  }

  const save = async () => {
    if (!settings) return
    if (!profile?.studio_id) { toast.error(t('noStudio')); return }
    setSaving(true)
    const { error } = settings.id
      ? await supabase.from('ai_settings').update({ personalidade: settings.personalidade, tom_voz: settings.tom_voz, custom_messages: settings.custom_messages, ai_patterns: settings.ai_patterns }).eq('id', settings.id)
      : await supabase.from('ai_settings').insert({ studio_id: profile.studio_id, personalidade: settings.personalidade, tom_voz: settings.tom_voz, custom_messages: settings.custom_messages, ai_patterns: settings.ai_patterns })
    setSaving(false)
    if (error) { toast.error(t('aiSaveError', { error: error.message })); return }
    setSaved(true); setTimeout(() => setSaved(false), 3000)
    toast.success(t('aiSaved'))
    if (!settings.id) loadSettings()
  }

  const runTest = () => {
    if (!testInput.trim() || !settings) return
    const result = matchPattern(testInput, settings.ai_patterns, settings.custom_messages)
    setTestResult(result)
  }

  const updatePattern = (idx: number, field: keyof AIPattern, value: string | string[] | boolean) => {
    if (!settings) return
    const patterns = [...settings.ai_patterns]
    patterns[idx] = { ...patterns[idx], [field]: value }
    setSettings({ ...settings, ai_patterns: patterns })
  }

  const addPattern = () => { if (settings) setSettings({ ...settings, ai_patterns: [...settings.ai_patterns, { id: 'p' + Date.now(), trigger: 'custom', label: t('newPattern'), keywords: [], response: '', enabled: true }] }) }
  const removePattern = (idx: number) => { if (settings) setSettings({ ...settings, ai_patterns: settings.ai_patterns.filter((_, i) => i !== idx) }) }
  const restorePatterns = () => { if (settings) setSettings({ ...settings, ai_patterns: defaultAiTemplates(profile?.studio_locale ?? 'pt').ai_patterns }) }

  const updateMessage = (idx: number, field: keyof CustomMessage, value: string | boolean) => {
    if (!settings) return
    const msgs = [...settings.custom_messages]
    msgs[idx] = { ...msgs[idx], [field]: value }
    setSettings({ ...settings, custom_messages: msgs })
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner className="text-[var(--gold)]" /></div>

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-serif font-medium flex items-center gap-2"><Bot className="size-6 text-[var(--gold)]" />SecretarIA</h1><p className="text-sm text-[var(--ink-500)] mt-0.5">{t('aiSubtitle')}</p></div>
        <Button className="btn-gold gap-2" onClick={save} disabled={saving}>{saving ? <Spinner className="size-4" /> : saved ? <CheckCircle2 className="size-4" /> : <Save className="size-4" />}{saving ? tc('saving') : saved ? tc('saved') : tc('save')}</Button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="luxury-card">
          <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center gap-2"><Settings2 className="size-4 text-[var(--gold)]" /><h2 className="font-serif font-medium text-lg">{t('config')}</h2></div>
          <div className="p-6">
            <Tabs defaultValue="patterns">
              <TabsList className="w-full"><TabsTrigger value="patterns" className="flex-1 text-xs">{t('patterns')}</TabsTrigger><TabsTrigger value="messages" className="flex-1 text-xs">{t('fixedMessages')}</TabsTrigger></TabsList>

              <TabsContent value="patterns" className="mt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-[var(--ink-500)]">{t('patternsHelp')}</p>
                  <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={restorePatterns}><RotateCcw className="size-3" />{t('restore')}</Button>
                </div>
                {settings?.ai_patterns.map((p, i) => (
                  <div key={p.id} className="rounded-lg border border-[var(--ink-200)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-xs">{p.label}</Badge>
                      <div className="flex items-center gap-1">
                        <Switch checked={p.enabled} onCheckedChange={v => updatePattern(i, 'enabled', v)} />
                        <Button variant="ghost" size="icon-xs" onClick={() => removePattern(i)}><Trash2 className="size-3 text-[var(--danger)]" /></Button>
                      </div>
                    </div>
                    <Input value={p.keywords.join(', ')} onChange={e => updatePattern(i, 'keywords', e.target.value.split(',').map(k => k.trim()))} placeholder={t('keywordsPh')} className="h-8 text-xs" />
                    <Textarea value={p.response} onChange={e => updatePattern(i, 'response', e.target.value)} placeholder={t('responsePh')} rows={2} className="text-xs" />
                  </div>
                ))}
                <Button variant="outline" className="w-full gap-2 text-sm" onClick={addPattern}><Plus className="size-4" />{t('addPattern')}</Button>
              </TabsContent>

              <TabsContent value="messages" className="mt-4 space-y-3">
                <p className="text-xs text-[var(--ink-500)]">{t('messagesHelp')}</p>
                {settings?.custom_messages.map((m, i) => (
                  <div key={m.id} className="rounded-lg border border-[var(--ink-200)] p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">{m.label}</Label>
                      <Switch checked={m.enabled} onCheckedChange={v => updateMessage(i, 'enabled', v)} />
                    </div>
                    <Textarea value={m.message} onChange={e => updateMessage(i, 'message', e.target.value)} rows={2} className="text-xs" />
                  </div>
                ))}
              </TabsContent>
            </Tabs>
          </div>
        </div>

        <div className="luxury-card flex flex-col" style={{ minHeight: '600px' }}>
          <div className="px-6 py-4 border-b border-[var(--ink-200)] flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl gold-gradient flex items-center justify-center gold-shadow"><Sparkles className="size-4" /></div>
            <div><h2 className="font-serif font-medium text-lg">{t('testTitle')}</h2><p className="text-xs text-[var(--ink-500)]">{t('testSubtitle')}</p></div>
            <div className="ml-auto flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-[var(--success)] animate-pulse" /><span className="text-xs text-[var(--ink-500)]">{t('online')}</span></div>
          </div>
          <div className="flex-1 p-6 flex flex-col">
            <p className="text-xs text-[var(--ink-500)] bg-[var(--ink-100)] rounded-lg px-3 py-2 mb-4">
              {t('testNotice')}
            </p>
            <div className="flex gap-2 mb-4">
              <Input value={testInput} onChange={e => setTestInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && runTest()} placeholder={t('testPh')} />
              <Button onClick={runTest} className="btn-gold"><Send className="size-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-1.5 mb-4">
              {[t('sample1'), t('sample2'), t('sample3'), t('sample4')].map(s => <button key={s} onClick={() => setTestInput(s)} className="text-xs px-2 py-1 rounded-full border border-[var(--ink-200)] hover:border-[var(--gold-200)] hover:bg-[var(--gold-50)]/30 transition-all">{s}</button>)}
            </div>
            {testResult && (
              <div className="space-y-3 flex-1">
                <div className="rounded-lg border border-[var(--ink-200)] p-3">
                  <p className="text-xs text-[var(--ink-500)] mb-1">{t('received')}</p>
                  <p className="text-sm">{testInput}</p>
                </div>
                <div className="rounded-lg border border-[var(--gold-200)] bg-[var(--gold-50)] p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Bot className="size-3.5 text-[var(--gold)]" />
                    <span className="text-xs font-medium">{t('matched', { label: (testResult.matched ? testResult.pattern?.label : t('fallback')) || '' })}</span>
                  </div>
                  <p className="text-sm">{testResult.response}</p>
                </div>
              </div>
            )}
            {!testResult && (
              <div className="flex-1 flex flex-col items-center justify-center text-center">
                <Bot className="size-12 text-[var(--ink-300)] mb-3" />
                <p className="text-sm text-[var(--ink-500)]">{t('typeToTest')}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
