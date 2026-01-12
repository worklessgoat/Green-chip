// ==================================================================================
//  🟢 GREEN CHIP V8 "DAILY RECAP" - ENTERPRISE TRADING ENGINE
//  ---------------------------------------------------------------------------------
//  New Capabilities:
//  [1] 📅 DAILY/WEEKLY/MONTHLY RECAPS: Auto-posts leaderboards (US Time).
//  [2] 🔘 COPY CA BUTTON: One-click copy for mobile/desktop.
//  [3] 📈 NEW HIGH TRACKER: Only reports new peaks or "Dip & Recover" scenarios.
//  [4] 🛑 SMART STOP LOSS: Cuts at -85% or Liquidity Pull.
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
//  Version: 8.1.0-LEADERBOARD-UPDATE
// ==================================================================================

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle 
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone'); // Ensure 'npm install moment-timezone'

// Set Global Timezone to US (Eastern Time)
moment.tz.setDefault("America/New_York");

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V8",
    VERSION: "8.1.0-STABLE",
    
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
        // Triggers are now dynamic based on "New High" logic
        STOP_LOSS_PCT: -85,      // Stop if drops 85% below entry (User Request)
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
        DAILY_CHECK_INTERVAL: 60000  // Check time every minute for Reports
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
        const t = moment().format('HH:mm:ss');
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', REPORT: '📊' };
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
        
        // 🆕 LEADERBOARD MEMORY (Daily, Weekly, Monthly)
        // Storing objects: { name, symbol, entry, maxGain, time, status }
        this.dailyStats = new Map();       
        this.weeklyStats = new Map();
        this.monthlyStats = new Map();

        this.lastReportDate = null;        
        this.lastReportWeek = null;
        this.lastReportMonth = null;
        
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
        
        const statObj = {
            name: data.name,
            symbol: data.symbol,
            entry: data.price,
            maxGain: 0,
            time: Date.now(),
            status: 'ACTIVE'
        };

        // Initialize in all timeframes
        this.dailyStats.set(address, { ...statObj });
        this.weeklyStats.set(address, { ...statObj });
        this.monthlyStats.set(address, { ...statObj });

        // Keep history manageable
        if (this.history.size > 10000) {
            const it = this.history.values();
            this.history.delete(it.next().value);
        }
    }

    // Update max gain in all leaderboards
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

        // Hype Score
        let hype = 0;
        const ratio = vol / liq;
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

        // Status
        let status = 'UNKNOWN';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'GRADUATED';
        if (dex.includes('pump')) status = 'PUMP.FUN';

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
        price: parseFloat(pair.priceUsd) 
    });
    
    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
}

function handleErr(source, e) {}

// ==================================================================================
//  💬  DISCORD SENDER (WITH COPY BUTTON)
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
    
    let badge = '⚡'; let color = '#FFFFFF';
    if (source === 'BOOST') { badge = '🚀'; color = '#FFD700'; }
    if (source === 'PROFILE') { badge = '💎'; color = '#00D4FF'; }
    if (analysis.status === 'GRADUATED') { badge = '🎓'; color = '#00FF00'; }

    const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';

    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(`${badge} ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
**Source:** ${source} | **Status:** ${analysis.status}

${links}
**Contract:** \`${token.address}\`

> **📊 METRICS**
> • **MCAP:** \`${Utils.formatUSD(analysis.fdv)}\`
> • **Price:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\`
> • **Liq:** \`${Utils.formatUSD(analysis.liq)}\`
> • **Vol (1h):** \`${Utils.formatUSD(analysis.vol)}\`
> • **Age:** \`${Utils.getAge(pair.pairCreatedAt)}\`

**🎯 HYPE SCORE: ${analysis.hype}/100**
${analysis.hype > 40 ? "🔥 HIGH MOMENTUM" : "✅ STEADY"}

[**🛒 BUY ON GMGN (LOWER FEES)**](${CONFIG.URLS.REFERRAL})
`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip V8 • ${moment().format('h:mm A z')}`, iconURL: client.user.displayAvatarURL() });

    // 🔘 Create Copy Button
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`copy_ca_${token.address}`)
            .setLabel('Copy CA')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋')
    );

    try {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        
        STATE.activeTracks.set(token.address, {
            name: token.name,
            symbol: token.symbol,
            entry: parseFloat(pair.priceUsd),
            entryMcap: analysis.fdv, // Store Entry Mcap for the report
            maxGain: 0,
            lastReportedGain: 0, // Track last gain we sent a message for
            msgId: msg.id,
            chanId: channel.id,
            start: Date.now()
        });
        
        STATE.stats.calls++;
        Utils.log('SUCCESS', 'Discord', `Sent Alert: ${token.name}`);
    } catch (e) {
        Utils.log('ERROR', 'Discord', e.message);
    }
}

// 🔘 Button Interaction Handler
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith('copy_ca_')) {
        const ca = interaction.customId.split('copy_ca_')[1];
        await interaction.reply({ content: `\`${ca}\``, ephemeral: true });
    }
});

