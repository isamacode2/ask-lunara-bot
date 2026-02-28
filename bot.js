require('dotenv').config();

const { Client, GatewayIntentBits, Partials } = require('discord.js');
const OpenAI = require('openai');

// ── Create Discord client ────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

// ── OpenAI client ─────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ── Config ────────────────────────────────────────────────
const FOUNDER_DISCORD_ID = process.env.FOUNDER_DISCORD_ID;

const DETAIL_KEYWORDS = [
  'verification',
  'privacy',
  'public profile',
  'data storage',
  'moderation',
  'gdpr',
  'who can see',
];

const SYSTEM_PROMPT = `
You are Ask-Lunara, the official assistant for Lunara — a privacy-first, consent-gated platform built for open relationships, polyamory, and the broader ENM community.

Core facts:
- ID verification required
- Consent-gated visibility
- No public profiles
- Zero data sold
- Founding members receive 3 months Premium free
- Community-first platform
- Waitlist at lunara.dating

If unsure, say: "That’s still being finalised — check lunara.dating for updates."
Keep responses concise, confident, and inclusive.
`;

// ── Ready event ───────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Ask-Lunara bot is online as ${client.user.tag}`);
});

// ── Message handler ───────────────────────────────────────
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.mentions.has(client.user)) return;

  const question = message.content
    .replace(/<@!?\d+>/, '')
    .trim();

  if (!question) return;

  const lowerQ = question.toLowerCase();
  const needsDetail = DETAIL_KEYWORDS.some((kw) =>
    lowerQ.includes(kw)
  );

  const maxTokens = needsDetail ? 300 : 150;

  console.log("Processing question:", question);

  try {
    await message.channel.sendTyping();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: question },
      ],
    });

    const answer =
      completion.choices[0]?.message?.content?.trim();

    if (!answer) {
      await message.reply(
        "I didn’t quite catch that. Could you rephrase? 🌙"
      );
      return;
    }

    const vagueIndicators = [
      "i don't know",
      "not sure",
      "unclear",
      "cannot answer",
    ];

    const isVague = vagueIndicators.some((v) =>
      answer.toLowerCase().includes(v)
    );

    if (isVague && FOUNDER_DISCORD_ID) {
      await message.reply(
        `${answer}\n\n_Tagging <@${FOUNDER_DISCORD_ID}> for clarification._`
      );
    } else {
      await message.reply(answer);
    }
  } catch (error) {
    console.error("OpenAI error:", error);
    await message.reply(
      "I’m having a moment — please try again shortly. 🌙"
    );
  }
});

// ── Login ─────────────────────────────────────────────────
client.login(process.env.DISCORD_BOT_TOKEN);