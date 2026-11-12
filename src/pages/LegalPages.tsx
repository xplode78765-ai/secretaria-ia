import { Link } from 'react-router-dom'
import { useI18n, type Lang } from '@/i18n'
import { LanguageToggle } from '@/components/LanguageToggle'

// Terms of Use and Privacy Policy.
// IMPORTANT: this is a starting text. Fill in COMPANY below and have a lawyer
// review both documents before selling.
const COMPANY = {
  name: '[RAZÃO SOCIAL]',
  cnpj: '[CNPJ]',
  email: '[E-MAIL DE CONTATO]',
  updated: '11/11/2026',
}

type Section = { h: string; p: string[] }
type Doc = { title: string; updated: string; back: string; sections: Section[] }

const TERMS: Record<Lang, Doc> = {
  pt: {
    title: 'Termos de Uso',
    updated: `Última atualização: ${COMPANY.updated}`,
    back: 'Voltar',
    sections: [
      { h: '1. Quem somos', p: [`A SecretarIA é um serviço oferecido por ${COMPANY.name}, CNPJ ${COMPANY.cnpj} ("nós"). Ao criar uma conta você ("studio") concorda com estes termos.`] },
      { h: '2. O que o serviço faz', p: ['A SecretarIA oferece agenda, cadastro de clientes, controle financeiro e uma assistente com inteligência artificial que responde mensagens e agenda horários pelo WhatsApp do studio.', 'A assistente responde com base nos procedimentos, preços e horários que você cadastra. Ela pode errar. Você é responsável por conferir os agendamentos e por manter seus dados atualizados. A assistente não dá orientação médica ou de saúde: nesses casos ela encaminha a conversa para a sua equipe.'] },
      { h: '3. Conexão com o WhatsApp', p: ['A conexão por QR code usa uma integração não oficial do WhatsApp. O WhatsApp (Meta) pode restringir ou banir números que usem integrações não oficiais, principalmente em caso de envio de mensagens em massa ou para pessoas que não conversaram com o studio. Ao conectar seu número dessa forma você declara conhecer e aceitar esse risco. Não nos responsabilizamos por bloqueio, banimento ou perda de histórico do número.', 'Para reduzir o risco, o sistema limita as mensagens promocionais a 50 por hora e só as envia a clientes que já conversaram com o studio. No plano Pro é possível usar a API oficial do WhatsApp, sujeita às regras e aos preços da Meta.'] },
      { h: '4. Suas obrigações', p: ['Usar o serviço de acordo com a lei, incluindo a Lei Geral de Proteção de Dados (LGPD).', 'Enviar mensagens promocionais apenas a clientes que consentiram, e respeitar o pedido de quem responder "SAIR".', 'Não usar o serviço para spam, conteúdo ilegal ou para se passar por outra pessoa ou empresa.', 'Manter sua senha em sigilo. O que for feito com a sua conta é de sua responsabilidade.'] },
      { h: '5. Teste grátis, planos e pagamento', p: ['Novas contas têm 7 dias de teste grátis, sem cartão. Depois disso é preciso assinar um plano para a assistente continuar atendendo.', 'A assinatura é mensal e renovada automaticamente. A cobrança é processada pela Asaas (Pix, cartão ou boleto). Os preços ficam na tela "Meu plano" e podem ser alterados para os ciclos seguintes, com aviso prévio.', 'Se um pagamento não for identificado, avisamos por 3 dias e depois pausamos a assistente e as mensagens automáticas. Seus dados continuam guardados.', 'Você pode cancelar quando quiser na tela "Meu plano". O cancelamento vale a partir do fim do período já pago; não há reembolso proporcional, salvo quando a lei exigir.'] },
      { h: '6. Dados das suas clientes', p: ['Os dados das suas clientes pertencem a você. Você é o controlador desses dados e nós somos o operador, tratando-os apenas para prestar o serviço, conforme a Política de Privacidade.'] },
      { h: '7. Disponibilidade e limites', p: ['Trabalhamos para manter o serviço no ar, mas ele pode ficar indisponível por manutenção ou por falha de terceiros (WhatsApp, provedores de IA, hospedagem, meios de pagamento).', 'Na medida permitida pela lei, nossa responsabilidade fica limitada ao valor pago por você nos 3 meses anteriores ao fato.'] },
      { h: '8. Encerramento', p: ['Podemos suspender contas que violem estes termos. Você pode pedir a exclusão da conta e dos dados pelo contato abaixo.'] },
      { h: '9. Mudanças e contato', p: [`Podemos atualizar estes termos e avisaremos pelo app. Dúvidas: ${COMPANY.email}.`] },
    ],
  },
  es: {
    title: 'Términos de Uso',
    updated: `Última actualización: ${COMPANY.updated}`,
    back: 'Volver',
    sections: [
      { h: '1. Quiénes somos', p: [`SecretarIA es un servicio ofrecido por ${COMPANY.name}, CNPJ ${COMPANY.cnpj} ("nosotros"). Al crear una cuenta tú ("el estudio") aceptas estos términos.`] },
      { h: '2. Qué hace el servicio', p: ['SecretarIA ofrece agenda, registro de clientes, control financiero y una asistente con inteligencia artificial que responde mensajes y reserva citas por el WhatsApp del estudio.', 'La asistente responde según los procedimientos, precios y horarios que registras. Puede equivocarse. Eres responsable de revisar las reservas y de mantener tus datos actualizados. La asistente no da orientación médica ni de salud: en esos casos deriva la conversación a tu equipo.'] },
      { h: '3. Conexión con WhatsApp', p: ['La conexión por código QR usa una integración no oficial de WhatsApp. WhatsApp (Meta) puede restringir o bloquear números que usen integraciones no oficiales, sobre todo si se envían mensajes masivos o a personas que no hablaron con el estudio. Al conectar tu número de esta forma declaras conocer y aceptar ese riesgo. No nos responsabilizamos por bloqueos ni por la pérdida del historial del número.', 'Para reducir el riesgo, el sistema limita los mensajes promocionales a 50 por hora y solo los envía a clientes que ya hablaron con el estudio. En el plan Pro se puede usar la API oficial de WhatsApp, sujeta a las reglas y precios de Meta.'] },
      { h: '4. Tus obligaciones', p: ['Usar el servicio conforme a la ley, incluida la ley brasileña de protección de datos (LGPD).', 'Enviar mensajes promocionales solo a clientes que dieron su consentimiento y respetar a quien responda "SALIR".', 'No usar el servicio para spam, contenido ilegal ni para hacerte pasar por otra persona o empresa.', 'Mantener tu contraseña en secreto. Lo que se haga con tu cuenta es tu responsabilidad.'] },
      { h: '5. Prueba gratis, planes y pago', p: ['Las cuentas nuevas tienen 7 días de prueba gratis, sin tarjeta. Después hay que suscribirse a un plan para que la asistente siga atendiendo.', 'La suscripción es mensual y se renueva automáticamente. El cobro lo procesa Asaas (Pix, tarjeta o boleto). Los precios están en la pantalla "Mi plan" y pueden cambiar para los ciclos siguientes, con aviso previo.', 'Si no se identifica un pago, avisamos durante 3 días y luego pausamos la asistente y los mensajes automáticos. Tus datos se conservan.', 'Puedes cancelar cuando quieras en la pantalla "Mi plan". La cancelación rige desde el final del período ya pagado; no hay reembolso proporcional, salvo cuando la ley lo exija.'] },
      { h: '6. Datos de tus clientas', p: ['Los datos de tus clientas te pertenecen. Tú eres el responsable de esos datos y nosotros el encargado, que los trata solo para prestar el servicio, según la Política de Privacidad.'] },
      { h: '7. Disponibilidad y límites', p: ['Trabajamos para mantener el servicio en línea, pero puede no estar disponible por mantenimiento o por fallas de terceros (WhatsApp, proveedores de IA, alojamiento, medios de pago).', 'En la medida que la ley lo permita, nuestra responsabilidad se limita al monto que pagaste en los 3 meses anteriores al hecho.'] },
      { h: '8. Cierre', p: ['Podemos suspender cuentas que incumplan estos términos. Puedes pedir la eliminación de la cuenta y de los datos por el contacto de abajo.'] },
      { h: '9. Cambios y contacto', p: [`Podemos actualizar estos términos y avisaremos en la app. Consultas: ${COMPANY.email}.`] },
    ],
  },
}

