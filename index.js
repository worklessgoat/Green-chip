// ==================================================================================
//  🟢 GREEN CHIP V8 "DAILY RECAP" - ENTERPRISE TRADING ENGINE
//  ---------------------------------------------------------------------------------
//  New Capabilities:
//  [1] 📅 LEADERBOARDS: Daily, Weekly, and Monthly Auto-Recaps.
//  [2] 🎨 DYNAMIC UI: Risk-based colors (Red/Yellow/Green) & Banner support.
//  [3] 📋 COPY CA: One-click button to copy Contract Address.
//  [4] 📈 REAL GAINS: Market Cap based calculations & Peak detection.
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
//  Version: 8.1.0-US-TZ
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone'); // npm install moment-timezone

// SET TIMEZONE TO US (New York)
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
        MAX_MCAP: 75000,         // Increased slightly for quality
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
        SCAN_DELAY_PROFILES: 15000,  
        SCAN_DELAY_BOOSTS: 30000,    
        SCAN_DELAY_SEARCH: 60000,    
        TRACK_DELAY: 15000,          
        QUEUE_DELAY: 3000,           
        DAILY_CHECK_INTERVAL: 60000  
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
        this.history = new Set();          // Permanent history
        this.processing = new Set();       // Temporary lock
        this.queue = [];                   // Discord send queue
        
        // 🆕 LEADERBOARD MEMORY
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
        
        const statEntry = {
            name: data.name,
            symbol: data.symbol,
            entryMcap: data.mcap, // Tracking MCAP now
            maxGain: 0,
            time: Date.now(),
            status: 'ACTIVE'
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

        // --- NEW: Risk Level (Color) Logic ---
        // Red: Risky (<$4k Liq or <$25k MCAP)
        // Yellow: Balance
        // Green: Low Risk (>$8k Liq and >$40k MCAP and Socials)
        
        let riskLevel = 'YELLOW'; // Default Balanced
        let color = '#FFFF00'; // Yellow

        if (liq < 4000 || fdv < 25000) {
            riskLevel = 'RED';
            color = '#FF0000'; // Red
        } else if (liq > 8000 && fdv > 40000 && socials.length > 0) {
            riskLevel = 'GREEN';
            color = '#00FF00'; // Green
        }

        // Status
        let status = 'UNKNOWN';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'GRADUATED';
        if (dex.includes('pump')) status = 'PUMP.FUN';

        return { safe, hype, status, vol, liq, fdv, riskLevel, color };
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
        price: parseFloat(pair.priceUsd),
        mcap: analysis.fdv
    });
    
    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
}

function handleErr(source, e) {
    if (!e.response || e.response.status !== 429) {}
}

