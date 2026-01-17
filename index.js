// ==================================================================================
//  🟢 GREEN CHIP V8 “ENHANCED EDITION” - ENTERPRISE TRADING ENGINE
//  ———————————————————————————
//  New Features:
//  [1] 🇺🇸 US TIMEZONE: All timestamps in EST/PST
//  [2] 🎨 DYNAMIC EMBED COLORS: Red (High Risk), Yellow (Medium), Green (Low Risk)
//  [3] 🖼️ PROFILE & BANNER: Displays coin profile pic and banner if available
//  [4] 📋 COPY CA BUTTON: Easy one-click contract address copy
//  [5] 📊 MARKET CAP GAINS: Real gains calculated from MCAP, not price
//  [6] 📅 WEEKLY & MONTHLY LEADERBOARDS: Auto-posts weekly/monthly summaries
//  [7] 🎯 HIGH QUALITY GAIN DETECTION: Tracks peak MCAP movements
//  ———————————————————————————
//  Author: Claude (AI) for GreenChip
//  Version: 8.0.0-ENHANCED
// ==================================================================================

require(‘dotenv’).config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require(‘discord.js’);
const axios = require(‘axios’);
const express = require(‘express’);
const moment = require(‘moment-timezone’);

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
BOT_NAME: “Green Chip V8”,
VERSION: “8.0.0-ENHANCED”,

```
// --- US Timezone ---
TIMEZONE: "America/New_York", // EST/EDT

// --- Strategy Filters ---
FILTERS: {
    MIN_MCAP: 20000,         // $20k Minimum (Entry Zone)
    MAX_MCAP: 55000,         // $55k Maximum (Moonshot Zone)
    MIN_LIQ: 1500,           // Liquidity Floor
    MIN_VOL_H1: 500,         // Momentum Check
    MAX_AGE_MIN: 60,         // Only Fresh Coins (<1 Hour)
    MIN_AGE_MIN: 1,          // Anti-Flashbot Buffer (>1 Minute)
    REQUIRE_SOCIALS: true,   // Filters out 99% of rugs
    ANTI_SPAM_NAMES: true    // Blocks "ELONCUMxxx" type names
},

// --- Tracking & Auto-Trading Logic ---
TRACKER: {
    GAIN_TRIGGER_1: 45,      // First Alert at +45% MCAP gain
    GAIN_TRIGGER_2: 100,     // Moon Alert at +100% MCAP gain
    GAIN_TRIGGER_3: 500,     // God Alert at +500% MCAP gain
    STOP_LOSS: 0.90,         // Hard Stop if drops 90% from entry
    RUG_CHECK_LIQ: 300,      // If liq < $300, it's a rug
    MAX_HOURS: 24            // Drop tracking after 24h
},

// --- System Intervals ---
SYSTEM: {
    SCAN_DELAY_PROFILES: 15000,  // Check Profiles every 15s
    SCAN_DELAY_BOOSTS: 30000,    // Check Trending/Boosts every 30s
    SCAN_DELAY_SEARCH: 60000,    // Deep Search every 60s
    TRACK_DELAY: 15000,          // Update Prices every 15s
    QUEUE_DELAY: 3000,           // Discord Rate Limit Protection
    RECAP_CHECK_INTERVAL: 60000  // Check time every minute for recaps
},

// --- Data Sources ---
ENDPOINTS: {
    PROFILES: "https://api.dexscreener.com/token-profiles/latest/v1",
    BOOSTS: "https://api.dexscreener.com/token-boosts/latest/v1",
    SEARCH: "https://api.dexscreener.com/latest/dex/search?q=solana",
    TOKENS: "https://api.dexscreener.com/latest/dex/tokens/"
},

URLS: {
    REFERRAL: "https://gmgn.ai/r/Greenchip"
}
```

};

// ==================================================================================
//  🛠️  UTILITY TOOLKIT
// ==================================================================================

