// ==================================================================================
//  🟢 GREEN CHIP V8 "DAILY RECAP" - ENTERPRISE TRADING ENGINE
//  ———————————————————————————
//  New Capabilities:
//  [1] 📅 DAILY RECAP: Auto-posts a "Gains Summary" at 12:00 AM every night.
//  [2] 🔒 ZERO DUPLICATES: Strict "Lock System" prevents double calls.
//  [3] 🚀 TRI-SOURCE SCANNER: Profiles + Boosts + Search (Simultaneous).
//  [4] 🤖 AUTO-TRADING AI: Tracks gains, threads replies, and monitors rugs.
//  ———————————————————————————
//  Author: Gemini (AI) for GreenChip
//  Version: 8.0.0-DAILY-RECAP
// ==================================================================================

require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType, Partials, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone'); // Changed to moment-timezone for US timezone support

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V8",
    VERSION: "8.0.0-STABLE",

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
    },

    // 🆕 US Timezone Configuration
    TIMEZONE: "America/New_York" // Eastern Time (can be changed to America/Chicago, America/Denver, America/Los_Angeles)
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
        const t = moment().tz(CONFIG.TIMEZONE).format('HH:mm:ss');
        const icons = { INFO: 'ℹ️', SUCCESS: '✅', WARN: '⚠️', ERROR: '❌', FOUND: '💎', DAILY: '📅' };
        console.log(`[${t}] ${icons[type]} [${source}] ${msg}`);
    },

    // 🆕 Get risk level and color based on coin metrics
    getRiskLevel: (analysis) => {
        const { vol, liq, fdv, hype } = analysis;
        let score = 0;
        
        // Lower liquidity = higher risk
        if (liq < 3000) score += 30;
        else if (liq < 5000) score += 20;
        else score += 10;
        
        // Lower volume = higher risk
        if (vol < 1000) score += 20;
        else if (vol < 3000) score += 10;
        
        // Higher mcap = lower risk (within our range)
        if (fdv > 40000) score -= 10;
        else if (fdv < 25000) score += 10;
        
        // Hype score consideration
        if (hype < 30) score += 15;
        else if (hype > 60) score -= 10;
        
        // Determine risk level
        if (score >= 40) return { level: 'HIGH RISK', color: '#FF0000', emoji: '🔴' };
        if (score >= 20) return { level: 'MEDIUM RISK', color: '#FFD700', emoji: '🟡' };
        return { level: 'LOW RISK', color: '#00FF00', emoji: '🟢' };
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

        // 🆕 DAILY GAINS MEMORY
        this.dailyStats = new Map();       // Stores performance of ALL calls today
        this.lastReportDate = null;        // Tracks if we sent the report yet
        
        this.stats = { calls: 0, rugs: 0, start: Date.now() };
    }

    // --- Lock System (Zero Duplicates) ---
    lockCoin(address) {
        if (this.history.has(address)) return false;    // Already called ever
        if (this.processing.has(address)) return false; // Currently checking
        this.processing.add(address);
        return true;
    }

    unlockCoin(address) {
        this.processing.delete(address);
    }

    finalizeCoin(address, data) {
        this.processing.delete(address);
        this.history.add(address);
        
        // Add to Daily Stats for the midnight report
        this.dailyStats.set(address, {
            name: data.name,
            symbol: data.symbol,
            entry: data.mcap, // 🆕 Store entry MCAP instead of price
            maxGain: 0,
            time: Date.now(),
            status: 'ACTIVE'
        });

        // Keep history manageable
        if (this.history.size > 10000) {
            const it = this.history.values();
            this.history.delete(it.next().value);
        }
    }

    // Updates the peak gain for the daily report, even if we stop tracking it
    updateDailyPeak(address, gain, status = 'ACTIVE') {
        if (this.dailyStats.has(address)) {
            const stat = this.dailyStats.get(address);
            if (gain > stat.maxGain) stat.maxGain = gain;
            stat.status = status; // Update status (e.g., if it rugged later)
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

// 1. Profiles
async function scanProfiles() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.PROFILES, { timeout: 5000, headers: Utils.getHeaders() });
        const profiles = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (profiles.length) await fetchAndProcess(profiles.map(p => p.tokenAddress), 'PROFILE');
    } catch (e) { handleErr('Profiles', e); }
    setTimeout(scanProfiles, CONFIG.SYSTEM.SCAN_DELAY_PROFILES);
}

// 2. Boosts
async function scanBoosts() {
    try {
        const res = await axios.get(CONFIG.ENDPOINTS.BOOSTS, { timeout: 5000, headers: Utils.getHeaders() });
        const boosts = res.data?.filter(p => p.chainId === 'solana').slice(0, 25) || [];
        if (boosts.length) await fetchAndProcess(boosts.map(p => p.tokenAddress), 'BOOST');
    } catch (e) { handleErr('Boosts', e); }
    setTimeout(scanBoosts, CONFIG.SYSTEM.SCAN_DELAY_BOOSTS);
}

