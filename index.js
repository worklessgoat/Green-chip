// ==================================================================================
//  🟢 GREEN CHIP V6 - HYBRID CORE
//  Logic: V4 Scan Algorithm (High Volume) + V5 Engine Labeling
//  Author: Gemini (AI) for GreenChip
//  Updated: Restored V4 "Catch-All" Logic to ensure calls flow immediately.
// ==================================================================================

require('dotenv').config();
const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    ActivityType, 
    Partials, 
    ButtonBuilder, 
    ButtonStyle, 
    ActionRowBuilder 
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone');
const cron = require('node-cron');

// ==================================================================================
//  ⚙️  CONFIGURATION
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V6",
    VERSION: "6.0-HYBRID",
    TIMEZONE: "America/New_York", 
    
    // --- V4 ORIGINAL FILTERS (The Money Makers) ---
    FILTERS: {
        MIN_MCAP: 10000,        
        MAX_MCAP: 90000,        
        MIN_LIQUIDITY: 1000,    
        MIN_VOLUME_H1: 1000,    // Keep at 1k to catch organic pumps
        MIN_AGE_MINUTES: 1,     
        MAX_AGE_MINUTES: 60,    
        MAX_PRICE_USD: 1.0,     
        REQUIRE_SOCIALS: true,  
        MIN_HYPE_SCORE: 10      
    },

    TRACKING: {
        GAIN_MILESTONES: [50, 100, 200, 300, 400, 500, 1000, 2000, 5000, 10000], 
        STOP_LOSS_DROP: 0.85,        
        RUG_LIQ_THRESHOLD: 200,      
        MAX_TRACK_DURATION_HR: 24    
    },

    SYSTEM: {
        SCAN_INTERVAL_MS: 12000,     // V4 Speed (12s)
        TRACK_INTERVAL_MS: 10000,    // V4 Speed (10s)
        RATE_LIMIT_DELAY: 1500,      
        RETRY_TIMEOUT_MS: 15000      
    },

    URLS: {
        REFERRAL: "https://gmgn.ai/r/Greenchip",
        DEX_API: "https://api.dexscreener.com/latest/dex/search?q=solana",
        TOKEN_API: "https://api.dexscreener.com/latest/dex/tokens/"
    }
};

// ==================================================================================
//  🛠️  UTILITY TOOLKIT
// ==================================================================================

const Utils = {
    sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    formatUSD: (num) => {
        if (!num || isNaN(num)) return '$0.00';
        if (num >= 1e9) return '$' + (num / 1e9).toFixed(2) + 'B';
        if (num >= 1e6) return '$' + (num / 1e6).toFixed(2) + 'M';
        if (num >= 1e3) return '$' + (num / 1e3).toFixed(2) + 'K';
        return '$' + num.toFixed(2);
    },

    formatPrice: (num) => {
        if (!num || isNaN(num)) return '$0.00';
        if (num < 0.000001) return '$' + num.toFixed(10);
        return '$' + num.toFixed(6);
    },

    getAge: (timestamp) => {
        const diffMs = Date.now() - timestamp;
        const mins = Math.floor(diffMs / 60000);
        if (mins < 1) return '🔥 Just Launched';
        if (mins < 60) return `${mins}m ago`;
        const hours = Math.floor(mins / 60);
        return `${hours}h ${mins % 60}m ago`;
    },

    getCurrentTime: () => {
        return moment().tz(CONFIG.TIMEZONE).format('h:mm:ss A');
    },

    log: (type, message) => {
        const time = Utils.getCurrentTime();
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', SYSTEM: '⚙️' };
        console.log(`[${time}] ${icons[type] || ''} ${type}: ${message}`);
    }
};

// ==================================================================================
//  🧠  STATE MANAGEMENT
// ==================================================================================

class StateManager {
    constructor() {
        this.activeCalls = new Map(); 
        this.processedHistory = new Set(); 
        this.stats = {
            callsToday: 0,
            startTime: Date.now(),
            apiRequests: 0,
            ruggedDetected: 0
        };
    }

