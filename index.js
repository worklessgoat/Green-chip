const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const axios = require('axios');
const express = require('express');
const moment = require('moment'); // For precise age calculation

// --- SERVER (Keeps bot alive on Render 24/7) ---
const app = express();
app.get('/', (req, res) => res.send('🟢 Green Chip GOD MODE is Live'));
app.listen(3000, () => console.log('✅ Server ready on port 3000'));

// --- BOT CONFIGURATION ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- MEMORY SYSTEM ---
const activeCalls = new Map(); // Stores data for gain tracking/replies
const processedCoins = new Set(); // Ensures we NEVER call the same coin twice

// --- ⚙️ "BEST OF THE BEST" SETTINGS ---
// Strictly tuned to your request: $20k-$90k, <1 Hour Old
const MIN_MCAP = 20000;         
const MAX_MCAP = 90000;         
const MIN_LIQUIDITY = 1500;     // Safety floor ($1.5k)
const MAX_AGE_MINUTES = 60;     // strictly < 1 hour old
const MIN_VOL_H1 = 500;         // Must be active
const REQUIRE_SOCIALS = true;   // MUST have Twitter/Telegram (Real Hype Check)
const REFERRAL_LINK = "https://gmgn.ai/r/Greenchip";

// --- 1. LOGIN & START ---
client.once('ready', () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🟢 GREEN CHIP GOD MODE ONLINE 🟢    ║
║   Target: $20k-$90k | < 1 Hour Old    ║
║   Status: SCANNING LIVE MARKET...     ║
╚═══════════════════════════════════════╝
    `);

    client.user.setPresence({
        activities: [{ name: 'Solana New Pairs', type: ActivityType.Watching }],
        status: 'online'
    });

    // ⚡ FAST SCAN (Every 10 seconds)
    setInterval(scanMarket, 10000);
    
    // 📈 GAIN TRACKING (Every 30 seconds)
    setInterval(trackGains, 30000);
});

// --- 2. COMMANDS ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // !test - Mock Alert to prove bot is online
    if (message.content === '!test') {
        const mockPair = {
            baseToken: { name: 'TEST COIN', symbol: 'TEST', address: 'So11111111111111111111111111111111111111112' },
            priceUsd: '0.001',
            fdv: 35000,
            liquidity: { usd: 5000 },
            volume: { h1: 15000 },
            pairCreatedAt: Date.now(),
            info: { socials: [{ type: 'twitter', url: 'https://twitter.com/test' }] },
            dexId: 'raydium'
        };
        await sendAlert(mockPair, message.channel.id, true);
        message.reply("✅ Bot is online. Use this call to check formatting.");
    }
});

// --- 3. THE "BEST" SCANNER ---
async function scanMarket() {
    try {
        // Fetch up to 100 latest Solana pairs
        const { data } = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana');
        if (!data.pairs) return;

        const now = Date.now();

        for (const pair of data.pairs) {
            // 🛑 BASIC FILTERS
            if (pair.chainId !== 'solana') continue;
            if (processedCoins.has(pair.baseToken.address)) continue; // Never call twice

            // 📊 EXTRACT DATA
            const mcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const volH1 = pair.volume?.h1 || 0;
            
            // 🕒 AGE CALCULATION (Strict 1 Hour Rule)
            const createdAt = pair.pairCreatedAt || now;
            const ageMinutes = (now - createdAt) / (1000 * 60);

            // 🐦 SOCIALS CHECK (Real Hype Indicator)
            // We use DexScreener's social data as the "Real/Live" proof.
            const socials = pair.info?.socials || [];
            const hasSocials = socials.length > 0;

            // --- 🔥 THE STRICT FILTER LOGIC ---
            const isGemZone = mcap >= MIN_MCAP && mcap <= MAX_MCAP;
            const isSafe = liq >= MIN_LIQUIDITY;
            const isMoving = volH1 >= MIN_VOL_H1;
            const isNew = ageMinutes <= MAX_AGE_MINUTES; // Strictly < 60 mins
            const passesSocials = REQUIRE_SOCIALS ? hasSocials : true;

            if (isGemZone && isSafe && isMoving && isNew && passesSocials) {
                console.log(`🎯 SNIPED: ${pair.baseToken.name} ($${mcap})`);
                await sendAlert(pair, process.env.CHANNEL_ID, false);
                
                // Add to memory
                processedCoins.add(pair.baseToken.address);
                activeCalls.set(pair.baseToken.address, {
                    name: pair.baseToken.name,
                    initialPrice: parseFloat(pair.priceUsd),
                    msgId: null, // Will be updated after sending
                    channelId: process.env.CHANNEL_ID,
                    highestGain: 0,
                    address: pair.baseToken.address,
                    isRugged: false
                });
            }
        }
    } catch (err) {
        console.error("Scanner Error:", err.message);
    }
}

// --- 4. PROFESSIONAL ALERT SENDER ---
async function sendAlert(pair, channelId, isTest) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const mcap = pair.fdv || pair.marketCap;
    const price = parseFloat(pair.priceUsd);
    
    // Social Links & Hype Check
    const socials = pair.info?.socials || [];
    const twitter = socials.find(s => s.type === 'twitter')?.url;
    const telegram = socials.find(s => s.type === 'telegram')?.url;
    const website = socials.find(s => s.type === 'website')?.url;

    let links = "";
    if (twitter) links += `[🐦 Twitter](${twitter}) `;
    if (telegram) links += `[✈️ Telegram](${telegram}) `;
    if (website) links += `[🌐 Web](${website})`;
    if (!links) links = "⚠️ **No Socials** (High Risk)";

    // Graduation Status Logic
    let status = "🟢 **Live Trading**";
    if (pair.dexId === 'raydium') status = "🎓 **Graduated to Raydium**";
    if (pair.dexId === 'pumpfun') status = "💊 **Pump.fun Bonding Curve**";

    // Age Display
    const created = moment(pair.pairCreatedAt);
    const ageText = created.fromNow(); // e.g., "10 minutes ago"

    const embed = new EmbedBuilder()
        .setTitle(`🚀 **GREEN CHIP CALL: ${pair.baseToken.name} ($${pair.baseToken.symbol})**`)
        .setColor('#00FF00') // Professional Green
        .setDescription(`
**${status}**
${links}

**High Upside Potential Detected**
This coin matches our strict criteria ($20k-$90k) and shows live social activity.
        `)
        .addFields(
            { name: '💎 Market Cap', value: `$${mcap.toLocaleString()}`, inline: true },
            { name: '💰 Price', value: `$${price}`, inline: true },
            { name: '🌊 Liquidity', value: `$${pair.liquidity.usd.toLocaleString()}`, inline: true },
            { name: '⏱️ Launched', value: `${ageText}`, inline: true },
            { name: '⚡ **QUICK BUY (LOWER FEES)**', value: `👉 [**CLICK HERE TO BUY ON GMGN**](${REFERRAL_LINK})` },
            { name: '📝 Contract Address (CA)', value: `\`${pair.baseToken.address}\`` }
        )
        // Auto-fetch real token image from DexScreener CDN
        .setThumbnail(pair.info?.imageUrl || 'https://dd.dexscreener.com/ds-data/tokens/solana/' + pair.baseToken.address + '.png')
        .setFooter({ text: isTest ? 'Green Chip • TEST ALERT' : 'Green Chip • Institutional Sniper • 24/7' })
        .setTimestamp();

    const msg = await channel.send({ embeds: [embed] });
    
    // Save Msg ID so we can reply to THIS specific message later
    if (!isTest && activeCalls.has(pair.baseToken.address)) {
        const data = activeCalls.get(pair.baseToken.address);
        data.msgId = msg.id; // Critical for "Reply" feature
    }
}

