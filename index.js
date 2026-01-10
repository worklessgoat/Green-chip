const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SERVER (Keeps bot alive) ---
const app = express();
app.get('/', (req, res) => res.send('🟢 Green Chip SNIPER is Live 24/7'));
app.listen(3000, () => console.log('✅ Server ready on port 3000'));

// --- BOT CONFIG ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- MEMORY SYSTEM ---
const activeCalls = new Map(); // Address -> {name, calledAt, initialPrice, mcap, highestGain}
const ruggedCoins = new Set(); // Track rugged coins to stop updates

// --- ⚙️ ELITE SNIPER SETTINGS ---
const MIN_MCAP = 20000;
const MAX_MCAP = 55000;
const MIN_LIQUIDITY = 2500;
const MIN_VOL_H1 = 800;
const MIN_VOL_H6 = 3000;
const REQUIRE_SOCIALS = true;
const MIN_HOLDERS = 50; // Minimum holders for legitimacy
const MAX_AGE_HOURS = 72; // Only coins less than 3 days old

// Pump.fun & Raydium Detection
const PUMPFUN_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const RAYDIUM_PROGRAM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';

// --- 1. LOGIN & INITIALIZATION ---
client.once('ready', async () => {
    console.log(`
╔═══════════════════════════════════════╗
║   🟢 GREEN CHIP SNIPER ACTIVATED 🟢   ║
║   Bot: ${client.user.tag.padEnd(27)}║
║   Mode: Ultra High Conviction Calls  ║
║   Range: $20k - $55k Market Cap      ║
║   Status: LIVE & HUNTING 24/7        ║
╚═══════════════════════════════════════╝
    `);

    // Set bot status
    client.user.setPresence({
        activities: [{ name: '🎯 Sniping 100x Gems', type: ActivityType.Watching }],
        status: 'online'
    });

    // Start scanning systems
    setInterval(scanMarket, 12000); // Fast scan every 12s
    setInterval(trackGains, 30000); // Update gains every 30s
    
    console.log('🔍 Market scanner initialized');
    console.log('📊 Gain tracker initialized');
});

// --- 2. COMMANDS ---
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();

    // !test - Verify bot is alive
    if (content === '!test') {
        const uptime = formatUptime(process.uptime());
        const embed = new EmbedBuilder()
            .setColor('#00FF00')
            .setTitle('✅ Green Chip is ONLINE')
            .setDescription('**Bot Status: Fully Operational**')
            .addFields(
                { name: '⏱️ Uptime', value: uptime, inline: true },
                { name: '📡 Active Calls', value: `${activeCalls.size}`, inline: true },
                { name: '🎯 Mode', value: 'Ultra Sniper', inline: true },
                { name: '💎 MCap Range', value: '$20k - $55k', inline: true },
                { name: '🔥 Scan Speed', value: '12 seconds', inline: true },
                { name: '📊 Gain Tracking', value: 'Live (30s)', inline: true }
            )
            .setFooter({ text: 'Green Chip • Premium Sniper Bot' })
            .setTimestamp();
        
        await message.channel.send({ embeds: [embed] });
    }

    // !stats - Show performance stats
    if (content === '!stats') {
        const totalCalls = activeCalls.size;
        const ruggedCount = ruggedCoins.size;
        const activeCount = totalCalls - ruggedCount;
        
        const embed = new EmbedBuilder()
            .setColor('#FFD700')
            .setTitle('📊 Green Chip Performance')
            .addFields(
                { name: '🎯 Total Calls', value: `${totalCalls}`, inline: true },
                { name: '✅ Active', value: `${activeCount}`, inline: true },
                { name: '❌ Rugged', value: `${ruggedCount}`, inline: true }
            )
            .setTimestamp();
        
        await message.channel.send({ embeds: [embed] });
    }
});

