// ==================================================================================
//  🟢 GREEN CHIP V4.5 ULTRA - PRODUCTION GRADE SOLANA TRACKER
//  Features: Live Tracking | Dip Recovery Analysis | Leaderboards | EST Timezone
//  Author: Gemini (AI) for GreenChip
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials } = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone');
const fs = require('fs');

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    // --- Identification ---
    BOT_NAME: "Green Chip V4.5",
    VERSION: "4.5.0-ULTRA",
    TIMEZONE: "America/New_York", // United States Timezone
    
    // --- Discovery Filters ---
    FILTERS: {
        MIN_MCAP: 20000,        
        MAX_MCAP: 55000,        
        MIN_LIQUIDITY: 1500,    
        MIN_VOLUME_H1: 500,     
        MIN_AGE_MINUTES: 1,     
        MAX_AGE_MINUTES: 60,    
        MAX_PRICE_USD: 1.0,     
        REQUIRE_SOCIALS: true,  
        MAX_SYM_LENGTH: 15,     
        MIN_HYPE_SCORE: 10      
    },

    // --- Tracking & Gains ---
    TRACKING: {
        GAIN_TRIGGER_START: 30,       // Start alerting early
        GAIN_STEP_MULTIPLIER: 1.5,    // Multiplier for standard steps
        HARD_STOP_LOSS_PERCENT: 0.85, // 85% Drop from ATH = STOP
        RUG_LIQ_THRESHOLD: 300,       // $300 Liq = Rug
        MAX_TRACK_DURATION_HR: 48     // Track for 2 days maximum
    },

    // --- System Intervals ---
    SYSTEM: {
        SCAN_INTERVAL_MS: 12000,    
        TRACK_INTERVAL_MS: 5000,     // Faster tracking updates
        LEADERBOARD_CHECK_MS: 60000, // Check for reset every minute
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
    
    // US Timezone Date
    getNow: () => moment().tz(CONFIG.TIMEZONE),

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

    log: (type, message) => {
        const time = Utils.getNow().format('HH:mm:ss');
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', LEADERBOARD: '🏆' };
        console.log(`[${time}] ${icons[type] || ''} ${type}: ${message}`);
    }
};

// ==================================================================================
//  🏆  LEADERBOARD SYSTEM (PERSISTENT)
// ==================================================================================

const DB_FILE = './leaderboard.json';

class LeaderboardManager {
    constructor() {
        this.data = {
            daily: [],
            weekly: [],
            lastResetDaily: Utils.getNow().format('YYYY-MM-DD'),
            lastResetWeekly: Utils.getNow().isoWeek()
        };
        this.load();
    }

    load() {
        if (fs.existsSync(DB_FILE)) {
            try {
                this.data = JSON.parse(fs.readFileSync(DB_FILE));
            } catch (e) { Utils.log('ERROR', 'Failed to load leaderboard DB'); }
        }
    }

    save() {
        fs.writeFileSync(DB_FILE, JSON.stringify(this.data, null, 2));
    }

    updateEntry(tokenData, gainPercent) {
        // Prepare entry object
        const entry = {
            symbol: tokenData.symbol,
            address: tokenData.address,
            gain: parseFloat(gainPercent.toFixed(2)),
            time: Utils.getNow().format('HH:mm A')
        };

        // Update Daily
        this.updateList('daily', entry);
        // Update Weekly
        this.updateList('weekly', entry);
        this.save();
    }

    updateList(type, entry) {
        const list = this.data[type];
        const existingIndex = list.findIndex(i => i.address === entry.address);
        
        if (existingIndex > -1) {
            // Only update if gain is higher
            if (entry.gain > list[existingIndex].gain) {
                list[existingIndex] = entry;
            }
        } else {
            list.push(entry);
        }
        
        // Sort by gain desc and keep top 10
        this.data[type] = list.sort((a, b) => b.gain - a.gain).slice(0, 10);
    }