    isProcessed(address) {
        return this.processedHistory.has(address);
    }

    addProcessed(address) {
        this.processedHistory.add(address);
        if (this.processedHistory.size > 8000) { 
            const it = this.processedHistory.values();
            this.processedHistory.delete(it.next().value);
        }
    }

    addActiveCall(data) {
        this.activeCalls.set(data.address, data);
        this.stats.callsToday++;
        Leaderboard.recordCall(data); 
    }

    removeActiveCall(address) {
        this.activeCalls.delete(address);
    }
}

const STATE = new StateManager();

// ==================================================================================
//  🏆  LEADERBOARD SYSTEM
// ==================================================================================

class LeaderboardManager {
    constructor() {
        this.dailyCalls = [];
        this.weeklyCalls = [];
    }

    recordCall(callData) {
        const entry = {
            symbol: callData.symbol,
            address: callData.address,
            entryPrice: callData.entryPrice,
            highestGain: 0,
            engine: callData.engineName || 'Standard',
            timestamp: Date.now()
        };
        this.dailyCalls.push(entry);
        this.weeklyCalls.push(entry);
    }

    updateGain(address, gain) {
        const dailyItem = this.dailyCalls.find(i => i.address === address);
        if (dailyItem && gain > dailyItem.highestGain) dailyItem.highestGain = gain;

        const weeklyItem = this.weeklyCalls.find(i => i.address === address);
        if (weeklyItem && gain > weeklyItem.highestGain) weeklyItem.highestGain = gain;
    }

    generateLeaderboard(type) {
        const list = type === 'DAILY' ? this.dailyCalls : this.weeklyCalls;
        const sorted = list.sort((a, b) => b.highestGain - a.highestGain).slice(0, 10); 

        if (sorted.length === 0) return "No calls recorded yet.";

        let description = "";
        sorted.forEach((item, index) => {
            let medal = "🔹";
            if (index === 0) medal = "🥇";
            if (index === 1) medal = "🥈";
            if (index === 2) medal = "🥉";
            
            description += `${medal} **$${item.symbol}** • +${item.highestGain.toFixed(0)}%\n`;
        });
        
        return description;
    }

    resetDaily() {
        this.dailyCalls = [];
        Utils.log('INFO', 'Daily Leaderboard Reset');
    }

    resetWeekly() {
        this.weeklyCalls = [];
        Utils.log('INFO', 'Weekly Leaderboard Reset');
    }
}

const Leaderboard = new LeaderboardManager();

// ==================================================================================
//  🌐  EXPRESS SERVER
// ==================================================================================

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.status(200).json({
        status: 'Operational',
        uptime: Utils.getAge(STATE.stats.startTime),
        active_tracks: STATE.activeCalls.size,
        history_db: STATE.processedHistory.size,
        calls_today: STATE.stats.callsToday
    });
});

app.listen(PORT, () => {
    Utils.log('SYSTEM', `Web server running on port ${PORT}`);
});

// ==================================================================================
//  🤖  DISCORD CLIENT
// ==================================================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
});

// ==================================================================================
//  🕵️  HYBRID ANALYZER (V4 LOGIC + V5 LABELS)
// ==================================================================================

class CoinAnalyzer {
    
    static calculateHypeScore(pair) {
        let score = 0;
        const vol = pair.volume?.h1 || 0;
        const liq = pair.liquidity?.usd || 1;
        
        const ratio = vol / liq;
        if (ratio > 0.5) score += 10;
        if (ratio > 2.0) score += 20; 
        
        const socials = pair.info?.socials || [];
        score += (socials.length * 20); 
        
        if (pair.info?.imageUrl) score += 10;
        return score;
    }