const PRIVACY: Record<Lang, Doc> = {
  pt: {
    title: 'Política de Privacidade',
    updated: `Última atualização: ${COMPANY.updated}`,
    back: 'Voltar',
    sections: [
      { h: '1. Quem trata os dados', p: [`${COMPANY.name}, CNPJ ${COMPANY.cnpj}. Contato do encarregado de dados: ${COMPANY.email}.`, 'Em relação aos dados das clientes finais, o studio é o controlador e a SecretarIA é o operador.'] },
      { h: '2. Dados que tratamos', p: ['Da conta do studio: nome, e-mail, telefone, dados do estabelecimento e, para cobrança, CPF ou CNPJ.', 'Das clientes do studio: nome, telefone/WhatsApp, e-mail, aniversário, foto, histórico de agendamentos e pagamentos, mensagens trocadas pelo WhatsApp (incluindo áudios, que são transcritos) e a ficha de anamnese, que pode conter dados de saúde.'] },
      { h: '3. Para que usamos', p: ['Prestar o serviço: responder mensagens, agendar, enviar lembretes e gerar relatórios.', 'Cobrar a assinatura do studio.', 'Segurança, prevenção a fraudes e cumprimento de obrigações legais.', 'Não vendemos dados nem os usamos para publicidade de terceiros.'] },
      { h: '4. Com quem compartilhamos', p: ['Com prestadores que operam o serviço, apenas no necessário: Supabase (banco de dados e hospedagem), OpenAI (geração de respostas e transcrição de áudio), Evolution API e WhatsApp/Meta (envio e recebimento de mensagens), Asaas (cobrança) e Resend (e-mails).', 'Alguns desses prestadores ficam fora do Brasil; nesses casos há transferência internacional de dados com as salvaguardas previstas na LGPD.'] },
      { h: '5. Mensagens promocionais', p: ['Mensagens de promoção, resgate e aniversário só são enviadas a clientes que já conversaram com o studio. Em cada uma há a opção de parar: basta responder "SAIR". Lembretes de horários marcados continuam sendo enviados.'] },
      { h: '6. Por quanto tempo guardamos', p: ['Enquanto a conta do studio existir. Após o cancelamento, os dados ficam guardados para permitir a reativação e são apagados quando o studio pedir a exclusão, salvo o que a lei obrigar a guardar.'] },
      { h: '7. Segurança', p: ['Acesso por perfil (dona, recepção, profissional), isolamento dos dados de cada studio, fotos em armazenamento privado e conexões criptografadas. Nenhum sistema é totalmente imune a incidentes; se houver um que traga risco, avisaremos os envolvidos e a ANPD.'] },
      { h: '8. Direitos do titular', p: ['Confirmar o tratamento, acessar, corrigir, portar ou eliminar dados, e revogar consentimento. Clientes finais devem pedir ao studio onde foram atendidas; o studio pode nos acionar pelo contato acima. Respondemos em até 15 dias.'] },
    ],
  },
  es: {
    title: 'Política de Privacidad',
    updated: `Última actualización: ${COMPANY.updated}`,
    back: 'Volver',
    sections: [
      { h: '1. Quién trata los datos', p: [`${COMPANY.name}, CNPJ ${COMPANY.cnpj}. Contacto del encargado de datos: ${COMPANY.email}.`, 'Respecto de los datos de las clientas finales, el estudio es el responsable y SecretarIA es el encargado.'] },
      { h: '2. Datos que tratamos', p: ['De la cuenta del estudio: nombre, correo, teléfono, datos del negocio y, para el cobro, CPF o CNPJ.', 'De las clientas del estudio: nombre, teléfono/WhatsApp, correo, cumpleaños, foto, historial de citas y pagos, mensajes intercambiados por WhatsApp (incluidos audios, que se transcriben) y la ficha de anamnesis, que puede contener datos de salud.'] },
      { h: '3. Para qué los usamos', p: ['Prestar el servicio: responder mensajes, reservar, enviar recordatorios y generar informes.', 'Cobrar la suscripción del estudio.', 'Seguridad, prevención de fraudes y cumplimiento de obligaciones legales.', 'No vendemos datos ni los usamos para publicidad de terceros.'] },
      { h: '4. Con quién los compartimos', p: ['Con proveedores que operan el servicio, solo lo necesario: Supabase (base de datos y alojamiento), OpenAI (generación de respuestas y transcripción de audio), Evolution API y WhatsApp/Meta (envío y recepción de mensajes), Asaas (cobro) y Resend (correos).', 'Algunos de estos proveedores están fuera de Brasil; en esos casos hay transferencia internacional de datos con las garantías previstas en la LGPD.'] },
      { h: '5. Mensajes promocionales', p: ['Los mensajes de promoción, reactivación y cumpleaños solo se envían a clientas que ya hablaron con el estudio. En cada uno está la opción de dejar de recibirlos: basta responder "SALIR". Los recordatorios de citas reservadas se siguen enviando.'] },
      { h: '6. Cuánto tiempo los guardamos', p: ['Mientras exista la cuenta del estudio. Tras la cancelación, los datos se conservan para permitir la reactivación y se eliminan cuando el estudio pida su eliminación, salvo lo que la ley obligue a conservar.'] },
      { h: '7. Seguridad', p: ['Acceso por perfil (dueña, recepción, profesional), aislamiento de los datos de cada estudio, fotos en almacenamiento privado y conexiones cifradas. Ningún sistema es totalmente inmune a incidentes; si ocurre uno que implique riesgo, avisaremos a los afectados y a la autoridad de protección de datos (ANPD).'] },
      { h: '8. Derechos del titular', p: ['Confirmar el tratamiento, acceder, corregir, portar o eliminar datos, y revocar el consentimiento. Las clientas finales deben pedirlo al estudio donde fueron atendidas; el estudio puede contactarnos por el medio indicado arriba. Respondemos en un máximo de 15 días.'] },
    ],
  },
}

function LegalPage({ docs }: { docs: Record<Lang, Doc> }) {
  const { lang } = useI18n()
  const doc = docs[lang]
  return (
    <div className="min-h-screen bg-[var(--canvas)]">
      <div className="max-w-3xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <Link to="/login" className="text-sm text-[var(--ink-500)] hover:text-[var(--gold)]">← {doc.back}</Link>
          <LanguageToggle />
        </div>
        <h1 className="text-3xl font-serif font-medium">{doc.title}</h1>
        <p className="text-xs text-[var(--ink-500)] mt-1 mb-8">{doc.updated}</p>
        <div className="space-y-6">
          {doc.sections.map((s) => (
            <section key={s.h}>
              <h2 className="font-serif font-medium text-lg mb-2">{s.h}</h2>
              <div className="space-y-2">
                {s.p.map((p, i) => <p key={i} className="text-sm leading-relaxed text-[var(--ink-600)]">{p}</p>)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

export function TermsPage() { return <LegalPage docs={TERMS} /> }
export function PrivacyPage() { return <LegalPage docs={PRIVACY} /> }