    async checkResets(client) {
        const now = Utils.getNow();
        const todayDate = now.format('YYYY-MM-DD');
        const currentWeek = now.isoWeek();

        // Daily Reset (12:00 AM)
        if (this.data.lastResetDaily !== todayDate) {
            await this.postLeaderboard(client, 'DAILY');
            this.data.daily = []; // Wipe
            this.data.lastResetDaily = todayDate;
            this.save();
            Utils.log('LEADERBOARD', 'Daily Leaderboard Reset');
        }

        // Weekly Reset (Monday 12:00 AM)
        if (this.data.lastResetWeekly !== currentWeek) {
            await this.postLeaderboard(client, 'WEEKLY');
            this.data.weekly = []; // Wipe
            this.data.lastResetWeekly = currentWeek;
            this.save();
            Utils.log('LEADERBOARD', 'Weekly Leaderboard Reset');
        }
    }

    async postLeaderboard(client, type) {
        const channel = client.channels.cache.get(process.env.CHANNEL_ID);
        if (!channel) return;

        const list = this.data[type.toLowerCase()];
        if (list.length === 0) return;

        let desc = list.map((e, i) => 
            `**#${i+1} ${e.symbol}** • +${e.gain}%`
        ).join('\n');

        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle(`🏆 ${type} TOP PERFORMERS`)
            .setDescription(desc || "No huge gains recorded yet.")
            .setFooter({ text: `Reset time: ${Utils.getNow().format('MM/DD HH:mm z')}` });

        await channel.send({ embeds: [embed] });
    }
}

const LEADERBOARD = new LeaderboardManager();

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
            ruggedDetected: 0
        };
    }

    isProcessed(address) { return this.processedHistory.has(address); }

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
    }

    removeActiveCall(address) {
        this.activeCalls.delete(address);
    }
}

const STATE = new StateManager();

// ==================================================================================
//  🌐  SERVER
// ==================================================================================

const app = express();
app.get('/', (req, res) => res.status(200).json({ status: 'OK', calls: STATE.stats.callsToday }));
app.listen(process.env.PORT || 3000);

// ==================================================================================
//  🤖  DISCORD CLIENT
// ==================================================================================

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// ==================================================================================
//  🕵️  COIN ANALYZER
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
        return score;
    }

    static getStatusBadge(pair) {
        const dexId = (pair.dexId || '').toLowerCase();
        if (dexId === 'raydium') return { text: '🎓 RAYDIUM GRADUATED', emoji: '🌟', color: '#00D4FF' }; 
        if (dexId === 'pump') return { text: '🚀 PUMP.FUN LIVE', emoji: '💊', color: '#14F195' }; 
        return { text: '⚡ DEX LISTED', emoji: '⚡', color: '#FFFFFF' };
    }

    static validate(pair) {
        if (!pair?.baseToken?.address || !pair?.priceUsd) return { valid: false };
        if (pair.chainId !== 'solana') return { valid: false };
        if (STATE.isProcessed(pair.baseToken.address)) return { valid: false };

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
        if (pair.baseToken.symbol.length > CONFIG.FILTERS.MAX_SYM_LENGTH) return { valid: false };

        const hype = this.calculateHypeScore(pair);
        if (hype < CONFIG.FILTERS.MIN_HYPE_SCORE) return { valid: false };

        return { valid: true, metrics: { hype, ageMins, fdv, liq, vol } };
    }
}

// ==================================================================================
//  📢  MESSAGE BUILDER (CLEANER & WITH COPY BUTTON)
// ==================================================================================

