// ==================================================================================
//  🟢 GREEN CHIP V9.0 - PERFECTION EDITION (ANTI-CRASH)
//  ---------------------------------------------------------------------------------
//  [1] 🌍 MULTI-CHAIN: Scans Solana & BSC (Binance Smart Chain) simultaneously.
//  [2] 🔀 SMART ROUTING: SOL -> Main Channel | BNB -> Dedicated BNB Channel.
//  [3] 🚫 NO SPACES: Compact UI (No gaps).
//  [4] 🏆 LEADERBOARDS: Daily (10), Weekly (15), Monthly (20) [Unified].
//  [5] 📈 TRACKER: Market Cap based gains + Peak detection.
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const express = require('express');

// 🛡️ ANTI-CRASH SYSTEM: PREVENTS "EXIT STATUS 1"
// This keeps the bot online even if there is a bug or network error.
process.on('unhandledRejection', (reason, p) => {
    console.log(' [Anti-Crash] :: Unhandled Rejection/Catch');
    console.log(reason, p);
});
process.on("uncaughtException", (err, origin) => {
    console.log(' [Anti-Crash] :: Uncaught Exception/Catch');
    console.log(err, origin);
});

// 🛡️ SAFE TIMEZONE LOADING
// If moment-timezone is missing on Render, this prevents the crash.
let moment;
try {
    moment = require('moment-timezone');
    moment.tz.setDefault("America/New_York");
} catch (e) {
    console.log("⚠️ Moment-Timezone missing, falling back to standard time.");
    moment = require('moment');
}

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V9",
    VERSION: "9.0.0-BNB-SUPPORT",
    
    FILTERS: {
        MIN_MCAP: 20000, MAX_MCAP: 75000, MIN_LIQ: 1500, MIN_VOL_H1: 500,         
        MAX_AGE_MIN: 60, MIN_AGE_MIN: 1, REQUIRE_SOCIALS: true, ANTI_SPAM_NAMES: true    
    },

    TRACKER: {
        GAIN_TRIGGER_1: 45, GAIN_TRIGGER_2: 100, GAIN_TRIGGER_3: 500,     
        STOP_LOSS: 0.90, RUG_CHECK_LIQ: 300, MAX_HOURS: 24            
    },

    SYSTEM: {
        SCAN_DELAY_PROFILES: 15000,  
        SCAN_DELAY_BOOSTS: 30000,    
        SCAN_DELAY_SEARCH: 60000,    
        TRACK_DELAY: 15000,          
        QUEUE_DELAY: 5000, // Increased slightly to 5s to prevent Discord bans          
        DAILY_CHECK_INTERVAL: 60000  
    },

    ENDPOINTS: {
        PROFILES: "https://api.dexscreener.com/token-profiles/latest/v1", 
        BOOSTS: "https://api.dexscreener.com/token-boosts/latest/v1",     
        SEARCH_SOL: "https://api.dexscreener.com/latest/dex/search?q=solana", 
        SEARCH_BNB: "https://api.dexscreener.com/latest/dex/search?q=bsc", 
        TOKENS: "https://api.dexscreener.com/latest/dex/tokens/"          
    },

    URLS: { REFERRAL: "https://gmgn.ai/r/Greenchip" },

    CHANNELS: {
        ALERTS_SOL: process.env.CHANNEL_ID,     
        ALERTS_BNB: "1462457809445584967",      
        LEADERBOARD: "1459729982459871252"      
    }
};

// ==================================================================================
//  🛠️  UTILITY TOOLKIT
// ==================================================================================

const Utils = {
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

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
        if (m < 60) return `${m}m ago`;
        return `${Math.floor(m/60)}h ${m%60}m ago`;
    },

    getHeaders: () => {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json'
        };
    },

    log: (type, source, msg) => {
        const t = moment().format('h:mm:ss A'); 
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', DAILY: '📅' };
        console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
    }
};