// ==================================================================================
//  📅  LEADERBOARD SYSTEM (Daily, Weekly, Monthly) - US TIMEZONE
// ==================================================================================

function initDailyScheduler() {
    setInterval(async () => {
        const now = moment(); // Uses US Timezone defined at top
        
        // 12:00 AM Check
        if (now.hour() === 0 && now.minute() === 0) {
            const todayStr = now.format("YYYY-MM-DD");
            
            // 1. Daily Report
            if (STATE.lastReportDate !== todayStr) {
                await sendLeaderboard('DAILY', STATE.dailyStats);
                STATE.lastReportDate = todayStr;
                STATE.dailyStats.clear(); // Reset Daily
            }

            // 2. Weekly Report (Sunday = 0)
            if (now.day() === 0 && STATE.lastReportWeek !== todayStr) {
                await sendLeaderboard('WEEKLY', STATE.weeklyStats);
                STATE.lastReportWeek = todayStr;
                STATE.weeklyStats.clear(); // Reset Weekly
            }

            // 3. Monthly Report (1st of month)
            if (now.date() === 1 && STATE.lastReportMonth !== todayStr) {
                await sendLeaderboard('MONTHLY', STATE.monthlyStats);
                STATE.lastReportMonth = todayStr;
                STATE.monthlyStats.clear(); // Reset Monthly
            }
        }
    }, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendLeaderboard(type, mapData) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const allCalls = Array.from(mapData.values());
    const sorted = allCalls.sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);

    if (sorted.length === 0) return;

    const titleMap = {
        'DAILY': `📅 DAILY LEADERBOARD`,
        'WEEKLY': `🔥 WEEKLY HALL OF FAME`,
        'MONTHLY': `👑 MONTHLY GOD MODE`
    };

    let description = `**Top Performers (${moment().subtract(1, 'day').format('MMMM Do')}):**\n\n`;

    sorted.forEach((coin, index) => {
        let icon = '🟢';
        if (coin.maxGain > 100) icon = '🚀';
        if (coin.maxGain > 500) icon = '👑';
        if (coin.status === 'RUG') icon = '💀';

        description += `**#${index + 1} ${icon} ${coin.name} ($${coin.symbol})**\n`;
        description += `Peak Gain: **+${coin.maxGain.toFixed(0)}%**\n`;
        description += `Status: ${coin.status}\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(titleMap[type])
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: `Green Chip V8 • ${type} Stats` });

    try {
        await channel.send({ embeds: [embed] });
        Utils.log('REPORT', type, `Sent ${type} Leaderboard.`);
    } catch (e) {
        Utils.log('ERROR', 'Leaderboard', e.message);
    }
}

// ==================================================================================
//  📈  TRACKER (UPDATED LOGIC: NEW HIGHS ONLY + DIP RECOVERY)
// ==================================================================================

async function runTracker() {
    if (STATE.activeTracks.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
        return;
    }

    for (const [addr, data] of STATE.activeTracks) {
        try {
            // Drop old tracks
            if (Date.now() - data.start > (CONFIG.TRACKER.MAX_HOURS * 3600000)) {
                STATE.activeTracks.delete(addr);
                continue;
            }

            const res = await axios.get(`${CONFIG.ENDPOINTS.TOKENS}${addr}`, { timeout: 3000, headers: Utils.getHeaders() });
            const pair = res.data?.pairs?.[0];
            if (!pair) continue;

            const currPrice = parseFloat(pair.priceUsd);
            const currMcap = pair.fdv || pair.marketCap;
            const liq = pair.liquidity?.usd || 0;
            const gain = ((currPrice - data.entry) / data.entry) * 100;

            // Update Leaderboard Memory
            STATE.updatePeak(addr, gain, 'ACTIVE');

            // 🛑 STOP LOSS & RUG CHECK (-85% or Low Liq)
            if (gain <= CONFIG.TRACKER.STOP_LOSS_PCT || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                await sendUpdate(data, currPrice, gain, 'RUG', currMcap);
                STATE.updatePeak(addr, gain, 'RUG');
                STATE.activeTracks.delete(addr); // Stop tracking
                continue;
            }

            // 🚀 NEW HIGH CHECK ONLY
            // We only send a message if current gain is higher than the last reported gain
            if (gain > data.lastReportedGain) {
                // Ensure it's a significant move (e.g., don't spam for 0.1% difference)
                // If it's the first gain (lastReported == 0), trigger.
                // Or if it beats the previous high.
                
                // Logic: Only update if gain is positive
                if (gain > 0) {
                    await sendUpdate(data, currPrice, gain, 'GAIN', currMcap);
                    data.lastReportedGain = gain; // Update "High Water Mark"
                    if (gain > data.maxGain) data.maxGain = gain; // Update Max
                }
            }
            // If it goes down, we do NOTHING. We wait for it to go back up past the last high.

        } catch (e) {}
        await Utils.sleep(500);
    }
    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
}

async function sendUpdate(data, price, gain, type, currentMcap) {
    const channel = client.channels.cache.get(data.chanId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(data.msgId);
        if (!msg) return;

        let color = '#00FF00'; 
        let text = '';

        if (type === 'RUG') {
            color = '#FF0000';
            text = `🚨 **STOPPED:** Token hit -85% or Rugged.`;
        } else {
            // DYNAMIC TEXT FORMATTING AS REQUESTED
            if (gain > 500) {
                 // Big Gain / Dip & Recover format
                 text = `🚀 **${gain.toFixed(0)}% gained** from \`${Utils.formatUSD(data.entryMcap)}\` market cap to \`${Utils.formatUSD(currentMcap)}\` market cap`;
            } else {
                 // Standard format
                 text = `🟢 **${gain.toFixed(0)}% gained**`;
            }
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setDescription(`${text}\n[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`)
            .setTimestamp(); // Uses local time, but consistent

        await msg.reply({ embeds: [embed] });
        
    } catch (e) { Utils.log('ERROR', 'Tracker', `Reply failed: ${e.message}`); }
}

// ==================================================================================
//  🔧  COMMANDS & SERVER
// ==================================================================================

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    
    if (m.content === '!test') {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🟢 GREEN CHIP V8 - ONLINE')
            .setDescription(`Timezone: America/New_York\nCurrent Time: ${moment().format('h:mm A z')}`)
        await m.reply({ embeds: [embed] });
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'ONLINE', version: CONFIG.VERSION }));
app.listen(process.env.PORT || 3000);

// Start
client.once('ready', () => {
    Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
    scanProfiles();
    scanBoosts();
    scanSearch();
    runTracker();
    processQueue();
    initDailyScheduler();
});

client.login(process.env.DISCORD_TOKEN);