async function sendCallAlert(pair, metrics) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const token = pair.baseToken;
    const status = CoinAnalyzer.getStatusBadge(pair);
    const socials = pair.info?.socials || [];
    
    // Condensed Socials
    const linkMap = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' | ');

    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    const photonLink = `https://photon-sol.tinyastro.io/en/lp/${pair.pairAddress}`;
    const bullxLink = `https://bullx.io/terminal?chainId=1399811149&address=${token.address}`;
    
    // CA BUTTON (Using Code Block)
    const caBlock = `\`${token.address}\``;

    const embed = new EmbedBuilder()
        .setColor(status.color)
        .setTitle(`${status.emoji} NEW: ${token.name} ($${token.symbol})`)
        .setURL(dexLink)
        .setDescription(`
${status.text}
${linkMap}

**MC:** \`${Utils.formatUSD(metrics.fdv)}\` • **Liq:** \`${Utils.formatUSD(metrics.liq)}\`
**Vol:** \`${Utils.formatUSD(metrics.vol)}\` • **Age:** \`${metrics.ageMins.toFixed(0)}m\`
**Score:** \`${metrics.hype}/100\`

**CA (Copy):**
${caBlock}

[**GMGN**](${CONFIG.URLS.REFERRAL}) • [**Photon**](${photonLink}) • [**BullX**](${bullxLink})
`)
        .setThumbnail(pair.info?.imageUrl || 'https://cdn.discordapp.com/embed/avatars/0.png')
        .setFooter({ text: `Green Chip Ultra • ${Utils.getNow().format('hh:mm A z')}` });

    try {
        const msg = await channel.send({ embeds: [embed] });
        
        STATE.addActiveCall({
            address: token.address,
            symbol: token.symbol,
            entryPrice: parseFloat(pair.priceUsd),
            entryMc: metrics.fdv,
            
            // TRACKING HIGHS & LOWS
            athPrice: parseFloat(pair.priceUsd), // All Time High Price
            athMc: metrics.fdv,                  // All Time High MC
            
            // Dip Tracking
            isDipping: false,
            dipLowMc: metrics.fdv,

            lastAlertGain: 0,
            channelId: process.env.CHANNEL_ID,
            messageId: msg.id,
            startTime: Date.now()
        });
    } catch (err) { Utils.log('ERROR', err.message); }
}

async function sendUpdate(callData, currentPrice, pairData, type, customMsg = null) {
    const channel = client.channels.cache.get(callData.channelId);
    if (!channel) return;

    try {
        const originalMsg = await channel.messages.fetch(callData.messageId);
        if (!originalMsg) return;

        const gainPct = ((currentPrice - callData.entryPrice) / callData.entryPrice) * 100;
        const curMc = pairData.fdv || pairData.marketCap || 0;

        let embedColor = '#00FF00'; 
        let title = '';
        let description = '';

        if (type === 'RUG' || type === 'STOP_LOSS') {
            embedColor = '#FF0000';
            title = type === 'RUG' ? '🚨 RUG PULLED' : '🛑 STOP LOSS TRIGGERED';
            description = `**${callData.symbol} Stopped.**\n${customMsg || 'Dropped below safety limits.'}`;
        } 
        else if (type === 'RECOVERY') {
            // "Goes down for a mean time and goes back up"
            embedColor = '#00FFFF'; // Cyan for recovery
            title = `📈 MEGA RECOVERY: +${gainPct.toFixed(0)}%`;
            description = `${customMsg}\nCurrent: \`${Utils.formatUSD(curMc)}\``;
        }
        else {
            // Standard "Goes Up"
            if (gainPct > 100) embedColor = '#FFD700';
            if (gainPct > 500) embedColor = '#FF00FF';
            title = `🚀 GOES UP: ${gainPct.toFixed(0)}% gained`;
            description = `**${callData.symbol} is mooning!**\nMC: \`${Utils.formatUSD(curMc)}\`\nPrice: \`${Utils.formatPrice(currentPrice)}\``;
        }

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle(title)
            .setDescription(description)
            .setTimestamp();

        await originalMsg.reply({ embeds: [embed] });

    } catch (err) { Utils.log('ERROR', err.message); }
}

// ==================================================================================
//  🔄  CORE LOOPS (SCANNER & INTELLIGENT TRACKER)
// ==================================================================================

