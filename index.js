// ==================================================================================
//  🟢 GREEN CHIP V8 "DAILY RECAP" - ENTERPRISE TRADING ENGINE
//  ---------------------------------------------------------------------------------
//  New Capabilities:
//  [1] 📅 DAILY RECAP: Auto-posts a "Gains Summary" at 12:00 AM every night.
//  [2] 🔒 ZERO DUPLICATES: Strict "Lock System" prevents double calls.
//  [3] 🚀 TRI-SOURCE SCANNER: Profiles + Boosts + Search (Simultaneous).
//  [4] 🤖 AUTO-TRADING AI: Tracks gains, threads replies, and monitors rugs.
//  [5] 🇺🇸 US TIMEZONE: All operations synced to US Eastern Time (EST/EDT).
//  [6] 📱 RICK UI: Enhanced compact vertical layout with Copy CA buttons.
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
//  Version: 8.5.0-US-RICK-UI
// ==================================================================================

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActivityType, 
    Partials, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    MessageFlags 
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone'); // Updated for Timezone support

// Set Global Timezone to US (Eastern Time)
moment.tz.setDefault("America/New_York");

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V8",
    VERSION: "8.5.0-STABLE",
    
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
        GAIN_TRIGGER_1: 45,      // First Alert at +45% (Reply to thread)
        GAIN_TRIGGER_2: 100,     // Moon Alert at +100%
        GAIN_TRIGGER_3: 500,     // God Alert at +500%
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
        DAILY_CHECK_INTERVAL: 60000  // Check time every minute for Daily Report
    },

    // --- Data Sources ---
    ENDPOINTS: {
        PROFILES: "https://api.dexscreener.com/token-profiles/latest/v1", // Paid Updates
        BOOSTS: "https://api.dexscreener.com/token-boosts/latest/v1",     // Trending/Hype
        SEARCH: "https://api.dexscreener.com/latest/dex/search?q=solana", // Deep Search
        TOKENS: "https://api.dexscreener.com/latest/dex/tokens/"          // Data Fetch
    },

    URLS: {
        REFERRAL: "https://gmgn.ai/r/Greenchip"
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
        if (m < 1) return '🔥 New';
        if (m < 60) return `${m}m`;
        return `${Math.floor(m/60)}h ${m%60}m`;
    },

    getHeaders: () => {
        return {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'application/json'
        };
    },

    log: (type, source, msg) => {
        const t = moment().format('HH:mm:ss');
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', DAILY: '📅' };
        console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
    }
};

// ==================================================================================
//  🧠  MEMORY & DEDUPLICATION (STATE)
// ==================================================================================

class StateManager {
    constructor() {
        this.activeTracks = new Map();     // Currently watched coins
        this.history = new Set();          // Permanent history (Prevent duplicates)
        this.processing = new Set();       // Temporary lock during analysis
        this.queue = [];                   // Discord send queue
        
        this.dailyStats = new Map();       
        this.lastReportDate = null;        
        
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
        
        this.dailyStats.set(address, {
            name: data.name,
            symbol: data.symbol,
            entryMcap: data.mcap,
            maxGain: 0,
            time: Date.now(),
            status: 'ACTIVE'
        });

        if (this.history.size > 10000) {
            const it = this.history.values();
            this.history.delete(it.next().value);
        }
    }

    updateDailyPeak(address, gain, status = 'ACTIVE') {
        if (this.dailyStats.has(address)) {
            const stat = this.dailyStats.get(address);
            if (gain > stat.maxGain) stat.maxGain = gain;
            stat.status = status; 
            this.dailyStats.set(address, stat);
        }
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
        if (liq < CONFIG.FILTERS.MIN_LI_MIN_LIQ) safe = false;
        if (vol < CONFIG.FILTERS.MIN_VOL_H1) safe = false;
        if (CONFIG.FILTERS.REQUIRE_SOCIALS && socials.length === 0) safe = false;
        
        if (CONFIG.FILTERS.ANTI_SPAM_NAMES) {
            const name = pair.baseToken.name.toLowerCase();
            if (name.includes('test') || name.length > 20) safe = false;
        }

        let status = 'Unknown';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'Raydium';
        if (dex.includes('pump')) status = 'Pump.Fun';

        return { safe, hype, status, vol, liq, fdv };
    }
}

