// ==================================================================================
//  🟢 GREEN CHIP V5 ULTRA - MULTI-ENGINE SOLANA TRACKER
//  Engines: PumpFun | Axiom Pulse | Sniper Watch | Standard Safe
//  Author: Gemini (AI) for GreenChip
//  Updated: SAFE MODE (Slower intervals to fix 429 Bans)
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
//  ⚙️  GLOBAL CONFIGURATION
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V5",
    VERSION: "5.0.3-SAFE-MODE",
    TIMEZONE: "America/New_York", 
    
    // --- Master Limits ---
    GLOBAL_LIMITS: {
        MAX_MCAP: 90000,        
        MIN_LIQUIDITY: 1000,    
        MAX_AGE_MINUTES: 60     
    },

    // --- Tracking Strategy ---
    TRACKING: {
        GAIN_MILESTONES: [50, 100, 200, 300, 400, 500, 1000, 2000, 5000, 10000], 
        STOP_LOSS_DROP: 0.85,        
        RUG_LIQ_THRESHOLD: 200,      
        MAX_TRACK_DURATION_HR: 24    
    },

    // --- System Intervals (SLOWED DOWN FOR SAFETY) ---
    SYSTEM: {
        SCAN_INTERVAL_MS: 30000,     // 30s (Slower to clear ban)
        TRACK_INTERVAL_MS: 20000,    // 20s (Slower to clear ban)
        RATE_LIMIT_DELAY: 2000,      
        RETRY_TIMEOUT_MS: 60000      
    },

    URLS: {
        REFERRAL: "https://gmgn.ai/r/Greenchip",
        DEX_API: "https://api.dexscreener.com/latest/dex/search?q=solana",
        TOKEN_API: "https://api.dexscreener.com/latest/dex/tokens/"
    }
};

// ==================================================================================
//  🔥  SCAN ENGINE CONFIGURATIONS
// ==================================================================================