async function runScanner() {
    try {
        const res = await axios.get(CONFIG.URLS.DEX_API, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
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
    } catch (err) { 
        if (err.response?.status === 429) await Utils.sleep(60000);
    }
    setTimeout(runScanner, CONFIG.SYSTEM.SCAN_INTERVAL_MS);
}

// INTELLIGENT TRACKER (Fixed Logic)
async function runTracker() {
    // Check Leaderboard Reset (12AM)
    await LEADERBOARD.checkResets(client);

    if (STATE.activeCalls.size === 0) {
        setTimeout(runTracker, CONFIG.SYSTEM.TRACK_INTERVAL_MS);
        return;
    }

    for (const [address, data] of STATE.activeCalls) {
        try {
            // Time Limit Check
            if (Date.now() - data.startTime > (CONFIG.TRACKING.MAX_TRACK_DURATION_HR * 3600000)) {
                STATE.removeActiveCall(address);
                continue;
            }

            const res = await axios.get(`${CONFIG.URLS.TOKEN_API}${address}`, { 
                headers: { 'User-Agent': 'Mozilla/5.0' } 
            });
            const pair = res.data?.pairs?.[0];
            if (!pair) continue;

            const curPrice = parseFloat(pair.priceUsd);
            const curMc = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const gain = ((curPrice - data.entryPrice) / data.entryPrice) * 100;

            // 1. UPDATE ATH (All Time High)
            if (curPrice > data.athPrice) {
                data.athPrice = curPrice;
                data.athMc = curMc;
                data.isDipping = false; // We are at new highs, not dipping
            }

            // 2. CHECK RUG
            if (liq < CONFIG.TRACKING.RUG_LIQ_THRESHOLD) {
                await sendUpdate(data, curPrice, pair, 'RUG');
                STATE.removeActiveCall(address);
                continue;
            }

            // 3. CHECK STOP LOSS (85% DROP FROM ATH)
            // "Then when it went down to 85% negative... its time to stop"
            const dropFromAth = (data.athPrice - curPrice) / data.athPrice;
            if (dropFromAth >= CONFIG.TRACKING.HARD_STOP_LOSS_PERCENT) {
                await sendUpdate(data, curPrice, pair, 'STOP_LOSS', `Dropped 85% from ATH (${Utils.formatUSD(data.athMc)})`);
                STATE.removeActiveCall(address);
                continue;
            }

            // 4. DIP DETECTION
            // If we are significantly below ATH, we are dipping. Track the bottom of the dip.
            if (dropFromAth > 0.30) { // 30% down from ATH considered a "dip"
                data.isDipping = true;
                if (!data.dipLowMc || curMc < data.dipLowMc) {
                    data.dipLowMc = curMc; // Track the lowest point of this dip
                }
            }

            // 5. GAIN ALERTS LOGIC
            // A. RECOVERY PUMP (The "3588% from X to Y" logic)
            // If it was dipping, and now it broke the old ATH (or is very close), trigger recovery msg
            if (data.isDipping && curPrice >= data.athPrice) {
                 await sendUpdate(data, curPrice, pair, 'RECOVERY', 
                    `**${gain.toFixed(0)}% gained** from ${Utils.formatUSD(data.dipLowMc)} market cap to ${Utils.formatUSD(curMc)} market cap`
                );
                data.isDipping = false; // Reset dip status
                data.dipLowMc = null;
                data.lastAlertGain = gain; // Prevent double alerts
                LEADERBOARD.updateEntry(data, gain);
            }
            
            // B. STANDARD GOES UP (Only if hitting new highs)
            // "Don't skip until it goes to the highest"
            else if (gain > data.lastAlertGain + 20) { // Minimum 20% step to avoid spam
                // Only alert if we are near ATH (not bouncing around bottom)
                if (curPrice >= data.athPrice * 0.95) {
                    await sendUpdate(data, curPrice, pair, 'GAIN');
                    data.lastAlertGain = gain;
                    LEADERBOARD.updateEntry(data, gain);
                }
            }

        } catch (err) {
            // Silent error handling for API glitches
        }
        await Utils.sleep(200); // Fast pacing
    }

    setTimeout(runTracker, CONFIG.SYSTEM.TRACK_INTERVAL_MS);
}

// ==================================================================================
//  🚀  INITIALIZATION
// ==================================================================================

client.once('ready', () => {
    Utils.log('SUCCESS', `System Online. Timezone: ${CONFIG.TIMEZONE}`);
    runScanner();
    runTracker();
});

if (!process.env.DISCORD_TOKEN) { process.exit(1); }
client.login(process.env.DISCORD_TOKEN);
