const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SERVER SETUP (Keeps bot alive) ---
const app = express();
app.get('/', (req, res) => res.send('Green Chip PRO is Running!'));
app.listen(3000, () => console.log('Server ready.'));

// --- BOT CONFIG ---
const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

// MEMORY (To track gains)
const activeCalls = new Map(); // Stores: { pairAddress: { initialPrice, msgId, channelId, highWaterMark } }

// --- SETTINGS ---
const MIN_MCAP = 20000;
const MAX_MCAP = 55000;
const MIN_LIQUIDITY = 1500;
const MIN_GAIN_TO_ALERT = 45; // Only reply if +45% gain
const MAX_GAIN_CAP = 10000000; // 10M% cap

// --- MAIN LOGIC ---
client.once('ready', () => {
    console.log(`✅ Green Chip PRO Logged in as ${client.user.tag}`);
    
    // 1. Scan for NEW coins every 30 seconds
    setInterval(scanForNewCoins, 30000);

    // 2. Track GAINS on old coins every 45 seconds
    setInterval(trackGains, 45000);
});

// --- SCANNER FUNCTION ---
async function scanForNewCoins() {
    try {
        const response = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana');
        const pairs = response.data.pairs;

        if (!pairs) return;

        for (const pair of pairs) {
            if (pair.chainId !== 'solana') continue;
            if (activeCalls.has(pair.pairAddress)) continue; // Already called this coin

            const mcap = pair.fdv || pair.marketCap;
            const liquidity = pair.liquidity?.usd || 0;
            const vol = pair.volume?.h24 || 0;

            // STRICT FILTER RULES
            if (mcap >= MIN_MCAP && mcap <= MAX_MCAP && liquidity >= MIN_LIQUIDITY && vol > 500) {
                await sendCall(pair);
            }
        }
    } catch (error) {
        console.error("Scanner error:", error.message);
    }
}

// --- SEND CALL FUNCTION ---
async function sendCall(pair) {
    const channel = client.channels.cache.get(process.env.CHANNEL_ID);
    if (!channel) return;

    const price = parseFloat(pair.priceUsd);

    const embed = new EmbedBuilder()
        .setTitle(`🚨 **GREEN CHIP CALL: ${pair.baseToken.name}**`)
        .setColor('#00FF00')
        .setDescription(`**High Potential Coin Detected**\nMarket Cap: $${(pair.fdv || pair.marketCap).toLocaleString()}`)
        .addFields(
            { name: '💰 Price', value: `$${price}`, inline: true },
            { name: '💧 Liquidity', value: `$${pair.liquidity.usd.toLocaleString()}`, inline: true },
            { name: '📝 Contract', value: `\`${pair.baseToken.address}\`` },
            { name: '⚡ LOWER FEES LINK', value: '[👉 **CLICK TO TRADE ON GMGN**](https://gmgn.ai/r/Greenchip)' }
        )
        .setTimestamp();

    const sentMsg = await channel.send({ embeds: [embed] });

    // SAVE TO MEMORY FOR TRACKING
    activeCalls.set(pair.pairAddress, {
        initialPrice: price,
        msgId: sentMsg.id,
        channelId: channel.id,
        highestGain: 0,
        address: pair.baseToken.address,
        name: pair.baseToken.name
    });
}

// --- TRACK GAINS FUNCTION ---
async function trackGains() {
    for (const [pairAddress, data] of activeCalls) {
        try {
            // Check current price
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
            if (!res.data.pairs || res.data.pairs.length === 0) continue;

            const currentPair = res.data.pairs[0];
            const currentPrice = parseFloat(currentPair.priceUsd);
            const currentLiq = currentPair.liquidity?.usd || 0;

            // ANTI-RUG: Stop tracking if liquidity dies (< $100)
            if (currentLiq < 100) {
                activeCalls.delete(pairAddress);
                continue;
            }

            // CALC GAIN
            const gainPct = ((currentPrice - data.initialPrice) / data.initialPrice) * 100;

            // IF GAIN > 45% AND NEW HIGH SCORE
            if (gainPct >= MIN_GAIN_TO_ALERT && gainPct > data.highestGain) {
                // Update memory so we don't spam the same percentage
                // Only alert on significant steps (e.g. 45%, 100%, 200%)
                if (gainPct > (data.highestGain + 20)) { 
                    data.highestGain = gainPct;
                    await sendUpdate(data, gainPct, currentPrice);
                }
            }

        } catch (e) {
            console.error(`Tracking Error for ${data.name}: ${e.message}`);
        }
    }
}

// --- REPLY UPDATE FUNCTION ---
async function sendUpdate(data, gainPct, currentPrice) {
    const channel = client.channels.cache.get(data.channelId);
    if (!channel) return;

    try {
        const originalMsg = await channel.messages.fetch(data.msgId);
        if (originalMsg) {
            const gainEmbed = new EmbedBuilder()
                .setTitle(`🚀 **GAIN UPDATE: +${gainPct.toFixed(2)}%**`)
                .setColor('#FFD700') // Gold
                .setDescription(`**${data.name}** is pumping!\nCurrent Price: $${currentPrice}\n\n[👉 Check on GMGN](https://gmgn.ai/r/Greenchip)`);
            
            await originalMsg.reply({ embeds: [gainEmbed] });
        }
    } catch (err) {
        console.log("Could not find original message to reply to.");
    }
}

client.login(process.env.DISCORD_TOKEN);