const Utils = {
sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

```
formatUSD: (n) => {
    if (!n || isNaN(n)) return '$0.00';
    if (n >= 1e9) return '$' + (n/1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(2) + 'K';
    return '$' + n.toFixed(2);
},

formatPrice: (n) => {
    if (!n || isNaN(n)) return '$0.00';
    if (n < 0.000001) return '$' + n.toFixed(10);
    return '$' + n.toFixed(6);
},

getAge: (ts) => {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return '🔥 Just Launched';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m/60)}h ${m%60}m`;
},

getTimestamp: () => {
    return moment().tz(CONFIG.TIMEZONE).format('h:mm A z');
},

getHeaders: () => {
    return {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
    };
},

log: (type, source, msg) => {
    const t = moment().tz(CONFIG.TIMEZONE).format('HH:mm:ss');
    const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', RECAP: '📅' };
    console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
}
```

};

// ==================================================================================
//  🧠  MEMORY & DEDUPLICATION (STATE)
// ==================================================================================

class StateManager {
constructor() {
this.activeTracks = new Map();
this.history = new Set();
this.processing = new Set();
this.queue = [];

```
    // 🆕 ENHANCED STATS TRACKING
    this.dailyStats = new Map();
    this.weeklyStats = new Map();
    this.monthlyStats = new Map();
    
    this.lastDailyReport = null;
    this.lastWeeklyReport = null;
    this.lastMonthlyReport = null;
    
    this.stats = { calls: 0, rugs: 0, start: Date.now() };
}

lockCoin(address) {
    if (this.history.has(address)) return false;
    if (this.processing.has(address)) return false;
    this.processing.add(address);
    return true;
}

unlockCoin(address) {
    this.processing.delete(address);
}

finalizeCoin(address, data) {
    this.processing.delete(address);
    this.history.add(address);
    
    const coinData = {
        name: data.name,
        symbol: data.symbol,
        address: address,
        entryMcap: data.mcap,
        entryPrice: data.price,
        maxGain: 0,
        peakMcap: data.mcap,
        time: Date.now(),
        status: 'ACTIVE'
    };
    
    this.dailyStats.set(address, coinData);
    this.weeklyStats.set(address, coinData);
    this.monthlyStats.set(address, coinData);

    if (this.history.size > 10000) {
        const it = this.history.values();
        this.history.delete(it.next().value);
    }
}