// --- 3. ELITE MARKET SCANNER ---
async function scanMarket() {
    try {
        // Multi-source data aggregation
        const dexData = await axios.get('https://api.dexscreener.com/latest/dex/tokens/solana', {
            timeout: 8000
        });

        if (!dexData.data?.pairs) return;

        const now = Date.now();

        for (const pair of dexData.data.pairs) {
            if (pair.chainId !== 'solana') continue;
            if (activeCalls.has(pair.baseToken.address)) continue;

            // --- DATA EXTRACTION ---
            const mcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;
            const volH1 = pair.volume?.h1 || 0;
            const volH6 = pair.volume?.h6 || 0;
            const priceUsd = parseFloat(pair.priceUsd || 0);
            const priceChange = pair.priceChange?.h1 || 0;
            
            // Age calculation
            const createdAt = pair.pairCreatedAt || now;
            const ageHours = (now - createdAt) / (1000 * 60 * 60);

            // Social validation
            const socials = pair.info?.socials || [];
            const twitter = socials.find(s => s.type === 'twitter')?.url;
            const telegram = socials.find(s => s.type === 'telegram')?.url;
            const website = socials.find(s => s.type === 'website')?.url;
            const hasSocials = socials.length >= 1;

            // Holder validation (from pair data if available)
            const txnCount = (pair.txns?.h1?.buys || 0) + (pair.txns?.h1?.sells || 0);
            const estimatedHolders = Math.min(txnCount * 0.6, 999); // Estimate

            // --- ELITE FILTERS ---
            const isInGemZone = mcap >= MIN_MCAP && mcap <= MAX_MCAP;
            const isSafe = liq >= MIN_LIQUIDITY;
            const isActive = volH1 >= MIN_VOL_H1 && volH6 >= MIN_VOL_H6;
            const isNew = ageHours <= MAX_AGE_HOURS;
            const hasEnoughHolders = estimatedHolders >= MIN_HOLDERS;
            const passesSocials = REQUIRE_SOCIALS ? hasSocials : true;
            const isMovingUp = priceChange > 5; // At least 5% up in 1h

            // Anti-rug: Check liquidity lock indicators
            const isLiquidityHealthy = liq > (mcap * 0.05); // At least 5% of mcap

            if (isInGemZone && isSafe && isActive && isNew && 
                hasEnoughHolders && passesSocials && isMovingUp && isLiquidityHealthy) {
                
                console.log(`🎯 ELITE CALL: ${pair.baseToken.name} | MCap: $${mcap.toLocaleString()}`);
                
                // Enhanced validation with Twitter sentiment
                const sentiment = await checkTwitterSentiment(pair.baseToken.symbol);
                const graduated = await checkPumpFunStatus(pair.baseToken.address);
                
                await sendEliteAlert(pair, process.env.CHANNEL_ID, {
                    twitter,
                    telegram,
                    website,
                    sentiment,
                    graduated,
                    ageHours
                });

                // Store call data for gain tracking
                activeCalls.set(pair.baseToken.address, {
                    name: pair.baseToken.name,
                    symbol: pair.baseToken.symbol,
                    calledAt: now,
                    initialPrice: priceUsd,
                    initialMcap: mcap,
                    pairAddress: pair.pairAddress,
                    highestGain: 0
                });
            }
        }
    } catch (err) {
        console.error("⚠️ Scan Error:", err.message);
    }
}

