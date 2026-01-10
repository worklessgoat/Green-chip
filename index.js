// ========================================
// GREEN CHIP V3 - PROFESSIONAL EDITION
// All-in-One Bot - Maximum Quality
// ========================================

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require(‘discord.js’);
const axios = require(‘axios’);
const express = require(‘express’);
const moment = require(‘moment’);

// === SERVER (24/7 UPTIME) ===
const app = express();
app.get(’/’, (req, res) => res.json({ status: ‘online’, version: ‘3.0.0’ }));
app.listen(process.env.PORT || 3000, () => console.log(‘✅ Server running’));

// === BOT SETUP ===
const client = new Client({
intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// === MEMORY ===
const activeCalls = new Map();
const processedCoins = new Set();
const ruggedCoins = new Set();
const callTimestamps = [];
const apiCache = new Map();

// === CONFIG ===
const CONFIG = {
MIN_MCAP: 20000,
MAX_MCAP: 55000,
MIN_LIQUIDITY: 2000,
MIN_VOL_H1: 1000,
MAX_AGE_MINUTES: 60,
MIN_AGE_MINUTES: 1,
REQUIRE_SOCIALS: true,
MIN_GAIN_ALERT: 45,
GAIN_UPDATE_THRESHOLD: 20,
MAX_GAIN_CAP: 10000000,
RUG_PRICE_DROP: 0.90,
RUG_LIQ_THRESHOLD: 500,
REFERRAL_LINK: “https://gmgn.ai/r/Greenchip”,
SCAN_INTERVAL: 8000,
GAIN_TRACK_INTERVAL: 25000,
MAX_CALLS_PER_HOUR: 25,
RATE_LIMIT_WINDOW: 3600000
};

// === UTILITIES ===
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function cleanNum(n) { return n >= 1e9 ? (n/1e9).toFixed(2)+‘B’ : n >= 1e6 ? (n/1e6).toFixed(2)+‘M’ : n >= 1e3 ? (n/1e3).toFixed(2)+‘K’ : n.toFixed(2); }
function getAge(ts) {
const mins = Math.floor((Date.now() - ts) / 60000);
return mins < 1 ? ‘Just now’ : mins === 1 ? ‘1 minute ago’ : mins < 60 ? `${mins} minutes ago` : moment(ts).fromNow();
}
function canCall() {
const now = Date.now();
while (callTimestamps.length > 0 && now - callTimestamps[0] > CONFIG.RATE_LIMIT_WINDOW) callTimestamps.shift();
return callTimestamps.length < CONFIG.MAX_CALLS_PER_HOUR;
}

// === FETCH DATA ===
async function fetchPairs() {
const cacheKey = ‘pairs’;
if (apiCache.has(cacheKey) && Date.now() - apiCache.get(cacheKey).time < 30000) {
return apiCache.get(cacheKey).data;
}
try {
const { data } = await axios.get(‘https://api.dexscreener.com/latest/dex/search?q=solana’, { timeout: 10000 });
if (data?.pairs) {
apiCache.set(cacheKey, { data: data.pairs, time: Date.now() });
return data.pairs;
}
} catch (err) { log(`API Error: ${err.message}`); }
return [];
}

// === QUALITY CHECK ===
async function isQuality(pair) {
const now = Date.now();
if (pair.chainId !== ‘solana’) return { pass: false };
if (processedCoins.has(pair.baseToken.address)) return { pass: false };
if (ruggedCoins.has(pair.baseToken.address)) return { pass: false };

```
const mcap = pair.fdv || pair.marketCap || 0;
const liq = pair.liquidity?.usd || 0;
const volH1 = pair.volume?.h1 || 0;
const age = (now - (pair.pairCreatedAt || now)) / 60000;
const price = parseFloat(pair.priceUsd);
const socials = pair.info?.socials || [];

if (mcap < CONFIG.MIN_MCAP || mcap > CONFIG.MAX_MCAP) return { pass: false };
if (age < CONFIG.MIN_AGE_MINUTES || age > CONFIG.MAX_AGE_MINUTES) return { pass: false };
if (liq < CONFIG.MIN_LIQUIDITY) return { pass: false };
if (volH1 < CONFIG.MIN_VOL_H1) return { pass: false };
if (CONFIG.REQUIRE_SOCIALS && socials.length < 1) return { pass: false };
if (!price || price <= 0 || price > 1) return { pass: false };
if ((liq / mcap) < 0.02) return { pass: false };
if ((volH1 / liq) > 10) return { pass: false };

return { pass: true, mcap, liq, volH1, age, price };
```

}

// === STATUS ===
function getStatus(pair) {
const dex = (pair.dexId || ‘’).toLowerCase();
if (dex.includes(‘raydium’)) return { emoji: ‘🎓’, text: ‘Graduated to Raydium’, color: ‘#00D4FF’ };
if (dex.includes(‘pump’)) {
return (pair.liquidity?.usd || 0) > 10000
? { emoji: ‘🚀’, text: ‘Graduating (High Liq)’, color: ‘#FFD700’ }
: { emoji: ‘💊’, text: ‘Pump.fun Bonding’, color: ‘#9D4EDD’ };
}
if (dex.includes(‘orca’)) return { emoji: ‘🌊’, text: ‘Listed on Orca’, color: ‘#00C9FF’ };
return { emoji: ‘🟢’, text: ‘Live Trading’, color: ‘#00FF00’ };
}

// === SCANNER ===
async function scan() {
try {
log(‘🔍 Scanning…’);
const pairs = await fetchPairs();
let found = 0;

```
    for (const pair of pairs) {
        const check = await isQuality(pair);
        if (!check.pass) continue;
        if (!canCall()) { log('⏸️ Rate limit (25/hr)'); break; }
        
        log(`✅ FOUND: ${pair.baseToken.name} ($${cleanNum(check.mcap)})`);
        await sendAlert(pair, process.env.CHANNEL_ID);
        
        processedCoins.add(pair.baseToken.address);
        callTimestamps.push(Date.now());
        activeCalls.set(pair.baseToken.address, {
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            initialPrice: check.price,
            msgId: null,
            channelId: process.env.CHANNEL_ID,
            highestGain: 0,
            address: pair.baseToken.address,
            isRugged: false
        });
        
        found++;
        await new Promise(r => setTimeout(r, 2000));
    }
    
    log(`📊 Scan done: ${found} calls`);
} catch (err) { log(`Scan error: ${err.message}`); }
```

}

// === SEND ALERT ===
async function sendAlert(pair, channelId) {
const channel = client.channels.cache.get(channelId);
if (!channel) return;

```
const mcap = pair.fdv || pair.marketCap;
const price = parseFloat(pair.priceUsd);
const liq = pair.liquidity?.usd || 0;
const vol = pair.volume?.h1 || 0;
const status = getStatus(pair);
const socials = pair.info?.socials || [];

let links = [];
const tw = socials.find(s => s.type === 'twitter')?.url;
const tg = socials.find(s => s.type === 'telegram')?.url;
const web = socials.find(s => s.type === 'website')?.url;
if (tw) links.push(`[Twitter](${tw})`);
if (tg) links.push(`[Telegram](${tg})`);
if (web) links.push(`[Website](${web})`);
const socialText = links.length > 0 ? `**Socials:** ${links.join(' • ')}` : '⚠️ No Socials';

const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;

const embed = new EmbedBuilder()
    .setTitle(`${status.emoji} **GREEN CHIP: ${pair.baseToken.name}**`)
    .setColor(status.color)
    .setDescription(`
```

**$${pair.baseToken.symbol}** | ${status.text}
${socialText}

**🎯 Quality Verified:**
✅ MCAP: $20k-$55k | ✅ Age: <1hr | ✅ Active Volume

**⚡ TRADE NOW:**
👉 [**BUY ON GMGN**](${CONFIG.REFERRAL_LINK})
📊 [Chart](${dexLink}) | [Photon](${photonLink})
`) .addFields( { name: '💎 MCAP', value: `$${cleanNum(mcap)}`, inline: true }, { name: '💰 Price', value: `$${price.toFixed(8)}`, inline: true }, { name: '🌊 Liq', value: `$${cleanNum(liq)}`, inline: true }, { name: '📊 Vol (1h)', value: `$${cleanNum(vol)}`, inline: true }, { name: '⏱️ Age', value: getAge(pair.pairCreatedAt), inline: true }, { name: '🔗 DEX', value: pair.dexId || 'N/A', inline: true }, { name: '📝 CA', value: ``${pair.baseToken.address}``} ) .setThumbnail(pair.info?.imageUrl ||`https://dd.dexscreener.com/ds-data/tokens/solana/${pair.baseToken.address}.png`)
.setFooter({ text: ‘Green Chip V3 • Professional Scanner’ })
.setTimestamp();

```
const msg = await channel.send({ embeds: [embed] });
if (activeCalls.has(pair.baseToken.address)) activeCalls.get(pair.baseToken.address).msgId = msg.id;
```

}

// === GAIN TRACKER ===
async function trackGains() {
if (activeCalls.size === 0) return;

```
for (const [addr, data] of activeCalls) {
    if (data.isRugged) continue;
    
    try {
        const { data: res } = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${addr}`, { timeout: 5000 });
        if (!res.pairs || !res.pairs[0]) continue;
        
        const pair = res.pairs[0];
        const curPrice = parseFloat(pair.priceUsd);
        const curLiq = pair.liquidity?.usd || 0;
        
        // Rug check
        if (curPrice < (data.initialPrice * (1 - CONFIG.RUG_PRICE_DROP)) || curLiq < CONFIG.RUG_LIQ_THRESHOLD) {
            log(`🚨 RUG: ${data.symbol}`);
            data.isRugged = true;
            ruggedCoins.add(addr);
            await sendRugAlert(data);
            continue;
        }
        
        const gain = ((curPrice - data.initialPrice) / data.initialPrice) * 100;
        
        if (gain >= CONFIG.MIN_GAIN_ALERT && gain > data.highestGain && gain >= (data.highestGain + CONFIG.GAIN_UPDATE_THRESHOLD)) {
            data.highestGain = gain;
            await sendGainUpdate(data, gain, curPrice, pair);
            log(`🚀 Gain: ${data.symbol} +${gain.toFixed(2)}%`);
        }
        
        if (gain >= CONFIG.MAX_GAIN_CAP) {
            await sendGainUpdate(data, gain, curPrice, pair, true);
            data.isRugged = true;
        }
    } catch (err) { log(`Track error (${data.symbol}): ${err.message}`); }
    
    await new Promise(r => setTimeout(r, 500));
}
```

}

// === GAIN UPDATE ===
async function sendGainUpdate(data, gain, price, pair, final = false) {
const channel = client.channels.cache.get(data.channelId);
if (!channel || !data.msgId) return;

```
try {
    const msg = await channel.messages.fetch(data.msgId);
    if (!msg) return;
    
    let color = '#00FF00', emoji = '🚀';
    if (gain >= 1000) { color = '#FFD700'; emoji = '🌕'; }
    else if (gain >= 500) { color = '#FF6B00'; emoji = '💎'; }
    else if (gain >= 100) { color = '#00D4FF'; emoji = '⚡'; }
    
    const mcap = pair.fdv || pair.marketCap || 0;
    const liq = pair.liquidity?.usd || 0;
    
    const embed = new EmbedBuilder()
        .setTitle(`${emoji} **GAIN: +${gain.toFixed(2)}%**`)
        .setColor(color)
        .setDescription(`
```

**${data.name} ($${data.symbol})**

**Price:**
Initial: $${data.initialPrice.toFixed(8)}
Current: $${price.toFixed(8)}
**+${gain.toFixed(2)}%**

**Stats:** MCAP: $${cleanNum(mcap)} | Liq: $${cleanNum(liq)}
${final ? ‘🎊 **MAX REACHED**’ : ‘’}

[**TAKE PROFITS →**](${CONFIG.REFERRAL_LINK})
`)
.setFooter({ text: final ? ‘Congrats! 🎉’ : ‘Green Chip V3’ })
.setTimestamp();

```
    await msg.reply({ embeds: [embed] });
} catch (err) { log(`Gain update failed: ${err.message}`); }
```

}

// === RUG ALERT ===
async function sendRugAlert(data) {
const channel = client.channels.cache.get(data.channelId);
if (!channel || !data.msgId) return;

```
try {
    const msg = await channel.messages.fetch(data.msgId);
    if (!msg) return;
    
    const embed = new EmbedBuilder()
        .setTitle('🚨 **STOP LOSS**')
        .setColor('#FF0000')
        .setDescription(`**${data.name} ($${data.symbol})**\n\n⚠️ Dropped >90% or liquidity removed\n🛑 Tracking stopped`)
        .setFooter({ text: 'Green Chip V3 • Risk Alert' })
        .setTimestamp();
    
    await msg.reply({ embeds: [embed] });
} catch (err) {}
```

}

// === BOT READY ===
client.once(‘ready’, () => {
console.log(`╔════════════════════════════════════╗ ║  🟢 GREEN CHIP V3 PRO ONLINE 🟢   ║ ║  Range: $20k-$55k | <1hr old      ║ ╚════════════════════════════════════╝`);

```
client.user.setPresence({
    activities: [{ name: '$20k-$55k gems | <1hr', type: ActivityType.Watching }],
    status: 'online'
});

setInterval(scan, CONFIG.SCAN_INTERVAL);
setInterval(trackGains, CONFIG.GAIN_TRACK_INTERVAL);
setTimeout(scan, 3000);
```

});

// === COMMANDS ===
client.on(‘messageCreate’, async (msg) => {
if (msg.author.bot) return;

```
if (msg.content === '!test') {
    const embed = new EmbedBuilder()
        .setTitle('✅ **GREEN CHIP V3 - ONLINE**')
        .setColor('#00FF00')
        .setDescription(`
```

**Status:** Operational
**Active:** ${activeCalls.size} | **Processed:** ${processedCoins.size}
**Calls/hr:** ${callTimestamps.length}/${CONFIG.MAX_CALLS_PER_HOUR}

**Config:** $${cleanNum(CONFIG.MIN_MCAP)}-$${cleanNum(CONFIG.MAX_MCAP)} | <${CONFIG.MAX_AGE_MINUTES}min
**Sources:** DexScreener ✅ | Pump.fun ✅

Ready! 💎
`)
.setTimestamp();
await msg.reply({ embeds: [embed] });
}

```
if (msg.content === '!stats') {
    const uptime = process.uptime();
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    
    const embed = new EmbedBuilder()
        .setTitle('📊 **STATISTICS**')
        .setColor('#00D4FF')
        .addFields(
            { name: 'Uptime', value: `${hrs}h ${mins}m`, inline: true },
            { name: 'Active', value: `${activeCalls.size}`, inline: true },
            { name: 'Total', value: `${processedCoins.size}`, inline: true },
            { name: 'Rugged', value: `${ruggedCoins.size}`, inline: true },
            { name: 'Rate', value: `${callTimestamps.length}/25`, inline: true },
            { name: 'RAM', value: `${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`, inline: true }
        )
        .setTimestamp();
    await msg.reply({ embeds: [embed] });
}

if (msg.content === '!reset' && msg.member?.permissions.has('Administrator')) {
    processedCoins.clear();
    ruggedCoins.clear();
    activeCalls.clear();
    callTimestamps.length = 0;
    await msg.reply('✅ Reset complete!');
}
```

});

// === ERROR HANDLING ===
client.on(‘error’, err => log(`Error: ${err.message}`));
process.on(‘unhandledRejection’, err => log(`Rejection: ${err.message}`));
process.on(‘uncaughtException’, err => { log(`Exception: ${err.message}`); process.exit(1); });
process.on(‘SIGINT’, () => { log(‘Shutting down…’); client.destroy(); process.exit(0); });
process.on(‘SIGTERM’, () => { log(‘Shutting down…’); client.destroy(); process.exit(0); });

// === LOGIN ===
client.login(process.env.DISCORD_TOKEN).catch(err => {
log(`Login failed: ${err.message}`);
process.exit(1);
});
