require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const webpush = require('web-push');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static('public'));

// Supabase client (service key per operazioni admin lato server)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Supabase client pubblico (per auth studenti)
const supabasePublic = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const resend = new Resend(process.env.RESEND_API_KEY);

// VAPID per push notifications
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

// Middleware autenticazione admin
function adminAuth(req, res, next) {
  const password = req.headers['x-admin-password'];
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }
  next();
}

// ─── API VERIFICHE ────────────────────────────────────────────────────────────

// GET /api/verifiche — lista pubblica
app.get('/api/verifiche', async (req, res) => {
  const { data, error } = await supabase
    .from('verifiche')
    .select('*')
    .order('data_verifica', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/verifiche — admin aggiunge verifica
app.post('/api/verifiche', adminAuth, async (req, res) => {
  const { materia, argomento, data_verifica, classe } = req.body;
  if (!materia || !argomento || !data_verifica || !classe) {
    return res.status(400).json({ error: 'Campi mancanti' });
  }
  const { data, error } = await supabase
    .from('verifiche')
    .insert([{ materia, argomento, data_verifica, classe }])
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// PUT /api/verifiche/:id — admin modifica
app.put('/api/verifiche/:id', adminAuth, async (req, res) => {
  const { materia, argomento, data_verifica, classe } = req.body;
  const { data, error } = await supabase
    .from('verifiche')
    .update({ materia, argomento, data_verifica, classe })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/verifiche/:id — admin elimina
app.delete('/api/verifiche/:id', adminAuth, async (req, res) => {
  const { error } = await supabase
    .from('verifiche')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────

// GET /api/vapid-public — chiave pubblica per il frontend
app.get('/api/vapid-public', (req, res) => {
  res.json({ key: process.env.VAPID_PUBLIC_KEY || '' });
});

// POST /api/subscribe — salva iscrizione push
app.post('/api/subscribe', async (req, res) => {
  const { subscription, email } = req.body;
  if (!subscription) return res.status(400).json({ error: 'Subscription mancante' });
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert([{ subscription: JSON.stringify(subscription), email: email || 'anonimo' }], { onConflict: 'email' });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ─── INVIO PROMEMORIA ────────────────────────────────────────────────────────

// POST /api/send-reminders — chiamato dal cron settimanale
app.post('/api/send-reminders', async (req, res) => {
  // Verifica semplice anti-spam: header segreto o admin password
  const secret = req.headers['x-cron-secret'] || req.headers['x-admin-password'];
  if (secret !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Non autorizzato' });
  }

  const oggi = new Date();
  const fraSetteGiorni = new Date();
  fraSetteGiorni.setDate(oggi.getDate() + 7);

  const { data: verifiche, error: errV } = await supabase
    .from('verifiche')
    .select('*')
    .gte('data_verifica', oggi.toISOString().split('T')[0])
    .lte('data_verifica', fraSetteGiorni.toISOString().split('T')[0])
    .order('data_verifica', { ascending: true });

  if (errV) return res.status(500).json({ error: errV.message });
  if (!verifiche || verifiche.length === 0) {
    return res.json({ ok: true, messaggio: 'Nessuna verifica nei prossimi 7 giorni' });
  }

  // Recupera tutti gli utenti registrati
  const { data: utenti, error: errU } = await supabase.auth.admin.listUsers();
  if (errU) return res.status(500).json({ error: errU.message });

  const email_destinatari = utenti.users.map(u => u.email).filter(Boolean);

  if (email_destinatari.length === 0) {
    return res.json({ ok: true, messaggio: 'Nessun destinatario registrato' });
  }

  // Costruisce il corpo email
  const righe = verifiche.map(v => {
    const data = new Date(v.data_verifica + 'T00:00:00');
    const dataFormatted = data.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${dataFormatted}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${v.materia}</strong></td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${v.argomento}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${v.classe}</td>
    </tr>`;
  }).join('');

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1d4ed8">Verifiche dei prossimi 7 giorni</h2>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f1f5f9">
            <th style="padding:8px 12px;text-align:left">Data</th>
            <th style="padding:8px 12px;text-align:left">Materia</th>
            <th style="padding:8px 12px;text-align:left">Argomento</th>
            <th style="padding:8px 12px;text-align:left">Classe</th>
          </tr>
        </thead>
        <tbody>${righe}</tbody>
      </table>
      <p style="color:#64748b;font-size:13px;margin-top:24px">
        Questa email è stata inviata automaticamente dal sistema verifiche del tuo liceo.
      </p>
    </div>`;

  // Invia email
  let emailInviate = 0;
  for (const email of email_destinatari) {
    try {
      await resend.emails.send({
        from: 'Verifiche Liceo <onboarding@resend.dev>',
        to: email,
        subject: `Promemoria verifiche — settimana del ${oggi.toLocaleDateString('it-IT')}`,
        html
      });
      emailInviate++;
    } catch (e) {
      console.error('Errore invio a', email, e.message);
    }
  }

  // Invia push notification
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('subscription');

  if (subscriptions && process.env.VAPID_PUBLIC_KEY) {
    for (const row of subscriptions) {
      try {
        const sub = JSON.parse(row.subscription);
        await webpush.sendNotification(sub, JSON.stringify({
          title: 'Verifiche in arrivo',
          body: `Hai ${verifiche.length} verifica${verifiche.length > 1 ? 'he' : ''} questa settimana`,
          icon: '/icon-192.png'
        }));
      } catch (e) {
        console.error('Errore push:', e.message);
      }
    }
  }

  res.json({ ok: true, emailInviate, verifiche: verifiche.length });
});

// ─── CONFIG PUBBLICA PER IL FRONTEND ─────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY
  });
});

// ─── START ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server avviato su porta ${PORT}`));