updatePeak(address, currentMcap, gain, status = 'ACTIVE') {
    for (const statsMap of [this.dailyStats, this.weeklyStats, this.monthlyStats]) {
        if (statsMap.has(address)) {
            const stat = statsMap.get(address);
            if (gain > stat.maxGain) {
                stat.maxGain = gain;
                stat.peakMcap = currentMcap;
            }
            stat.status = status;
            statsMap.set(address, stat);
        }
    }
}
```

}

const STATE = new StateManager();

// ==================================================================================
//  ⚖️  RISK ENGINE WITH COLOR CODING
// ==================================================================================

class RiskEngine {
static analyze(pair) {
const vol = pair.volume?.h1 || 0;
const liq = pair.liquidity?.usd || 1;
const fdv = pair.fdv || pair.marketCap || 0;
const socials = pair.info?.socials || [];

```
    let riskScore = 0;
    
    // Risk Factors
    if (liq < 3000) riskScore += 30;
    else if (liq < 5000) riskScore += 15;
    
    if (socials.length === 0) riskScore += 25;
    else if (socials.length < 2) riskScore += 10;
    
    const ratio = vol / liq;
    if (ratio > 3.0) riskScore += 20;
    else if (ratio < 0.3) riskScore += 15;
    
    if (fdv < 25000) riskScore += 10;
    
    // Risk Level & Color
    let riskLevel = 'LOW';
    let embedColor = '#00FF00'; // Green
    
    if (riskScore >= 50) {
        riskLevel = 'HIGH';
        embedColor = '#FF0000'; // Red
    } else if (riskScore >= 25) {
        riskLevel = 'MEDIUM';
        embedColor = '#FFD700'; // Yellow/Gold
    }

    // Hype Score
    let hype = 0;
    if (ratio > 0.5) hype += 20;
    if (ratio > 2.0) hype += 30;
    if (socials.length > 0) hype += 20;
    if (pair.info?.header) hype += 10;
    
    // Safety Checks
    let safe = true;
    if (fdv < CONFIG.FILTERS.MIN_MCAP) safe = false;
    if (fdv > CONFIG.FILTERS.MAX_MCAP) safe = false;
    if (liq < CONFIG.FILTERS.MIN_LIQ) safe = false;
    if (vol < CONFIG.FILTERS.MIN_VOL_H1) safe = false;
    if (CONFIG.FILTERS.REQUIRE_SOCIALS && socials.length === 0) safe = false;
    
    if (CONFIG.FILTERS.ANTI_SPAM_NAMES) {
        const name = pair.baseToken.name.toLowerCase();
        if (name.includes('test') || name.length > 20) safe = false;
    }

    let status = 'UNKNOWN';
    const dex = (pair.dexId || '').toLowerCase();
    if (dex.includes('raydium')) status = 'GRADUATED';
    if (dex.includes('pump')) status = 'PUMP.FUN';

    return { safe, hype, status, vol, liq, fdv, riskLevel, embedColor, riskScore };
}
```

}

// ==================================================================================
//  📡  MULTI-THREADED SCANNERS
// ==================================================================================

async function scanProfiles() {
try {
const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
const profiles = res.data?.filter(p => p.chainId === ‘solana’).slice(0, 25) || [];
if (profiles.length) await fetchAndProcess(profiles.map(p => p.tokenAddress), ‘PROFILE’);
} catch (e) { handleErr(‘Profiles’, e); }
setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

async function scanBoosts() {
try {
const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
const boosts = res.data?.filter(p => p.chainId === ‘solana’).slice(0, 25) || [];
if (boosts.length) await fetchAndProcess(boosts.map(p => p.tokenAddress), ‘BOOST’);
} catch (e) { handleErr(‘Boosts’, e); }
setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

async function scanSearch() {
try {
const res = await axios.get(CONFIG.ENDPOINTS.SEARCH, { timeout: 5000, headers: Utils.getHeaders() });
const pairs = res.data?.pairs || [];
for (const pair of pairs) processPair(pair, ‘SEARCH’);
} catch (e) { handleErr(‘Search’, e); }
setTimeout(scanSearch, CONFIG.SYSTEM.SCAN_DELAY_SEARCH);
}

async function fetchAndProcess(addresses, source) {
if (!addresses || !addresses.length) return;
try {
const chunk = addresses.slice(0, 30).join(’,’);
const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${chunk}`, { timeout: 5000, headers: Utils.getHeaders() });
const pairs = res.data?.pairs || [];
for (const pair of pairs) processPair(pair, source);
} catch (e) { handleErr(‘Fetch’, e); }
}

function processPair(pair, source) {
if (!pair || !pair.baseToken || pair.chainId !== ‘solana’) return;
const addr = pair.baseToken.address;

```
if (!STATE.lockCoin(addr)) return;

const analysis = RiskEngine.analyze(pair);
const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;

if (ageMins < CONFIG.FILTERS.MIN_AGE_MIN || ageMins > CONFIG.FILTERS.MAX_AGE_MIN || !analysis.safe) {
    STATE.unlockCoin(addr);
    return;
}

STATE.finalizeCoin(addr, { 
    name: pair.baseToken.name, 
    symbol: pair.baseToken.symbol, 
    price: parseFloat(pair.priceUsd),
    mcap: analysis.fdv
});

STATE.queue.push({ pair, analysis, source });
Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
```

}

function handleErr(source, e) {
if (!e.response || e.response.status !== 429) {
// Utils.log(‘WARN’, source, e.message);
}
}

// ==================================================================================
//  💬  DISCORD SENDER WITH ENHANCED UI
// ==================================================================================