// ==================================================================================
//  🧠  MEMORY & STATE
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
        
        this.stats = { calls: 0, rugs: 0, start: Date.now() };
    }

    lockCoin(address) {
        if (this.history.has(address)) return false;
        if (this.processing.has(address)) return false;
        this.processing.add(address);
        return true;
    }

    unlockCoin(address) { this.processing.delete(address); }

    finalizeCoin(address, data) {
        this.processing.delete(address);
        this.history.add(address);
        
        const statEntry = {
            name: data.name, symbol: data.symbol, entryMcap: data.mcap, 
            maxGain: 0, chainId: data.chainId, time: Date.now(), status: 'ACTIVE'
        };

        this.dailyStats.set(address, { ...statEntry });
        this.weeklyStats.set(address, { ...statEntry });
        this.monthlyStats.set(address, { ...statEntry });

        if (this.history.size > 10000) {
            const it = this.history.values();
            this.history.delete(it.next().value);
        }
    }

    updatePeak(address, gain, status = 'ACTIVE') {
        const updateMap = (map) => {
            if (map.has(address)) {
                const stat = map.get(address);
                if (gain > stat.maxGain) stat.maxGain = gain;
                stat.status = status;
                map.set(address, stat);
            }
        };
        updateMap(this.dailyStats);
        updateMap(this.weeklyStats);
        updateMap(this.monthlyStats);
    }
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

        let riskLevel = 'YELLOW'; let color = '#FFFF00'; 
        if (liq < 4000 || fdv < 25000) { riskLevel = 'RED'; color = '#FF0000'; } 
        else if (liq > 8000 && fdv > 40000 && socials.length > 0) { riskLevel = 'GREEN'; color = '#00FF00'; }

        let status = 'UNKNOWN';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'GRADUATED';
        if (dex.includes('pump')) status = 'PUMP.FUN';
        if (pair.chainId === 'bsc') status = 'BSC GEM'; 

        return { safe, hype, status, vol, liq, fdv, riskLevel, color };
    }
}

// ==================================================================================
//  📡  SCANNERS
// ==================================================================================

async function scanProfiles() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
        const profiles = res.data?.filter(p => p.chainId === 'solana' || p.chainId === 'bsc').slice(0, 25) || [];
        if (profiles.length) await fetchAndProcess(profiles.map(p => p.tokenAddress), 'PROFILE');
    } catch (e) {}
    setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

async function scanBoosts() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
        const boosts = res.data?.filter(p => p.chainId === 'solana' || p.chainId === 'bsc').slice(0, 25) || [];
        if (boosts.length) await fetchAndProcess(boosts.map(p => p.tokenAddress), 'BOOST');
    } catch (e) {}
    setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

async function scanSearch() {
    try {
        const resSol = await axios.get(CONFIG.ENDPOINTS.SEARCH_SOL, { timeout: 5000, headers: Utils.getHeaders() });
        for (const pair of (resSol.data?.pairs || [])) processPair(pair, 'SEARCH');
        
        const resBnb = await axios.get(CONFIG.ENDPOINTS.SEARCH_BNB, { timeout: 5000, headers: Utils.getHeaders() });
        for (const pair of (resBnb.data?.pairs || [])) processPair(pair, 'SEARCH');
    } catch (e) {}
    setTimeout(scanSearch, CONFIG.SYSTEM.SCAN_DELAY_SEARCH);
}

