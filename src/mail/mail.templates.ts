// Pure, framework-agnostic email template builders.
// Kept free of Nest dependencies so they can be unit-tested and reused.

export const LOGO_CID = 'nordikhat-logo';

export interface CredentialsEmailParams {
  name: string;
  loginEmail: string;
  password: string;
  appName?: string;
  apartmentLabel?: string;
  iosUrl?: string;
  huaweiUrl?: string;
  androidTestEmail?: string;
}

export interface RejectionEmailParams {
  name: string;
  reason: string;
  appName?: string;
  apartmentLabel?: string;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BRAND_DARK = '#111217';
const BRAND_MUTED = '#6b7280';
const BG = '#f4f5f7';
const CARD = '#ffffff';
const BORDER = '#e5e7eb';

function layout(opts: {
  appName: string;
  preheader: string;
  accent: string;
  heading: string;
  bodyHtml: string;
}): string {
  const year = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(opts.appName)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(opts.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 0;">
  <tr>
    <td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
        <tr>
          <td style="height:4px;background:${opts.accent};font-size:0;line-height:0;">&nbsp;</td>
        </tr>
        <tr>
          <td align="center" style="padding:28px 32px 8px 32px;">
            <img src="cid:${LOGO_CID}" alt="${escapeHtml(opts.appName)}" width="120" style="display:block;width:120px;max-width:60%;height:auto;border:0;" />
          </td>
        </tr>
        <tr>
          <td style="padding:8px 32px 0 32px;">
            <h1 style="margin:0;font-size:20px;line-height:1.3;color:${BRAND_DARK};font-weight:700;text-align:center;">${escapeHtml(opts.heading)}</h1>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px 32px 32px;color:#374151;font-size:15px;line-height:1.6;">
            ${opts.bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid ${BORDER};background:#fafafa;">
            <p style="margin:0;color:${BRAND_MUTED};font-size:12px;line-height:1.5;text-align:center;">
              Este es un mensaje automático de ${escapeHtml(opts.appName)}. Por favor no respondas a este correo.<br/>
              &copy; ${year} ${escapeHtml(opts.appName)}. Todos los derechos reservados.
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function deviceCard(opts: { label: string; instructionHtml: string }): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 10px 0;border:1px solid ${BORDER};border-radius:10px;background:#ffffff;">
    <tr>
      <td style="padding:14px 16px;">
        <span style="display:block;color:${BRAND_DARK};font-size:14px;font-weight:700;">${escapeHtml(opts.label)}</span>
        <div style="margin-top:6px;color:#374151;font-size:14px;line-height:1.55;">${opts.instructionHtml}</div>
      </td>
    </tr>
  </table>`;
}

function howToAccessSection(params: CredentialsEmailParams, appName: string): string {
  const androidInstruction =
    `Estamos en <strong>prueba interna</strong>. <strong>Responde a este correo</strong> con tu cuenta de <strong>Gmail (Google)</strong> para agregarte como probador y poder descargarla.`;

  const iosInstruction = params.iosUrl?.trim()
    ? `Descárgala desde el App Store:<br/>
       <a href="${escapeHtml(params.iosUrl.trim())}" style="display:inline-block;margin-top:8px;padding:9px 18px;background:${BRAND_DARK};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Descargar en App Store</a>`
    : `Búscala como <strong>${escapeHtml(appName)}</strong> en el App Store.`;

  const huaweiInstruction = params.huaweiUrl?.trim()
    ? `Descárgala desde AppGallery:<br/>
       <a href="${escapeHtml(params.huaweiUrl.trim())}" style="display:inline-block;margin-top:8px;padding:9px 18px;background:${BRAND_DARK};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;">Descargar en AppGallery</a>`
    : `Ya está disponible en <strong>AppGallery</strong>: ábrela y busca <strong>${escapeHtml(appName)}</strong>.`;

  return `
    <p style="margin:22px 0 10px 0;font-size:15px;font-weight:700;color:${BRAND_DARK};">Cómo descargar e ingresar a la app</p>
    ${deviceCard({ label: '📱 Android', instructionHtml: androidInstruction })}
    ${deviceCard({ label: '🍎 iPhone (iOS)', instructionHtml: iosInstruction })}
    ${deviceCard({ label: '🟢 Huawei', instructionHtml: huaweiInstruction })}
  `;
}

export function renderCredentialsEmail(params: CredentialsEmailParams): {
  subject: string;
  html: string;
} {
  const appName = params.appName || 'Astra Domus';
  const greetingName = params.name?.trim() || 'Residente';
  const aptLine = params.apartmentLabel
    ? `<p style="margin:0 0 16px 0;">Tu registro para <strong>${escapeHtml(params.apartmentLabel)}</strong> fue aprobado.</p>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(greetingName)}</strong>,</p>
    ${aptLine}
    <p style="margin:0 0 8px 0;">Estas son tus credenciales para ingresar a <strong>${escapeHtml(appName)}</strong>. Consérvalas en un lugar seguro.</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0;border:1px solid ${BORDER};border-radius:10px;background:#f9fafb;">
      <tr>
        <td style="padding:14px 18px;border-bottom:1px solid ${BORDER};">
          <span style="display:block;color:${BRAND_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Usuario (correo)</span>
          <span style="display:block;color:${BRAND_DARK};font-size:16px;font-weight:600;margin-top:4px;">${escapeHtml(params.loginEmail)}</span>
        </td>
      </tr>
      <tr>
        <td style="padding:14px 18px;">
          <span style="display:block;color:${BRAND_MUTED};font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Contraseña temporal</span>
          <span style="display:block;color:${BRAND_DARK};font-size:18px;font-weight:700;letter-spacing:.06em;margin-top:4px;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(params.password)}</span>
        </td>
      </tr>
    </table>
    ${howToAccessSection(params, appName)}
    <p style="margin:16px 0 0 0;color:${BRAND_MUTED};font-size:13px;">Si no esperabas este correo, ignóralo o contacta a la administración del conjunto.</p>
  `;

  return {
    subject: `Tus credenciales de acceso · ${appName}`,
    html: layout({
      appName,
      preheader: 'Tu registro fue aprobado. Aquí están tus credenciales y cómo descargar la app.',
      accent: '#16a34a',
      heading: '¡Tu registro fue aprobado!',
      bodyHtml,
    }),
  };
}

export function renderRejectionEmail(params: RejectionEmailParams): {
  subject: string;
  html: string;
} {
  const appName = params.appName || 'Nordikhat';
  const greetingName = params.name?.trim() || 'Residente';
  const aptLine = params.apartmentLabel
    ? `<p style="margin:0 0 16px 0;">Tu solicitud de registro para <strong>${escapeHtml(params.apartmentLabel)}</strong> no pudo ser aprobada.</p>`
    : `<p style="margin:0 0 16px 0;">Tu solicitud de registro no pudo ser aprobada.</p>`;

  const bodyHtml = `
    <p style="margin:0 0 12px 0;">Hola <strong>${escapeHtml(greetingName)}</strong>,</p>
    ${aptLine}
    <p style="margin:0 0 8px 0;">La administración revisó tu solicitud y encontró lo siguiente:</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #fde68a;border-radius:10px;background:#fffbeb;">
      <tr>
        <td style="padding:16px 18px;">
          <span style="display:block;color:#92400e;font-size:12px;text-transform:uppercase;letter-spacing:.04em;font-weight:700;">Motivo del rechazo</span>
          <span style="display:block;color:#78350f;font-size:15px;line-height:1.6;margin-top:6px;">${escapeHtml(params.reason)}</span>
        </td>
      </tr>
    </table>
    <p style="margin:16px 0 0 0;">Puedes volver a realizar el auto-registro corrigiendo la información indicada. Si tienes dudas, comunícate con la administración del conjunto.</p>
  `;

  return {
    subject: `Tu solicitud de registro fue rechazada · ${appName}`,
    html: layout({
      appName,
      preheader: 'Tu solicitud de registro no pudo ser aprobada. Conoce el motivo.',
      accent: '#dc2626',
      heading: 'Solicitud de registro rechazada',
      bodyHtml,
    }),
  };
}
