// ==================================================================================
//  🟢 GREEN CHIP V8 “ENHANCED” - ENTERPRISE TRADING ENGINE
//  Version: 8.1.0-PRODUCTION-READY
// ==================================================================================

require(‘dotenv’).config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require(‘discord.js’);
const axios = require(‘axios’);
const express = require(‘express’);
const moment = require(‘moment-timezone’);

// ==================================================================================
//  ⚙️  CONFIGURATION
// ==================================================================================

const CONFIG = {
BOT_NAME: “Green Chip V8”,
VERSION: “8.1.0-PRODUCTION”,
TIMEZONE: “America/New_York”,

```
FILTERS: {
    MIN_MCAP: 20000,
    MAX_MCAP: 55000,
    MIN_LIQ: 1500,
    MIN_VOL_H1: 500,
    MAX_AGE_MIN: 60,
    MIN_AGE_MIN: 1,
    REQUIRE_SOCIALS: true,
    ANTI_SPAM_NAMES: true
},

TRACKER: {
    GAIN_TRIGGER_1: 45,
    GAIN_TRIGGER_2: 100,
    GAIN_TRIGGER_3: 500,
    STOP_LOSS: 0.90,
    RUG_CHECK_LIQ: 300,
    MAX_HOURS: 24
},

SYSTEM: {
    SCAN_DELAY_PROFILES: 15000,
    SCAN_DELAY_BOOSTS: 30000,
    SCAN_DELAY_SEARCH: 60000,
    TRACK_DELAY: 15000,
    QUEUE_DELAY: 3000,
    DAILY_CHECK_INTERVAL: 60000,
    STARTUP_DELAY: 5000
},

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
//  🛠️  UTILITIES
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

getUSTime: () => {
    return moment().tz(CONFIG.TIMEZONE).format('h:mm A z');
},

getHeaders: () => ({
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json'
}),

log: (type, source, msg) => {
    const t = moment().tz(CONFIG.TIMEZONE).format('HH:mm:ss');
    const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', REPORT: '📊' };
    console.log(`[${t}] ${icons[type] || 'ℹ️'} [${source}] ${msg}`);
},

calculateMCapGain: (entryMcap, currentMcap) => {
    if (!entryMcap || !currentMcap) return 0;
    return ((currentMcap - entryMcap) / entryMcap) * 100;
},

getRiskColor: (analysis) => {
    let riskScore = 0;
    if (analysis.liq < 3000) riskScore += 3;
    else if (analysis.liq < 8000) riskScore += 2;
    else riskScore += 1;
    if (!analysis.hasSocials) riskScore += 2;
    const ratio = analysis.vol / analysis.liq;
    if (ratio > 2.0) riskScore += 2;
    else if (ratio > 1.0) riskScore += 1;
    if (analysis.ageMinutes < 5) riskScore += 2;
    else if (analysis.ageMinutes < 15) riskScore += 1;
    if (riskScore >= 6) return '#FF4444';
    if (riskScore >= 4) return '#FFAA00';
    return '#00FF88';
}
```

};

// ==================================================================================
//  🧠  STATE MANAGER
// ==================================================================================

class StateManager {
constructor() {
this.activeTracks = new Map();
this.history = new Set();
this.processing = new Set();
this.queue = [];
this.dailyStats = new Map();
this.weeklyStats = new Map();
this.monthlyStats = new Map();
this.lastDailyReport = null;
this.lastWeeklyReport = null;
this.lastMonthlyReport = null;
this.stats = { calls: 0, start: Date.now() };
}

```
lockCoin(address) {
    if (this.history.has(address) || this.processing.has(address)) return false;
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
        ca: address,
        entryMcap: data.mcap,
        entryPrice: data.price,
        maxGain: 0,
        time: Date.now(),
        status: 'ACTIVE'
    };
    this.dailyStats.set(address, {...coinData});
    this.weeklyStats.set(address, {...coinData});
    this.monthlyStats.set(address, {...coinData});
    if (this.history.size > 10000) {
        const it = this.history.values();
        this.history.delete(it.next().value);
    }
}

updatePeaks(address, gain, currentMcap, status = 'ACTIVE') {
    [this.dailyStats, this.weeklyStats, this.monthlyStats].forEach(statMap => {
        if (statMap.has(address)) {
            const stat = statMap.get(address);
            if (gain > stat.maxGain) {
                stat.maxGain = gain;
                stat.peakMcap = currentMcap;
            }
            stat.status = status;
        }
    });
}
```

}

const STATE = new StateManager();