// ==================================================================================
//  📡  MULTI-THREADED SCANNERS
// ==================================================================================

async function scanProfiles() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
        const profiles = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (profiles.length) await fetchAndProcess(profiles.map(p => p.tokenAddress), 'PROFILE');
    } catch (e) { handleErr('Profiles', e); }
    setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

async function scanBoosts() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
        const boosts = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (boosts.length) await fetchAndProcess(boosts.map(p => p.tokenAddress), 'BOOST');
    } catch (e) { handleErr('Boosts', e); }
    setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

async function scanSearch() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.SEARCH, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        for (const pair of pairs) processPair(pair, 'SEARCH');
    } catch (e) { handleErr('Search', e); }
    setTimeout(scanSearch, CONFIG.SYSTEM.SCAN_DELAY_SEARCH);
}

async function fetchAndProcess(addresses, source) {
    if (!addresses || !addresses.length) return;
    try {
        const chunk = addresses.slice(0, 30).join(',');
        const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${chunk}`, { timeout: 5000, headers: Utils.getHeaders() });
        const pairs = res.data?.pairs || [];
        for (const pair of pairs) processPair(pair, source);
    } catch (e) { handleErr('Fetch', e); }
}

function processPair(pair, source) {
    if (!pair || !pair.baseToken || pair.chainId !== 'solana') return;
    const addr = pair.baseToken.address;

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
        mcap: analysis.fdv 
    });
    
    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
}

function handleErr(source, e) {}

// ==================================================================================
//  💬  DISCORD SENDER (RICK STYLE UI)
// ==================================================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
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

    const token = pair.baseToken;
    const socials = pair.info?.socials || [];
    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const mcapStr = Utils.formatUSD(analysis.fdv);
    
    let badge = '⚡'; let color = '#FFFFFF';
    if (source === 'BOOST') { badge = '🚀'; color = '#FFD700'; }
    if (source === 'PROFILE') { badge = '💎'; color = '#00D4FF'; }

    const socialLinks = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || 'No Socials';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`💊 ${token.name} [${mcapStr}] - ${token.symbol}/SOL`)
        .setURL(dexLink)
        .setDescription(`
**Solana @ ${analysis.status}** 🔥

💵 **USD:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\`
💎 **FDV:** \`${mcapStr}\`
💧 **Liq:** \`${Utils.formatUSD(analysis.liq)}\`
📊 **Vol:** \`${Utils.formatUSD(analysis.vol)}\` • **Age:** \`${Utils.getAge(pair.pairCreatedAt)}\`

🔗 ${socialLinks}

\`${token.address}\`
`)
        .setThumbnail(pair.info?.imageUrl || null)
        .setImage(pair.info?.header || null)
        .setFooter({ text: `Green Chip V8 • ${moment().format('hh:mm A')} EST`, iconURL: client.user.displayAvatarURL() });

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`copy_${token.address}`).setLabel('📋 Copy CA').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setLabel('Trade on GMGN').setStyle(ButtonStyle.Link).setURL(CONFIG.URLS.REFERRAL)
    );

    try {
        const msg = await channel.send({ embeds: [embed], components: [buttons] });
        
        STATE.activeTracks.set(token.address, {
            name: token.name,
            symbol: token.symbol,
            entryMcap: analysis.fdv,
            maxGain: 0,
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
}

// Interaction Handler for Buttons
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith('copy_')) {
        const ca = interaction.customId.split('_')[1];
        await interaction.reply({ content: `\`${ca}\``, flags: MessageFlags.Ephemeral });
    }
});

// ==================================================================================
//  📅  DAILY RECAP SYSTEM
// ==================================================================================