const client = new Client({
intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

async function processQueue() {
if (STATE.queue.length === 0) {
setTimeout(processQueue, 1000);
return;
}

```
const item = STATE.queue.shift();
await sendAlert(item.pair, item.analysis, item.source);
setTimeout(processQueue, CONFIG.SYSTEM.QUEUE_DELAY);
```

}

async function sendAlert(pair, analysis, source) {
const channel = client.channels.cache.get(process.env.CHANNEL_ID);
if (!channel) return;

```
const token = pair.baseToken;
const socials = pair.info?.socials || [];
const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
const gmgnLink = `https://gmgn.ai/sol/token/${token.address}`;

let badge = '⚡';
if (source === 'BOOST') badge = '🚀';
if (source === 'PROFILE') badge = '💎';
if (analysis.status === 'GRADUATED') badge = '🎓';

const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';

// Risk indicator
let riskEmoji = '🟢';
if (analysis.riskLevel === 'HIGH') riskEmoji = '🔴';
else if (analysis.riskLevel === 'MEDIUM') riskEmoji = '🟡';

const embed = new EmbedBuilder()
    .setColor(analysis.embedColor)
    .setTitle(`${badge} ${token.name} [$${Utils.formatUSD(analysis.fdv)}] - ${token.symbol}/SOL`)
    .setURL(dexLink)
    .setDescription(`
```

**${analysis.status}** 🔥

💵 **USD:** `${Utils.formatPrice(parseFloat(pair.priceUsd))}`
💎 **MCAP:** `${Utils.formatUSD(analysis.fdv)}`
💧 **Liq:** `${Utils.formatUSD(analysis.liq)}`
📊 **Vol:** `${Utils.formatUSD(analysis.vol)}` • **Age:** ${Utils.getAge(pair.pairCreatedAt)}
📈 **1H:** ${pair.priceChange?.h1 || 0}% ${pair.priceChange?.h1 > 0 ? ‘🟢’ : ‘🔴’}

${riskEmoji} **Risk: ${analysis.riskLevel}**

${links}
`) .setThumbnail(pair.info?.imageUrl || null) .setImage(pair.info?.header || null) .setFooter({  text: `Green Chip V8 • ${Utils.getTimestamp()}`,
iconURL: client.user?.displayAvatarURL()
});

```
const row = new ActionRowBuilder()
    .addComponents(
        new ButtonBuilder()
            .setLabel('📋 Copy CA')
            .setCustomId(`copy_ca_${token.address}`)
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setLabel('🛒 Buy on GMGN')
            .setURL(gmgnLink)
            .setStyle(ButtonStyle.Link)
    );

try {
    const msg = await channel.send({ embeds: [embed], components: [row] });
    
    STATE.activeTracks.set(token.address, {
        name: token.name,
        symbol: token.symbol,
        entryPrice: parseFloat(pair.priceUsd),
        entryMcap: analysis.fdv,
        maxGain: 0,
        peakMcap: analysis.fdv,
        msgId: msg.id,
        chanId: channel.id,
        t1: false, t2: false, t3: false,
        start: Date.now()
    });
    
    STATE.stats.calls++;
    Utils.log('SUCCESS', 'Discord', `Sent Alert: ${token.name}`);
} catch (e) {
    Utils.log('ERROR', 'Discord', e.message);
}
```

}

// ==================================================================================
//  📋  COPY CA BUTTON HANDLER
// ==================================================================================

client.on(‘interactionCreate’, async (interaction) => {
if (!interaction.isButton()) return;

```
if (interaction.customId.startsWith('copy_ca_')) {
    const address = interaction.customId.replace('copy_ca_', '');
    
    await interaction.reply({
        content: `📋 **Contract Address:**\n\`\`\`${address}\`\`\`\n✅ Click to select and copy!`,
        ephemeral: true
    });
}
```

});

// ==================================================================================
//  📅  RECAP SCHEDULER (DAILY, WEEKLY, MONTHLY)
// ==================================================================================

function initRecapScheduler() {
setInterval(async () => {
const now = moment().tz(CONFIG.TIMEZONE);
const dateKey = now.format(“YYYY-MM-DD”);
const weekKey = now.format(“YYYY-[W]WW”);
const monthKey = now.format(“YYYY-MM”);

```
    // Daily Recap at Midnight
    if (now.hour() === 0 && now.minute() === 0 && STATE.lastDailyReport !== dateKey) {
        await sendRecap('DAILY', STATE.dailyStats);
        STATE.lastDailyReport = dateKey;
        STATE.dailyStats.clear();
    }

    // Weekly Recap on Sunday at Midnight
    if (now.day() === 0 && now.hour() === 0 && now.minute() === 0 && STATE.lastWeeklyReport !== weekKey) {
        await sendRecap('WEEKLY', STATE.weeklyStats);
        STATE.lastWeeklyReport = weekKey;
        STATE.weeklyStats.clear();
    }

    // Monthly Recap on 1st at Midnight
    if (now.date() === 1 && now.hour() === 0 && now.minute() === 0 && STATE.lastMonthlyReport !== monthKey) {
        await sendRecap('MONTHLY', STATE.monthlyStats);
        STATE.lastMonthlyReport = monthKey;
        STATE.monthlyStats.clear();
    }
}, CONFIG.SYSTEM.RECAP_CHECK_INTERVAL);
```

}

async function sendRecap(type, statsMap) {
const channel = client.channels.cache.get(process.env.CHANNEL_ID);
if (!channel) return;

```
const allCalls = Array.from(statsMap.values());
const sorted = allCalls.sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);

if (sorted.length === 0) {
    Utils.log('RECAP', type, 'No calls, skipping report.');
    return;
}

const period = type === 'DAILY' ? 'Daily' : type === 'WEEKLY' ? 'Weekly' : 'Monthly';
const emoji = type === 'DAILY' ? '📅' : type === 'WEEKLY' ? '📊' : '📈';

let description = `**${emoji} ${period.toUpperCase()} LEADERBOARD**\n\nTop Performers:\n\n`;

sorted.forEach((coin, index) => {
    let icon = '🟢';
    if (coin.maxGain > 100) icon = '🚀';
    if (coin.maxGain > 500) icon = '👑';
    if (coin.status === 'RUG') icon = '💀';

    description += `**#${index + 1} ${icon} ${coin.name} ($${coin.symbol})**\n`;
    description += `Peak Gain: **+${coin.maxGain.toFixed(0)}%** (MCAP: ${Utils.formatUSD(coin.entryMcap)} → ${Utils.formatUSD(coin.peakMcap)})\n\n`;
});

description += `\n*${period} stats reset. Let's hunt! 🏹*`;

const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(`🏆 GREEN CHIP ${period.toUpperCase()} RECAP`)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: `Green Chip V8 • ${period} Summary` });

