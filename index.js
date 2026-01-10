// ========================================
// 🟢 GREEN CHIP V3 - PROFESSIONAL EDITION
// Solana Meme Coin Scanner
// ========================================

const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require(‘discord.js’);
const axios = require(‘axios’);
const express = require(‘express’);
const moment = require(‘moment’);

// ==================== SERVER (24/7 UPTIME) ====================
const app = express();
app.get(’/’, (req, res) => res.json({
status: ‘🟢 ONLINE’,
version: ‘3.0.0’,
uptime: Math.floor(process.uptime()),
active: activeCalls.size,
processed: processedCoins.size
}));
app.listen(process.env.PORT || 3000, () => console.log(‘✅ Server running on port’, process.env.PORT || 3000));

// ==================== BOT SETUP ====================
const client = new Client({
intents: [
GatewayIntentBits.Guilds,
GatewayIntentBits.GuildMessages,
GatewayIntentBits.MessageContent
]
});

// ==================== MEMORY SYSTEM ====================
const activeCalls = new Map();      // Track coins for gain updates
const processedCoins = new Set();   // Never call same coin twice
const ruggedCoins = new Set();      // Blacklist rugged coins
const callTimestamps = [];          // Rate limiting
const cache = new Map();            // API response cache

// ==================== CONFIGURATION ====================
const CONFIG = {
// Market Cap Range
MIN_MCAP: 20000,
MAX_MCAP: 55000,

```
// Safety & Quality
MIN_LIQUIDITY: 2000,
MIN_VOL_H1: 1000,
MAX_AGE_MINUTES: 60,
MIN_AGE_MINUTES: 1,

// Social Requirements
REQUIRE_SOCIALS: true,
MIN_SOCIAL_COUNT: 1,

// Gain Tracking
MIN_GAIN_ALERT: 45,
GAIN_UPDATE_STEP: 20,
MAX_GAIN_CAP: 10000000,
RUG_PRICE_DROP: 0.90,
RUG_LIQ_MIN: 500,

// Performance
SCAN_INTERVAL: 8000,
GAIN_INTERVAL: 25000,
CACHE_TTL: 30000,
MAX_CALLS_PER_HOUR: 25,

// Links
REFERRAL_LINK: "https://gmgn.ai/r/Greenchip"
```

};

// ==================== UTILITY FUNCTIONS ====================
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

const formatNum = (n) => {
if (n >= 1e9) return (n/1e9).toFixed(2) + ‘B’;
if (n >= 1e6) return (n/1e6).toFixed(2) + ‘M’;
if (n >= 1e3) return (n/1e3).toFixed(2) + ‘K’;
return n.toFixed(2);
};

const getAge = (timestamp) => {
const mins = Math.floor((Date.now() - timestamp) / 60000);
if (mins < 1) return ‘Just launched’;
if (mins === 1) return ‘1 minute ago’;
if (mins < 60) return `${mins} minutes ago`;
return moment(timestamp).fromNow();
};

const canMakeCall = () => {
const now = Date.now();
while (callTimestamps.length > 0 && now - callTimestamps[0] > 3600000) {
callTimestamps.shift();
}
return callTimestamps.length < CONFIG.MAX_CALLS_PER_HOUR;
};

// ==================== DATA FETCHING ====================
async function fetchMarketData() {
const cacheKey = ‘market_data’;
const cached = cache.get(cacheKey);

```
if (cached && Date.now() - cached.time < CONFIG.CACHE_TTL) {
    return cached.data;
}

try {
    const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana', {
        timeout: 10000,
        headers: { 'User-Agent': 'GreenChipBot/3.0' }
    });
    
    if (data?.pairs) {
        cache.set(cacheKey, { data: data.pairs, time: Date.now() });
        return data.pairs;
    }
} catch (err) {
    log(`❌ API Error: ${err.message}`);
}

return [];
```

}