async function fetchAndProcess(addresses, source) {
    if (!addresses || !addresses.length) return;
    try {
        const chunk = addresses.slice(0, 30).join(',');
        const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${chunk}`, { timeout: 5000, headers: Utils.getHeaders() });
        for (const pair of (res.data?.pairs || [])) processPair(pair, source);
    } catch (e) {}
}

function processPair(pair, source) {
    if (!pair || !pair.baseToken) return;
    const chain = pair.chainId;
    if (chain !== 'solana' && chain !== 'bsc') return; 

    const addr = pair.baseToken.address;
    if (!STATE.lockCoin(addr)) return;

    const analysis = RiskEngine.analyze(pair);
    const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;

    if (ageMins < CONFIG.FILTERS.MIN_AGE_MIN || ageMins > CONFIG.FILTERS.MAX_AGE_MIN || !analysis.safe) {
        STATE.unlockCoin(addr); return;
    }

    STATE.finalizeCoin(addr, { 
        name: pair.baseToken.name, symbol: pair.baseToken.symbol, 
        price: parseFloat(pair.priceUsd), mcap: analysis.fdv, chainId: chain 
    });
    
    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name} [${chain.toUpperCase()}]`);
}

// ==================================================================================
//  💬  DISCORD SENDER
// ==================================================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

async function processQueue() {
    if (STATE.queue.length === 0) { setTimeout(processQueue, 1000); return; }
    const item = STATE.queue.shift();
    await sendAlert(item.pair, item.analysis, item.source);
    setTimeout(processQueue, CONFIG.SYSTEM.QUEUE_DELAY);
}

async function sendAlert(pair, analysis, source) {
    let targetChannelId = CONFIG.CHANNELS.ALERTS_SOL;
    let chainBadge = '☀️';
    if (pair.chainId === 'bsc') { targetChannelId = CONFIG.CHANNELS.ALERTS_BNB; chainBadge = '🟡'; }

    const channel = client.channels.cache.get(targetChannelId);
    if (!channel) return;

    const token = pair.baseToken;
    const socials = pair.info?.socials || [];
    const dexLink = `https://dexscreener.com/${pair.chainId}/${pair.pairAddress}`; 
    const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';
    const desc = `**Chain:** ${chainBadge} ${pair.chainId.toUpperCase()} | **Risk:** ${analysis.riskLevel}\n**CA:** \`${token.address}\`\n${links}\n> **📊 DATA**\n> • **MCAP:** \`${Utils.formatUSD(analysis.fdv)}\`\n> • **Liq:** \`${Utils.formatUSD(analysis.liq)}\` | **Vol:** \`${Utils.formatUSD(analysis.vol)}\`\n**🎯 HYPE: ${analysis.hype}/100** ${analysis.hype > 40 ? "🔥" : "✅"}\n[**🛒 BUY ON GMGN**](${CONFIG.URLS.REFERRAL})`;

    const embed = new EmbedBuilder()
        .setColor(analysis.color)
        .setTitle(`${analysis.riskLevel==='GREEN'?'🟢':analysis.riskLevel==='RED'?'🔴':'🟡'} ${token.name} ($${token.symbol})`)
        .setURL(dexLink).setDescription(desc)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setImage(pair.info?.header || null)
        .setFooter({ text: `Green Chip V9 • ${moment().format('h:mm A')} EST`, iconURL: client.user.displayAvatarURL() });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`copy_${token.address}`).setLabel('📋 Copy CA').setStyle(ButtonStyle.Secondary)
    );

    try {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        STATE.activeTracks.set(token.address, {
            name: token.name, symbol: token.symbol, entryMcap: analysis.fdv, 
            entryPrice: parseFloat(pair.priceUsd), maxGain: 0, msgId: msg.id, chanId: channel.id,
            t1: false, t2: false, t3: false, start: Date.now()
        });
        STATE.stats.calls++;
        Utils.log('SUCCESS', 'Discord', `Sent ${pair.chainId.toUpperCase()} Alert: ${token.name}`);
    } catch (e) {
        if (e.code === 50013) console.error("⚠️ CRITICAL: Turn on 'Message Content Intent' in Dev Portal!");
        else console.error(`❌ Send Failed: ${e.message}`);
    }
}

// ==================================================================================
//  📅  LEADERBOARD & TRACKER
// ==================================================================================