    // This assigns the "Engine" label, but DOES NOT block the coin.
    static getEngineLabel(pair) {
        // 1. PumpFun
        if (pair.dexId === 'pump') return { name: '💊 PumpFun Turbo', color: '#14F195', emoji: '💊' };
        
        // 2. Sniper (New & High Vol)
        const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;
        if (ageMins < 10 && (pair.volume?.h1 > 3000)) return { name: '🎯 Sniper Watch', color: '#FF0000', emoji: '🎯' };
        
        // 3. Axiom/Trend
        const hype = this.calculateHypeScore(pair);
        if (hype > 40) return { name: '⚡ Axiom Trend', color: '#00D4FF', emoji: '⚡' };
        
        // 4. Standard
        return { name: '🟢 Standard High Vol', color: '#FFFFFF', emoji: '🟢' };
    }

    static validate(pair) {
        // --- 1. BASIC CHECKS ---
        if (!pair?.baseToken?.address || !pair?.priceUsd) return { valid: false };
        if (pair.chainId !== 'solana') return { valid: false };
        if (STATE.isProcessed(pair.baseToken.address)) return { valid: false };

        // --- 2. V4 ORIGINAL FILTERS (Broad & Effective) ---
        const fdv = pair.fdv || pair.marketCap || 0;
        if (fdv < CONFIG.FILTERS.MIN_MCAP) return { valid: false };
        if (fdv > CONFIG.FILTERS.MAX_MCAP) return { valid: false };

        const createdAt = pair.pairCreatedAt; 
        if (!createdAt) return { valid: false };
        const ageMins = (Date.now() - createdAt) / 60000;
        if (ageMins < CONFIG.FILTERS.MIN_AGE_MINUTES) return { valid: false };
        if (ageMins > CONFIG.FILTERS.MAX_AGE_MINUTES) return { valid: false };

        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h1 || 0;
        if (liq < CONFIG.FILTERS.MIN_LIQUIDITY) return { valid: false };
        if (vol < CONFIG.FILTERS.MIN_VOLUME_H1) return { valid: false };

        const socials = pair.info?.socials || [];
        if (CONFIG.FILTERS.REQUIRE_SOCIALS && socials.length === 0) return { valid: false };

        // --- 3. RETURN SUCCESS WITH ENGINE LABEL ---
        const hype = this.calculateHypeScore(pair);
        const engine = this.getEngineLabel(pair);

        return { 
            valid: true, 
            metrics: { hype, ageMins, fdv, liq, vol },
            engine: engine
        };
    }
}

// ==================================================================================
//  📢  MESSAGE BUILDER
// ==================================================================================

async function sendCallAlert(pair, metrics, engine) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return Utils.log('ERROR', 'Channel not found');

    const token = pair.baseToken;
    const socials = pair.info?.socials || [];
    const linkMap = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ');
    const socialText = linkMap.length > 0 ? linkMap : "⚠️ *No social links*";

    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    
    const embed = new EmbedBuilder()
        .setColor(engine.color)
        .setTitle(`${engine.emoji} ${engine.name.toUpperCase()}: ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
${socialText}

**Metrics:** \`$${Utils.formatUSD(metrics.fdv)} MC\` • \`$${Utils.formatUSD(metrics.liq)} Liq\`
**Volume:** \`$${Utils.formatUSD(metrics.vol)} (1h)\` • **Price:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\`
**Age:** ${Utils.getAge(pair.pairCreatedAt)} • **Hype:** \`${metrics.hype}/100\`

[**📈 DexScreener**](${dexLink}) • [**⚡ Photon**](${photonLink}) • [**🛒 GMGN**](${CONFIG.URLS.REFERRAL})
`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip V6 • ${Utils.getCurrentTime()}`, iconURL: client.user.displayAvatarURL() });

    const copyButton = new ButtonBuilder()
        .setCustomId(`copy_ca_${token.address}`)
        .setLabel(`📝 Copy CA`) 
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(copyButton);

    try {
        const msg = await channel.send({ 
            content: `\`${token.address}\``, 
            embeds: [embed],
            components: [row] 
        });
        
        STATE.addActiveCall({
            address: token.address,
            symbol: token.symbol,
            entryPrice: parseFloat(pair.priceUsd),
            highestPrice: parseFloat(pair.priceUsd),
            highestGain: 0,
            engineName: engine.name,
            milestonesCleared: [],
            channelId: process.env.CHANNEL_ID,
            messageId: msg.id,
            startTime: Date.now(),
            lastUpdate: Date.now()
        });

        Utils.log('SUCCESS', `Sent Call: ${token.name}`);
    } catch (err) {
        Utils.log('ERROR', `Failed to send embed: ${err.message}`);
    }
}