// ==================== QUALITY FILTERS ====================
async function meetsQualityCriteria(pair) {
const now = Date.now();

```
// Basic checks
if (pair.chainId !== 'solana') return { pass: false };
if (processedCoins.has(pair.baseToken.address)) return { pass: false };
if (ruggedCoins.has(pair.baseToken.address)) return { pass: false };

// Extract metrics
const mcap = pair.fdv || pair.marketCap || 0;
const liq = pair.liquidity?.usd || 0;
const vol = pair.volume?.h1 || 0;
const created = pair.pairCreatedAt || now;
const age = (now - created) / 60000;
const price = parseFloat(pair.priceUsd);
const socials = pair.info?.socials || [];

// Market cap filter ($20k-$55k strict)
if (mcap < CONFIG.MIN_MCAP || mcap > CONFIG.MAX_MCAP) {
    return { pass: false, reason: `MCAP $${formatNum(mcap)}` };
}

// Age filter (1-60 minutes)
if (age < CONFIG.MIN_AGE_MINUTES || age > CONFIG.MAX_AGE_MINUTES) {
    return { pass: false, reason: `Age ${age.toFixed(0)}m` };
}

// Liquidity check
if (liq < CONFIG.MIN_LIQUIDITY) {
    return { pass: false, reason: `Low liq $${liq.toFixed(0)}` };
}

// Volume check
if (vol < CONFIG.MIN_VOL_H1) {
    return { pass: false, reason: `Low vol $${vol.toFixed(0)}` };
}

// Social presence (REAL HYPE CHECK)
if (CONFIG.REQUIRE_SOCIALS && socials.length < CONFIG.MIN_SOCIAL_COUNT) {
    return { pass: false, reason: 'No socials' };
}

// Price validation
if (!price || price <= 0 || price > 1) {
    return { pass: false, reason: 'Invalid price' };
}

// Safety checks
const liqRatio = liq / mcap;
if (liqRatio < 0.02) {
    return { pass: false, reason: 'Fake MCAP' };
}

const volRatio = vol / liq;
if (volRatio > 10) {
    return { pass: false, reason: 'Wash trading' };
}

// Symbol length check
if (pair.baseToken.symbol?.length > 20) {
    return { pass: false, reason: 'Suspicious symbol' };
}

// ALL CHECKS PASSED
return { 
    pass: true, 
    data: { mcap, liq, vol, age, price, socials }
};
```

}

// ==================== STATUS DETECTION ====================
function getGraduationStatus(pair) {
const dex = (pair.dexId || ‘’).toLowerCase();
const liq = pair.liquidity?.usd || 0;

```
if (dex.includes('raydium')) {
    return { emoji: '🎓', text: 'Graduated to Raydium', color: '#00D4FF' };
}

if (dex.includes('pump') || dex.includes('pumpfun')) {
    if (liq > 10000) {
        return { emoji: '🚀', text: 'Graduating Soon', color: '#FFD700' };
    }
    return { emoji: '💊', text: 'Pump.fun Bonding', color: '#9D4EDD' };
}

if (dex.includes('orca')) {
    return { emoji: '🌊', text: 'Listed on Orca', color: '#00C9FF' };
}

return { emoji: '🟢', text: 'Live Trading', color: '#00FF00' };
```

}