// ==================================================================================
//  ⚖️  RISK ENGINE
// ==================================================================================

class RiskEngine {
static analyze(pair) {
const vol = pair.volume?.h1 || 0;
const liq = pair.liquidity?.usd || 1;
const fdv = pair.fdv || pair.marketCap || 0;
const socials = pair.info?.socials || [];
const ageMinutes = (Date.now() - pair.pairCreatedAt) / 60000;

```
    let hype = 0;
    const ratio = vol / liq;
    if (ratio > 0.5) hype += 20;
    if (ratio > 2.0) hype += 30;
    if (socials.length > 0) hype += 20;
    if (pair.info?.header) hype += 10;
    
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

    return { safe, hype, status, vol, liq, fdv, hasSocials: socials.length > 0, ageMinutes };
}
```

}

// ==================================================================================
//  📡  SCANNERS
// ==================================================================================

async function scanProfiles() {
try {
const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
const profiles = res.data?.filter(p => p.chainId === ‘solana’).slice(0, 25) || [];
if (profiles.length) await fetchAndProcess(profiles.map(p => p.tokenAddress), ‘PROFILE’);
} catch (e) { /* silent */ }
setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

async function scanBoosts() {
try {
const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
const boosts = res.data?.filter(p => p.chainId === ‘solana’).slice(0, 25) || [];
if (boosts.length) await fetchAndProcess(boosts.map(p => p.tokenAddress), ‘BOOST’);
} catch (e) { /* silent */ }
setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

async function scanSearch() {
try {
const res = await axios.get(CONFIG.ENDPOINTS.SEARCH, { timeout: 5000, headers: Utils.getHeaders() });
const pairs = res.data?.pairs || [];
for (const pair of pairs) processPair(pair, ‘SEARCH’);
} catch (e) { /* silent */ }
setTimeout(scanSearch, CONFIG.SYSTEM.SCAN_DELAY_SEARCH);
}

async function fetchAndProcess(addresses, source) {
if (!addresses?.length) return;
try {
const chunk = addresses.slice(0, 30).join(’,’);
const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${chunk}`, { timeout: 5000, headers: Utils.getHeaders() });
const pairs = res.data?.pairs || [];
for (const pair of pairs) processPair(pair, source);
} catch (e) { /* silent */ }
}

function processPair(pair, source) {
if (!pair?.baseToken || pair.chainId !== ‘solana’) return;
const addr = pair.baseToken.address;
if (!STATE.lockCoin(addr)) return;

```
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

// ==================================================================================
//  💬  DISCORD CLIENT
// ==================================================================================

const client = new Client({
intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
partials: [Partials.Message, Partials.Channel]
});

async function processQueue() {
if (STATE.queue.length === 0) {
setTimeout(processQueue, 1000);
return;
}
const item = STATE.queue.shift();
await sendAlert(item.pair, item.analysis, item.source);
setTimeout(processQueue, CONFIG.SYSTEM.QUEUE_DELAY);
}

async function sendAlert(pair, analysis, source) {
const channel = client.channels.cache.get(process.env.CHANNEL_ID);
if (!channel) return;

```
const token = pair.baseToken;
const socials = pair.info?.socials || [];
const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
const ca = token.address;

let badge = '⚡';
if (source === 'BOOST') badge = '🚀';
if (source === 'PROFILE') badge = '💎';
if (analysis.status === 'GRADUATED') badge = '🎓';

const color = Utils.getRiskColor(analysis);
const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';
const priceChange1h = pair.priceChange?.h1 || 0;
const priceIndicator = priceChange1h >= 0 ? '🟢' : '🔴';

const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${badge} ${token.name} [${Utils.formatUSD(analysis.fdv)}] - ${token.symbol}/SOL`)
    .setURL(dexLink)
    .setDescription(`**${analysis.status}** 🔥\n\n💵 **USD:** ${Utils.formatPrice(parseFloat(pair.priceUsd))}\n💎 **MCAP:** ${Utils.formatUSD(analysis.fdv)}\n💧 **Liq:** ${Utils.formatUSD(analysis.liq)}\n📊 **Vol:** ${Utils.formatUSD(analysis.vol)} • **Age:** ${Utils.getAge(pair.pairCreatedAt)}\n📈 **1H:** ${priceChange1h.toFixed(2)}% ${priceIndicator}\n\n🔗 ${links}\n\n**Contract Address:**\n\`\`\`${ca}\`\`\``)
    .setFooter({ text: `Green Chip V8 • ${Utils.getUSTime()}`, iconURL: client.user?.displayAvatarURL() });

if (pair.info?.imageUrl) embed.setThumbnail(pair.info.imageUrl);
if (pair.info?.header) embed.setImage(pair.info.header);

const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`copy_ca_${ca}`).setLabel('📋 Copy CA').setStyle(ButtonStyle.Primary)
);

try {
    const msg = await channel.send({ embeds: [embed], components: [row] });
    STATE.activeTracks.set(ca, {
        name: token.name,
        symbol: token.symbol,
        entryPrice: parseFloat(pair.priceUsd),
        entryMcap: analysis.fdv,
        maxGain: 0,
        msgId: msg.id,
        chanId: channel.id,
        t1: false, t2: false, t3: false,
        start: Date.now()
    });
    STATE.stats.calls++;
    Utils.log('SUCCESS', 'Discord', `Sent: ${token.name}`);
} catch (e) {
    Utils.log('ERROR', 'Discord', e.message);
}
```

}

client.on(‘interactionCreate’, async (interaction) => {
if (!interaction.isButton()) return;
if (interaction.customId.startsWith(‘copy_ca_’)) {
const ca = interaction.customId.replace(‘copy_ca_’, ‘’);
await interaction.reply({ content: `\`${ca}``, ephemeral: true });
}
});

// ==================================================================================
//  📅  LEADERBOARDS
// ==================================================================================

function initLeaderboardScheduler() {
setInterval(async () => {
const now = moment().tz(CONFIG.TIMEZONE);
if (now.hour() === 0 && now.minute() === 0) {
const todayStr = now.format(“YYYY-MM-DD”);
if (STATE.lastDailyReport !== todayStr) {
await sendLeaderboard(‘DAILY’);
STATE.lastDailyReport = todayStr;
STATE.dailyStats.clear();
}
}
if (now.day() === 0 && now.hour() === 23 && now.minute() === 59) {
const weekStr = now.format(“YYYY-WW”);
if (STATE.lastWeeklyReport !== weekStr) {
await sendLeaderboard(‘WEEKLY’);
STATE.lastWeeklyReport = weekStr;
STATE.weeklyStats.clear();
}
}
if (now.date() === now.daysInMonth() && now.hour() === 23 && now.minute() === 59) {
const monthStr = now.format(“YYYY-MM”);
if (STATE.lastMonthlyReport !== monthStr) {
await sendLeaderboard(‘MONTHLY’);
STATE.lastMonthlyReport = monthStr;
STATE.monthlyStats.clear();
}
}
}, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendLeaderboard(period) {
const channel = client.channels.cache.get(process.env.CHANNEL_ID);
if (!channel) return;

```
let statMap, title, dateStr;
const now = moment().tz(CONFIG.TIMEZONE);
if (period === 'DAILY') {
    statMap = STATE.dailyStats;
    title = '📅 DAILY LEADERBOARD';
    dateStr = now.subtract(1, 'days').format('MMMM Do, YYYY');
} else if (period === 'WEEKLY') {
    statMap = STATE.weeklyStats;
    title = '📊 WEEKLY LEADERBOARD';
    dateStr = `Week of ${now.subtract(1, 'weeks').startOf('week').format('MMMM Do')}`;
} else {
    statMap = STATE.monthlyStats;
    title = '🏆 MONTHLY LEADERBOARD';
    dateStr = now.subtract(1, 'months').format('MMMM YYYY');
}

const sorted = Array.from(statMap.values()).sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);
if (sorted.length === 0) return;

let description = `**${title} - ${dateStr}**\n\nTop Performers:\n\n`;
sorted.forEach((coin, index) => {
    let icon = '🟢';
    if (coin.maxGain > 100) icon = '🚀';
    if (coin.maxGain > 500) icon = '👑';
    description += `**#${index + 1} ${icon} ${coin.name} ($${coin.symbol})**\nPeak: **+${coin.maxGain.toFixed(0)}%** (${Utils.formatUSD(coin.peakMcap || coin.entryMcap)})\n\`${coin.ca}\`\n\n`;
});

const embed = new EmbedBuilder()
    .setColor('#FFD700')
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: `Green Chip V8 • ${Utils.getUSTime()}` });