// --- 4. PUMP.FUN GRADUATION CHECKER ---
async function checkPumpFunStatus(tokenAddress) {
    try {
        // Check if token has graduated from Pump.fun to Raydium
        const response = await axios.get(
            `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
            { timeout: 5000 }
        );

        if (!response.data?.pairs) return { graduated: false, platform: 'Unknown' };

        const raydiumPair = response.data.pairs.find(p => 
            p.dexId === 'raydium' || p.labels?.includes('v3')
        );

        if (raydiumPair) {
            return { 
                graduated: true, 
                platform: 'Raydium',
                dexId: raydiumPair.dexId 
            };
        }

        return { graduated: false, platform: 'Pump.fun/Ongoing' };
    } catch {
        return { graduated: false, platform: 'Unknown' };
    }
}

// --- 5. TWITTER SENTIMENT ANALYSIS ---
async function checkTwitterSentiment(symbol) {
    try {
        // Use Google search to find recent Twitter mentions
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=${process.env.SEARCH_ENGINE_ID}&q=${symbol}+crypto+twitter&num=5`;
        
        if (!process.env.GOOGLE_API_KEY) {
            return { hype: 'Unknown', mentions: 0 };
        }

        const { data } = await axios.get(searchUrl, { timeout: 5000 });
        const mentions = data.searchInformation?.totalResults || 0;
        
        const hypeLevel = mentions > 10000 ? '🔥 TRENDING' : 
                         mentions > 1000 ? '📈 Growing' : 
                         '🌱 Early';

        return { hype: hypeLevel, mentions: parseInt(mentions) };
    } catch {
        return { hype: 'Unknown', mentions: 0 };
    }
}

// --- 6. ELITE ALERT SENDER ---
async function sendEliteAlert(pair, channelId, extras) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const mcap = pair.fdv || pair.marketCap;
    const price = parseFloat(pair.priceUsd);
    const liq = pair.liquidity?.usd || 0;
    const volH1 = pair.volume?.h1 || 0;
    const priceChange1h = pair.priceChange?.h1 || 0;
    const priceChange6h = pair.priceChange?.h6 || 0;
    
    // Social links
    let socialText = "📱 **Socials:** ";
    if (extras.twitter) socialText += `[Twitter](${extras.twitter}) `;
    if (extras.telegram) socialText += `[Telegram](${extras.telegram}) `;
    if (extras.website) socialText += `[Website](${extras.website})`;
    if (!extras.twitter && !extras.telegram && !extras.website) {
        socialText = "⚠️ **No Socials** - Higher Risk";
    }

    // Graduation status
    const gradStatus = extras.graduated.graduated 
        ? `✅ **Graduated to ${extras.graduated.platform}**` 
        : `⏳ **On ${extras.graduated.platform}** - Not Yet Graduated`;

    // Age badge
    const ageBadge = extras.ageHours < 24 ? '🆕 FRESH (<24h)' : 
                     extras.ageHours < 48 ? '⚡ NEW (<48h)' : 
                     '📅 Recent (<72h)';

    const embed = new EmbedBuilder()
        .setColor('#00FF41')
        .setTitle(`🎯 GREEN CHIP CALL: ${pair.baseToken.name} ($${pair.baseToken.symbol})`)
        .setDescription(`
**${ageBadge}**
${gradStatus}
${socialText}

**Twitter Sentiment:** ${extras.sentiment.hype} (${extras.sentiment.mentions.toLocaleString()} mentions)
        `)
        .addFields(
            { name: '💎 Market Cap', value: `$${mcap.toLocaleString()}`, inline: true },
            { name: '💰 Price', value: `$${price.toFixed(10)}`, inline: true },
            { name: '🌊 Liquidity', value: `$${liq.toLocaleString()}`, inline: true },
            { name: '📊 Volume 1h', value: `$${volH1.toLocaleString()}`, inline: true },
            { name: '📈 1h Change', value: `${priceChange1h > 0 ? '+' : ''}${priceChange1h.toFixed(2)}%`, inline: true },
            { name: '📈 6h Change', value: `${priceChange6h > 0 ? '+' : ''}${priceChange6h.toFixed(2)}%`, inline: true },
            { 
                name: '⚡ FAST BUY (Lower Fees)', 
                value: `[👉 **Trade on GMGN**](https://gmgn.ai/r/Greenchip?chain=sol&token=${pair.baseToken.address})\n*Use this platform for reduced trading fees*` 
            },
            { name: '📝 Contract Address', value: `\`\`\`${pair.baseToken.address}\`\`\`` }
        )
        .setThumbnail(pair.info?.imageUrl || `https://dd.dexscreener.com/ds-data/tokens/solana/${pair.baseToken.address}.png`)
        .setFooter({ text: 'Green Chip • Elite Sniper • $20k-$55k Zone • Auto Gain Tracking Active' })
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

// --- 7. AUTOMATIC GAIN TRACKER ---
async function trackGains() {
    if (activeCalls.size === 0) return;

    try {
        for (const [address, callData] of activeCalls.entries()) {
            if (ruggedCoins.has(address)) continue;

            // Fetch current price
            const { data } = await axios.get(
                `https://api.dexscreener.com/latest/dex/tokens/${address}`,
                { timeout: 5000 }
            );

            if (!data?.pairs?.[0]) continue;

            const pair = data.pairs[0];
            const currentPrice = parseFloat(pair.priceUsd || 0);
            const currentMcap = pair.fdv || pair.marketCap || 0;
            const liq = pair.liquidity?.usd || 0;

            if (currentPrice === 0) continue;

            // Calculate gain
            const gainPercent = ((currentPrice - callData.initialPrice) / callData.initialPrice) * 100;

            // Rug detection
            const isRugged = liq < 500 || currentMcap < (callData.initialMcap * 0.3);

            if (isRugged) {
                ruggedCoins.add(address);
                await sendRugAlert(callData, process.env.CHANNEL_ID);
                continue;
            }

            // Only send update if gain >= 45% AND is higher than previous highest
            if (gainPercent >= 45 && gainPercent > callData.highestGain) {
                callData.highestGain = gainPercent;
                await sendGainUpdate(callData, gainPercent, currentPrice, currentMcap, process.env.CHANNEL_ID);
            }

            // Stop tracking if gain exceeds 10,000,000% (ultra rare but possible)
            if (gainPercent >= 10000000) {
                await sendMegaGainAlert(callData, gainPercent, process.env.CHANNEL_ID);
                ruggedCoins.add(address); // Stop tracking this winner
            }
        }
    } catch (err) {
        console.error("⚠️ Gain Tracker Error:", err.message);
    }
}

// --- 8. GAIN UPDATE MESSAGE ---
async function sendGainUpdate(callData, gainPercent, currentPrice, currentMcap, channelId) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const gainColor = gainPercent >= 1000 ? '#FFD700' : // Gold for 10x+
                      gainPercent >= 500 ? '#FF6B00' :  // Orange for 5x+
                      gainPercent >= 200 ? '#00FF41' :  // Green for 2x+
                      '#00BFFF';                         // Blue for <2x

    const embed = new EmbedBuilder()
        .setColor(gainColor)
        .setTitle(`📈 GAIN UPDATE: ${callData.name}`)
        .setDescription(`**Our call is up +${gainPercent.toFixed(2)}%!**`)
        .addFields(
            { name: '💵 Called At', value: `$${callData.initialPrice.toFixed(10)}`, inline: true },
            { name: '💰 Current Price', value: `$${currentPrice.toFixed(10)}`, inline: true },
            { name: '📊 Current MCap', value: `$${currentMcap.toLocaleString()}`, inline: true },
            { name: '🚀 Gain', value: `**+${gainPercent.toFixed(2)}%**`, inline: false }
        )
        .setFooter({ text: 'Green Chip Gain Tracker • Live Updates' })
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

// --- 9. RUG ALERT ---
async function sendRugAlert(callData, channelId) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#FF0000')
        .setTitle(`🚨 RUG DETECTED: ${callData.name}`)
        .setDescription(`**This coin appears to have been rugged. Gain tracking stopped.**`)
        .addFields(
            { name: '⚠️ Status', value: 'Liquidity Removed or Severe Dump', inline: false },
            { name: '📉 Action', value: 'Exit immediately if you haven\'t already', inline: false }
        )
        .setFooter({ text: 'Green Chip Protection System' })
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

// --- 10. MEGA GAIN ALERT (For 100x+ gains) ---
async function sendMegaGainAlert(callData, gainPercent, channelId) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setColor('#FFD700')
        .setTitle(`🏆 LEGENDARY GAIN: ${callData.name}`)
        .setDescription(`**UNBELIEVABLE! This call hit +${gainPercent.toLocaleString()}%!**`)
        .addFields(
            { name: '👑 Achievement', value: 'MEGA WINNER - Tracking Complete', inline: false },
            { name: '💎 Initial Call', value: `$${callData.initialPrice.toFixed(10)}`, inline: true },
            { name: '🚀 Peak Gain', value: `**+${gainPercent.toLocaleString()}%**`, inline: true }
        )
        .setFooter({ text: 'Green Chip • Ultimate Sniper Success' })
        .setTimestamp();

    await channel.send({ embeds: [embed] });
}

// --- UTILITY FUNCTIONS ---
function formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    return `${days}d ${hours}h ${minutes}m`;
}

// --- ERROR HANDLING ---
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
});

client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
});

// --- START BOT ---
client.login(process.env.DISCORD_TOKEN);