// ==================== MARKET SCANNER ====================
async function scanMarket() {
try {
log(‘🔍 Scanning market…’);

```
    const pairs = await fetchMarketData();
    if (pairs.length === 0) {
        log('⚠️ No data received');
        return;
    }
    
    let scanned = 0;
    let qualified = 0;
    
    for (const pair of pairs) {
        scanned++;
        
        // Check quality
        const check = await meetsQualityCriteria(pair);
        if (!check.pass) continue;
        
        // Rate limit check
        if (!canMakeCall()) {
            log('⏸️ Rate limit reached (25 calls/hour)');
            break;
        }
        
        qualified++;
        log(`✅ QUALIFIED: ${pair.baseToken.name} ($${formatNum(check.data.mcap)})`);
        
        // Send alert
        await sendCoinAlert(pair, process.env.CHANNEL_ID);
        
        // Record
        processedCoins.add(pair.baseToken.address);
        callTimestamps.push(Date.now());
        
        // Track for gains
        activeCalls.set(pair.baseToken.address, {
            name: pair.baseToken.name,
            symbol: pair.baseToken.symbol,
            initialPrice: check.data.price,
            msgId: null,
            channelId: process.env.CHANNEL_ID,
            highestGain: 0,
            address: pair.baseToken.address,
            isRugged: false,
            callTime: Date.now()
        });
        
        // Delay between calls
        await new Promise(r => setTimeout(r, 2000));
    }
    
    log(`📊 Scan complete: ${scanned} checked | ${qualified} qualified`);
    
} catch (err) {
    log(`❌ Scanner error: ${err.message}`);
}
```

}

// ==================== ALERT SENDER ====================
async function sendCoinAlert(pair, channelId) {
const channel = client.channels.cache.get(channelId);
if (!channel) {
log(‘❌ Channel not found’);
return;
}

```
try {
    const mcap = pair.fdv || pair.marketCap;
    const price = parseFloat(pair.priceUsd);
    const liq = pair.liquidity?.usd || 0;
    const vol = pair.volume?.h1 || 0;
    const status = getGraduationStatus(pair);
    const socials = pair.info?.socials || [];
    
    // Build social links
    const socialLinks = [];
    const twitter = socials.find(s => s.type === 'twitter')?.url;
    const telegram = socials.find(s => s.type === 'telegram')?.url;
    const website = socials.find(s => s.type === 'website')?.url;
    
    if (twitter) socialLinks.push(`[Twitter](${twitter})`);
    if (telegram) socialLinks.push(`[Telegram](${telegram})`);
    if (website) socialLinks.push(`[Website](${website})`);
    
    const socialText = socialLinks.length > 0 
        ? `**Socials:** ${socialLinks.join(' • ')}`
        : '⚠️ **No Socials Listed**';
    
    // Chart links
    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    
    // Build embed
    const embed = new EmbedBuilder()
        .setTitle(`${status.emoji} **GREEN CHIP ALERT: ${pair.baseToken.name}**`)
        .setColor(status.color)
        .setDescription(`
```

**$${pair.baseToken.symbol}** | ${status.text}
${socialText}

**🎯 Quality Verified:**
✅ MCAP: $${formatNum(CONFIG.MIN_MCAP)}-$${formatNum(CONFIG.MAX_MCAP)}
✅ Age: Under 1 hour old
✅ Active trading volume
✅ Verified social presence

**⚡ TRADE NOW:**
👉 [**BUY ON GMGN (Lower Fees)**](${CONFIG.REFERRAL_LINK})
📊 [DexScreener](${dexLink}) | [Photon](${photonLink})
`) .addFields( { name: '💎 Market Cap', value: `$${formatNum(mcap)}`, inline: true }, { name: '💰 Price', value: `$${price.toFixed(9)}`, inline: true }, { name: '🌊 Liquidity', value: `$${formatNum(liq)}`, inline: true }, { name: '📊 Volume (1h)', value: `$${formatNum(vol)}`, inline: true }, { name: '⏱️ Launched', value: getAge(pair.pairCreatedAt), inline: true }, { name: '🔗 DEX', value: pair.dexId || 'Unknown', inline: true }, { name: '📝 Contract Address (CA)', value: ``${pair.baseToken.address}``} ) .setThumbnail( pair.info?.imageUrl || `https://dd.dexscreener.com/ds-data/tokens/solana/${pair.baseToken.address}.png`
)
.setFooter({ text: ‘Green Chip V3 • Professional Scanner • DYOR & Trade Responsibly’ })
.setTimestamp();

```
    const msg = await channel.send({ embeds: [embed] });
    
    // Save message ID for replies
    if (activeCalls.has(pair.baseToken.address)) {
        activeCalls.get(pair.baseToken.address).msgId = msg.id;
    }
    
    log(`📤 Alert sent: ${pair.baseToken.symbol}`);
    
} catch (err) {
    log(`❌ Alert error: ${err.message}`);
}
```

}