function initScheduler() {
    setInterval(async () => {
        const now = moment();
        const dateStr = now.format("YYYY-MM-DD");
        if (now.hour() === 0 && now.minute() === 0) {
            if (STATE.lastDailyReport !== dateStr) {
                await sendLeaderboard('DAILY', STATE.dailyStats, 10);
                STATE.lastDailyReport = dateStr; STATE.dailyStats.clear();
            }
            if (now.day() === 1 && STATE.lastWeeklyReport !== dateStr) {
                await sendLeaderboard('WEEKLY', STATE.weeklyStats, 15);
                STATE.lastWeeklyReport = dateStr; STATE.weeklyStats.clear();
            }
            if (now.date() === 1 && STATE.lastMonthlyReport !== dateStr) {
                await sendLeaderboard('MONTHLY', STATE.monthlyStats, 20);
                STATE.lastMonthlyReport = dateStr; STATE.monthlyStats.clear();
            }
        }
    }, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendLeaderboard(type, statMap, limit) {
    const channel = client.channels.cache.get(CONFIG.CHANNELS.LEADERBOARD); 
    if (!channel) return;
    const sorted = Array.from(statMap.values()).sort((a, b) => b.maxGain - a.maxGain).slice(0, limit);
    if (!sorted.length) return;
    let desc = `**Top ${limit} Performers for ${type}**\n\n`;
    sorted.forEach((coin, i) => {
        desc += `**#${i+1} ${coin.chainId==='bsc'?'🟡':'☀️'} ${coin.name} ($${coin.symbol})**\nPeak: **+${coin.maxGain.toFixed(0)}%**\nStatus: ${coin.status}\n\n`;
    });
    const embed = new EmbedBuilder().setColor('#FFD700').setTitle(`🏆 ${type} LEADERBOARD`).setDescription(desc).setTimestamp();
    try { await channel.send({ embeds: [embed] }); } catch (e) {}
}

async function runTracker() {
    if (STATE.activeTracks.size === 0) { setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY); return; }
    for (const [addr, data] of STATE.activeTracks) {
        try {
            if (Date.now() - data.start > (CONFIG.TRACKER.MAX_HOURS * 3600000)) { STATE.activeTracks.delete(addr); continue; }
            const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${addr}`, { timeout: 3000, headers: Utils.getHeaders() });
            const pair = res.data?.pairs?.[0];
            if (!pair) continue;
            const gain = (( (pair.fdv||pair.marketCap) - data.entryMcap) / data.entryMcap) * 100;
            STATE.updatePeak(addr, gain, 'ACTIVE');
            if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) { await sendUpdate(data, pair.fdv, gain, 'GAIN'); data.t1 = true; }
        } catch (e) {}
        await Utils.sleep(1000);
    }
    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
}

async function sendUpdate(data, mcap, gain, type) {
    const channel = client.channels.cache.get(data.chanId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(data.msgId);
        if (msg) await msg.reply({ content: `🚀 **${data.name}** is up **${gain.toFixed(0)}%**! (\`${Utils.formatUSD(mcap)}\`)` });
    } catch (e) {}
}

// ==================================================================================
//  🔧  SERVER
// ==================================================================================

client.on('interactionCreate', async interaction => {
    if (interaction.isButton() && interaction.customId.startsWith('copy_')) {
        await interaction.reply({ content: `${interaction.customId.split('_')[1]}`, ephemeral: true });
    }
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!test') {
        await m.reply(`🟢 Green Chip Online | ${moment().format('YYYY-MM-DD h:mm A z')}`);
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'ONLINE', version: CONFIG.VERSION }));
app.listen(process.env.PORT || 3000);

if (!process.env.DISCORD_TOKEN) {
    console.error("❌ CRITICAL ERROR: DISCORD_TOKEN is missing in Render Environment Variables!");
} else {
    client.login(process.env.DISCORD_TOKEN).then(() => {
        Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
        scanProfiles(); scanBoosts(); scanSearch(); runTracker(); processQueue(); initScheduler();
    }).catch(err => {
        console.error("❌ LOGIN FAILED: Token invalid or Intents Missing.");
        console.error(err);
    });
}