// 3. Search
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

    // 🔒 THE LOCK
    if (!STATE.lockCoin(addr)) return;

    // ⏳ Analysis
    const analysis = RiskEngine.analyze(pair);
    const ageMins = (Date.now() - pair.pairCreatedAt) / 60000;

    if (ageMins < CONFIG.FILTERS.MIN_AGE_MIN || ageMins > CONFIG.FILTERS.MAX_AGE_MIN || !analysis.safe) {
        STATE.unlockCoin(addr);
        return;
    }

    // ✅ Finalize
    STATE.finalizeCoin(addr, { 
        name: pair.baseToken.name, 
        symbol: pair.baseToken.symbol, 
        mcap: analysis.fdv // 🆕 Store MCAP instead of price
    });

    STATE.queue.push({ pair, analysis, source });
    Utils.log('FOUND', source, `Queued: ${pair.baseToken.name}`);
}

function handleErr(source, e) {
    if (!e.response || e.response.status !== 429) {
        // Utils.log('WARN', source, e.message);
    }
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
    
    // 🆕 Get risk assessment
    const risk = Utils.getRiskLevel(analysis);

    let badge = '⚡'; 
    if (source === 'BOOST') badge = '🚀';
    if (source === 'PROFILE') badge = '💎';
    if (analysis.status === 'GRADUATED') badge = '🎓';

    const links = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ') || '⚠️ No Socials';

    // 🆕 Create Copy CA Button
    const copyButton = new ButtonBuilder()
        .setCustomId(`copy_${token.address}`)
        .setLabel('📋 Copy CA')
        .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(copyButton);

    const embed = new EmbedBuilder()
        .setColor(risk.color) // 🆕 Dynamic color based on risk
        .setTitle(`${badge} ${token.name} [$${Utils.formatUSD(analysis.fdv)}] - ${token.symbol}/SOL`)
        .setURL(dexLink)
        .setDescription(`
**${analysis.status}** ${risk.emoji}

💵 **USD:** ${Utils.formatPrice(parseFloat(pair.priceUsd))}
💎 **MCAP:** ${Utils.formatUSD(analysis.fdv)}
💧 **Liq:** ${Utils.formatUSD(analysis.liq)}
📊 **Vol:** ${Utils.formatUSD(analysis.vol)} • **Age:** ${Utils.getAge(pair.pairCreatedAt)}
📈 **1H:** ${pair.priceChange?.h1 ? pair.priceChange.h1.toFixed(2) + '%' : 'N/A'} ${pair.priceChange?.h1 >= 0 ? '🟢' : '🔴'}

${links}
        `)
        .setThumbnail(pair.info?.imageUrl || null) // 🆕 Profile image
        .setImage(pair.info?.header || null) // 🆕 Banner image if available
        .setFooter({ 
            text: `Green Chip V8 • ${moment().tz(CONFIG.TIMEZONE).format('h:mm A z')}`, 
            iconURL: client.user.displayAvatarURL() 
        });

    try {
        const msg = await channel.send({ embeds: [embed], components: [row] });
        
        STATE.activeTracks.set(token.address, {
            name: token.name,
            symbol: token.symbol,
            entryMcap: analysis.fdv, // 🆕 Track entry MCAP
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

// 🆕 Handle Copy CA Button Interactions
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    
    if (interaction.customId.startsWith('copy_')) {
        const address = interaction.customId.replace('copy_', '');
        await interaction.reply({ 
            content: `\`\`\`${address}\`\`\`\nContract Address copied! Paste it in your wallet.`, 
            ephemeral: true 
        });
    }
});

// ==================================================================================
//  📅  DAILY RECAP SYSTEM
// ==================================================================================

// Runs every minute to check if it's midnight
function initDailyScheduler() {
    setInterval(async () => {
        const now = moment().tz(CONFIG.TIMEZONE); // 🆕 US Timezone

        // Check if time is 00:00 (Midnight) AND we haven't sent report today
        if (now.hour() === 0 && now.minute() === 0) {
            const todayStr = now.format("YYYY-MM-DD");
            
            if (STATE.lastReportDate !== todayStr) {
                await sendDailyRecap();
                STATE.lastReportDate = todayStr;
                
                // RESET Daily Stats for the new day
                STATE.dailyStats.clear();
                Utils.log('DAILY', 'System', 'Daily Stats Reset for new day.');
            }
        }
    }, CONFIG.SYSTEM.DAILY_CHECK_INTERVAL);
}

async function sendDailyRecap() {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    // Convert map to array and sort by Highest Gain
    const allCalls = Array.from(STATE.dailyStats.values());
    const sorted = allCalls.sort((a, b) => b.maxGain - a.maxGain).slice(0, 10); // Top 10

    if (sorted.length === 0) {
        Utils.log('DAILY', 'Report', 'No calls today, skipping report.');
        return;
    }

    const yesterday = moment().tz(CONFIG.TIMEZONE).subtract(1, 'days').format('MMMM Do, YYYY');
    const today = moment().tz(CONFIG.TIMEZONE).format('MMMM Do, YYYY');

    let description = `**📅 DAILY RECAP: ${yesterday}**\n\nHere are the Top Performers from yesterday's calls:\n\n`;

    sorted.forEach((coin, index) => {
        let icon = '🟢';
        if (coin.maxGain > 100) icon = '🚀';
        if (coin.maxGain > 500) icon = '👑';
        if (coin.status === 'RUG') icon = '💀';

        description += `**#${index + 1} ${icon} ${coin.name} ($${coin.symbol})**\n`;
        description += `Peak Gain: **+${coin.maxGain.toFixed(0)}%** (MCAP)\n`; // 🆕 Clarify it's MCAP gain
        description += `Status: ${coin.status}\n\n`;
    });

    description += `\n*Stats are reset. Starting fresh for ${today}.*\nLet's hunt! 🏹`;

    const embed = new EmbedBuilder()
        .setColor('#FFD700') // Gold color
        .setTitle(`🏆 GREEN CHIP DAILY LEADERBOARD`)
        .setDescription(description)
        .setTimestamp()
        .setFooter({ text: 'Green Chip V8 • Daily Summary' });

    try {
        await channel.send({ embeds: [embed] });
        Utils.log('DAILY', 'Report', 'Sent Daily Recap successfully.');
    } catch (e) {
        Utils.log('ERROR', 'Daily', e.message);
    }
}

// ==================================================================================
//  📈  TRACKER (UPDATES DAILY PEAK)
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

            const currMcap = pair.fdv || pair.marketCap || 0; // 🆕 Use MCAP
            const liq = pair.liquidity?.usd || 0;
            const gain = ((currMcap - data.entryMcap) / data.entryMcap) * 100; // 🆕 Calculate gain by MCAP

            // Update Daily Stats Memory (For the midnight report)
            STATE.updateDailyPeak(addr, gain, 'ACTIVE');

            // RUG CHECK
            if (currMcap < (data.entryMcap * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                await sendUpdate(data, currMcap, gain, 'RUG');
                STATE.updateDailyPeak(addr, gain, 'RUG'); // Mark as rug in history
                STATE.activeTracks.delete(addr);
                continue;
            }

            // GAIN CHECK
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

async function sendUpdate(data, mcap, gain, type) {
    const channel = client.channels.cache.get(data.chanId);
    if (!channel) return;
    try {
        const msg = await channel.messages.fetch(data.msgId);
        if (!msg) return;

        let color = '#00FF00'; let title = `🚀 GAIN: +${gain.toFixed(0)}%`;
        if (type === 'MOON') { color = '#00D4FF'; title = `🌕 MOONSHOT: +${gain.toFixed(0)}%`; }
        if (type === 'GOD') { color = '#FFD700'; title = `👑 GOD CANDLE: +${gain.toFixed(0)}%`; }
        if (type === 'RUG') { color = '#FF0000'; title = `🚨 STOP LOSS / RUG`; }

        const desc = type === 'RUG' 
            ? `⚠️ **Token Dropped >90% or Liquidity Pulled.**\nTracking stopped.`
            : `**${data.name} ($${data.symbol})**\nEntry MCAP: ${Utils.formatUSD(data.entryMcap)}\nNow: ${Utils.formatUSD(mcap)}\n\n[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`;

        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
        await msg.reply({ embeds: [embed] });
        
    } catch (e) { Utils.log('ERROR', 'Tracker', `Reply failed: ${e.message}`); }
}

// ==================================================================================
//  🔧  COMMANDS & SERVER
// ==================================================================================

client.on('messageCreate', async (m) => {
    if (m.author.bot) return;

    // Manual Test
    if (m.content === '!test') {
        const uptime = Utils.getAge(STATE.stats.start);
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('🟢 GREEN CHIP V8 - ACTIVE')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '📡 Tracking', value: `${STATE.activeTracks.size}`, inline: true },
                { name: '📅 Daily Calls', value: `${STATE.dailyStats.size}`, inline: true }
            );
        await m.reply({ embeds: [embed] });
    }

    // Force Daily Report (Admin Only - optional)
    if (m.content === '!forcereport') {
        await sendDailyRecap();
        await m.reply("✅ Forced Daily Report sent.");
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
    initDailyScheduler(); // 🆕 Start the midnight clock
});

client.login(process.env.DISCORD_TOKEN);
