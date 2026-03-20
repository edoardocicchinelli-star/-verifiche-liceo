# Verifiche Scolastiche

App per la gestione e il promemoria delle verifiche scolastiche.

## Setup

### 1. Variabili d'ambiente
Copia `.env.example` in `.env` e compila tutti i valori.

Per generare le chiavi VAPID (notifiche push), dopo aver installato i pacchetti esegui:
```
node -e "const w=require('web-push');const k=w.generateVAPIDKeys();console.log('VAPID_PUBLIC_KEY='+k.publicKey+'\nVAPID_PRIVATE_KEY='+k.privateKey)"
```

### 2. Installazione pacchetti
```
npm install
```

### 3. Avvio locale
```
npm start
```

## Deploy su Render.com

1. Carica questo progetto su GitHub
2. Vai su render.com → New → Web Service
3. Collega il repository GitHub
4. Build Command: `npm install`
5. Start Command: `node server.js`
6. Aggiungi le variabili d'ambiente nella sezione Environment

## Cron settimanale (cron-job.org)

Per inviare i promemoria automaticamente ogni lunedì mattina:
1. Vai su cron-job.org e crea un account
2. Nuovo cron job → URL: `https://tuo-app.onrender.com/api/send-reminders`
3. Metodo: POST
4. Header: `x-admin-password: la-tua-password-admin`
5. Frequenza: ogni lunedì alle 8:00

## Note Resend

Con il piano gratuito Resend puoi inviare email solo all'indirizzo con cui ti sei registrato,
a meno che non aggiunga un dominio verificato. Per uso scolastico reale,
aggiungi il dominio della scuola su resend.com → Domains.
