const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// --- SERVER SETUP (Keeps bot alive on Render) ---
const app = express();
app.get('/', (req, res) => res.send('Green Chip Bot is Online! 🟢'));
app.listen(3000, () => console.log('Web server ready.'));

// --- BOT CONFIG ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// MEMORY
const activeCalls = new Map();

// FILTERS
const MIN_MCAP = 20000;
const MAX_MCAP = 55000;
const MIN_LIQUIDITY = 1500;
const MIN_GAIN_TO_ALERT = 45; 

// --- 1. LOGIN & START ---
client.once('ready', () => {
    console.log(`✅ LOGGED IN AS: ${client.user.tag}`);
    console.log(`waiting for !test command or market data...`);
    
    // Start the automatic cycles
    setInterval(scanForNewCoins, 30000); // Scan every 30s
    setInterval(trackGains, 45000);      // Track gains every 45s
});

// --- 2. LISTENER FOR !TEST COMMAND ---
client.on('messageCreate', async (message) => {
    // Ignore bot's own messages
    if (message.author.bot) return;

    // If user types "!test"
    if (message.content === '!test') {
        console.log('Test command received!');
        
        // Create a FAKE coin for demonstration
        const mockPair = {
            baseToken: { name: 'TEST COIN', symbol: 'TEST', address: 'So11111111111111111111111111111111111111112' },
            priceUsd: '0.0025',
            fdv: 45000,
            liquidity: { usd: 5000 },
            volume: { h24: 12000 },
            pairAddress: 'mock-address'
        };

        await sendCall(mockPair, message.channel.id);
        message.reply("✅ Test successful! If you see the embed above, I am working.");
    }
});

// --- 3. SCANNER LOGIC ---
async function scanForNewCoins() {
    console.log('...Scanning Solana Market...');
    try {
        const response = await axios.get('https://api.dexscreener.com/latest/dex/search?q=solana');
        const pairs = response.data.pairs;

        if (!pairs) return;

        for (const pair of pairs) {
            if (pair.chainId !== 'solana') continue;
            if (activeCalls.has(pair.pairAddress)) continue;

            const mcap = pair.fdv || pair.marketCap;
            const liquidity = pair.liquidity?.usd || 0;
            const vol = pair.volume?.h24 || 0;

            // STRICT FILTERS
            if (mcap >= MIN_MCAP && mcap <= MAX_MCAP && liquidity >= MIN_LIQUIDITY && vol > 500) {
                console.log(`MATCH FOUND: ${pair.baseToken.name}`);
                await sendCall(pair, process.env.CHANNEL_ID);
            }
        }
    } catch (error) {
        console.error("Scanner error:", error.message);
    }
}

// --- 4. SEND ALERT FUNCTION ---
async function sendCall(pair, channelId) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        console.log("Channel not found!");
        return;
    }

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

    // Track it
    if (pair.pairAddress !== 'mock-address') {
        activeCalls.set(pair.pairAddress, {
            initialPrice: price,
            msgId: sentMsg.id,
            channelId: channel.id,
            highestGain: 0,
            address: pair.baseToken.address,
            name: pair.baseToken.name
        });
    }
}

// --- 5. GAIN TRACKING ---
async function trackGains() {
    for (const [pairAddress, data] of activeCalls) {
        try {
            const res = await axios.get(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
            if (!res.data.pairs || res.data.pairs.length === 0) continue;

            const currentPair = res.data.pairs[0];
            const currentPrice = parseFloat(currentPair.priceUsd);
            const currentLiq = currentPair.liquidity?.usd || 0;

            if (currentLiq < 100) {
                activeCalls.delete(pairAddress); // Rugged
                continue;
            }

            const gainPct = ((currentPrice - data.initialPrice) / data.initialPrice) * 100;

            if (gainPct >= MIN_GAIN_TO_ALERT && gainPct > data.highestGain) {
                if (gainPct > (data.highestGain + 20)) { 
                    data.highestGain = gainPct;
                    await sendUpdate(data, gainPct, currentPrice);
                }
            }
        } catch (e) { console.error(e.message); }
    }
}

async function sendUpdate(data, gainPct, currentPrice) {
    const channel = client.channels.cache.get(data.channelId);
    if (!channel) return;
    try {
        const originalMsg = await channel.messages.fetch(data.msgId);
        if (originalMsg) {
            const gainEmbed = new EmbedBuilder()
                .setTitle(`🚀 **GAIN UPDATE: +${gainPct.toFixed(2)}%**`)
                .setColor('#FFD700')
                .setDescription(`**${data.name}** is pumping!\nCurrent Price: $${currentPrice}\n\n[👉 Check on GMGN](https://gmgn.ai/r/Greenchip)`);
            await originalMsg.reply({ embeds: [gainEmbed] });
        }
    } catch (err) {}
}

client.login(process.env.DISCORD_TOKEN);