async function sendGainUpdate(callData, currentPrice, pairData, type = 'GAIN') {
    const channel = client.channels.cache.get(callData.channelId);
    if (!channel) return;

    try {
        const originalMsg = await channel.messages.fetch(callData.messageId);
        if (!originalMsg) return;

        const gainPct = ((currentPrice - callData.entryPrice) / callData.entryPrice) * 100;
        const mc = pairData.fdv || pairData.marketCap || 0;

        let embedColor = '#00FF00'; 
        let emoji = '🚀';
        let title = `GAIN UPDATE: +${gainPct.toFixed(0)}%`;

        if (type === 'RUG') {
            embedColor = '#FF0000'; 
            emoji = '🚨';
            title = 'STOP LOSS / RUG ALERT';
        } else if (gainPct > 100) {
            embedColor = '#FFD700'; 
            emoji = '🌕';
        }

        const description = type === 'RUG' 
            ? `**⚠️ CRITICAL DROP**\nDropped >85% or Liq Pulled.\nStopped Tracking.`
            : `**${callData.symbol} +${gainPct.toFixed(0)}%**\nMC: \`${Utils.formatUSD(mc)}\` • Price: \`${Utils.formatPrice(currentPrice)}\``;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${emoji} ${title}`)
            .setDescription(description)
            .setFooter({ text: `Green Chip V6 • ${callData.engineName} • ${Utils.getCurrentTime()}` });

        await originalMsg.reply({ embeds: [embed] });

    } catch (err) {
        Utils.log('ERROR', `Failed to send update: ${err.message}`);
    }
}

async function postLeaderboard(type) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const title = type === 'DAILY' ? '📅 DAILY TOP PERFORMERS' : '🏆 WEEKLY HALL OF FAME';
    const content = Leaderboard.generateLeaderboard(type);

    const embed = new EmbedBuilder()
        .setColor('#FF00FF')
        .setTitle(title)
        .setDescription(content)
        .setFooter({ text: `Leaderboard updated ${Utils.getCurrentTime()}` });

    await channel.send({ embeds: [embed] });
}

// ==================================================================================
//  🔄  CORE LOOPS (V4 SPEED + V5 LOGIC)
// ==================================================================================

// 1. Scanner Loop
async function runScanner() {
    try {
        STATE.stats.apiRequests++;
        const res = await axios.get(CONFIG.URLS.DEX_API, {
            timeout: 8000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        const pairs = res.data?.pairs || [];

        // 🟢 HEARTBEAT LOG
        Utils.log('INFO', `Scanning ${pairs.length} pairs (Hybrid Mode)...`);

        for (const pair of pairs) {
            const check = CoinAnalyzer.validate(pair);
            
            if (check.valid) {
                STATE.addProcessed(pair.baseToken.address);
                await sendCallAlert(pair, check.metrics, check.engine);
                await Utils.sleep(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
            }
        }
        setTimeout(runScanner, CONFIG.SYSTEM.SCAN_INTERVAL_MS);

    } catch (err) {
        if (err.response && err.response.status === 429) {
            Utils.log('WARN', `⛔ RATE LIMITED (429). Retrying in 15s...`);
            setTimeout(runScanner, CONFIG.SYSTEM.RETRY_TIMEOUT_MS); 
            return;
        }
        Utils.log('WARN', `Scanner API Error: ${err.message}`);
        setTimeout(runScanner, 20000);
    }
}

// 2. Tracker Loop
async function runTracker() {
    if (STATE.activeCalls.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_INTERVAL_MS);
        return;
    }

    for (const [address, data] of STATE.activeCalls) {
        try {
            if (Date.now() - data.startTime > (CONFIG.TRACKING.MAX_TRACK_DURATION_HR * 3600000)) {
                STATE.removeActiveCall(address);
                continue;
            }

            const res = await axios.get(`${CONFIG.URLS.TOKEN_API}${address}`, { 
                timeout: 3000,
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
            });
            const pair = res.data?.pairs?.[0]; 

            if (!pair) continue;

            const currentPrice = parseFloat(pair.priceUsd);
            const liq = pair.liquidity?.usd || 0;

            if (currentPrice < (data.entryPrice * (1 - CONFIG.TRACKING.STOP_LOSS_DROP)) || liq < CONFIG.TRACKING.RUG_LIQ_THRESHOLD) {
                await sendGainUpdate(data, currentPrice, pair, 'RUG');
                STATE.removeActiveCall(address);
                STATE.stats.ruggedDetected++;
                continue;
            }

            const gain = ((currentPrice - data.entryPrice) / data.entryPrice) * 100;
            
            Leaderboard.updateGain(address, gain);
            if (gain > data.highestGain) data.highestGain = gain;

            const crossedMilestones = CONFIG.TRACKING.GAIN_MILESTONES.filter(m => 
                gain >= m && !data.milestonesCleared.includes(m)
            );

            if (crossedMilestones.length > 0) {
                await sendGainUpdate(data, currentPrice, pair, 'GAIN');
                crossedMilestones.forEach(m => data.milestonesCleared.push(m));
            }

        } catch (err) {
             if (err.response && err.response.status === 429) {
                break; 
            }
        }
        await Utils.sleep(500); 
    }

    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_INTERVAL_MS);
}

// ==================================================================================
//  ⏰  CRON SCHEDULER
// ==================================================================================

cron.schedule('0 0 * * *', () => {
    Utils.log('SYSTEM', 'Running Daily Leaderboard Task');
    postLeaderboard('DAILY');
    Leaderboard.resetDaily();
}, { timezone: CONFIG.TIMEZONE });

cron.schedule('0 0 * * 0', () => {
    Utils.log('SYSTEM', 'Running Weekly Leaderboard Task');
    postLeaderboard('WEEKLY');
    Leaderboard.resetWeekly();
}, { timezone: CONFIG.TIMEZONE });

// ==================================================================================
//  💬  HANDLERS
// ==================================================================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;
    if (interaction.customId.startsWith('copy_ca_')) {
        const ca = interaction.customId.split('_')[2];
        await interaction.reply({ content: `Here is the CA for easy copying:\n\`${ca}\``, ephemeral: true });
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    if (message.content === '!test') {
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🟢 GREEN CHIP V6 - HYBRID MODE ONLINE')
            .setDescription(`Timezone: ${CONFIG.TIMEZONE} | Time: ${Utils.getCurrentTime()}`)
            .addFields(
                { name: '⏱️ Uptime', value: Utils.getAge(STATE.stats.startTime), inline: true },
                { name: '📡 Active Tracks', value: `${STATE.activeCalls.size}`, inline: true },
                { name: '🎯 Calls Today', value: `${STATE.stats.callsToday}`, inline: true }
            );
        await message.reply({ embeds: [embed] });
    }
});

// ==================================================================================
//  🚀  INIT
// ==================================================================================

client.once('ready', () => {
    Utils.log('SUCCESS', `Logged in as ${client.user.tag}`);
    Utils.log('INFO', `Green Chip V6 Hybrid Logic Loaded.`);
    
    client.user.setPresence({
        activities: [{ name: 'Solana Chain 24/7', type: ActivityType.Watching }],
        status: 'online', 
    });

    runScanner();
    runTracker();
});

if (!process.env.DISCORD_TOKEN || !process.env.CHANNEL_ID) {
    Utils.log('ERROR', 'Missing ENV variables.');
    process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);

process.on('unhandledRejection', (reason) => {
    Utils.log('ERROR', `Unhandled Rejection: ${reason}`);
});

process.on('uncaughtException', (err) => {
    Utils.log('ERROR', `Uncaught Exception: ${err.message}`);
});