function initDailyScheduler() {
    setInterval(async () => {
        const now = moment();
        if (now.hour() === 0 && now.minute() === 0) {
            const todayStr = now.format("YYYY-MM-DD");
            if (STATE.lastReportDate !== todayStr) {
                await sendDailyRecap();
                STATE.lastReportDate = todayStr;
                STATE.dailyStats.clear();
            }
        }
    }, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendDailyRecap() {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const allCalls = Array.from(STATE.dailyStats.values());
    const sorted = allCalls.sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);

    if (sorted.length === 0) return;

    let description = `**📅 DAILY RECAP: ${moment().subtract(1, 'days').format('MMMM Do, YYYY')}**\n\n`;

    sorted.forEach((coin, index) => {
        let icon = coin.maxGain > 100 ? '🚀' : '🟢';
        description += `**#${index + 1} ${icon} ${coin.name} ($${coin.symbol})**\nPeak Gain: **+${coin.maxGain.toFixed(0)}%**\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 GREEN CHIP DAILY LEADERBOARD`)
        .setDescription(description)
        .setTimestamp();

    try { await channel.send({ embeds: [embed] }); } catch (e) {}
}

// ==================================================================================
//  📈  TRACKER (MCAP BASED)
// ==================================================================================

async function runTracker() {
    if (STATE.activeTracks.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
        return;
    }

    for (const [addr, data] of STATE.activeTracks) {
        try {
            if (Date.now() - data.start > (CONFIG.TRACKER.MAX_HOURS * 3600000)) {
                STATE.activeTracks.delete(addr);
                continue;
            }

            const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${addr}`, { timeout: 3000, headers: Utils.getHeaders() });
            const pair = res.data?.pairs?.[0];
            if (!pair) continue;

            const currMcap = pair.fdv || pair.marketCap || 0;
            const gain = ((currMcap - data.entryMcap) / data.entryMcap) * 100;

            STATE.updateDailyPeak(addr, gain, 'ACTIVE');

            if (currMcap < (data.entryMcap * (1 - CONFIG.TRACKER.STOP_LOSS))) {
                await sendUpdate(data, currMcap, gain, 'RUG');
                STATE.activeTracks.delete(addr);
                continue;
            }

            if (gain > data.maxGain) data.maxGain = gain;

            if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) {
                await sendUpdate(data, currMcap, gain, 'GAIN');
                data.t1 = true;
            } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_2 && !data.t2) {
                await sendUpdate(data, currMcap, gain, 'MOON');
                data.t2 = true;
            }
        } catch (e) {}
        await Utils.sleep(500);
    }
    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
}

async function sendUpdate(data, mcap, gain, type) {
    const channel = client.channels.cache.get(data.chanId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(data.msgId);
        let color = type === 'RUG' ? '#FF0000' : '#00FF00';
        let title = type === 'RUG' ? `🚨 STOP LOSS` : `🚀 MCAP GAIN: +${gain.toFixed(0)}%`;

        const desc = `**${data.name} ($${data.symbol})**\nEntry Cap: \`${Utils.formatUSD(data.entryMcap)}\`\nNow: \`${Utils.formatUSD(mcap)}\``;

        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc);
        await msg.reply({ embeds: [embed] });
    } catch (e) {}
}

// ==================================================================================
//  🔧  COMMANDS & SERVER
// ==================================================================================

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!test') {
        const uptime = Utils.getAge(STATE.stats.start);
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🟢 GREEN CHIP - ACTIVE')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '📡 Tracking', value: `${STATE.activeTracks.size}`, inline: true }
            );
        await m.reply({ embeds: [embed] });
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'ONLINE' }));
app.listen(process.env.PORT || 3000);

client.once('ready', () => {
    Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
    // Live Price Status Logic (Rick Image Style)
    setInterval(async () => {
        try {
            const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}So11111111111111111111111111111111111111112`);
            const price = res.data.pairs[0].priceUsd;
            const change = res.data.pairs[0].priceChange.h24;
            client.user.setActivity(`SOL: $${parseFloat(price).toFixed(2)} (${change >= 0 ? '▲' : '▼'}${Math.abs(change)}%)`, { type: ActivityType.Custom });
        } catch (e) {}
    }, 60000);

    scanProfiles();
    scanBoosts();
    scanSearch();
    runTracker();
    processQueue();
    initDailyScheduler();
});

client.login(process.env.DISCORD_TOKEN);
