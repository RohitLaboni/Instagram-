require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');

const instaSave = require('./instaSave');

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

function extractUrl(text) {
  if (!text) return null;

  const urlRe = /(https?:\/\/(?:www\.)?instagram\.com\/[^\s]+)/i;

  const match = String(text).match(urlRe);

  return match ? match[1] : null;
}

const TELEGRAM_SAFE_LIMIT = 50 * 1024 * 1024;

async function downloadToBuffer(url, maxSize = Infinity) {
  const headers = {
    'User-Agent': 'Mozilla/5.0'
  };

  const resp = await axios.get(url, {
    responseType: 'stream',
    headers,
    timeout: 20000,
    validateStatus: null
  });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`download failed: ${resp.status}`);
  }

  if (!resp.data || typeof resp.data.on !== 'function') {
    throw new Error('Invalid stream response');
  }

  const contentLengthHeader = resp.headers['content-length'];

  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);

    if (!Number.isNaN(contentLength) && contentLength > maxSize) {
      return {
        tooBig: true,
        size: contentLength
      };
    }
  }

  return await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let finished = false;

    resp.data.on('data', (chunk) => {
      if (finished) return;

      chunks.push(chunk);
      size += chunk.length;

      if (size > maxSize) {
        finished = true;

        if (typeof resp.data.destroy === 'function') {
          resp.data.destroy();
        }

        return resolve({
          tooBig: true,
          size
        });
      }
    });

    resp.data.on('end', () => {
      if (finished) return;

      finished = true;

      resolve({
        buffer: Buffer.concat(chunks, size),
        size
      });
    });

    resp.data.on('error', (err) => {
      if (finished) return;

      finished = true;
      reject(err);
    });
  });
}

bot.start((ctx) =>
  ctx.reply(
    'Send me an Instagram post or reel link and I will try to download the video/image for you.'
  )
);

bot.command('help', (ctx) =>
  ctx.reply(
    'Send an Instagram URL (post/reel). I will download the media and send it if possible.'
  )
);

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();

  const url = extractUrl(text);

  if (!url) return;

  const user =
    ctx.from.username
      ? `@${ctx.from.username}`
      : ctx.from.first_name || 'user';

  try {
    await ctx.reply(`🔎 ${user}, fetching data for:\n${url}`);

    const data = await instaSave(url);

    const metaLines = [];

    if (data.profileName)
      metaLines.push(`Profile: ${data.profileName}`);

    if (data.description)
      metaLines.push(`Caption: ${data.description}`);

    if (data.likes)
      metaLines.push(`Likes: ${data.likes}`);

    if (data.comments)
      metaLines.push(`Comments: ${data.comments}`);

    if (data.timeAgo)
      metaLines.push(`Posted: ${data.timeAgo}`);

    const caption =
      metaLines.join('\n').slice(0, 1000) || undefined;

    // FIXED FOR NEW instaSave FORMAT
    const media = Array.isArray(data.media)
      ? data.media
      : [];

    const first = media[0];

    if (!first || !first.url) {
      throw new Error('No downloadable media found');
    }

    // VIDEO
    if (first.type === 'video') {
      await ctx.reply('⬇️ Checking & downloading video...');

      const result = await downloadToBuffer(
        first.url,
        TELEGRAM_SAFE_LIMIT
      );

      if (result.tooBig) {
        await ctx.reply(
          `⚠️ The video is too large (${(
            result.size /
            (1024 * 1024)
          ).toFixed(1)} MB).\n\nDirect link:\n${first.url}`
        );

        return;
      }

      if (!result.buffer) {
        throw new Error('Empty video buffer');
      }

      await ctx.replyWithVideo(
        {
          source: result.buffer
        },
        {
          caption
        }
      );

      return;
    }

    // IMAGE
    if (first.type === 'image') {
      await ctx.reply('⬇️ Checking & downloading image...');

      const result = await downloadToBuffer(
        first.url,
        TELEGRAM_SAFE_LIMIT
      );

      if (result.tooBig) {
        await ctx.reply(
          `⚠️ The image is too large (${(
            result.size /
            (1024 * 1024)
          ).toFixed(1)} MB).\n\nDirect link:\n${first.url}`
        );

        return;
      }

      if (!result.buffer) {
        throw new Error('Empty image buffer');
      }

      await ctx.replyWithPhoto(
        {
          source: result.buffer
        },
        {
          caption
        }
      );

      return;
    }

    await ctx.reply(
      `I couldn't find a supported media type.\n\n${url}`
    );

  } catch (err) {
    console.error('Handler error:', err.message || err);

    await ctx.reply(
      `❌ Error: ${err.message || err}`
    );
  }
});

bot.catch((err) => {
  console.error('Bot error:', err.message || err);
});

console.log('Bot started');

bot.launch();

process.once('SIGINT', () => bot.stop('SIGINT'));

process.once('SIGTERM', () => bot.stop('SIGTERM'));
