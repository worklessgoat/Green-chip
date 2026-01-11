// ==================================================================================
//  🟢 GREEN CHIP V4 ULTRA - PRODUCTION GRADE SOLANA TRACKER
//  Target: 1m-1h Age | $10k-$90k MC | High Vol | Anti-Rug | Social Hype Analysis
//  Author: Gemini (AI) for GreenChip
//  Updated: Widened MC ($10k-90k), Increased Volume Req, Green Online Status
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
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    // --- Identification ---
    BOT_NAME: "Green Chip V4",
    VERSION: "4.1.0-STABLE",
    TIMEZONE: "America/New_York", 
    
    // --- Discovery Filters ---
    FILTERS: {
        MIN_MCAP: 10000,        // Lowered to $10k
        MAX_MCAP: 90000,        // Raised to $90k
        MIN_LIQUIDITY: 1500,    
        MIN_VOLUME_H1: 1500,    // Increased to $1,500 (High Volume Bot)
        MIN_AGE_MINUTES: 1,     
        MAX_AGE_MINUTES: 60,    
        MAX_PRICE_USD: 1.0,     
        REQUIRE_SOCIALS: true,  
        MAX_SYM_LENGTH: 15,     
        MIN_HYPE_SCORE: 10      
    },

    // --- Tracking & Gains ---
    TRACKING: {
        GAIN_MILESTONES: [50, 100, 200, 300, 400, 500, 1000, 2000, 5000, 10000], 
        STOP_LOSS_DROP: 0.90,        
        RUG_LIQ_THRESHOLD: 300,      
        MAX_TRACK_DURATION_HR: 24    
    },

    // --- System Intervals ---
    SYSTEM: {
        SCAN_INTERVAL_MS: 12000,     
        TRACK_INTERVAL_MS: 15000,    
        CACHE_CLEANUP_MS: 3600000,   
        RATE_LIMIT_DELAY: 2000       
    },

    // --- Links ---
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
        if (this.processedHistory.size > 5000) {
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
            timestamp: Date.now()
        };
        this.dailyCalls.push(entry);
        this.weeklyCalls.push(entry);
    }

    updateGain(address, gain) {
        // Update Daily
        const dailyItem = this.dailyCalls.find(i => i.address === address);
        if (dailyItem && gain > dailyItem.highestGain) dailyItem.highestGain = gain;

        // Update Weekly
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
        tracking: STATE.activeCalls.size,
        history_size: STATE.processedHistory.size,
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
//  🕵️  COIN ANALYZER ENGINE
// ==================================================================================

class CoinAnalyzer {
    
    static calculateHypeScore(pair) {
        let score = 0;
        const vol = pair.volume?.h1 || 0;
        const liq = pair.liquidity?.usd || 1;
        
        const ratio = vol / liq;
        if (ratio > 0.5) score += 10;
        if (ratio > 1.0) score += 20;
        if (ratio > 5.0) score += 40; 

        const socials = pair.info?.socials || [];
        score += (socials.length * 15); 
        
        const hasWeb = socials.find(s => s.type === 'website');
        if (hasWeb) score += 10;

        return score;
    }

    static getStatusBadge(pair) {
        const dexId = (pair.dexId || '').toLowerCase();
        if (dexId === 'raydium') return { text: '🎓 RAYDIUM GRADUATED', emoji: '🌟', color: '#00D4FF' }; 
        if (dexId === 'pump') return { text: '🚀 PUMP.FUN LIVE', emoji: '💊', color: '#14F195' }; 
        return { text: '⚡ DEX LISTED', emoji: '⚡', color: '#FFFFFF' };
    }

    static validate(pair) {
        if (!pair?.baseToken?.address || !pair?.priceUsd) return { valid: false, reason: 'Incomplete Data' };
        if (pair.chainId !== 'solana') return { valid: false, reason: 'Not Solana' };
        if (STATE.isProcessed(pair.baseToken.address)) return { valid: false, reason: 'Already Seen' };

        const fdv = pair.fdv || pair.marketCap || 0;
        if (fdv < CONFIG.FILTERS.MIN_MCAP) return { valid: false, reason: 'MC Low' };
        if (fdv > CONFIG.FILTERS.MAX_MCAP) return { valid: false, reason: 'MC High' };

        const createdAt = pair.pairCreatedAt; 
        if (!createdAt) return { valid: false, reason: 'Unknown Age' };
        const ageMins = (Date.now() - createdAt) / 60000;
        if (ageMins < CONFIG.FILTERS.MIN_AGE_MINUTES) return { valid: false, reason: 'Too New' };
        if (ageMins > CONFIG.FILTERS.MAX_AGE_MINUTES) return { valid: false, reason: 'Too Old' };

        const liq = pair.liquidity?.usd || 0;
        const vol = pair.volume?.h1 || 0;
        if (liq < CONFIG.FILTERS.MIN_LIQUIDITY) return { valid: false, reason: 'Low Liq' };
        if (vol < CONFIG.FILTERS.MIN_VOLUME_H1) return { valid: false, reason: 'Dead Volume' };

        const socials = pair.info?.socials || [];
        if (CONFIG.FILTERS.REQUIRE_SOCIALS && socials.length === 0) return { valid: false, reason: 'No Socials' };

        if (pair.baseToken.symbol.length > CONFIG.FILTERS.MAX_SYM_LENGTH) return { valid: false, reason: 'Spam Symbol' };

        const hype = this.calculateHypeScore(pair);
        if (hype < CONFIG.FILTERS.MIN_HYPE_SCORE) return { valid: false, reason: 'Low Hype Score' };

        return { 
            valid: true, 
            metrics: { hype, ageMins, fdv, liq, vol } 
        };
    }
}

// ==================================================================================
//  📢  MESSAGE BUILDER
// ==================================================================================

async function sendCallAlert(pair, metrics) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return Utils.log('ERROR', 'Channel not found');

    const token = pair.baseToken;
    const status = CoinAnalyzer.getStatusBadge(pair);
    const socials = pair.info?.socials || [];
    
    const linkMap = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ');
    const socialText = linkMap.length > 0 ? linkMap : "⚠️ *No social links*";

    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    
    const embed = new EmbedBuilder()
        .setColor(status.color)
        .setTitle(`${status.emoji} ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`**${status.text}** | ${socialText}\n
**Metrics:** \`$${Utils.formatUSD(metrics.fdv)} MC\` • \`$${Utils.formatUSD(metrics.liq)} Liq\` • \`$${Utils.formatUSD(metrics.vol)} Vol\`
**Price:** \`${Utils.formatPrice(parseFloat(pair.priceUsd))}\` • **Age:** ${Utils.getAge(pair.pairCreatedAt)}
**Hype:** \`${metrics.hype}/100\` ${metrics.hype > 30 ? "🔥" : ""}

[**📈 DexScreener**](${dexLink}) • [**⚡ Photon**](${photonLink}) • [**🛒 GMGN**](${CONFIG.URLS.REFERRAL})
`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip V4 • ${Utils.getCurrentTime()}`, iconURL: client.user.displayAvatarURL() });

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
            ? `**⚠️ CRITICAL DROP**\nDropped >90% or Liq Pulled.\nStopped Tracking.`
            : `**${callData.symbol} +${gainPct.toFixed(0)}%**\nMC: \`${Utils.formatUSD(mc)}\` • Price: \`${Utils.formatPrice(currentPrice)}\``;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(`${emoji} ${title}`)
            .setDescription(description)
            .setFooter({ text: `Green Chip V4 • ${Utils.getCurrentTime()}` });

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
//  🔄  CORE LOOPS
// ==================================================================================

// 1. Scanner Loop
async function runScanner() {
    try {
        STATE.stats.apiRequests++;
        const res = await axios.get(CONFIG.URLS.DEX_API, {
            timeout: 5000,
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Accept': 'application/json'
            }
        });

        const pairs = res.data?.pairs || [];

        for (const pair of pairs) {
            const check = CoinAnalyzer.validate(pair);
            if (check.valid) {
                STATE.addProcessed(pair.baseToken.address);
                await sendCallAlert(pair, check.metrics);
                await Utils.sleep(CONFIG.SYSTEM.RATE_LIMIT_DELAY);
            }
        }
        setTimeout(runScanner, CONFIG.SYSTEM.SCAN_INTERVAL_MS);

    } catch (err) {
        if (err.response && err.response.status === 429) {
            Utils.log('WARN', `⛔ RATE LIMITED (429). Retrying in 5s...`);
            setTimeout(runScanner, 5000); 
            return;
        }
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

            // RUG CHECK
            if (currentPrice < (data.entryPrice * (1 - CONFIG.TRACKING.STOP_LOSS_DROP)) || liq < CONFIG.TRACKING.RUG_LIQ_THRESHOLD) {
                await sendGainUpdate(data, currentPrice, pair, 'RUG');
                STATE.removeActiveCall(address);
                STATE.stats.ruggedDetected++;
                continue;
            }

            // GAIN CHECK
            const gain = ((currentPrice - data.entryPrice) / data.entryPrice) * 100;
            
            Leaderboard.updateGain(address, gain);

            if (gain > data.highestGain) data.highestGain = gain;

            // Check Milestones
            for (const milestone of CONFIG.TRACKING.GAIN_MILESTONES) {
                if (gain >= milestone && !data.milestonesCleared.includes(milestone)) {
                    await sendGainUpdate(data, currentPrice, pair, 'GAIN');
                    
                    CONFIG.TRACKING.GAIN_MILESTONES.forEach(m => {
                        if (m <= milestone && !data.milestonesCleared.includes(m)) {
                            data.milestonesCleared.push(m);
                        }
                    });
                    break; 
                }
            }

        } catch (err) {
             if (err.response && err.response.status === 429) {
                Utils.log('WARN', 'Tracker Rate Limited - Skipping cycle');
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

// Daily
cron.schedule('0 0 * * *', () => {
    Utils.log('SYSTEM', 'Running Daily Leaderboard Task');
    postLeaderboard('DAILY');
    Leaderboard.resetDaily();
}, { timezone: CONFIG.TIMEZONE });

// Weekly
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
            .setTitle('🟢 GREEN CHIP V4 - SYSTEM ONLINE')
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
    Utils.log('INFO', `Timezone set to: ${CONFIG.TIMEZONE}`);
    
    // VISUAL FIX: Set to 'online' (Green) instead of 'dnd' (Red)
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