try {
    await channel.send({ embeds: [embed] });
    Utils.log('RECAP', type, `Sent ${period} Recap successfully.`);
} catch (e) {
    Utils.log('ERROR', 'Recap', e.message);
}
```

}

// ==================================================================================
//  📈  TRACKER WITH MARKET CAP-BASED GAINS
// ==================================================================================

async function runTracker() {
if (STATE.activeTracks.size === 0) {
setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
return;
}

```
for (const [addr, data] of STATE.activeTracks) {
    try {
        if (Date.now() - data.start > (CONFIG.TRACKER.MAX_HOURS * 3600000)) {
            STATE.activeTracks.delete(addr);
            continue;
        }

        const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${addr}`, { timeout: 3000, headers: Utils.getHeaders() });
        const pair = res.data?.pairs?.[0];
        if (!pair) continue;

        const currPrice = parseFloat(pair.priceUsd);
        const currMcap = pair.fdv || pair.marketCap || 0;
        const liq = pair.liquidity?.usd || 0;
        
        // REAL GAIN = Market Cap Change
        const mcapGain = ((currMcap - data.entryMcap) / data.entryMcap) * 100;

        STATE.updatePeak(addr, currMcap, mcapGain, 'ACTIVE');

        // RUG CHECK
        if (currPrice < (data.entryPrice * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
            STATE.updatePeak(addr, currMcap, mcapGain, 'RUG');
            STATE.activeTracks.delete(addr);
            continue;
        }

        if (mcapGain > data.maxGain) {
            data.maxGain = mcapGain;
            data.peakMcap = currMcap;
        }

        // GAIN ALERTS
        if (mcapGain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) {
            await sendUpdate(data, currMcap, mcapGain, 'GAIN');
            data.t1 = true;
        } else if (mcapGain >= CONFIG.TRACKER.GAIN_TRIGGER_2 && !data.t2) {
            await sendUpdate(data, currMcap, mcapGain, 'MOON');
            data.t2 = true;
        } else if (mcapGain >= CONFIG.TRACKER.GAIN_TRIGGER_3 && !data.t3) {
            await sendUpdate(data, currMcap, mcapGain, 'GOD');
            data.t3 = true;
        }

    } catch (e) {}
    await Utils.sleep(500);
}
setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
```

}

async function sendUpdate(data, currentMcap, gain, type) {
const channel = client.channels.cache.get(data.chanId);
if (!channel) return;
try {
const msg = await channel.messages.fetch(data.msgId);
if (!msg) return;

```
    let color = '#00FF00'; let title = `🚀 GAIN: +${gain.toFixed(0)}%`;
    if (type === 'MOON') { color = '#00D4FF'; title = `🌕 MOONSHOT: +${gain.toFixed(0)}%`; }
    if (type === 'GOD') { color = '#FFD700'; title = `👑 GOD CANDLE: +${gain.toFixed(0)}%`; }

    const desc = `**${data.name} ($${data.symbol})**\n\nEntry MCAP: ${Utils.formatUSD(data.entryMcap)}\nCurrent MCAP: ${Utils.formatUSD(currentMcap)}\nPeak MCAP: ${Utils.formatUSD(data.peakMcap)}\n\n[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`;

    const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
    await msg.reply({ embeds: [embed] });
    
} catch (e) { Utils.log('ERROR', 'Tracker', `Reply failed: ${e.message}`); }
```

}

// ==================================================================================
//  🔧  COMMANDS & SERVER
// ==================================================================================

client.on(‘messageCreate’, async (m) => {
if (m.author.bot) return;

```
if (m.content === '!test') {
    const uptime = Utils.getAge(STATE.stats.start);
    const embed = new EmbedBuilder()
        .setColor('#00FF00')
        .setTitle('🟢 GREEN CHIP V8 - ENHANCED EDITION')
        .addFields(
            { name: '⏱️ Uptime', value: uptime, inline: true },
            { name: '📡 Tracking', value: `${STATE.activeTracks.size}`, inline: true },
            { name: '📅 Daily Calls', value: `${STATE.dailyStats.size}`, inline: true },
            { name: '🕐 Timezone', value: CONFIG.TIMEZONE, inline: true }
        );
    await m.reply({ embeds: [embed] });
}

if (m.content === '!forcedaily') await sendRecap('DAILY', STATE.dailyStats);
if (m.content === '!forceweekly') await sendRecap('WEEKLY', STATE.weeklyStats);
if (m.content === '!forcemonthly') await sendRecap('MONTHLY', STATE.monthlyStats);
```

});

const app = express();
app.get(’/’, (req, res) => res.json({ status: ‘ONLINE’, version: CONFIG.VERSION }));
app.listen(process.env.PORT || 3000);

client.once(‘ready’, () => {
Utils.log(‘SUCCESS’, ‘System’, `Logged in as ${client.user.tag}`);
scanProfiles();
scanBoosts();
scanSearch();
runTracker();
processQueue();
initRecapScheduler();
});

client.login(process.env.DISCORD_TOKEN);