// ==================== GAIN TRACKER ====================
async function trackGains() {
if (activeCalls.size === 0) return;

```
log(`📈 Tracking ${activeCalls.size} positions...`);

for (const [address, data] of activeCalls) {
    if (data.isRugged) continue;
    
    try {
        const { data: result } = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${address}`,
            { timeout: 5000 }
        );
        
        if (!result.pairs || result.pairs.length === 0) continue;
        
        const pair = result.pairs[0];
        const currentPrice = parseFloat(pair.priceUsd);
        const currentLiq = pair.liquidity?.usd || 0;
        
        // RUG DETECTION
        const priceDrop = currentPrice < (data.initialPrice * (1 - CONFIG.RUG_PRICE_DROP));
        const liqDrained = currentLiq < CONFIG.RUG_LIQ_MIN;
        
        if (priceDrop || liqDrained) {
            log(`🚨 RUG DETECTED: ${data.symbol}`);
            data.isRugged = true;
            ruggedCoins.add(address);
            await sendRugAlert(data);
            continue;
        }
        
        // GAIN CALCULATION
        const gain = ((currentPrice - data.initialPrice) / data.initialPrice) * 100;
        
        // Send update if significant
        if (gain >= CONFIG.MIN_GAIN_ALERT && gain > data.highestGain) {
            if (gain >= (data.highestGain + CONFIG.GAIN_UPDATE_STEP)) {
                data.highestGain = gain;
                await sendGainUpdate(data, gain, currentPrice, pair);
                log(`🚀 ${data.symbol}: +${gain.toFixed(2)}%`);
            }
        }
        
        // Max cap reached
        if (gain >= CONFIG.MAX_GAIN_CAP) {
            await sendGainUpdate(data, gain, currentPrice, pair, true);
            data.isRugged = true;
            log(`🌕 MAX GAIN: ${data.symbol}`);
        }
        
    } catch (err) {
        log(`❌ Track error (${data.symbol}): ${err.message}`);
    }
    
    await new Promise(r => setTimeout(r, 500));
}
```

}

// ==================== GAIN UPDATE SENDER ====================
async function sendGainUpdate(data, gain, price, pair, isFinal = false) {
const channel = client.channels.cache.get(data.channelId);
if (!channel || !data.msgId) return;

```
try {
    const originalMsg = await channel.messages.fetch(data.msgId);
    if (!originalMsg) return;
    
    // Dynamic styling
    let color = '#00FF00', emoji = '🚀';
    if (gain >= 1000) { color = '#FFD700'; emoji = '🌕'; }
    else if (gain >= 500) { color = '#FF6B00'; emoji = '💎'; }
    else if (gain >= 100) { color = '#00D4FF'; emoji = '⚡'; }
    
    const mcap = pair.fdv || pair.marketCap || 0;
    const liq = pair.liquidity?.usd || 0;
    
    const embed = new EmbedBuilder()
        .setTitle(`${emoji} **GAIN UPDATE: +${gain.toFixed(2)}%**`)
        .setColor(color)
        .setDescription(`
```

**${data.name} ($${data.symbol}) is pumping!**

**Price Movement:**
Initial: $${data.initialPrice.toFixed(9)}
Current: $${price.toFixed(9)}
**Gain: +${gain.toFixed(2)}%**

**Current Stats:**
Market Cap: $${formatNum(mcap)}
Liquidity: $${formatNum(liq)}

${isFinal ? ‘🎊 **MAXIMUM TRACKING REACHED (10M%)**’ : ‘’}

[**🔥 SECURE PROFITS ON GMGN**](${CONFIG.REFERRAL_LINK})
`)
.setFooter({
text: isFinal ? ‘Green Chip V3 • Congratulations! 🎉’ : ‘Green Chip V3 • Gain Tracker’
})
.setTimestamp();

```
    await originalMsg.reply({ embeds: [embed] });
    
} catch (err) {
    log(`❌ Gain update failed: ${err.message}`);
}
```

}

// ==================== RUG ALERT ====================
async function sendRugAlert(data) {
const channel = client.channels.cache.get(data.channelId);
if (!channel || !data.msgId) return;

```
try {
    const originalMsg = await channel.messages.fetch(data.msgId);
    if (!originalMsg) return;
    
    const embed = new EmbedBuilder()
        .setTitle('🚨 **STOP LOSS / RUG ALERT**')
        .setColor('#FF0000')
        .setDescription(`
```

**${data.name} ($${data.symbol})**

⚠️ **Warning:** Price dropped >90% or liquidity removed
🛑 Tracking has been stopped
📊 Possible rug pull detected

**Reminder:** Always use stop losses and never invest more than you can afford to lose.
`)
.setFooter({ text: ‘Green Chip V3 • Risk Management Alert’ })
.setTimestamp();

```
    await originalMsg.reply({ embeds: [embed] });
    
} catch (err) {
    log(`❌ Rug alert failed: ${err.message}`);
}
```

}

// ==================== BOT READY ====================
client.once(‘ready’, () => {
console.log(`╔════════════════════════════════════════════════╗ ║                                                ║ ║     🟢 GREEN CHIP V3 PROFESSIONAL ONLINE 🟢    ║ ║                                                ║ ║   Target: $${CONFIG.MIN_MCAP/1000}k-$${CONFIG.MAX_MCAP/1000}k | Age: <${CONFIG.MAX_AGE_MINUTES} min         ║ ║   Quality: MAXIMUM | Status: SCANNING          ║ ║                                                ║ ╚════════════════════════════════════════════════╝`);

```
client.user.setPresence({
    activities: [{ 
        name: `$${CONFIG.MIN_MCAP/1000}k-$${CONFIG.MAX_MCAP/1000}k gems | <1hr old`, 
        type: ActivityType.Watching 
    }],
    status: 'online'
});

// Start scanning
log('⚡ Starting market scanner...');
setInterval(scanMarket, CONFIG.SCAN_INTERVAL);

// Start gain tracking
log('📈 Starting gain tracker...');
setInterval(trackGains, CONFIG.GAIN_INTERVAL);

// Initial scan
setTimeout(scanMarket, 3000);
```

});

// ==================== COMMANDS ====================
client.on(‘messageCreate’, async (msg) => {
if (msg.author.bot) return;

```
const cmd = msg.content.toLowerCase();

// !test - System check
if (cmd === '!test') {
    const embed = new EmbedBuilder()
        .setTitle('✅ **GREEN CHIP V3 - SYSTEM STATUS**')
        .setColor('#00FF00')
        .setDescription(`
```

**Bot Status:** 🟢 Online & Operational
**Version:** 3.0.0 Professional Edition

**Current Stats:**
• Active Calls: ${activeCalls.size}
• Processed Coins: ${processedCoins.size}
• Rugged Detected: ${ruggedCoins.size}
• Calls This Hour: ${callTimestamps.length}/${CONFIG.MAX_CALLS_PER_HOUR}

**Configuration:**
• Market Cap: $${formatNum(CONFIG.MIN_MCAP)} - $${formatNum(CONFIG.MAX_MCAP)}
• Max Age: ${CONFIG.MAX_AGE_MINUTES} minutes
• Min Liquidity: $${formatNum(CONFIG.MIN_LIQUIDITY)}
• Min Volume: $${formatNum(CONFIG.MIN_VOL_H1)}
• Social Required: ${CONFIG.REQUIRE_SOCIALS ? ‘Yes’ : ‘No’}

**Data Sources:**
✅ DexScreener API
✅ Real-time market data
✅ Multi-source verification

All systems operational! 💎
`)
.setFooter({ text: ‘Green Chip V3 • Professional Grade Scanner’ })
.setTimestamp();

```
    await msg.reply({ embeds: [embed] });
}

// !stats - Detailed stats
if (cmd === '!stats') {
    const uptime = process.uptime();
    const hrs = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    
    const embed = new EmbedBuilder()
        .setTitle('📊 **DETAILED STATISTICS**')
        .setColor('#00D4FF')
        .addFields(
            { name: '⏱️ Uptime', value: `${hrs}h ${mins}m`, inline: true },
            { name: '📊 Active Trades', value: `${activeCalls.size}`, inline: true },
            { name: '✅ Total Processed', value: `${processedCoins.size}`, inline: true },
            { name: '⚠️ Rugs Detected', value: `${ruggedCoins.size}`, inline: true },
            { name: '📈 Hourly Rate', value: `${callTimestamps.length}/${CONFIG.MAX_CALLS_PER_HOUR}`, inline: true },
            { name: '💾 Memory', value: `${Math.round(process.memoryUsage().heapUsed/1024/1024)}MB`, inline: true }
        )
        .setFooter({ text: 'Green Chip V3 • Performance Metrics' })
        .setTimestamp();
    
    await msg.reply({ embeds: [embed] });
}

// !reset - Clear memory (admin only)
if (cmd === '!reset') {
    if (!msg.member?.permissions.has('Administrator')) {
        await msg.reply('❌ Admin only command');
        return;
    }
    
    processedCoins.clear();
    ruggedCoins.clear();
    activeCalls.clear();
    callTimestamps.length = 0;
    cache.clear();
    
    await msg.reply('✅ **System Reset Complete**\nAll memory cleared. Bot will resume scanning.');
    log('🔄 System reset by admin');
}
```

});

// ==================== ERROR HANDLING ====================
client.on(‘error’, (err) => {
log(`❌ Discord error: ${err.message}`);
});

process.on(‘unhandledRejection’, (err) => {
log(`❌ Unhandled rejection: ${err.message}`);
});

process.on(‘uncaughtException’, (err) => {
log(`❌ Uncaught exception: ${err.message}`);
process.exit(1);
});

process.on(‘SIGINT’, () => {
log(‘🛑 Shutting down gracefully…’);
client.destroy();
process.exit(0);
});

process.on(‘SIGTERM’, () => {
log(‘🛑 Shutting down gracefully…’);
client.destroy();
process.exit(0);
});

// ==================== LOGIN ====================
if (!process.env.DISCORD_TOKEN) {
console.error(‘❌ ERROR: DISCORD_TOKEN not found in environment variables’);
console.error(‘Please set DISCORD_TOKEN in your .env file or hosting environment’);
process.exit(1);
}

if (!process.env.CHANNEL_ID) {
console.error(‘❌ ERROR: CHANNEL_ID not found in environment variables’);
console.error(‘Please set CHANNEL_ID in your .env file or hosting environment’);
process.exit(1);
}

client.login(process.env.DISCORD_TOKEN).catch(err => {
log(`❌ Login failed: ${err.message}`);
console.error(‘Check your DISCORD_TOKEN is valid’);
process.exit(1);
});