// --- 5. AUTOMATIC GAIN TRACKER (REPLIES) ---
async function trackGains() {
    if (activeCalls.size === 0) return;

    for (const [address, data] of activeCalls) {
        if (data.isRugged) continue;

        try {
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
            if (!res.data.pairs || res.data.pairs.length === 0) continue;

            // Get the best pair (usually first one)
            const pair = res.data.pairs[0];
            const currentPrice = parseFloat(pair.priceUsd);
            const currentLiq = pair.liquidity?.usd || 0;

            // 🛑 RUG CHECK: If Drops 90% OR Liquidity < $500
            const priceDrop = (currentPrice < data.initialPrice * 0.10); // 90% drop from call
            const liqGone = (currentLiq < 500);

            if (priceDrop || liqGone) {
                data.isRugged = true;
                await sendRugUpdate(data);
                continue;
            }

            // 🚀 GAIN CALCULATION
            const gainPct = ((currentPrice - data.initialPrice) / data.initialPrice) * 100;

            // 📢 SEND UPDATE IF > 45%
            if (gainPct >= 45 && gainPct > data.highestGain) {
                // Limit spam: Only update if gain increased by 20% since last time
                if (gainPct > (data.highestGain + 20)) {
                    data.highestGain = gainPct;
                    await sendGainReply(data, gainPct, currentPrice);
                }
            }
            
            // Stop tracking if > 10,000,000% (Maximum Cap)
            if (gainPct > 10000000) {
                 await sendGainReply(data, gainPct, currentPrice, true); // True = Final message
                 data.isRugged = true; // Stop tracking (Winner)
            }

        } catch (e) {
            console.error(`Tracking Error (${data.name}):`, e.message);
        }
    }
}

// --- 6. REPLY WITH GAINS (THREADED) ---
async function sendGainReply(data, gainPct, currentPrice, isFinal = false) {
    const channel = client.channels.cache.get(data.channelId);
    if (!channel || !data.msgId) return;

    try {
        // Fetch the ORIGINAL message to reply to it
        const originalMsg = await channel.messages.fetch(data.msgId);
        if (originalMsg) {
            // Choose Color & Emoji based on gain
            const isMoon = gainPct >= 100;
            const emoji = isMoon ? '🌕' : '🚀';
            const color = isMoon ? '#FFD700' : '#00FF00'; // Gold or Green

            const embed = new EmbedBuilder()
                .setTitle(`${emoji} **GAIN UPDATE: +${gainPct.toFixed(2)}%**`)
                .setColor(color)
                .setDescription(`
**${data.name} is pumping!**
Current Price: $${currentPrice}
Initial Price: $${data.initialPrice}

[👉 **SECURE PROFITS ON GMGN**](${REFERRAL_LINK})
                `);
            
            if (isFinal) embed.setFooter({ text: 'Maximum Tracking Reached (10M%)' });

            await originalMsg.reply({ embeds: [embed] });
        }
    } catch (e) { console.error("Reply failed - message might be deleted"); }
}

// --- 7. STOP TRACKING (RUG/CRASH) ---
async function sendRugUpdate(data) {
    const channel = client.channels.cache.get(data.channelId);
    if (!channel || !data.msgId) return;
    try {
        const originalMsg = await channel.messages.fetch(data.msgId);
        if (originalMsg) {
            const embed = new EmbedBuilder()
                .setTitle('⚠️ **STOP LOSS / RUG ALERT**')
                .setColor('#FF0000') // Red
                .setDescription(`**${data.name}** dropped >90% or removed liquidity.\nTracking stopped.`);
            await originalMsg.reply({ embeds: [embed] });
        }
    } catch (e) {}
}

client.login(process.env.DISCORD_TOKEN);
