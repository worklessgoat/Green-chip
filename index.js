// ==================================================================================
//  🟢 GREEN CHIP V8.5 - US TIMEZONE & COMPACT UI
//  ---------------------------------------------------------------------------------
//  Changes:
//  [1] 🇺🇸 TIMEZONE: Set to America/New_York (EST).
//  [2] 📱 COMPACT UI: "Rick-Style" alerts with no dead space.
//  [3] 📋 COPY BUTTON: Added Copy CA button + Warning Fix.
//  [4] 🖼️ IMAGES: Auto-adds Profile & Banner if available.
//  [5] 💰 MCAP GAINS: Tracker replies use MCAP instead of Price.
//  ---------------------------------------------------------------------------------
//  Author: Gemini (AI) for GreenChip
//  Version: 8.5.0-RICK-STYLE
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
    MessageFlags // 🆕 Added to fix the warning log
} = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment-timezone'); // 🆕 Ensure 'npm install moment-timezone'

// 🆕 Set Timezone to US (New York / EST)
moment.tz.setDefault("America/New_York");

// ==================================================================================
//  ⚙️  CONFIGURATION MATRIX
// ==================================================================================

const CONFIG = {
    BOT_NAME: "Green Chip V8",
    VERSION: "8.5.0-COMPACT",
    
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
        if (m < 1) return '🔥 New'; // Compact text
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
        // 🆕 Log using US Time
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
            entry: data.price,
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
        let status = 'Unknown Source';
        const dex = (pair.dexId || '').toLowerCase();
        if (dex.includes('raydium')) status = 'Raydium';
        if (dex.includes('pump')) status = 'Pump.Fun';

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
        price: parseFloat(pair.priceUsd) 
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
//  💬  DISCORD SENDER (COMPACT / RICK STYLE)
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
    const info = pair.info || {}; // 🆕 Info object for images
    const socials = info.socials || [];
    const dexLink = `https://dexscreener.com/solana/${pair.pairAddress}`;
    
    // --- 🆕 Rick Style Badge Logic ---
    let badge = '⚡'; 
    if (source === 'BOOST') badge = '🚀';
    if (source === 'PROFILE') badge = '💎';
    if (analysis.status === 'Raydium') badge = '🎓';
    
    // Title: 💊 Name [MCAP] - SYMBOL/SOL
    const mcapShort = Utils.formatUSD(analysis.fdv);
    const title = `${badge} ${token.name} [${mcapShort}] - ${token.symbol}/SOL`;

    // --- 🆕 Compact Body (No dead space) ---
    const age = Utils.getAge(pair.pairCreatedAt);
    const price = parseFloat(pair.priceUsd);
    const change1h = pair.priceChange?.h1 || 0;
    const changeEmoji = change1h >= 0 ? '🟢' : '🔴';

    // Vertical line format as requested in image
    let body = `**${analysis.status}** 🔥 \n`;
    body += `💵 **USD:** \`${Utils.formatPrice(price)}\`\n`;
    body += `💎 **MCAP:** \`${mcapShort}\`\n`;
    body += `💧 **Liq:** \`${Utils.formatUSD(analysis.liq)}\`\n`;
    body += `📊 **Vol:** \`${Utils.formatUSD(analysis.vol)}\` • **Age:** \`${age}\`\n`;
    body += `📈 **1H:** \`${change1h}%\` ${changeEmoji}\n`;

    // Conditional Socials (Only add if they exist)
    if (socials.length > 0) {
        const socialLinks = socials.map(s => `[${s.type.toUpperCase()}](${s.url})`).join(' • ');
        body += `\n🔗 ${socialLinks}`;
    }

    const embed = new EmbedBuilder()
        .setColor(change1h >= 0 ? '#00FF00' : '#FF0000') // Green if up, Red if down
        .setTitle(title)
        .setURL(dexLink)
        .setDescription(body)
        .setFooter({ text: `${CONFIG.BOT_NAME} • ${moment().format('h:mm A z')}` }); // 🆕 US Time in footer

    // --- 🆕 Images (Profile & Banner) ---
    // Add Thumbnail (Icon)
    if (info.imageUrl) embed.setThumbnail(info.imageUrl);
    
    // Add Banner (Header) if available
    if (info.header) embed.setImage(info.header);

    // --- 🆕 Buttons (Buy & Copy CA) ---
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setLabel('Buy on GMGN')
            .setStyle(ButtonStyle.Link)
            .setURL(CONFIG.URLS.REFERRAL),
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
            entry: parseFloat(pair.priceUsd), // Stored for % calc
            entryMcap: analysis.fdv,          // 🆕 Stored for MCAP display
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
//  🖱️  INTERACTION HANDLER (BUTTONS)
// ==================================================================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    if (interaction.customId.startsWith('copy_')) {
        const ca = interaction.customId.split('_')[1];
        // 🆕 Warning Fix: Use MessageFlags.Ephemeral
        await interaction.reply({ 
            content: `\`${ca}\``, 
            flags: MessageFlags.Ephemeral 
        });
    }
});

