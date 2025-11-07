import express from 'express';
import cors from 'cors';
import qrcode from 'qrcode';
import pino from 'pino';
import makeWASocket, { 
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';

import { Boom } from '@hapi/boom';
import 'dotenv/config';


const app = express();
const logger = pino({ level: 'info' });
const PORT = process.env.PORT || 3000;

// Store active connections
const connections = new Map();
const qrCodes = new Map();

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'online',
    service: 'WhatsApp Baileys Server',
    activeConnections: connections.size
  });
});

// Create new WhatsApp connection
app.post('/api/device/create', async (req, res) => {
  try {
    const { deviceId, supabaseUrl, supabaseKey } = req.body;

    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }

    logger.info(`Creating connection for device: ${deviceId}`);

    // Use device-specific auth folder
    const authFolder = `./auth_sessions/${deviceId}`;
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    const { version } = await fetchLatestBaileysVersion();

    if (typeof makeWASocket !== 'function') {
      logger.error('makeWASocket is not a function', {
        type: typeof makeWASocket,
      });
      return res.status(500).json({ error: 'makeWASocket is not a function' });
    }

    const sock = makeWASocket({
      version,
      logger,
      printQRInTerminal: true,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      browser: ['WhatsApp Business', 'Chrome', '120.0.0'],
      markOnlineOnConnect: true,
    });

    // Store connection
    connections.set(deviceId, { sock, supabaseUrl, supabaseKey });

    // QR Code handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrCodeDataURL = await qrcode.toDataURL(qr);
          qrCodes.set(deviceId, qrCodeDataURL);
          logger.info(`QR Code generated for device: ${deviceId}`);

          // Update device in Supabase with QR code
          if (supabaseUrl && supabaseKey) {
            await fetch(`${supabaseUrl}/rest/v1/devices?id=eq.${deviceId}`, {
              method: 'PATCH',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                qr_code: qrCodeDataURL,
                status: 'connecting'
              })
            });
          }
        } catch (err) {
          logger.error('Error generating QR code:', err);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error instanceof Boom)
          ? lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut
          : true;

        logger.info(`Connection closed for ${deviceId}, reconnecting: ${shouldReconnect}`);

        if (shouldReconnect) {
          setTimeout(() => {
            connections.delete(deviceId);
            // Recreate connection
          }, 3000);
        } else {
          connections.delete(deviceId);
        }

        // Update device status in Supabase
        if (supabaseUrl && supabaseKey) {
          await fetch(`${supabaseUrl}/rest/v1/devices?id=eq.${deviceId}`, {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              status: 'disconnected',
              qr_code: null
            })
          });
        }
      } else if (connection === 'open') {
        logger.info(`Connection opened for device: ${deviceId}`);
        qrCodes.delete(deviceId);

        // Get phone number
        const phoneNumber = sock.user?.id?.split(':')[0] || '';

        // Update device in Supabase
        if (supabaseUrl && supabaseKey) {
          await fetch(`${supabaseUrl}/rest/v1/devices?id=eq.${deviceId}`, {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal'
            },
            body: JSON.stringify({
              status: 'connected',
              phone: `+${phoneNumber}`,
              qr_code: null,
              last_seen: new Date().toISOString()
            })
          });
        }
      }
    });

    // Save credentials when updated
    sock.ev.on('creds.update', saveCreds);

    // Handle incoming messages
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type === 'notify') {
        for (const msg of messages) {
          if (!msg.message) continue;

          const messageContent = msg.message.conversation ||
            msg.message.extendedTextMessage?.text ||
            '';

          logger.info(`Message received on ${deviceId}: ${messageContent}`);

          // Store message in Supabase
          if (supabaseUrl && supabaseKey && messageContent) {
            await fetch(`${supabaseUrl}/rest/v1/messages`, {
              method: 'POST',
              headers: {
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                'Prefer': 'return=minimal'
              },
              body: JSON.stringify({
                device_id: deviceId,
                chat_id: msg.key.remoteJid,
                message_id: msg.key.id,
                from_me: msg.key.fromMe,
                contact_phone: msg.key.remoteJid?.split('@')[0],
                message_type: 'text',
                content: messageContent,
                status: 'received',
                timestamp: new Date(msg.messageTimestamp * 1000).toISOString()
              })
            });
          }
        }
      }
    });

    res.json({
      success: true,
      message: 'Connection created',
      deviceId,
      waitingForQR: true
    });

  } catch (error) {
    logger.error('Error creating connection:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Get QR code for a device
app.get('/api/device/:deviceId/qr', (req, res) => {
  const { deviceId } = req.params;
  const qrCode = qrCodes.get(deviceId);

  if (!qrCode) {
    return res.status(404).json({ error: 'QR code not found or device already connected' });
  }

  res.json({ qrCode });
});

// Send message
app.post('/api/message/send', async (req, res) => {
  try {
    const { deviceId, to, message } = req.body;

    if (!deviceId || !to || !message) {
      return res.status(400).json({ error: 'deviceId, to, and message are required' });
    }

    const connection = connections.get(deviceId);
    if (!connection) {
      return res.status(404).json({ error: 'Device not connected' });
    }

    const { sock } = connection;

    // Format phone number (add @s.whatsapp.net if not group)
    const jid = to.includes('@g.us') ? to : `${to.replace(/\D/g, '')}@s.whatsapp.net`;

    await sock.sendMessage(jid, { text: message });

    logger.info(`Message sent from ${deviceId} to ${to}`);

    res.json({
      success: true,
      message: 'Message sent'
    });

  } catch (error) {
    logger.error('Error sending message:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Disconnect device
app.post('/api/device/:deviceId/disconnect', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const connection = connections.get(deviceId);

    if (!connection) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const { sock } = connection;
    await sock.logout();
    connections.delete(deviceId);
    qrCodes.delete(deviceId);

    logger.info(`Device ${deviceId} disconnected`);

    res.json({
      success: true,
      message: 'Device disconnected'
    });

  } catch (error) {
    logger.error('Error disconnecting device:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Get connection status
app.get('/api/device/:deviceId/status', (req, res) => {
  const { deviceId } = req.params;
  const connection = connections.get(deviceId);

  res.json({
    connected: !!connection,
    hasQR: qrCodes.has(deviceId)
  });
});

app.listen(PORT, () => {
  logger.info(`Baileys server running on port ${PORT}`);
});
