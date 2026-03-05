require('dotenv').config();
const { Telegraf } = require('telegraf');
const axios = require('axios');
const path = require('path');

const instaSave = require('./instaSave'); // your scraper module (the function you provided)

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('Missing BOT_TOKEN in .env');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Helper: extract first URL from text
function extractUrl(text) {
  if (!text) return null;
  const urlRe = /(https?:\/\/(?:www\.)?instagram\.com\/[^\s]+)/i;
  const match = text.match(urlRe);
  return match ? match[1].split('?')[0] : null; // strip query for cleanliness
}

// Telegram's practical file limit for bots can vary; we'll use 50 MB as a safe threshold.
const TELEGRAM_SAFE_LIMIT = 50 * 1024 * 1024; // 50 MB

// Download helper using axios: returns { buffer, size } or throws
// If the server provides Content-Length and it's > maxSize, we return { tooBig: true, size }
async function downloadToBuffer(url, maxSize = Infinity) {
  const headers = { 'User-Agent': 'Mozilla/5.0' };
  // request as stream so we can avoid loading huge files if content-length says so
  const resp = await axios.get(url, { responseType: 'stream', headers, validateStatus: null });

  if (resp.status < 200 || resp.status >= 300) {
    throw new Error(`download failed: ${resp.status}`);
  }

  const contentLengthHeader = resp.headers['content-length'];
  if (contentLengthHeader) {
    const contentLength = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(contentLength) && contentLength > maxSize) {
      return { tooBig: true, size: contentLength };
    }
  }

  // accumulate stream into buffer
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    resp.data.on('data', (chunk) => {
      chunks.push(chunk);
      size += chunk.length;
      // If we've exceeded maxSize while downloading (content-length was missing or lied), abort early
      if (size > maxSize) {
        resp.data.destroy(); // stop the stream
        resolve({ tooBig: true, size }); // resolve with tooBig flag
      }
    });
    resp.data.on('end', () => {
      if (size > maxSize) {
        resolve({ tooBig: true, size });
      } else {
        resolve({ buffer: Buffer.concat(chunks, size), size });
      }
    });
    resp.data.on('error', (err) => {
      reject(err);
    });
  });
}

bot.start((ctx) => ctx.reply('Send me an Instagram post or reel link and I will try to download the video/image for you.'));

bot.command('help', (ctx) => ctx.reply('Send an Instagram URL (post/reel). I will download the media and send it if possible.'));

bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  const url = extractUrl(text);
  if (!url) {
    return; // ignore non-links to reduce noise
  }

  const user = ctx.from.username ? `@${ctx.from.username}` : ctx.from.first_name || 'user';
  try {
    await ctx.reply(`🔎 ${user}, fetching data for: ${url}`);

    const data = await instaSave(url);
    // expected: { JPEG, MP4, likes, comments, description, profileName, timeAgo }

    const metaLines = [];
    if (data.profileName) metaLines.push(`Profile: ${data.profileName}`);
    if (data.description) metaLines.push(`Caption: ${data.description}`);
    if (data.likes) metaLines.push(`Likes: ${data.likes}`);
    if (data.comments) metaLines.push(`Comments: ${data.comments}`);
    if (data.timeAgo) metaLines.push(`Posted: ${data.timeAgo}`);
    const caption = metaLines.join('\n') || undefined;

    if (data.MP4) {
      // Try to avoid downloading if file is too large by inspecting content-length first
      await ctx.reply('⬇️ Checking & downloading video...');
      const result = await downloadToBuffer(data.MP4, TELEGRAM_SAFE_LIMIT);
      if (result.tooBig) {
        await ctx.reply(`⚠️ The video is too large (${(result.size / (1024*1024)).toFixed(1)} MB) for Telegram. Here's the direct link:\n${data.MP4}`);
        return;
      }
      // send as video (telegram will auto-detect)
      await ctx.replyWithVideo({ source: result.buffer }, { caption });
      return;
    }

    if (data.JPEG) {
      await ctx.reply('⬇️ Checking & downloading image...');
      const result = await downloadToBuffer(data.JPEG, TELEGRAM_SAFE_LIMIT);
      if (result.tooBig) {
        // images rarely exceed limits, but just in case
        await ctx.reply(`⚠️ The image is too large (${(result.size / (1024*1024)).toFixed(1)} MB). Here's the direct link:\n${data.JPEG}`);
        return;
      }
      await ctx.replyWithPhoto({ source: result.buffer }, { caption });
      return;
    }

    // Nothing downloadable found; send metadata + original URL
    await ctx.reply(`I couldn't find a direct media file. Here is the link and any metadata I found:\n${url}\n\n${caption || 'No metadata found.'}`);

  } catch (err) {
    console.error('Handler error:', err);
    await ctx.reply(`❌ Error: ${err.message || err}. If you keep getting errors, the scraper might be blocked or the post is private.`);
  }
});

// handle errors globally
bot.catch((err, ctx) => {
  console.error('Bot error', err);
});

console.log('Bot started');
bot.launch();

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));