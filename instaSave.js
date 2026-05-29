const axios = require('axios');
const cheerio = require('cheerio');

let igdl = null;
try {
igdl = require('ab-downloader').igdl;
} catch (e) {
// fallback থাকবে
}

function mapIgdlResult(d) {
if (!d) return null;

const item = Array.isArray(d) ? (d[0] || {}) : d;

const pickUrl = (...keys) => {
for (const k of keys) {
const v = item?.[k];
if (!v) continue;
if (Array.isArray(v)) return v[0];
return v;
}
return null;
};

const MP4 = pickUrl('MP4', 'mp4', 'video', 'videoUrl', 'url', 'downloadUrl');
const JPEG = pickUrl('JPEG', 'jpeg', 'image', 'imageUrl', 'thumbnail', 'thumb');

return {
MP4,
JPEG,
description: item.description || item.caption || item.title || null,
profileName: item.profileName || item.username || item.author || null,
likes: item.likes || item.likeCount || null,
comments: item.comments || item.commentCount || null,
timeAgo: item.timeAgo || item.time || item.published || null
};
}

async function instaSave(url) {

// ✅ 1. Try igdl first
if (igdl) {
try {
const data = await igdl(url);
const mapped = mapIgdlResult(data);

if (mapped && (mapped.MP4 || mapped.JPEG)) {  
    return mapped;  
  }  
} catch (err) {  
  console.warn('igdl failed:', err.message);  
}

}

// ✅ 2. Fallback scraper (fixed)
const endpoint = 'https://insta-save.net/content.php';

let resp;
try {
resp = await axios.get(endpoint, {
params: { url },
headers: {
'User-Agent': 'Mozilla/5.0',
'Referer': 'https://insta-save.net/'
},
timeout: 10000
});
} catch (err) {
throw new Error('Request failed: ' + err.message);
}

const j = resp.data;

if (!j || j.status !== 'ok' || !j.html) {
throw new Error('scrape-fail');
}

const $ = cheerio.load(j.html);

// ❗ FIXED selector logic
let el = $('#download_content .col-md-4.position-relative').first();
if (!el.length) el = $('#download_content .download').first();
if (!el.length) el = $('.download_content .col-md-4').first();

let jpg = null;
let mp4 = null;
let description = null;
let profileName = null;
let likes = null;
let comments = null;
let timeAgo = null;

if (el.length) {
jpg = el.find('img.load').attr('src') || el.find('img').attr('src') || null;
mp4 = el.find('a.btn.bg-gradient-success').attr('href') ||
el.find('a.download-video').attr('href') || null;

description = el.find('p.text-sm').text().trim() || null;  
profileName = el.find('p.text-sm a').text().trim() || null;  

const stats = el.find('.stats small').toArray().map(s => $(s).text().trim());  
likes = stats[0] || null;  
comments = stats[1] || null;  
timeAgo = stats[2] || null;

} else {
// fallback parsing
jpg = $('img').first().attr('src') || null;
mp4 = $('a[href$=".mp4"]').first().attr('href') || null;
description = $('meta[name="description"]').attr('content') || null;
}

// ✅ URL validation
if (jpg && !jpg.startsWith('http')) jpg = null;
if (mp4 && !mp4.startsWith('http')) mp4 = null;

// ❗ Multiple media support (new)
const media = [];

$('#download_content img').each((i, img) => {
const src = $(img).attr('src');
if (src && src.startsWith('http')) {
media.push({ type: 'image', url: src });
}
});

$('#download_content a[href$=".mp4"]').each((i, a) => {
const href = $(a).attr('href');
if (href && href.startsWith('http')) {
media.push({ type: 'video', url: href });
}
});

return {
success: true,
media: media.length ? media : [
{ type: mp4 ? 'video' : 'image', url: mp4 || jpg }
],
description,
profileName,
likes,
comments,
timeAgo
};
}

module.exports = instaSave;

// Fix only error code
/* Don't change any code */