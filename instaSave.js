const axios = require('axios');
const cheerio = require('cheerio');

let igdl = null;
try {
  // optional: if ab-downloader isn't installed the module still works (fallback scraping)
  igdl = require('ab-downloader').igdl;
} catch (e) {
  // ignore — we'll use the scraper fallback
}

/**
 * Try to extract commonly-used fields from ab-downloader's result.
 * The exact shape of ab-downloader output can vary by version/content-type,
 * so we probe for several common keys.
 */
function mapIgdlResult(d) {
  if (!d) return null;
  // if it's an array, pick the first item (carousel handling)
  const item = Array.isArray(d) ? (d[0] || {}) : d;

  const pickUrl = (...keys) => {
    for (const k of keys) {
      if (!item) continue;
      const v = item[k];
      if (!v) continue;
      if (Array.isArray(v) && v.length) return v[0];
      return v;
    }
    return null;
  };

  // Common heuristics
  const MP4 = pickUrl('MP4', 'mp4', 'video', 'videoUrl', 'url', 'downloadUrl') || null;
  const JPEG = pickUrl('JPEG', 'jpeg', 'image', 'imageUrl', 'thumbnail', 'thumb') || null;
  const description = item.description || item.caption || item.title || null;
  const profileName = item.profileName || item.username || item.author || null;
  const likes = item.likes || item.likeCount || null;
  const comments = item.comments || item.commentCount || null;
  const timeAgo = item.timeAgo || item.time || item.published || null;

  return { JPEG, MP4, likes, comments, description, profileName, timeAgo, raw: item };
}

async function instaSave(url) {
  // 1) Try ab-downloader igdl if available
  if (igdl) {
    try {
      const data = await igdl(url);
      const mapped = mapIgdlResult(data);
      // If we successfully found at least one media URL, return it
      if (mapped && (mapped.MP4 || mapped.JPEG)) {
        return mapped;
      }
      // otherwise continue to fallback scrape
      console.warn('igdl returned but no media found, falling back to scraper');
    } catch (err) {
      // igdl failed for this url — log and continue to fallback
      console.warn('igdl failed:', (err && err.message) || err);
    }
  }

  // 2) Fallback: use insta-save.net endpoint (your existing scraping)
  const endpoint = 'https://insta-save.net/content.php';
  const resp = await axios.get(endpoint, {
    params: { url },
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Referer': 'https://insta-save.net/'
    },
    timeout: 10000
  });

  const j = resp.data;
  if (!j || j.status !== 'ok' || !j.html) throw new Error('scrape-fail');

  const $ = cheerio.load(j.html);
  // attempt to pick the first meaningful card
  const el = $('#download_content .col-md-4.position-relative').first()
            || $('#download_content .download').first()
            || $('.download_content .col-md-4').first();

  let jpg = null;
  let mp4 = null;
  let description = null;
  let profileName = null;
  let likes = null;
  let comments = null;
  let timeAgo = null;

  if (el && el.length) {
    jpg = el.find('img.load').attr('src') || el.find('img').attr('src') || null;
    mp4 = el.find('a.btn.bg-gradient-success').attr('href') || el.find('a.download-video').attr('href') || null;
    description = el.find('p.text-sm').text().trim() || null;
    profileName = el.find('p.text-sm a').text().trim() || null;

    const stats = el.find('.stats small').toArray().map(s => $(s).text().trim());
    likes = stats[0] || null;
    comments = stats[1] || null;
    timeAgo = stats[2] || null;
  } else {
    // attempt alternative parsing for different HTML structures
    jpg = $('img').first().attr('src') || null;
    mp4 = $('a[href$=".mp4"]').first().attr('href') || null;
    description = $('meta[name="description"]').attr('content') || null;
  }

  return { JPEG: jpg, MP4: mp4, likes, comments, description, profileName, timeAgo, raw: j };
}

module.exports = instaSave;