// ==================================================================================
//  💬  DISCORD SENDER
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
    
    // UI Logic
    const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';
    
    // Images: Use header as main image if exists, else standard logic
    const imageUrl = pair.info?.header || pair.info?.imageUrl; 
    const thumbUrl = pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';

    const embed = new EmbedBuilder()
        .setColor(analysis.color) // Uses Red/Yellow/Green from RiskEngine
        .setTitle(`${analysis.riskLevel === 'GREEN' ? '🟢' : analysis.riskLevel === 'RED' ? '🔴' : '🟡'} ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
**Source:** ${source} | **Risk:** ${analysis.riskLevel}

${links}

> **📊 MARKET DATA**
> • **MCAP:** \`${Utils.formatUSD(analysis.fdv)}\`
> • **Liquidity:** \`${Utils.formatUSD(analysis.liq)}\`
> • **Volume (1h):** \`${Utils.formatUSD(analysis.vol)}\`
> • **Age:** \`${Utils.getAge(pair.pairCreatedAt)}\`

**🎯 HYPE SCORE: ${analysis.hype}/100**
${analysis.hype > 40 ? "🔥 HIGH MOMENTUM" : "✅ STEADY"}

[**🛒 BUY ON GMGN (LOWER FEES)**](${CONFIG.URLS.REFERRAL})
`)
        .setThumbnail(thumbUrl)
        .setImage(pair.info?.header ? pair.info.header : null) // Add banner if exists
        .setFooter({ text: `Green Chip V8 • US Timezone • ${moment().format('h:mm A')}`, iconURL: client.user.displayAvatarURL() });

    // Button: Copy CA
    const row = new ActionRowBuilder()
        .addComponents(
            new ButtonBuilder()
                .setCustomId(`copy_${token.address}`)
                .setLabel('📋 Copy CA')
                .setStyle(ButtonStyle.Secondary)
        );

    try {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        
        STATE.activeTracks.set(token.address, {
            name: token.name,
            symbol: token.symbol,
            entryMcap: analysis.fdv, // Save MCAP for gain calc
            entryPrice: parseFloat(pair.priceUsd),
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

// ==================================================================================
//  📅  LEADERBOARD SYSTEM (DAILY, WEEKLY, MONTHLY)
// ==================================================================================

function initScheduler() {
    setInterval(async () => {
        const now = moment();
        const dateStr = now.format("YYYY-MM-DD");
        
        // 12:00 AM Check
        if (now.hour() === 0 && now.minute() === 0) {
            
            // --- DAILY REPORT ---
            if (STATE.lastDailyReport !== dateStr) {
                await sendLeaderboard('DAILY', STATE.dailyStats);
                STATE.lastDailyReport = dateStr;
                STATE.dailyStats.clear(); // Reset Daily
            }

            // --- WEEKLY REPORT (Monday) ---
            if (now.day() === 1 && STATE.lastWeeklyReport !== dateStr) {
                await sendLeaderboard('WEEKLY', STATE.weeklyStats);
                STATE.lastWeeklyReport = dateStr;
                STATE.weeklyStats.clear(); // Reset Weekly
            }

            // --- MONTHLY REPORT (1st of month) ---
            if (now.date() === 1 && STATE.lastMonthlyReport !== dateStr) {
                await sendLeaderboard('MONTHLY', STATE.monthlyStats);
                STATE.lastMonthlyReport = dateStr;
                STATE.monthlyStats.clear(); // Reset Monthly
            }
        }
    }, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendLeaderboard(type, statMap) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const allCalls = Array.from(statMap.values());
    const sorted = allCalls.sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);

    if (sorted.length === 0) return;

    let title = `🏆 ${type} LEADERBOARD`;
    let desc = `**Top Performers of the ${type.toLowerCase()}**\n\n`;

    sorted.forEach((coin, index) => {
        let icon = '🟢';
        if (coin.maxGain > 100) icon = '🚀';
        if (coin.maxGain > 500) icon = '👑';
        if (coin.status === 'RUG') icon = '💀';

        desc += `**#${index + 1} ${icon} ${coin.name} ($${coin.symbol})**\n`;
        desc += `Peak: **+${coin.maxGain.toFixed(0)}%**\n`;
        desc += `Status: ${coin.status}\n\n`;
    });

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(title)
        .setDescription(desc)
        .setTimestamp()
        .setFooter({ text: 'Green Chip V8 • Leaderboard' });

    await channel.send({ embeds: [embed] });
}

// ==================================================================================
//  📈  TRACKER (MCAP BASED + ATH DETECTION)
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

            const currPrice = parseFloat(pair.priceUsd);
            const currMcap = pair.fdv || pair.marketCap;
            const liq = pair.liquidity?.usd || 0;

            // GAIN FORMULA: Based on MCAP as requested
            const gain = ((currMcap - data.entryMcap) / data.entryMcap) * 100;

            STATE.updatePeak(addr, gain, 'ACTIVE');

            // RUG CHECK (Silent removal)
            if (currPrice < (data.entryPrice * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                // NO MESSAGE sent here as requested
                STATE.updatePeak(addr, gain, 'RUG'); 
                STATE.activeTracks.delete(addr);
                continue;
            }

            // High Score Logic
            if (gain > data.maxGain) data.maxGain = gain;

            if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_1 && !data.t1) {
                await sendUpdate(data, currMcap, gain, 'GAIN');
                data.t1 = true;
            } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_2 && !data.t2) {
                await sendUpdate(data, currMcap, gain, 'MOON');
                data.t2 = true;
            } else if (gain >= CONFIG.TRACKER.GAIN_TRIGGER_3 && !data.t3) {
                await sendUpdate(data, currMcap, gain, 'GOD');
                data.t3 = true;
            }

        } catch (e) {}
        await Utils.sleep(500);
    }
    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_DELAY);
}

async function sendUpdate(data, currentMcap, gain, type) {
    const channel = client.channels.cache.get(data.chanId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(data.msgId);
        if (!msg) return;

        let color = '#00FF00'; let title = `🚀 GAIN: +${gain.toFixed(0)}%`;
        if (type === 'MOON') { color = '#00D4FF'; title = `🌕 MOONSHOT: +${gain.toFixed(0)}%`; }
        if (type === 'GOD') { color = '#FFD700'; title = `👑 GOD CANDLE: +${gain.toFixed(0)}%`; }

        const desc = `**${data.name} ($${data.symbol})**\n` +
            `Entry MCAP: \`${Utils.formatUSD(data.entryMcap)}\`\n` +
            `Current MCAP: \`${Utils.formatUSD(currentMcap)}\`\n` +
            `**Peak Gain: +${data.maxGain.toFixed(0)}%**\n\n` +
            `[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`;

        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
        await msg.reply({ embeds: [embed] });
        
    } catch (e) { Utils.log('ERROR', 'Tracker', `Reply failed: ${e.message}`); }
}

// ==================================================================================
//  🔧  INTERACTIONS (BUTTONS) & SERVER
// ==================================================================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId.startsWith('copy_')) {
        const ca = interaction.customId.split('_')[1];
        // Send ephemeral message (only visible to user) for easy copy
        await interaction.reply({ 
            content: `${ca}`, 
            ephemeral: true 
        });
    }
});

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;
    if (m.content === '!test') {
        await m.reply(`🟢 Green Chip Online | ${moment().format('YYYY-MM-DD HH:mm:ss')}`);
    }
});

const app = express();
app.get('/', (req, res) => res.json({ status: 'ONLINE', version: CONFIG.VERSION }));
app.listen(process.env.PORT || 3000);

client.once('ready', () => {
    Utils.log('SUCCESS', 'System', `Logged in as ${client.user.tag}`);
    scanProfiles();
    scanBoosts();
    scanSearch();
    runTracker();
    processQueue();
    initScheduler();
});

client.login(process.env.DISCORD_TOKEN);