const ENGINES = {
    // 1. THE PUMPFUN DEGEN
    PUMP_TURBO: {
        id: 'PUMP_TURBO',
        name: '💊 PumpFun Turbo',
        emoji: '💊',
        color: '#14F195', 
        filter: (pair) => {
            if (pair.dexId !== 'pump') return false;
            if (pair.marketCap > 90000) return false;
            if (pair.volume?.h1 < 1000) return false; 
            return true;
        }
    },

    // 2. AXIOM PULSE / GRADUATING
    AXIOM_PULSE: {
        id: 'AXIOM_PULSE',
        name: '⚡ Axiom/Pulse Trend',
        emoji: '⚡',
        color: '#00D4FF', 
        filter: (pair) => {
            const socials = pair.info?.socials || [];
            if (socials.length === 0) return false; 
            if (pair.volume?.h1 < 2000) return false; 
            const hype = CoinAnalyzer.calculateHypeScore(pair);
            return hype > 30; 
        }
    },

    // 3. SNIPER WATCH
    SNIPER_WATCH: {
        id: 'SNIPER_WATCH',
        name: '🎯 Sniper Watch',
        emoji: '🎯',
        color: '#FF0000', 
        filter: (pair) => {
            const ageMins = Utils.getAgeNumber(pair.pairCreatedAt);
            if (ageMins > 10) return false; 
            if (pair.volume?.h1 < 3000) return false; 
            return true;
        }
    },

    // 4. STANDARD SAFE
    STANDARD: {
        id: 'STANDARD',
        name: '🟢 Standard High Vol',
        emoji: '🟢',
        color: '#FFFFFF', 
        filter: (pair) => {
            if (pair.marketCap < 10000 || pair.marketCap > 90000) return false;
            if (pair.volume?.h1 < 1000) return false;
            if (pair.liquidity?.usd < 1000) return false;
            return true;
        }
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

    getAgeNumber: (timestamp) => {
        return (Date.now() - timestamp) / 60000;
    },

    getAgeString: (timestamp) => {
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
            engine: callData.engineName,
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
            
            description += `${medal} **$${item.symbol}** (${item.engine}) • +${item.highestGain.toFixed(0)}%\n`;
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
        uptime: Utils.getAgeString(STATE.stats.startTime),
        active_tracks: STATE.activeCalls.size,
        history_db: STATE.processedHistory.size,
        calls_today: STATE.stats.callsToday,
        engine_status: 'ALL ENGINES ONLINE'
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
//  🛡️  ADVANCED ANTI-RUG & ANALYZER (V2)
// ==================================================================================

class CoinAnalyzer {
    
    // Updated Hype Algorithm
    static calculateHypeScore(pair) {
        let score = 0;
        const vol = pair.volume?.h1 || 0;
        const liq = pair.liquidity?.usd || 1;
        
        const ratio = vol / liq;
        if (ratio > 0.5) score += 10;
        if (ratio > 2.0) score += 20; 
        
        const socials = pair.info?.socials || [];
        score += (socials.length * 20); 
        
        const hasWeb = socials.find(s => s.type === 'website');
        if (hasWeb) score += 15;

        if (pair.info?.imageUrl) score += 10;

        return score;
    }

    // New Anti-Rug Checks
    static securityCheck(pair) {
        const liq = pair.liquidity?.usd || 0;
        const mc = pair.fdv || pair.marketCap || 0;
        
        if (liq < CONFIG.GLOBAL_LIMITS.MIN_LIQUIDITY) return { safe: false, reason: 'No Liquidity' };
        
        if (mc > 20000 && liq < 500) return { safe: false, reason: 'Liquidity Mismatch (Honey Pot Risk)' };

        if (parseFloat(pair.priceUsd) > 1.5) return { safe: false, reason: 'Suspicious Price Peg' };

        return { safe: true };
    }

    static determineEngines(pair) {
        let matches = [];

        if (STATE.isProcessed(pair.baseToken.address)) return [];
        if (pair.chainId !== 'solana') return [];

        const secCheck = this.securityCheck(pair);
        if (!secCheck.safe) return [];

        if (ENGINES.PUMP_TURBO.filter(pair)) matches.push(ENGINES.PUMP_TURBO);
        else if (ENGINES.AXIOM_PULSE.filter(pair)) matches.push(ENGINES.AXIOM_PULSE);
        else if (ENGINES.SNIPER_WATCH.filter(pair)) matches.push(ENGINES.SNIPER_WATCH);
        else if (ENGINES.STANDARD.filter(pair)) matches.push(ENGINES.STANDARD);

        return matches;
    }
}

// ==================================================================================
//  📢  MESSAGE BUILDER
// ==================================================================================

async function sendCallAlert(pair, engine) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return Utils.log('ERROR', 'Channel not found');

    const token = pair.baseToken;
    const socials = pair.info?.socials || [];
    const linkMap = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ');
    const socialText = linkMap.length > 0 ? linkMap : "⚠️ *No social links*";

    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    
    // Metrics
    const hype = CoinAnalyzer.calculateHypeScore(pair);
    const mc = pair.fdv || pair.marketCap || 0;
    const liq = pair.liquidity?.usd || 0;
    const vol = pair.volume?.h1 || 0;
    const age = Utils.getAgeString(pair.pairCreatedAt);

    const embed = new EmbedBuilder()
        .setColor(engine.color)
        .setTitle(`${engine.emoji} ${engine.name.toUpperCase()}: ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
${socialText}

**Metrics:** \`$${Utils.formatUSD(mc)} MC\` • \`$${Utils.formatUSD(liq)} Liq\`
**Volume:** \`$${Utils.formatUSD(vol)} (1h)\` • **Price:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\`
**Age:** ${age} • **Hype:** \`${hype}/100\`

[**📈 DexScreener**](${dexLink}) • [**⚡ Photon**](${photonLink}) • [**🛒 GMGN**](${CONFIG.URLS.REFERRAL})
`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip V5 • Engine: ${engine.id} • ${Utils.getCurrentTime()}`, iconURL: client.user.displayAvatarURL() });

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

        Utils.log('SUCCESS', `Sent Call [${engine.id}]: ${token.name}`);
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
            .setFooter({ text: `Green Chip V5 • ${callData.engineName} • ${Utils.getCurrentTime()}` });

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
//  🔄  MULTI-ENGINE CORE LOOPS
// ==================================================================================

// 1. Master Scanner
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
        Utils.log('INFO', `Scanning ${pairs.length} pairs across 4 engines...`);

        for (const pair of pairs) {
            const matchedEngines = CoinAnalyzer.determineEngines(pair);

            if (matchedEngines.length > 0) {
                const engine = matchedEngines[0];
                STATE.addProcessed(pair.baseToken.address);
                await sendCallAlert(pair, engine);
                await Utils.sleep(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
            }
        }
        setTimeout(runScanner, CONFIG.SYSTEM.SCAN_INTERVAL_MS);

    } catch (err) {
        if (err.response && err.response.status === 429) {
            Utils.log('WARN', `⛔ RATE LIMITED (429). Cooling down for 60s (Safety Mode)...`);
            setTimeout(runScanner, CONFIG.SYSTEM.RETRY_TIMEOUT_MS); 
            return;
        }
        Utils.log('WARN', `Scanner API Error: ${err.message}`);
        setTimeout(runScanner, 20000);
    }
}

// 2. High-Speed Tracker
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
            .setTitle('🟢 GREEN CHIP V5 - MULTI-ENGINE ONLINE')
            .setDescription(`Timezone: ${CONFIG.TIMEZONE} | Time: ${Utils.getCurrentTime()}`)
            .addFields(
                { name: '⏱️ Uptime', value: Utils.getAgeString(STATE.stats.startTime), inline: true },
                { name: '📡 Active Tracks', value: `${STATE.activeCalls.size}`, inline: true },
                { name: '🎯 Calls Today', value: `${STATE.stats.callsToday}`, inline: true },
                { name: '🚀 Engines', value: 'PumpFun, Axiom, Sniper, Standard', inline: false }
            );
        await message.reply({ embeds: [embed] });
    }
});

// ==================================================================================
//  🚀  INIT
// ==================================================================================

client.once('ready', () => {
    Utils.log('SUCCESS', `Logged in as ${client.user.tag}`);
    Utils.log('INFO', `Green Chip V5 Loaded. Engines: ${Object.keys(ENGINES).length} Active.`);
    
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