try {
    await channel.send({ embeds: [embed] });
    Utils.log('REPORT', period, 'Sent successfully');
} catch (e) {
    Utils.log('ERROR', period, e.message);
}
```

}

// ==================================================================================
//  📈  TRACKER
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

        const currentMcap = pair.fdv || pair.marketCap || 0;
        const liq = pair.liquidity?.usd || 0;
        const gain = Utils.calculateMCapGain(data.entryMcap, currentMcap);

        STATE.updatePeaks(addr, gain, currentMcap, 'ACTIVE');

        const currPrice = parseFloat(pair.priceUsd);
        if (currPrice < (data.entryPrice * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
            STATE.updatePeaks(addr, gain, currentMcap, 'RUG');
            STATE.activeTracks.delete(addr);
            continue;
        }

        if (gain > data.maxGain) data.maxGain = gain;

        if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) {
            await sendGainUpdate(data, currentMcap, gain, 'GAIN');
            data.t1 = true;
        } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_2 && !data.t2) {
            await sendGainUpdate(data, currentMcap, gain, 'MOON');
            data.t2 = true;
        } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_3 && !data.t3) {
            await sendGainUpdate(data, currentMcap, gain, 'GOD');
            data.t3 = true;
        }
    } catch (e) { /* silent */ }
    await Utils.sleep(500);
}
setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
```

}