// ==================================================================================
//  📅  DAILY RECAP SYSTEM
// ==================================================================================

// Runs every minute to check if it's midnight
function initDailyScheduler() {
    setInterval(async () => {
        const now = moment();
        
        // Check 12:00 AM (EST)
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

    const allCalls = Array.from(STATE.dailyStats.values());
    const sorted = allCalls.sort((a, b) => b.maxGain - a.maxGain).slice(0, 10);

    if (sorted.length === 0) {
        Utils.log('DAILY', 'Report', 'No calls today, skipping report.');
        return;
    }

    const yesterday = moment().subtract(1, 'days').format('MMMM Do');
    
    let description = `**📅 LEADERBOARD: ${yesterday}**\n\n`;

    sorted.forEach((coin, index) => {
        let icon = '🟢';
        if (coin.maxGain > 100) icon = '🚀';
        if (coin.maxGain > 500) icon = '👑';
        if (coin.status === 'RUG') icon = '💀';

        description += `\`#${index + 1}\` ${icon} **$${coin.symbol}** (+${coin.maxGain.toFixed(0)}%)\n`;
    });

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 DAILY TOP PERFORMERS`)
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
//  📈  TRACKER (MCAP GAINS VERSION)
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
            const currMcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const gain = ((currPrice - data.entry) / data.entry) * 100;

            STATE.updateDailyPeak(addr, gain, 'ACTIVE');

            if (currPrice < (data.entry * (1 - CONFIG.TRACKER.STOP_LOSS)) || liq < CONFIG.TRACKER.RUG_CHECK_LIQ) {
                await sendUpdate(data, currMcap, gain, 'RUG');
                STATE.updateDailyPeak(addr, gain, 'RUG');
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
        if (type === 'RUG') { color = '#FF0000'; title = `🚨 STOP LOSS / RUG`; }

        // 🆕 Use MCAP for display (e.g. $20k -> $40k)
        const entryStr = Utils.formatUSD(data.entryMcap);
        const currStr = Utils.formatUSD(currentMcap);

        const desc = type === 'RUG' 
            ? `⚠️ **Token Dropped >90% or Liquidity Pulled.**\nTracking stopped.`
            : `**${data.name} ($${data.symbol})**\nEntry: \`${entryStr}\` → Now: \`${currStr}\`\n\n[**💰 TAKE PROFIT**](${CONFIG.URLS.REFERRAL})`;

        const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(desc).setTimestamp();
        
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
            .setTitle('🟢 GREEN CHIP V8 - ACTIVE')
            // 🆕 US Time in Test command
            .setDescription(`**Time:** ${moment().format('MMMM Do YYYY, h:mm:ss a z')}\n**Tracking:** ${STATE.activeTracks.size} tokens`);
        await m.reply({ embeds: [embed] });
    }

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
    initDailyScheduler();
});

client.login(process.env.DISCORD_TOKEN);