async function sendGainUpdate(data, currentMcap, gain, type) {
const channel = client.channels.cache.get(data.chanId);
if (!channel) return;
try {
const msg = await channel.messages.fetch(data.msgId);
if (!msg) return;

```
    let color = '#00FF00', title = `🚀 GAIN: +${gain.toFixed(0)}%`;
    if (type === 'MOON') { color = '#00D4FF'; title = `🌕 MOONSHOT: +${gain.toFixed(0)}%`; }
    if (type === 'GOD') { color = '#FFD700'; title = `👑 GOD CANDLE: +${gain.toFixed(0)}%`; }

    const desc = `**${data.name} ($${data.symbol})**\n\nEntry: ${Utils.formatUSD(data.entryMcap)}\nCurrent: ${Utils.formatUSD(currentMcap)}\n\n**Gain: +${gain.toFixed(2)}%**\n\n[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`;

    const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
    await msg.reply({ embeds: [embed] });
} catch (e) { /* silent */ }
```

}

// ==================================================================================
//  🔧  COMMANDS
// ==================================================================================

client.on(‘messageCreate’, async (m) => {
if (m.author.bot) return;
if (m.content === ‘!test’) {
const embed = new EmbedBuilder()
.setColor(’#00FF00’)
.setTitle(‘🟢 GREEN CHIP V8 - ACTIVE’)
.addFields(
{ name: ‘⏱️ Uptime’, value: Utils.getAge(STATE.stats.start), inline: true },
{ name: ‘📡 Tracking’, value: `${STATE.activeTracks.size}`, inline: true },
{ name: ‘📅 Calls’, value: `${STATE.stats.calls}`, inline: true }
)
.setFooter({ text: Utils.getUSTime() });
await m.reply({ embeds: [embed] });
}
if (m.content === ‘!forcedaily’) { await sendLeaderboard(‘DAILY’); await m.reply(“✅ Daily sent”); }
if (m.content === ‘!forceweekly’) { await sendLeaderboard(‘WEEKLY’); await m.reply(“✅ Weekly sent”); }
if (m.content === ‘!forcemonthly’) { await sendLeaderboard(‘MONTHLY’); await m.reply(“✅ Monthly sent”); }
});

// ==================================================================================
//  🚀  SERVER & INITIALIZATION
// ==================================================================================

const app = express();
app.get(’/’, (req, res) => res.json({ status: ‘ONLINE’, version: CONFIG.VERSION, uptime: Utils.getAge(STATE.stats.start), tracking: STATE.activeTracks.size, calls: STATE.stats.calls }));
app.get(’/health’, (req, res) => res.json({ healthy: true, bot: client.isReady() ? ‘connected’ : ‘disconnected’, time: Utils.getUSTime() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => Utils.log(‘SUCCESS’, ‘Server’, `Running on port ${PORT}`));

client.once(‘ready’, () => {
Utils.log(‘SUCCESS’, ‘Discord’, `Logged in as ${client.user.tag}`);
client.user.setActivity(‘Green Chip V8’, { type: ActivityType.Watching });
setTimeout(() => {
scanProfiles();
scanBoosts();
scanSearch();
runTracker();
processQueue();
initLeaderboardScheduler();
Utils.log(‘SUCCESS’, ‘System’, ‘All scanners active’);
}, CONFIG.SYSTEM.STARTUP_DELAY);
});

client.login(process.env.DISCORD_TOKEN).catch(err => {
Utils.log(‘ERROR’, ‘Login’, ‘Failed to connect to Discord’);
console.error(err);
});
